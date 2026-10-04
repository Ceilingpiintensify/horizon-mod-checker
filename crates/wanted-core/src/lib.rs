//! Answers "Is my mod on Horizon?" for one mod or a whole pack.
//!
//! Every answer comes from one of four places, checked in this order:
//!
//! 1. **Built in.** `rules/builtin.toml`: Horizon already does what the mod does.
//! 2. **Ported.** A Rust version is in Horizon's registry (`index.json`), mapped
//!    to the Java mod by `rules/ports.toml`, and not revoked.
//! 3. **Works.** Horizon's own launcher carries the jar's content over
//!    (`horizon-launcher mods check <slug> --json`).
//! 4. **Not yet.** Anything else.

use serde::Deserialize;
use std::collections::BTreeMap;
use std::fmt;

// ---------------------------------------------------------------------------
// Mod ids

/// Lowercase ASCII letters and digits, with `_` between words.
///
/// `fabric-api` becomes `fabric_api`, `Applied Energistics 2` becomes
/// `applied_energistics_2` and `Macaw's Fences and Walls` becomes
/// `macaws_fences_and_walls`. Apostrophes join, everything else separates.
pub fn normalize_id(s: &str) -> String {
    let mut out = String::new();
    let mut gap = false;
    for c in s.trim().chars() {
        if c.is_ascii_alphanumeric() {
            if gap && !out.is_empty() {
                out.push('_');
            }
            gap = false;
            out.push(c.to_ascii_lowercase());
        } else if c != '\'' && c != '\u{2019}' {
            gap = true;
        }
    }
    out
}

/// True when two names or ids mean the same mod: `ok_zoomer` and `okzoomer`.
pub fn same_mod(a: &str, b: &str) -> bool {
    let (a, b) = (normalize_id(a), normalize_id(b));
    !a.is_empty() && (a == b || a.replace('_', "") == b.replace('_', ""))
}

// ---------------------------------------------------------------------------
// Reading a jar

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Loader {
    Fabric,
    NeoForge,
    Forge,
}

/// Who a jar says it is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JarMeta {
    pub loader: Loader,
    /// Normalised with [`normalize_id`].
    pub id: String,
    pub name: String,
    pub version: String,
}

/// The manifest files a jar may carry, as text. The app reads them out of the
/// zip; tests pass strings.
#[derive(Debug, Default, Clone, Copy)]
pub struct JarFiles<'a> {
    /// `fabric.mod.json`
    pub fabric_mod_json: Option<&'a str>,
    /// `META-INF/neoforge.mods.toml`
    pub neoforge_mods_toml: Option<&'a str>,
    /// `META-INF/mods.toml` (Forge)
    pub mods_toml: Option<&'a str>,
    /// `META-INF/MANIFEST.MF`, for versions written as `${file.jarVersion}`
    pub manifest_mf: Option<&'a str>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MetaError {
    /// None of the three manifest files is in the jar.
    NoManifest,
    /// A manifest is there but can't be read.
    Invalid { file: &'static str, why: String },
}

impl fmt::Display for MetaError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            MetaError::NoManifest => write!(f, "this jar doesn't say which mod it is"),
            MetaError::Invalid { file, why } => write!(f, "{file} can't be read: {why}"),
        }
    }
}

impl std::error::Error for MetaError {}

#[derive(Deserialize)]
struct FabricJson {
    id: String,
    version: String,
    name: Option<String>,
}

#[derive(Deserialize)]
struct ModsToml {
    mods: Vec<ModsEntry>,
}

#[derive(Deserialize)]
struct ModsEntry {
    #[serde(rename = "modId")]
    mod_id: String,
    version: Option<String>,
    #[serde(rename = "displayName")]
    display_name: Option<String>,
}

/// Reads the jar's own manifest. NeoForge first, then Fabric, then Forge.
pub fn read_jar(files: &JarFiles) -> Result<JarMeta, MetaError> {
    if let Some(text) = files.neoforge_mods_toml {
        return read_mods_toml(
            text,
            "neoforge.mods.toml",
            Loader::NeoForge,
            files.manifest_mf,
        );
    }
    if let Some(text) = files.fabric_mod_json {
        let j: FabricJson = serde_json::from_str(text).map_err(|e| MetaError::Invalid {
            file: "fabric.mod.json",
            why: e.to_string(),
        })?;
        let name = j
            .name
            .filter(|n| !n.trim().is_empty())
            .unwrap_or_else(|| j.id.clone());
        return Ok(JarMeta {
            loader: Loader::Fabric,
            id: normalize_id(&j.id),
            name,
            version: j.version,
        });
    }
    if let Some(text) = files.mods_toml {
        return read_mods_toml(text, "mods.toml", Loader::Forge, files.manifest_mf);
    }
    Err(MetaError::NoManifest)
}

