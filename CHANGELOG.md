# Changelog


## 1.4.4 — 3 November 2026

A maintenance release.

### Fixes

- Fixed a crash when the Horizon log file was locked by another tool.

## 1.4.3 · 2026-11-01

- Fixed the one-click install when Horizon's registry answers with a moved file.
- The most-wanted board keeps its counts when the vote server is unreachable.
- Icons arrive faster on first start and survive a flaky connection.
- Clearer wording on the four answers; small layout fixes on the pack view.

## 1.4.1 · 2026-10-09

- Fixed the one-click install when Horizon's registry answers with a moved file.
- The most-wanted board keeps its counts when the vote server is unreachable.

## 1.4.2 · 2026-10-30

- **Is my mod on Horizon?** Type a mod's name or drop its jar for one plain answer: built in, ported, works or not yet, with one button.
- **Bring your whole pack.** A mods folder, a Prism or MultiMC instance, a `.mrpack` or a CurseForge zip, answered in three numbers. Add everything that works in one click.
- **Most wanted.** The top 10 missing mods by vote, one vote per mod per install, no account.
- **Tell me when it's here.** A local watchlist, checked against Horizon's registry on every start.
- Every mod shows its own icon from Modrinth, cached on your PC. A two-letter tile stands in when there's no icon.
- Built-in rules for 13 groups of Java mods that Horizon already replaces, each linked to the Horizon doc behind it.
- Registry installs are checked against their SHA-256 and minisign signature; revoked files are turned off with the reason.
- Vote server for the Cloudflare free plan (Worker and D1) in `server/`.
- Portable builds for Windows (`.exe`) and Linux (AppImage).
