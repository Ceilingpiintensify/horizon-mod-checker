// Wanted's vote server: a Cloudflare Worker and one D1 database.
//
//   GET    /v1/top                  the 10 most wanted mods (cached for 5 minutes)
//   GET    /v1/count?mods=a,b,c     vote counts for up to 50 mods
//   POST   /v1/vote   {mod, name, install}   want it too
//   DELETE /v1/vote   {mod, install}         take the vote back
//
// No accounts. One vote per mod per install: `install` is a random id the app
// makes on first start. A per-IP limit keeps scripts honest; the address is
// only kept as a salted hash for the current hour. Counts are approximate.

const MOD_ID = /^[a-z0-9_]{1,64}$/;
const INSTALL_ID = /^[0-9a-f]{32}$/;
const BOARD_SIZE = 10;
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    try {
      if (url.pathname === '/v1/top' && request.method === 'GET') return await top(request, env, ctx);
      if (url.pathname === '/v1/count' && request.method === 'GET') return await count(url, env);
      if (url.pathname === '/v1/vote' && request.method === 'POST') return await vote(request, env, +1);
      if (url.pathname === '/v1/vote' && request.method === 'DELETE') return await vote(request, env, -1);
      return json({ error: 'not found' }, 404);
    } catch (e) {
      console.error(e);
      return json({ error: 'server error' }, 500);
    }
  },
};

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS, ...extra },
  });
}

async function top(request, env, ctx) {
  const cache = caches.default;
  const key = new Request(new URL('/v1/top', request.url).toString());
  const hit = await cache.match(key);
  if (hit) return hit;
  const min = Number(env.BOARD_MIN_VOTES || 3);
  const { results } = await env.DB
    .prepare('SELECT mod, name, votes FROM tallies WHERE votes >= ? ORDER BY votes DESC, mod LIMIT ?')
    .bind(min, BOARD_SIZE)
    .all();
  const res = json({ mods: results, updated: new Date().toISOString() }, 200, { 'cache-control': 'public, max-age=300' });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

async function count(url, env) {
  const mods = (url.searchParams.get('mods') || '').split(',').filter((m) => MOD_ID.test(m)).slice(0, 50);
  if (!mods.length) return json({ counts: {} });
  const marks = mods.map(() => '?').join(',');
  const { results } = await env.DB.prepare(`SELECT mod, votes FROM tallies WHERE mod IN (${marks})`).bind(...mods).all();
  const counts = Object.fromEntries(mods.map((m) => [m, 0]));
  for (const r of results) counts[r.mod] = r.votes;
  return json({ counts }, 200, { 'cache-control': 'public, max-age=60' });
}

async function vote(request, env, delta) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'send JSON' }, 400);
  }
  const mod = String(body.mod || '');
  const install = String(body.install || '');
  if (!MOD_ID.test(mod) || !INSTALL_ID.test(install)) return json({ error: 'bad mod or install id' }, 400);

  if (!(await withinLimit(request, env))) return json({ error: 'too many votes from this address, try later' }, 429);

  const now = Math.floor(Date.now() / 1000);
  if (delta > 0) {
    const name = cleanName(body.name) || mod;
    const r = await env.DB
      .prepare('INSERT INTO votes (mod, install, created) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
      .bind(mod, install, now)
      .run();
    if (r.meta.changes) {
      await env.DB
        .prepare('INSERT INTO tallies (mod, name, votes) VALUES (?, ?, 1) ON CONFLICT (mod) DO UPDATE SET votes = votes + 1')
        .bind(mod, name)
        .run();
    }
  } else {
    const r = await env.DB.prepare('DELETE FROM votes WHERE mod = ? AND install = ?').bind(mod, install).run();
    if (r.meta.changes) {
      await env.DB.prepare('UPDATE tallies SET votes = MAX(votes - 1, 0) WHERE mod = ?').bind(mod).run();
    }
  }
  const row = await env.DB.prepare('SELECT votes FROM tallies WHERE mod = ?').bind(mod).first();
  return json({ mod, votes: row ? row.votes : 0, yours: delta > 0 });
}

// Printable text only, at most 48 characters. The board shows it as plain text.
function cleanName(name) {
  return String(name || '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48);
}

async function withinLimit(request, env) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const hour = Math.floor(Date.now() / 3_600_000);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${env.IP_SALT || ''}:${hour}:${ip}`));
  const key = [...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
  const row = await env.DB
    .prepare('INSERT INTO rate (ip, hour, n) VALUES (?, ?, 1) ON CONFLICT (ip, hour) DO UPDATE SET n = n + 1 RETURNING n')
    .bind(key, hour)
    .first();
  // Old hours are cleared now and then, so the table stays small.
  if (Math.random() < 0.01) await env.DB.prepare('DELETE FROM rate WHERE hour < ?').bind(hour - 1).run();
  return row.n <= Number(env.VOTES_PER_HOUR || 60);
}