fn read_mods_toml(
    text: &str,
    file: &'static str,
    loader: Loader,
    mf: Option<&str>,
) -> Result<JarMeta, MetaError> {
    let t: ModsToml = toml::from_str(text).map_err(|e| MetaError::Invalid {
        file,
        why: e.message().to_string(),
    })?;
    let m = t.mods.into_iter().next().ok_or(MetaError::Invalid {
        file,
        why: "no [[mods]] entry".into(),
    })?;
    let version = match m.version.as_deref() {
        None | Some("${file.jarVersion}") => {
            mf.and_then(|mf| manifest_value(mf, "Implementation-Version"))
        }
        Some(v) => Some(v.to_string()),
    }
    .unwrap_or_else(|| "unknown".into());
    let name = m
        .display_name
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| m.mod_id.clone());
    Ok(JarMeta {
        loader,
        id: normalize_id(&m.mod_id),
        name,
        version,
    })
}

/// One value from a `MANIFEST.MF`, with continuation lines joined.
fn manifest_value(mf: &str, key: &str) -> Option<String> {
    let mut value: Option<String> = None;
    for line in mf.lines() {
        let line = line.trim_end_matches('\r');
        match (&mut value, line.strip_prefix(' ')) {
            (Some(v), Some(more)) => v.push_str(more),
            (Some(_), None) => break,
            (None, _) => {
                if let Some((k, v)) = line.split_once(':') {
                    if k.eq_ignore_ascii_case(key) {
                        value = Some(v.trim_start().to_string());
                    }
                }
            }
        }
    }
    value.filter(|v| !v.is_empty())
}

// ---------------------------------------------------------------------------
// Packs

/// What the player dropped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PackKind {
    /// A folder of jars.
    ModsFolder,
    /// A Prism Launcher or MultiMC instance folder.
    Instance,
    /// A Modrinth `.mrpack`.
    Mrpack,
    /// A CurseForge modpack zip.
    CurseForgeZip,
}

impl PackKind {
    /// Tells a pack from its file name and the paths inside it.
    pub fn detect(name: &str, entries: &[&str]) -> Option<PackKind> {
        let lower = name.to_ascii_lowercase();
        let has = |p: &str| entries.iter().any(|e| e.trim_start_matches("./") == p);
        if lower.ends_with(".mrpack") {
            Some(PackKind::Mrpack)
        } else if lower.ends_with(".zip") && has("manifest.json") {
            Some(PackKind::CurseForgeZip)
        } else if has("instance.cfg") || has("mmc-pack.json") {
            Some(PackKind::Instance)
        } else if entries
            .iter()
            .any(|e| e.to_ascii_lowercase().ends_with(".jar"))
        {
            Some(PackKind::ModsFolder)
        } else {
            None
        }
    }
}

// ---------------------------------------------------------------------------
// Rules

/// How a built-in replacement is reached.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum How {
    /// Part of the game. Always on.
    Engine,
    /// Built in, off by default. Turned on in Horizon's settings.
    Setting,
    /// One of Horizon's own mods, from the launcher's Mods page.
    OfficialMod,
}

/// A row of `rules/builtin.toml`.
#[derive(Debug, Clone, Deserialize)]
pub struct BuiltinRule {
    pub mods: Vec<String>,
    #[serde(default)]
    pub ids: Vec<String>,
    pub horizon: String,
    pub how: How,
    #[serde(default, rename = "where")]
    pub place: String,
    pub source: String,
}

impl BuiltinRule {
    fn covers(&self, id: &str) -> bool {
        self.ids.iter().chain(&self.mods).any(|m| same_mod(m, id))
    }
}

/// A row of `rules/ports.toml`.
#[derive(Debug, Clone, Deserialize)]
pub struct PortRule {
    pub java: String,
    pub registry: String,
    pub name: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct Rules {
    pub builtin: Vec<BuiltinRule>,
    pub ports: Vec<PortRule>,
}

#[derive(Deserialize)]
struct BuiltinFile {
    builtin: Vec<BuiltinRule>,
}

#[derive(Deserialize)]
struct PortsFile {
    #[serde(default)]
    port: Vec<PortRule>,
}

impl Rules {
    /// Reads the text of `rules/builtin.toml` and `rules/ports.toml`.
    pub fn from_toml(builtin: &str, ports: &str) -> Result<Rules, toml::de::Error> {
        let b: BuiltinFile = toml::from_str(builtin)?;
        let p: PortsFile = toml::from_str(ports)?;
        Ok(Rules {
            builtin: b.builtin,
            ports: p.port,
        })
    }

