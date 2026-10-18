// Wanted window UI. The core (crates/wanted-core) decides the answer; this file
// draws it: one big result, one plain sentence, one button. Three tabs: Check,
// Most wanted and Watching. `window.wanted` drives the window for screenshots.
(function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s, el = document) => el.querySelector(s);
  const fmt = (n) => n.toLocaleString('en-US');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  const svg = (d) => `<svg class="i" viewBox="0 0 16 16">${d}</svg>`;
  const icon = {
    search: svg('<circle cx="7" cy="7" r="4.6"/><path d="M10.4 10.4L14 14"/>'),
    drop: svg('<path d="M8 2.5v7.2M5 6.9l3 3 3-3"/><path d="M2.5 10.5v1.8a1.2 1.2 0 0 0 1.2 1.2h8.6a1.2 1.2 0 0 0 1.2-1.2v-1.8"/>'),
    folder: svg('<path d="M2 4.6a1.1 1.1 0 0 1 1.1-1.1h3.1l1.5 1.7h5.2a1.1 1.1 0 0 1 1.1 1.1v6.1a1.1 1.1 0 0 1-1.1 1.1H3.1A1.1 1.1 0 0 1 2 12.4z"/>'),
    plus: svg('<path d="M8 3.5v9M3.5 8h9"/>'),
    check: svg('<path d="M3.4 8.6l3 3 6.2-7.2"/>'),
    bell: svg('<path d="M4 11.2V7.6a4 4 0 0 1 8 0v3.6l1.1 1.3H2.9z"/><path d="M6.7 14.2h2.6"/>'),
    install: svg('<path d="M8 2.5v8M4.8 7.6L8 10.8l3.2-3.2M3 13.5h10"/>'),
    out: svg('<path d="M6.5 3.5h6v6M12.5 3.5L4 12"/>'),
    x: svg('<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>'),
    min: '<svg viewBox="0 0 10 10"><path d="M0 5.5h10"/></svg>',
    max: '<svg viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9"/></svg>',
    close: '<svg viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10"/></svg>',
  };
  // The mark: a bold W on paper with a small red stamp.
  const MARK = '<svg viewBox="0 0 16 16"><rect x="0.5" y="0.5" width="15" height="15" rx="3.6" fill="#f8f2e3" stroke="rgba(23,19,14,.28)"/><path d="M1 2.5h2.86l.92 4.12.93-4.12h2.58l.92 4.12.93-4.12H13l-2.68 8.5H7.83L7 8.05 6.17 11H3.68z" fill="#17130e"/><circle cx="13.1" cy="13.1" r="2.3" fill="#d4372c" stroke="#f8f2e3"/></svg>';

  // Every mod shows its own icon from Modrinth, as Horizon's launcher does.
  // Only Modrinth's image server is used. The desktop shell keeps downloaded
  // icons in the app's cache folder and hands their local addresses over as
  // `window.wantedIcons`, so they show offline. A monogram tile (two letters
  // on a muted colour) stands in while an icon loads, and for mods with no
  // icon, CurseForge-only mods and offline starts.
  const ICON_HOST = 'https://cdn.modrinth.com/';
  const CDN = (p) => `${ICON_HOST}data/${p}`;
  // [raw_icon_url, icon_url] from Modrinth's project data, by mod name.
  const ICONS = {
    Sodium: [CDN('AANobbMI/icon.png'), CDN('AANobbMI/295862f4724dc3f78df3447ad6072b2dcd3ef0c9_96.webp')],
    Create: [CDN('LNytGWDc/45c6a706e0e67669d3004f80eec443331fb33369.png'), CDN('LNytGWDc/61d716699bcf1ec42ed4926a9e1c7311be6087e2_96.webp')],
    Veinminer: [CDN('OhduvhIc/5ea1f538e66ee4d4e5e571ad952cba0e06e0bd5c.png')],
    "Macaw's Fences and Walls": [CDN('GmwLse2I/28e06d4ddbe6fbf5b8eb0ff7b64a9aad1af34e32.png'), CDN('GmwLse2I/ebe4d2375e0a402e5587665ba9da5eb50f37422a_96.webp')],
    'Applied Energistics 2': [CDN('XxWD5pD3/icon.png'), CDN('XxWD5pD3/60b001515abbf6ebf32bc2729b0ddd95d2793feb_96.webp')],
    Waystones: [CDN('LOpKHB2A/d56c030a875582aff5bab477ddcfec317a1610f0.png'), CDN('LOpKHB2A/d56c030a875582aff5bab477ddcfec317a1610f0_96.webp')],
    "Farmer's Delight": [CDN('R2OftAxM/8e7aa38ab94d94bb0a2894a218b69beb49002b34.png')],
    'Sophisticated Backpacks': [CDN('TyCTlI4b/e31c7e2f8769d317339e25b2a8d1b40fbf312729.png'), CDN('TyCTlI4b/e31c7e2f8769d317339e25b2a8d1b40fbf312729_96.webp')],
    "Tinkers' Construct": [CDN('rxIIYO6c/7a24bafaf8a7ce40cea07a4a070e6dd78a86ebd6.png'), CDN('rxIIYO6c/4c1b02748edd2def6a2427f494735641570c34ec_96.webp')],
    Mekanism: [CDN('Ce6I4WUE/icon.png'), CDN('Ce6I4WUE/ea185eb1300a64867f89101d4798e71a54ef6bed_96.webp')],
    Botania: [CDN('pfjLUfGv/4c006056fd05fdd63b83d79c7c3bb9712d2f49bc.png'), CDN('pfjLUfGv/e40d77bf0245907048fb71b5a64ec3de10099ef1_96.webp')],
    "Iron's Spells 'n Spellbooks": [CDN('s4OWxYQQ/6a1f5c6adb434a6c56c1975af6f4fbde3ba907ff.png')],
  };
  const PALETTE = ['#8a5a2b', '#3d5a80', '#5f6f52', '#a0522d', '#6b4e71', '#2f6f73', '#4f5d75', '#8c6d3f', '#4e7d5b', '#7a3b3b', '#5b5a7a', '#6d5a4a'];
  const norm = (s) => s.toLowerCase().replace(/['\u2019]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  function mono(name) {
    const words = name.replace(/['\u2019]/g, '').split(/[\s:]+/).filter((w) => /^[a-z]/i.test(w) && !/^(and|the|of|n)$/i.test(w));
    if (!words.length) return '?';
    if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
    return words[0][0].toUpperCase() + (words[0][1] || '').toLowerCase();
  }
  function colour(name) {
    let h = 7;
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }
  // Best first: the original upload, the original behind a _96 thumbnail, the thumbnail.
  function iconSources(name) {
    const [raw, thumb] = ICONS[name] || [];
    const list = [raw, thumb && thumb.replace(/_96(\.\w+)$/, '$1'), thumb].filter((u) => u && u.startsWith(ICON_HOST));
    const cached = window.wantedIcons || {};
    return [...new Set(list)].map((u) => cached[u] || u);
  }
  function tile(m, cls = '') {
    const src = iconSources(m.name);
    const img = src.length ? `<img alt="" draggable="false" src="${esc(src[0])}" data-next="${esc(src.slice(1).join(' '))}">` : '';
    return `<span class="tile ${cls}" style="--c:${m.c || colour(m.name)}"><span>${m.mono || mono(m.name)}</span>${img}</span>`;
  }
  // Pixel art keeps hard edges: few colours, or a tiny original.
  const pixelArt = new Map();
  function isPixelArt(img) {
    if (pixelArt.has(img.src)) return pixelArt.get(img.src);
    const w = img.naturalWidth, h = img.naturalHeight;
    let pixel = w <= 64 && h <= 64;
    if (!pixel && w * h <= 1200000) {
      try {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0);
        const px = new Uint32Array(g.getImageData(0, 0, w, h).data.buffer);
        const seen = new Set();
        pixel = true;
        for (let i = 0; i < px.length && pixel; i++) { seen.add(px[i]); if (seen.size > 256) pixel = false; }
      } catch {
        pixel = false; // an icon the page can't read is drawn smooth
      }
    }
    pixelArt.set(img.src, pixel);
    return pixel;
  }
  function iconReady(img) {
    if (!img.naturalWidth) return;
    img.classList.toggle('pixel', isPixelArt(img));
    img.parentElement.classList.add('has-icon');
  }
  function iconFailed(img) {
    const [next, ...rest] = (img.dataset.next || '').split(' ').filter(Boolean);
    if (next) {
      img.dataset.next = rest.join(' ');
      img.src = next;
    } else {
      img.remove(); // the monogram stays
    }
  }
  function hydrate(root) {
    root.querySelectorAll('.tile img').forEach((img) => { if (img.complete && img.naturalWidth) iconReady(img); });
  }
  const STAMP = { found: ['Found', 'green'], builtin: ['Built in', 'ink'], notyet: ['Not yet', 'red'] };
  const stamp = (pile, cls = '') => `<span class="stamp ${STAMP[pile][1]} ${cls}">${STAMP[pile][0]}</span>`;

  // Answers for the mods in the README pictures. The core gives the same ones.
  const MODS = {
    sodium: { name: 'Sodium', c: '#3a332a', pile: 'builtin', how: 'engine',
      big: 'Horizon is already this fast.', why: "You don't need it. Horizon's own engine does Sodium's job, and it's always on." },
    create: { name: 'Create', c: '#8a5a2b', pile: 'notyet', votes: 1240,
      why: "There's no Rust version yet, and Horizon can't carry its machines over by itself." },
    veinminer: { name: 'Veinminer', c: '#7a5c3e', pile: 'found', kind: 'ported',
      big: 'Ported. A Rust version is ready.', why: "It's listed and reviewed by Horizon. One click puts it in your game." },
    macaws_fences_and_walls: { name: "Macaw's Fences and Walls", c: '#5b5a7a', pile: 'found', kind: 'works',
      big: 'It works. Its blocks come over.', why: "Horizon's own check brings its blocks, items and recipes across." },
  };
  // rules/builtin.toml, for names typed by hand.
  const BUILTIN = [
    [['Sodium', 'Lithium', 'FerriteCore', 'ModernFix', 'ImmediatelyFast'], "Horizon's engine", ''],
    [['Distant Horizons'], 'LOD Distance', 'Options > Horizon Settings > Graphics'],
    [["Xaero's Minimap", 'JourneyMap'], 'the Minimap mod', "the launcher's Mods page"],
    [['Zoomify', 'OK Zoomer'], 'the Zoom mod', "the launcher's Mods page"],
    [['JEI', 'REI', 'EMI', 'Just Enough Items', 'Roughly Enough Items'], 'the Recipes mod', "the launcher's Mods page"],
    [['Mouse Tweaks'], 'Mouse Tweaks-style controls', 'Options > Horizon Settings > Extras'],
    [['Inventory Profiles Next', 'Inventory Sorter'], 'Sorting', 'Options > Horizon Settings > Extras'],
    [['LambDynamicLights'], 'Dynamic lights', 'Options > Horizon Settings > Extras'],
    [['Controlify', 'MidnightControls'], 'Controllers', 'Options > Horizon Settings > Controller'],
    [['AutoReconnect'], 'Auto-reconnect', 'Options > Horizon Settings > Extras'],
    [['Gamma Utils', 'Fullbright'], 'Fullbright', 'Options > Horizon Settings > Extras'],
    [['FPS Display', 'FPS Counter'], 'the FPS Counter mod', "the launcher's Mods page"],
    [['Keystrokes'], 'the Keystrokes mod', "the launcher's Mods page"],
  ];

  function lookup(q) {
    const id = norm(q);
    const alias = { macaws_fences: 'macaws_fences_and_walls', mcwfences: 'macaws_fences_and_walls' };
    if (MODS[id] || MODS[alias[id]]) return { id: MODS[id] ? id : alias[id], ...(MODS[id] || MODS[alias[id]]) };
    for (const [names, what, where] of BUILTIN) {
      const hit = names.find((n) => norm(n) === id || norm(n).replace(/_/g, '') === id.replace(/_/g, ''));
      if (!hit) continue;
      return where
        ? { id, name: hit, pile: 'builtin', how: 'setting', big: 'Horizon already does this.', why: `You don't need it. Turn on ${what} in ${where}.` }
        : { id, name: hit, pile: 'builtin', how: 'engine', big: 'Horizon is already this fast.', why: "You don't need it. It's part of Horizon's engine, always on." };
    }
    const b = BOARD.find((m) => norm(m.name) === id || m.id === id);
    if (b) return { ...b, pile: 'notyet', why: "There's no Rust version yet. Vote for it, and porters see it." };
    return { id, name: q.trim() || 'That mod', pile: 'notyet', votes: 0, unsure: true,
      why: "Wanted couldn't match that name to a mod. Drop its jar instead, and Wanted reads it." };
  }

  // The 10 most wanted, as the vote server returns them.
  const BOARD = [
    { id: 'create', name: 'Create', c: '#8a5a2b', votes: 1240, mine: true },
    { id: 'ae2', name: 'Applied Energistics 2', c: '#3d5a80', votes: 860 },
    { id: 'waystones', name: 'Waystones', c: '#5f6f52', votes: 615, mine: true },
    { id: 'farmersdelight', name: "Farmer's Delight", c: '#a0522d', votes: 590 },
    { id: 'sophisticatedbackpacks', name: 'Sophisticated Backpacks', c: '#6b4e71', votes: 470 },
    { id: 'tconstruct', name: "Tinkers' Construct", c: '#2f6f73', votes: 432 },
    { id: 'mekanism', name: 'Mekanism', c: '#4f5d75', votes: 398 },
    { id: 'botania', name: 'Botania', c: '#4e7d5b', votes: 351 },
    { id: 'twilightforest', name: 'The Twilight Forest', mono: 'TF', c: '#3b4f3a', votes: 307 },
    { id: 'irons_spellbooks', name: "Iron's Spells 'n Spellbooks", mono: 'IS', c: '#7a3b3b', votes: 284 },
  ];
  const TILTS = [-1.2, 0.8, -0.5, 1.1, -0.9, 0.6, -1, 0.9, -0.4, 1.2];

  // The pack in the README pictures, sorted into its three piles.
  const PACK = {
    name: 'Our SMP pack',
    found: ["Macaw's Fences and Walls", "Macaw's Bridges", "Macaw's Roofs", "Macaw's Windows", "Macaw's Doors", "Macaw's Trapdoors",
      "Macaw's Paths and Pavings", "Macaw's Lights and Lamps", 'Chipped', 'Rechiseled', 'Supplementaries', 'Handcrafted', 'Another Furniture',
      'Excessive Building', "Biomes O' Plenty", 'Terralith', "Oh The Biomes We've Gone", 'Regions Unexplored', "Nature's Spirit",
      "YUNG's Better Dungeons", "YUNG's Better Mineshafts", 'Towns and Towers', 'Repurposed Structures', 'Storage Drawers'],
    ported: ['Veinminer', 'AppleSkin', 'Jade', 'Clumps', 'Better Ping Display', 'Shulker Box Tooltip'],
    builtin: ['Sodium', 'Lithium', 'FerriteCore', 'ModernFix', 'ImmediatelyFast', 'Distant Horizons', "Xaero's Minimap", 'Zoomify', 'JEI',
      'Mouse Tweaks', 'Inventory Profiles Next', 'LambDynamicLights', 'AutoReconnect', 'Controlify'],
    notyet: ['Create', 'Applied Energistics 2', 'Waystones', "Farmer's Delight", 'Sophisticated Backpacks', "Tinkers' Construct", 'Mekanism',
      'Botania', 'The Twilight Forest', "Iron's Spells 'n Spellbooks", "Alex's Mobs", 'Quark', 'Simple Voice Chat', 'Sophisticated Storage',
      "Create: Steam 'n' Rails", "Traveler's Backpack"],
    partly: ['Supplementaries', 'Handcrafted', 'Another Furniture', "Biomes O' Plenty", 'Storage Drawers'],
  };

  const WATCHING = [
    { id: 'create', name: 'Create', c: '#8a5a2b', votes: 1240 },
    { id: 'ae2', name: 'Applied Energistics 2', c: '#3d5a80', votes: 860 },
    { id: 'sophisticatedbackpacks', name: 'Sophisticated Backpacks', c: '#6b4e71', votes: 470 },
  ];
  const ARRIVED = { id: 'waystones', name: 'Waystones', c: '#5f6f52' };

  const S = { tab: 'check', answer: null, voted: false, watched: false, arrived: true, installed: false, added: false };

  // Shell -----------------------------------------------------------------------
  function shell() {
    return `
    <div class="win grain" id="win">
      <header class="titlebar">
        <div class="brand">${MARK}<span class="wordmark">Wanted</span></div>
        <nav class="tabs" id="tabs">
          <button data-tab="check">Check</button>
          <button data-tab="board">Most wanted</button>
          <button data-tab="watching">Watching <em id="arrivals">1</em></button>
        </nav>
        <div class="winctl"><span>${icon.min}</span><span>${icon.max}</span><span>${icon.close}</span></div>
      </header>
      <main class="view" id="view"></main>
      <div class="dropzone" id="dropzone">${icon.folder}<b>Drop to check the whole pack</b><span>A mods folder, an instance, a .mrpack or a CurseForge zip</span></div>
      <div class="scrim" id="scrim"></div>
      <aside class="sheet" id="sheet"></aside>
      <div class="toast" id="toast"></div>
    </div>`;
  }

  function show(tab, html) {
    S.tab = tab;
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    $('#arrivals').textContent = S.arrived && !S.installed ? '1' : '';
    $('#view').innerHTML = html;
    hydrate($('#view'));
    $('#win').classList.remove('details-on');
  }

  // Check ------------------------------------------------------------------------
  const searchBox = (size, value = '') => `
    <form class="search ${size}" id="search" autocomplete="off">
      ${icon.search}
      <input id="q" type="text" spellcheck="false" placeholder="Type a mod's name" value="${esc(value)}">
      <button class="primary" id="go" type="submit">Check</button>
    </form>`;

  function startView() {
    return `
    <section class="check start">
      <h1>Is my mod on Horizon?</h1>
      ${searchBox('big')}
      <p class="hint">${icon.drop}or drop a jar, a mods folder or a modpack</p>
      <p class="try">Try <button data-try="Sodium">Sodium</button>, <button data-try="Create">Create</button> or <button data-try="Veinminer">Veinminer</button></p>
    </section>`;
  }

  function answerView(m) {
    let big = m.big;
    let actions;
    if (m.pile === 'notyet') {
      const n = m.votes || 0;
      big = m.unsure ? 'Not sure yet.' : `<span class="count" id="count"><span class="roll"><i>${fmt(n)}</i><i>${fmt(n + 1)}</i></span></span> players want it.`;
      actions = `<button class="primary" id="want">${icon.plus}Want it too</button><button class="ghost" id="watch">${icon.bell}Tell me when it's here</button>`;
    } else if (m.pile === 'found') {
      actions = m.kind === 'ported'
        ? `<button class="primary" id="act" data-done="Installed">${icon.install}Install</button>`
        : `<button class="primary" id="act" data-done="Added to Horizon">${icon.plus}Add to Horizon</button>`;
    } else {
      actions = m.how === 'engine'
        ? '<button class="primary" id="again">Check another mod</button>'
        : '<button class="primary" id="howto">How to turn it on</button>';
    }
    return `
    <section class="check answer">
      ${searchBox('slim', m.name)}
      <article class="notice ${m.pile}" id="notice">
        ${tile(m, 'xl')}
        <div class="body">
          <h2>${esc(m.name)}</h2>
          <p class="big">${big}</p>
          <p class="why">${m.why}</p>
          <div class="actions">${actions}</div>
          ${m.pile === 'notyet' ? `<button class="quiet" id="smelt">Port it yourself with Smelt${icon.out}</button>` : ''}
        </div>
        ${stamp(m.pile, 'big')}
      </article>
    </section>`;
  }

  function packView() {
    const cols = [
      [PACK.found.length + PACK.ported.length, 'found', 'come with you'],
      [PACK.builtin.length, 'builtin', "you don't need anymore"],
      [PACK.notyet.length, 'notyet', 'still wanted'],
    ];
    const total = cols.reduce((a, c) => a + c[0], 0);
    return `
    <section class="check pack" id="pack">
      <header class="pack-head">${icon.folder}<b>${PACK.name}</b><span class="sep"></span><span id="packstat">${total} mods</span></header>
      <div class="progress"><i id="prog"></i></div>
      <div class="tally">
        ${cols.map(([n, pile, label], k) => `<div class="col"><b class="n" data-n="${n}" id="n${k}">${n}</b>${stamp(pile)}<p>${label}</p></div>`).join('')}
      </div>
      <div class="pack-actions">
        <button class="primary" id="addall">${icon.plus}Add the ${cols[0][0]} to Horizon</button>
        <button class="quiet" id="details">Show details</button>
      </div>
    </section>`;
  }

  function sheetHtml() {
    const row = (name, note) => `<li>${tile({ name })}${esc(name)}<span>${note}</span></li>`;
    const found = [...PACK.ported.map((n) => row(n, 'Ported')), ...PACK.found.map((n) => row(n, PACK.partly.includes(n) ? 'Works, partly' : 'Works'))];
    return `
      <h3>Come with you <span>${found.length}</span></h3><ul>${found.join('')}</ul>
      <h3>You don't need anymore <span>${PACK.builtin.length}</span></h3><ul>${PACK.builtin.map((n) => row(n, 'Built in')).join('')}</ul>
      <h3>Still wanted <span>${PACK.notyet.length}</span></h3><ul>${PACK.notyet.map((n) => row(n, 'Not yet')).join('')}</ul>`;
  }

  // Most wanted ------------------------------------------------------------------
  function boardView() {
    const posters = BOARD.map((m, k) => `
      <article class="poster" style="--tilt:${TILTS[k]}deg">
        <i class="pin"></i><span class="rank">No. ${k + 1}</span>
        <h3>WANTED</h3>
        ${tile(m, 'md')}
        <span class="name">${esc(m.name)}</span>
        <p class="reward"><b>${fmt(m.votes)}</b> players</p>
        ${m.mine ? `<button class="want on" data-id="${m.id}">${icon.check}You want it</button>` : `<button class="want" data-id="${m.id}">${icon.plus}Want it too</button>`}
      </article>`).join('');
    return `
    <section class="board">
      <header class="board-head">
        <h1>Most wanted</h1>
        <div><p>The mods Horizon players miss most. Porters pick from this board.</p><button class="quiet" id="smelt">Port one with Smelt${icon.out}</button></div>
      </header>
      <div class="board-scroll"><div class="posters">${posters}</div></div>
    </section>`;
  }

  // Watching ---------------------------------------------------------------------
  function watchingView() {
    const arrived = S.arrived ? `
      <article class="notice arrived">
        ${tile(ARRIVED, 'lg')}
        <div class="body">
          <h2>${ARRIVED.name} is on Horizon now</h2>
          <p class="why">You asked to hear when it lands. It's reviewed and ready to install.</p>
          <div class="actions"><button class="primary" id="act" data-done="Installed">${icon.install}Install</button></div>
        </div>
        ${stamp('found', 'big')}
      </article>` : '';
    return `
    <section class="watching">
      ${arrived}
      <h3 class="watch-label">Still watching</h3>
      <ul class="watchlist">
        ${WATCHING.map((m) => `<li>${tile(m)}<b>${esc(m.name)}</b><span class="votes">${fmt(m.votes)} want it</span>${stamp('notyet', 'sm')}<button class="x" title="Stop watching">${icon.x}</button></li>`).join('')}
      </ul>
    </section>`;
  }

  // Behaviour ------------------------------------------------------------------------
  let toastTimer;
  function toast(html, ms = 2600) {
    const t = $('#toast');
    t.innerHTML = `${icon.check}<span>${html}</span>`;
    t.classList.add('on');
    clearTimeout(toastTimer);
    if (ms) toastTimer = setTimeout(() => t.classList.remove('on'), ms);
  }

  function thump(root = document) {
    root.querySelectorAll('.stamp').forEach((s) => {
      s.classList.remove('thump', 'wait');
      void s.offsetWidth;
      s.classList.add('thump');
    });
  }

  function answer(m, { animate = true } = {}) {
    S.answer = m;
    S.voted = false;
    S.watched = false;
    show('check', answerView(m));
    if (animate) {
      const st = $('#notice > .stamp');
      st.classList.add('wait');
      setTimeout(() => thump($('#notice')), 120);
    }
  }

  function vote() {
    const m = S.answer;
    if (!m || m.pile !== 'notyet' || m.unsure) return;
    S.voted = !S.voted;
    $('#count')?.classList.toggle('up', S.voted);
    const b = $('#want');
    b.innerHTML = S.voted ? `${icon.check}You want it` : `${icon.plus}Want it too`;
    b.classList.toggle('ghost', S.voted);
    b.classList.toggle('primary', !S.voted);
  }

  function watch() {
    S.watched = !S.watched;
    const b = $('#watch');
    b.classList.toggle('on', S.watched);
    b.innerHTML = S.watched ? `${icon.check}Watching` : `${icon.bell}Tell me when it's here`;
    if (S.watched) toast(`You'll hear when <b>${esc(S.answer.name)}</b> is on Horizon.`);
  }

  function act(btn) {
    if (btn.classList.contains('done')) return;
    btn.classList.add('done');
    btn.innerHTML = `${icon.check}${btn.dataset.done}`;
    if (S.tab === 'watching') {
      S.installed = true;
      $('#arrivals').textContent = '';
      toast(`<b>${ARRIVED.name}</b> is in Horizon. Start the game to use it.`);
    } else {
      toast(`<b>${esc(S.answer.name)}</b> is in Horizon. Start the game to use it.`);
    }
  }

  function addAll() {
    const b = $('#addall');
    if (!b || S.added) return;
    S.added = true;
    b.classList.add('done');
    b.innerHTML = `${icon.check}30 added to Horizon`;
    toast("<b>30 mods</b> are in Horizon. Start the game and they're there.", 0);
  }

  async function checkPack(ms = 1800) {
    S.added = false;
    show('check', packView());
    const pack = $('#pack');
    pack.classList.add('checking');
    pack.querySelectorAll('.stamp').forEach((s) => s.classList.add('wait'));
    const goal = [0, 1, 2].map((k) => +$(`#n${k}`).dataset.n);
    const total = goal[0] + goal[1] + goal[2];
    // Each mod lands in its pile in turn, in a fixed shuffled order.
    const order = [];
    goal.forEach((n, k) => { for (let i = 0; i < n; i++) order.push(k); });
    for (let i = order.length - 1; i > 0; i--) { const j = (i * 7919 + 13) % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    const els = [0, 1, 2].map((k) => $(`#n${k}`));
    els.forEach((e) => { e.textContent = '0'; });
    const t0 = performance.now();
    await new Promise((done) => {
      (function tick(now) {
        const t = Math.min(1, (now - t0) / ms);
        const e = 1 - Math.pow(1 - t, 2);
        const seen = Math.round(e * total);
        const c = [0, 0, 0];
        for (let i = 0; i < seen; i++) c[order[i]]++;
        els.forEach((el, k) => { if (el.textContent !== String(c[k])) el.textContent = c[k]; });
        $('#prog').style.width = `${e * 100}%`;
        $('#packstat').textContent = t < 1 ? `Checking ${seen} of ${total}` : `${total} mods`;
        if (t < 1) requestAnimationFrame(tick); else done();
      })(t0);
    });
    pack.classList.remove('checking');
    for (const s of pack.querySelectorAll('.stamp')) {
      s.classList.remove('wait');
      s.classList.add('thump');
      await sleep(170);
    }
  }

  function details(on = true) {
    $('#sheet').innerHTML = sheetHtml();
    hydrate($('#sheet'));
    $('#win').classList.toggle('details-on', on);
  }

  function route(tab) {
    if (tab === 'check') show('check', S.answer ? answerView(S.answer) : startView());
    if (tab === 'board') show('board', boardView());
    if (tab === 'watching') show('watching', watchingView());
  }

  function wire() {
    const app = $('#app');
    app.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = $('#q').value;
      if (q.trim()) answer(lookup(q));
    });
    app.addEventListener('click', (e) => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.tab) route(t.dataset.tab);
      else if (t.dataset.try) answer(lookup(t.dataset.try));
      else if (t.id === 'want') vote();
      else if (t.id === 'watch') watch();
      else if (t.id === 'act') act(t);
      else if (t.id === 'again') { S.answer = null; route('check'); $('#q').focus(); }
      else if (t.id === 'howto') toast(S.answer.why.replace("You don't need it. ", ''), 4200);
      else if (t.id === 'addall') addAll();
      else if (t.id === 'details') details(true);
      else if (t.id === 'smelt') window.open('https://github.com/Ceilingpiintensify/smelt', '_blank');
      else if (t.classList.contains('want')) {
        const on = t.classList.toggle('on');
        t.innerHTML = on ? `${icon.check}You want it` : `${icon.plus}Want it too`;
      } else if (t.classList.contains('x')) t.closest('li').remove();
    });
    $('#scrim').addEventListener('click', () => details(false));
    // Icon loads and failures don't bubble, so they're caught on the way down.
    document.addEventListener('load', (e) => { if (e.target.matches?.('.tile img')) iconReady(e.target); }, true);
    document.addEventListener('error', (e) => { if (e.target.matches?.('.tile img')) iconFailed(e.target); }, true);
    // Drop anything on the window: a jar is one answer, a folder or a pack is three numbers.
    let depth = 0;
    window.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; $('#dropzone').classList.add('on'); });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('dragleave', () => { if (--depth <= 0) $('#dropzone').classList.remove('on'); });
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      depth = 0;
      $('#dropzone').classList.remove('on');
      const f = e.dataTransfer.files[0];
      if (f && /\.jar$/i.test(f.name)) answer(lookup(f.name.replace(/[-_ ]?\d.*$/, '').replace(/\.jar$/i, '')));
      else if (f) checkPack();
    });
  }

  $('#app').innerHTML = shell();
  wire();

  // Driven by the screenshot tooling, and handy for trying the window by hand.
  window.wanted = {
    idle() {
      S.answer = null;
      S.added = false;
      show('check', startView());
      $('#toast').classList.remove('on');
    },
    focus(on = true) { $('#search').classList.toggle('focus', on); },
    async type(text, ms = 85) {
      const q = $('#q');
      q.value = '';
      for (const ch of text) {
        q.value += ch;
        await sleep(ms);
      }
    },
    check() { answer(lookup($('#q').value)); },
    answer(id, opts) { answer({ id, ...MODS[id] }, opts); },
    vote,
    watch,
    drag(on = true) { $('#dropzone').classList.toggle('on', on); },
    pack: checkPack,
    packDone() { show('check', packView()); },
    addAll,
    details,
    board() { route('board'); },
    watching() { route('watching'); },
    press(sel) {
      const b = $(sel);
      b.classList.add('pressed');
      setTimeout(() => b.classList.remove('pressed'), 170);
    },
    toast,
  };

  window.wanted.idle();
})();