    pub fn builtin_for(&self, id: &str) -> Option<&BuiltinRule> {
        self.builtin.iter().find(|r| r.covers(id))
    }

    pub fn port_for(&self, id: &str) -> Option<&PortRule> {
        self.ports
            .iter()
            .find(|p| same_mod(&p.java, id) || p.name.as_deref().is_some_and(|n| same_mod(n, id)))
    }
}

// ---------------------------------------------------------------------------
// Horizon's registry

/// The registry index schema this build reads.
pub const INDEX_SCHEMA: u32 = 1;

/// Where Horizon's launcher reads the registry. Built by the CI of
/// github.com/horizon-rust/horizon-mods (docs/api/mod-index.md).
pub const INDEX_URL: &str = "https://horizon-rust.github.io/horizon-mods/index.json";

#[derive(Debug, Clone, Deserialize)]
pub struct Project {
    pub id: String,
    pub kind: String,
    pub name: String,
    /// The author's minisign public key. When set, every file must verify with it.
    #[serde(default)]
    pub key: Option<String>,
    /// Newest first.
    pub versions: Vec<Version>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Version {
    pub version: String,
    pub file: FileRef,
}

#[derive(Debug, Clone, Deserialize)]
pub struct FileRef {
    pub name: String,
    pub url: String,
    pub sha256: String,
    #[serde(default)]
    pub signature: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Revoked {
    pub id: String,
    /// One file. Without it, every version of the project.
    #[serde(default)]
    pub sha256: Option<String>,
    pub reason: String,
}

#[derive(Deserialize)]
struct IndexFile {
    schema: u32,
    projects: Vec<Project>,
    #[serde(default)]
    revoked: Vec<Revoked>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IndexError {
    /// The index is newer than this build understands.
    TooNew(u32),
    Invalid(String),
}

impl fmt::Display for IndexError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            IndexError::TooNew(n) => {
                write!(f, "the registry uses schema {n}; update Wanted to read it")
            }
            IndexError::Invalid(why) => write!(f, "the registry index can't be read: {why}"),
        }
    }
}

impl std::error::Error for IndexError {}

#[derive(Debug, Clone, Default)]
pub struct Registry {
    pub projects: BTreeMap<String, Project>,
    pub revoked: Vec<Revoked>,
}

impl Registry {
    pub fn from_json(text: &str) -> Result<Registry, IndexError> {
        let i: IndexFile =
            serde_json::from_str(text).map_err(|e| IndexError::Invalid(e.to_string()))?;
        if i.schema > INDEX_SCHEMA {
            return Err(IndexError::TooNew(i.schema));
        }
        let projects = i.projects.into_iter().map(|p| (p.id.clone(), p)).collect();
        Ok(Registry {
            projects,
            revoked: i.revoked,
        })
    }

    /// Why a file was taken down, if it was.
    pub fn revoked_reason(&self, id: &str, sha256: &str) -> Option<&str> {
        self.revoked
            .iter()
            .find(|r| {
                r.id == id
                    && r.sha256
                        .as_deref()
                        .is_none_or(|s| s.eq_ignore_ascii_case(sha256))
            })
            .map(|r| r.reason.as_str())
    }

    /// The project and its newest file, when it's a mod Wanted may install.
    pub fn installable(&self, id: &str) -> Option<(&Project, &FileRef)> {
        let p = self.projects.get(id)?;
        install_folder(&p.kind)?;
        let file = &p.versions.first()?.file;
        self.revoked_reason(id, &file.sha256)
            .is_none()
            .then_some((p, file))
    }
}

/// The game-folder subfolder a registry kind installs into.
pub fn install_folder(kind: &str) -> Option<&'static str> {
    match kind {
        "mod" => Some("horizon-mods"),
        "native-mod" => Some("horizon-native-mods"),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Horizon's own check

/// The verdict of `horizon-launcher mods check <slug> --json`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LauncherCheck {
    /// Content only: its blocks, items, recipes and worldgen come over.
    Works,
    /// The content comes over; some features don't.
    Partly,
    /// Nothing to carry over.
    DoesntRun,
}

impl LauncherCheck {
    /// Reads the verdict word, in any case and spacing.
    // verify: the JSON field that holds it. docs/mod-browser.md names the three
    // verdicts ("Works", "Partly", "Doesn't run") but not the field.
    pub fn parse(word: &str) -> Option<LauncherCheck> {
        match normalize_id(word).replace('_', "").as_str() {
            "works" => Some(LauncherCheck::Works),
            "partly" => Some(LauncherCheck::Partly),
            "doesntrun" | "doesnotrun" => Some(LauncherCheck::DoesntRun),
            _ => None,
        }
    }
}

// ---------------------------------------------------------------------------
// The answer

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Verdict {
    /// Horizon already does this.
    BuiltIn {
        horizon: String,
        how: How,
        place: String,
    },
    /// A Rust version is in Horizon's registry.
    Ported {
        project: String,
        folder: &'static str,
    },
    /// Horizon's launcher carries the mod's content over.
    Works { partly: bool },
    /// Not on Horizon yet. `sure` is false when the jar couldn't be checked,
    /// as with CurseForge-only files: the app then says "Not sure yet".
    NotYet { sure: bool },
}

/// The three piles a pack is sorted into.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pile {
    ComesWithYou,
    NotNeeded,
    NotYet,
}

impl Verdict {
    pub fn pile(&self) -> Pile {
        match self {
            Verdict::BuiltIn { .. } => Pile::NotNeeded,
            Verdict::Ported { .. } | Verdict::Works { .. } => Pile::ComesWithYou,
            Verdict::NotYet { .. } => Pile::NotYet,
        }
    }

    /// The stamp on the answer card.
    pub fn stamp(&self) -> &'static str {
        match self.pile() {
            Pile::ComesWithYou => "FOUND",
            Pile::NotNeeded => "BUILT IN",
            Pile::NotYet => "NOT YET",
        }
    }

    /// The one button under the answer.
    pub fn button(&self) -> &'static str {
        match self {
            Verdict::BuiltIn {
                how: How::Engine, ..
            } => "Check another mod",
            Verdict::BuiltIn { .. } => "How to turn it on",
            Verdict::Ported { .. } => "Install",
            Verdict::Works { .. } => "Add to Horizon",
            Verdict::NotYet { .. } => "Want it too",
        }
    }
}

/// Everything Wanted knows: the rules and the registry.
#[derive(Debug, Clone, Default)]
pub struct Hub {
    pub rules: Rules,
    pub registry: Registry,
}

impl Hub {
    /// Built in, then ported (unless revoked), then Horizon's check, then not yet.
    pub fn verdict(&self, id: &str, check: Option<LauncherCheck>) -> Verdict {
        if let Some(b) = self.rules.builtin_for(id) {
            return Verdict::BuiltIn {
                horizon: b.horizon.clone(),
                how: b.how,
                place: b.place.clone(),
            };
        }
        if let Some(port) = self.rules.port_for(id) {
            if let Some((p, _)) = self.registry.installable(&port.registry) {
                let folder = install_folder(&p.kind).unwrap_or("horizon-mods");
                return Verdict::Ported {
                    project: p.id.clone(),
                    folder,
                };
            }
        }
        match check {
            Some(LauncherCheck::Works) => Verdict::Works { partly: false },
            Some(LauncherCheck::Partly) => Verdict::Works { partly: true },
            Some(LauncherCheck::DoesntRun) => Verdict::NotYet { sure: true },
            None => Verdict::NotYet { sure: false },
        }
    }

    /// Watched mods that have a Rust version now, in watch order.
    pub fn arrivals<'a>(&self, watching: &'a [String]) -> Vec<&'a str> {
        watching
            .iter()
            .filter(|id| matches!(self.verdict(id, None), Verdict::Ported { .. }))
            .map(String::as_str)
            .collect()
    }
}

// ---------------------------------------------------------------------------
// The pack answer

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PackSummary {
    pub works: u32,
    pub ported: u32,
    pub built_in: u32,
    pub not_yet: u32,
}

impl PackSummary {
    pub fn from_verdicts<'a>(verdicts: impl IntoIterator<Item = &'a Verdict>) -> PackSummary {
        let mut s = PackSummary::default();
        for v in verdicts {
            match v {
                Verdict::Works { .. } => s.works += 1,
                Verdict::Ported { .. } => s.ported += 1,
                Verdict::BuiltIn { .. } => s.built_in += 1,
                Verdict::NotYet { .. } => s.not_yet += 1,
            }
        }
        s
    }

    pub fn total(&self) -> u32 {
        self.works + self.ported + self.built_in + self.not_yet
    }

    pub fn come_with_you(&self) -> u32 {
        self.works + self.ported
    }

    /// The three big numbers: "30 / 14 / 16".
    pub fn short(&self) -> String {
        format!(
            "{} / {} / {}",
            self.come_with_you(),
            self.built_in,
            self.not_yet
        )
    }

    /// "30 come with you. 14 you don't need anymore. 16 not yet."
    pub fn sentence(&self) -> String {
        let come = match self.come_with_you() {
            1 => "1 comes with you.".to_string(),
            n => format!("{n} come with you."),
        };
        format!(
            "{come} {} you don't need anymore. {} not yet.",
            self.built_in, self.not_yet
        )
    }

    /// The primary button.
    pub fn button(&self) -> String {
        match self.come_with_you() {
            0 => "Check another pack".into(),
            1 => "Add it to Horizon".into(),
            n => format!("Add the {n} to Horizon"),
        }
    }
}

// ---------------------------------------------------------------------------
// Mod icons
//
// Every mod is shown with its own icon from Modrinth, the way Horizon's
// launcher shows them. Only Modrinth's image server is trusted. Icons are
// cached on disk so they show offline; a monogram tile stands in while one
// loads, and for mods with no icon, CurseForge-only mods and offline starts.

/// The only place icons are fetched from.
pub const ICON_HOST: &str = "https://cdn.modrinth.com/";

/// Where to look for a project's icon, best first: the original upload
/// (`raw_icon_url`, Modrinth API v3), the original behind a `_96` thumbnail,
/// then the thumbnail itself (`icon_url`). Anything not on [`ICON_HOST`] is dropped.
pub fn icon_candidates(raw_icon_url: Option<&str>, icon_url: Option<&str>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut push = |u: String| {
        if icon_cache_name(&u).is_some() && !out.contains(&u) {
            out.push(u);
        }
    };
    if let Some(raw) = raw_icon_url {
        push(raw.to_string());
    }
    if let Some(thumb) = icon_url {
        if let Some((stem, ext)) = thumb.rsplit_once('.') {
            if let Some(original) = stem.strip_suffix("_96") {
                push(format!("{original}.{ext}"));
            }
        }
        push(thumb.to_string());
    }
    out
}

/// The file name an icon is cached under: `data/<project>/<file>` becomes
/// `<project>-<file>`. None for anything that isn't a plain image file on
/// Modrinth's image server.
pub fn icon_cache_name(url: &str) -> Option<String> {
    let rest = url.strip_prefix(ICON_HOST)?.strip_prefix("data/")?;
    let (project, file) = rest.split_once('/')?;
    let plain = |s: &str| {
        !s.is_empty()
            && s.len() <= 96
            && !s.starts_with('.')
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
    };
    let ext = file.rsplit_once('.')?.1.to_ascii_lowercase();
    let image = matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp" | "gif");
    (plain(project) && plain(file) && !file.contains("..") && image)
        .then(|| format!("{project}-{file}"))
}

/// Two letters for the monogram tile: the initials of the first two words,
/// or the first two letters of a one-word name. `Create` is `Cr`,
/// `Applied Energistics 2` is `AE`.
pub fn monogram(name: &str) -> String {
    let clean: String = name
        .chars()
        .filter(|c| *c != '\'' && *c != '\u{2019}')
        .collect();
    let words: Vec<&str> = clean
        .split(|c: char| c.is_whitespace() || c == ':')
        .filter(|w| w.starts_with(|c: char| c.is_ascii_alphabetic()))
        .filter(|w| !["and", "the", "of", "n"].contains(&w.to_ascii_lowercase().as_str()))
        .collect();
    let chars = |w: &str, n: usize| w.chars().take(n).collect::<Vec<char>>();
    match words.as_slice() {
        [] => "?".into(),
        [one] => {
            let c = chars(one, 2);
            c[0].to_ascii_uppercase().to_string()
                + &c.get(1)
                    .map(|c| c.to_ascii_lowercase().to_string())
                    .unwrap_or_default()
        }
        [a, b, ..] => format!("{}{}", chars(a, 1)[0], chars(b, 1)[0]).to_ascii_uppercase(),
    }
}

/// What a mod's tile shows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Portrait {
    /// The cached icon file.
    Icon(String),
    /// Two letters on a muted colour.
    Monogram(String),
}

impl Portrait {
    /// The cached icon when there is one, otherwise the monogram.
    pub fn of(name: &str, cached_icon: Option<&str>) -> Portrait {
        match cached_icon {
            Some(file) => Portrait::Icon(file.to_string()),
            None => Portrait::Monogram(monogram(name)),
        }
    }
}

/// `1240` as `1,240`, for vote counts.
pub fn grouped(n: u64) -> String {
    let digits = n.to_string();
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    out
}

// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    const BUILTIN: &str = include_str!("../../../rules/builtin.toml");
    const PORTS: &str = include_str!("../../../rules/ports.toml");

    fn index(revoked: &str) -> String {
        format!(
            r#"{{"schema":1,"generated":"2026-10-30T18:00:00Z","projects":[
              {{"id":"veinminer","kind":"mod","name":"Veinminer","versions":[{{"version":"1.2.0",
                "file":{{"name":"veinminer-1.2.0.hmod","url":"https://github.com/horizon-rust/horizon-mods/releases/download/veinminer-1.2.0/veinminer-1.2.0.hmod","size":9120,"sha256":"aa11"}}}}]}},
              {{"id":"waystones","kind":"native-mod","name":"Waystones","key":"RWTexample","versions":[{{"version":"0.3.0",
                "file":{{"name":"waystones-0.3.0.hnmod","url":"https://github.com/horizon-rust/horizon-mods/releases/download/waystones-0.3.0/waystones-0.3.0.hnmod","size":48211,"sha256":"bb22"}}}}]}}
            ],"revoked":[{revoked}]}}"#
        )
    }

    fn hub(revoked: &str) -> Hub {
        Hub {
            rules: Rules::from_toml(BUILTIN, PORTS).unwrap(),
            registry: Registry::from_json(&index(revoked)).unwrap(),
        }
    }

    #[test]
    fn ids_are_normalised() {
        assert_eq!(normalize_id("fabric-api"), "fabric_api");
        assert_eq!(
            normalize_id("Applied Energistics 2"),
            "applied_energistics_2"
        );
        assert_eq!(
            normalize_id("Macaw's Fences and Walls"),
            "macaws_fences_and_walls"
        );
        assert_eq!(normalize_id("  OK  Zoomer! "), "ok_zoomer");
        assert_eq!(normalize_id("Sodium"), "sodium");
        assert!(same_mod("okzoomer", "OK Zoomer"));
        assert!(!same_mod("", ""));
    }

    #[test]
    fn reads_fabric_jars() {
        let json = r#"{ "schemaVersion": 1, "id": "veinminer", "version": "1.2.0", "name": "Veinminer",
                        "environment": "*", "depends": { "fabricloader": ">=0.16" } }"#;
        let m = read_jar(&JarFiles {
            fabric_mod_json: Some(json),
            ..Default::default()
        })
        .unwrap();
        assert_eq!(
            m,
            JarMeta {
                loader: Loader::Fabric,
                id: "veinminer".into(),
                name: "Veinminer".into(),
                version: "1.2.0".into()
            }
        );

        let no_name = r#"{ "schemaVersion": 1, "id": "fabric-api", "version": "0.119.2" }"#;
        let m = read_jar(&JarFiles {
            fabric_mod_json: Some(no_name),
            ..Default::default()
        })
        .unwrap();
        assert_eq!(
            (m.id.as_str(), m.name.as_str()),
            ("fabric_api", "fabric-api")
        );
    }

    #[test]
    fn reads_neoforge_jars_and_the_jar_version() {
        let toml = r#"
            modLoader = "javafml"
            loaderVersion = "[4,)"
            license = "MIT"
            [[mods]]
            modId = "create"
            version = "${file.jarVersion}"
            displayName = "Create"
            [[dependencies.create]]
            modId = "neoforge"
            type = "required"
        "#;
        let mf = "Manifest-Version: 1.0\r\nImplementation-Title: Create\r\nImplementation-Version: 6.0.\r\n 6\r\nBuilt-By: ci\r\n";
        let m = read_jar(&JarFiles {
            neoforge_mods_toml: Some(toml),
            manifest_mf: Some(mf),
            ..Default::default()
        })
        .unwrap();
        assert_eq!(
            m,
            JarMeta {
                loader: Loader::NeoForge,
                id: "create".into(),
                name: "Create".into(),
                version: "6.0.6".into()
            }
        );
    }

    #[test]
    fn reads_forge_jars() {
        let toml = "modLoader=\"javafml\"\nloaderVersion=\"[52,)\"\nlicense=\"MIT\"\n[[mods]]\nmodId=\"mcwfences\"\nversion=\"1.2.0\"\ndisplayName=\"Macaw's Fences and Walls\"\n";
        let m = read_jar(&JarFiles {
            mods_toml: Some(toml),
            ..Default::default()
        })
        .unwrap();
        assert_eq!(
            (m.loader, m.id.as_str(), m.version.as_str()),
            (Loader::Forge, "mcwfences", "1.2.0")
        );
        assert_eq!(m.name, "Macaw's Fences and Walls");
    }

    #[test]
    fn a_jar_without_a_manifest_says_so() {
        assert_eq!(read_jar(&JarFiles::default()), Err(MetaError::NoManifest));
        let bad = read_jar(&JarFiles {
            fabric_mod_json: Some("{ nope"),
            ..Default::default()
        });
        assert!(matches!(
            bad,
            Err(MetaError::Invalid {
                file: "fabric.mod.json",
                ..
            })
        ));
    }

    #[test]
    fn packs_are_told_apart() {
        assert_eq!(
            PackKind::detect("Our SMP pack.mrpack", &[]),
            Some(PackKind::Mrpack)
        );
        assert_eq!(
            PackKind::detect("smp.zip", &["manifest.json", "overrides/"]),
            Some(PackKind::CurseForgeZip)
        );
        assert_eq!(
            PackKind::detect(
                "Our SMP pack",
                &["instance.cfg", "minecraft/mods/create.jar"]
            ),
            Some(PackKind::Instance)
        );
        assert_eq!(
            PackKind::detect("mods", &["sodium.jar", "create.jar"]),
            Some(PackKind::ModsFolder)
        );
        assert_eq!(PackKind::detect("photos", &["a.png"]), None);
    }

    #[test]
    fn the_rule_files_read() {
        let r = Rules::from_toml(BUILTIN, PORTS).unwrap();
        assert_eq!(r.builtin.len(), 13);
        assert!(r.builtin.iter().all(|b| {
            b.source
                .starts_with("https://github.com/horizon-rust/horizon/")
        }));
        assert!(
            r.builtin
                .iter()
                .all(|b| b.how == How::Engine || !b.place.is_empty())
        );
        assert_eq!(
            r.port_for("Veinminer").map(|p| p.registry.as_str()),
            Some("veinminer")
        );
    }

    #[test]
    fn built_in_comes_first() {
        let h = hub("");
        let v = h.verdict("sodium", Some(LauncherCheck::DoesntRun));
        assert_eq!(
            v,
            Verdict::BuiltIn {
                horizon: "Horizon's engine".into(),
                how: How::Engine,
                place: String::new()
            }
        );
        assert_eq!((v.stamp(), v.button()), ("BUILT IN", "Check another mod"));

        let v = h.verdict("Xaero's Minimap", None);
        assert!(matches!(
            v,
            Verdict::BuiltIn {
                how: How::OfficialMod,
                ..
            }
        ));
        assert_eq!(v.button(), "How to turn it on");
        assert!(matches!(
            h.verdict("ok_zoomer", None),
            Verdict::BuiltIn { .. }
        ));
    }

    #[test]
    fn ported_needs_a_listed_unrevoked_file() {
        let h = hub("");
        let v = h.verdict("veinminer", Some(LauncherCheck::DoesntRun));
        assert_eq!(
            v,
            Verdict::Ported {
                project: "veinminer".into(),
                folder: "horizon-mods"
            }
        );
        assert_eq!((v.stamp(), v.button()), ("FOUND", "Install"));
        assert_eq!(
            h.verdict("waystones", None),
            Verdict::Ported {
                project: "waystones".into(),
                folder: "horizon-native-mods"
            }
        );

        // One file taken down, then the whole project.
        let h = hub(
            r#"{"id":"veinminer","sha256":"AA11","reason":"Sent chat messages it didn't declare.","date":"2026-10-24"}"#,
        );
        assert_eq!(
            h.verdict("veinminer", None),
            Verdict::NotYet { sure: false }
        );
        assert_eq!(
            h.registry.revoked_reason("veinminer", "aa11"),
            Some("Sent chat messages it didn't declare.")
        );
        let h = hub(r#"{"id":"waystones","reason":"Taken down.","date":"2026-10-24"}"#);
        assert_eq!(
            h.verdict("waystones", Some(LauncherCheck::Works)),
            Verdict::Works { partly: false }
        );
    }

    #[test]
    fn then_horizons_check_then_not_yet() {
        let h = hub("");
        let v = h.verdict("mcwfences", Some(LauncherCheck::Works));
        assert_eq!((v.stamp(), v.button()), ("FOUND", "Add to Horizon"));
        assert_eq!(
            h.verdict("supplementaries", Some(LauncherCheck::Partly)),
            Verdict::Works { partly: true }
        );
        let v = h.verdict("create", Some(LauncherCheck::DoesntRun));
        assert_eq!(v, Verdict::NotYet { sure: true });
        assert_eq!((v.stamp(), v.button()), ("NOT YET", "Want it too"));
        assert_eq!(
            h.verdict("some_curseforge_only_mod", None),
            Verdict::NotYet { sure: false }
        );
    }

    #[test]
    fn the_launcher_verdict_reads() {
        assert_eq!(LauncherCheck::parse("Works"), Some(LauncherCheck::Works));
        assert_eq!(LauncherCheck::parse("partly"), Some(LauncherCheck::Partly));
        assert_eq!(
            LauncherCheck::parse("Doesn't run"),
            Some(LauncherCheck::DoesntRun)
        );
        assert_eq!(
            LauncherCheck::parse("doesnt_run"),
            Some(LauncherCheck::DoesntRun)
        );
        assert_eq!(LauncherCheck::parse("checking"), None);
    }

    #[test]
    fn a_newer_index_is_refused() {
        let e = Registry::from_json(r#"{"schema":2,"projects":[]}"#).unwrap_err();
        assert_eq!(e, IndexError::TooNew(2));
        assert!(e.to_string().contains("update Wanted"));
    }

    #[test]
    fn the_sample_pack_adds_up() {
        let mut v = Vec::new();
        v.extend(std::iter::repeat_n(Verdict::Works { partly: false }, 24));
        v.extend(std::iter::repeat_n(
            Verdict::Ported {
                project: "x".into(),
                folder: "horizon-mods",
            },
            6,
        ));
        v.extend(std::iter::repeat_n(
            Verdict::BuiltIn {
                horizon: "x".into(),
                how: How::Engine,
                place: String::new(),
            },
            14,
        ));
        v.extend(std::iter::repeat_n(Verdict::NotYet { sure: true }, 16));
        let s = PackSummary::from_verdicts(&v);
        assert_eq!(
            s,
            PackSummary {
                works: 24,
                ported: 6,
                built_in: 14,
                not_yet: 16
            }
        );
        assert_eq!(s.total(), 60);
        assert_eq!(s.short(), "30 / 14 / 16");
        assert_eq!(
            s.sentence(),
            "30 come with you. 14 you don't need anymore. 16 not yet."
        );
        assert_eq!(s.button(), "Add the 30 to Horizon");
    }

    #[test]
    fn watched_mods_arrive() {
        let h = hub("");
        let watching = ["create", "waystones", "applied_energistics_2"].map(String::from);
        assert_eq!(h.arrivals(&watching), ["waystones"]);
    }

    #[test]
    fn icons_come_from_modrinth_only() {
        let thumb = "https://cdn.modrinth.com/data/LNytGWDc/61d716699bcf1ec42ed4926a9e1c7311be6087e2_96.webp";
        let raw =
            "https://cdn.modrinth.com/data/LNytGWDc/45c6a706e0e67669d3004f80eec443331fb33369.png";
        assert_eq!(
            icon_candidates(Some(raw), Some(thumb)),
            [
                raw,
                "https://cdn.modrinth.com/data/LNytGWDc/61d716699bcf1ec42ed4926a9e1c7311be6087e2.webp",
                thumb
            ]
        );
        assert_eq!(
            icon_candidates(
                None,
                Some("https://cdn.modrinth.com/data/AANobbMI/icon.png")
            ),
            ["https://cdn.modrinth.com/data/AANobbMI/icon.png"]
        );
        assert!(
            icon_candidates(
                Some("https://example.com/data/x/icon.png"),
                Some("http://cdn.modrinth.com/data/x/icon.png")
            )
            .is_empty()
        );
        assert!(icon_candidates(None, None).is_empty());

        assert_eq!(
            icon_cache_name(raw).as_deref(),
            Some("LNytGWDc-45c6a706e0e67669d3004f80eec443331fb33369.png")
        );
        for bad in [
            "https://cdn.modrinth.com.example.net/data/x/icon.png",
            "https://cdn.modrinth.com/data/../icon.png",
            "https://cdn.modrinth.com/data/x/../../icon.png",
            "https://cdn.modrinth.com/data/x/.icon.png",
            "https://cdn.modrinth.com/data/x/icon.png?size=96",
            "https://cdn.modrinth.com/data/x/icon.svg",
            "https://cdn.modrinth.com/user/x/icon.png",
        ] {
            assert_eq!(icon_cache_name(bad), None, "{bad}");
        }
    }

    #[test]
    fn the_fallback_is_a_monogram() {
        assert_eq!(monogram("Create"), "Cr");
        assert_eq!(monogram("Applied Energistics 2"), "AE");
        assert_eq!(monogram("Macaw's Fences and Walls"), "MF");
        assert_eq!(monogram("The Twilight Forest"), "TF");
        assert_eq!(monogram("Iron's Spells 'n Spellbooks"), "IS");
        assert_eq!(monogram("x"), "X");
        assert_eq!(monogram("2048"), "?");
        assert_eq!(
            Portrait::of("The Twilight Forest", None),
            Portrait::Monogram("TF".into())
        );
        assert_eq!(
            Portrait::of("Create", Some("LNytGWDc-45c6.png")),
            Portrait::Icon("LNytGWDc-45c6.png".into())
        );
    }

    #[test]
    fn counts_are_grouped() {
        assert_eq!(grouped(1240), "1,240");
        assert_eq!(grouped(615), "615");
        assert_eq!(grouped(1_000_000), "1,000,000");
    }
}
