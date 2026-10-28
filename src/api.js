// The Worker's request handling, minus the Cloudflare bindings, so it can be
// tested against a plain in-memory store.
'use strict';
const O = require('./ops.js');

const MAX_BODY = 64 * 1024;
const json = (obj, status) => ({ status: status || 200, body: JSON.stringify(obj),
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

// Constant-time-ish compare so a token cannot be guessed a character at a time.
function tokenEq(a, b) {
  const x = String(a || ''), y = String(b || '');
  // An empty token must never match, or an unset secret would let everyone in.
  if (!x.length || x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}
function roleFor(token, env) {
  if (env.CARTER_TOKEN && tokenEq(token, env.CARTER_TOKEN)) return 'carter';
  if (env.PARTNER_TOKEN && tokenEq(token, env.PARTNER_TOKEN)) return 'partner';
  if (env.ADMIN_TOKEN && tokenEq(token, env.ADMIN_TOKEN)) return 'admin';
  return null;
}
// Partner shops. Carter plans. Both can put things on and take things off,
// because that is the whole reason this is hosted rather than local.
const ALLOWED = {
  partner: ['toggle', 'add', 'move'],
  carter: ['toggle', 'add', 'move', 'remove', 'setDinner', 'swapDinner'],
  admin:  ['toggle', 'add', 'move', 'remove', 'setDinner', 'swapDinner']
};

async function handle(req, env, store, now) {
  const url = new URL(req.url);
  const path = url.pathname;

  if (path === '/' || path === '') return { status: 302, headers: { location: '/robots.txt' }, body: '' };
  if (path === '/robots.txt') return { status: 200, headers: { 'content-type': 'text/plain' },
    body: 'User-agent: *\nDisallow: /\n' };
  if (path === '/health') return json({ ok: true });

  // /<token> serves the page. /api/... does the work, token in a header.
  const apiMatch = path === '/api/state' || path === '/api/mutate';
  const token = apiMatch ? req.headers.get('x-list-token') : path.slice(1);
  const role = roleFor(token, env);

  if (!role) {
    // Same answer for a wrong token and a missing one, and no hint which.
    return apiMatch ? json({ error: 'not_authorised' }, 401)
                    : { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' },
                        body: '<!doctype html><meta charset=utf-8><title>Not found</title>' +
                              '<body style="font:17px system-ui;padding:3rem;max-width:30rem;margin:0 auto">' +
                              '<h1 style="font-size:1.3rem">Not found</h1>' +
                              '<p>Check the link. It is long and easy to cut short when copying.</p>' };
  }

  if (!apiMatch) {
    if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
    return { status: 200, headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      // The page is only ever reachable by its secret link; keep it out of indexes
      // and out of referrer headers so the token does not leak to other sites.
      'x-robots-tag': 'noindex, nofollow',
      'referrer-policy': 'no-referrer'
    }, body: env.PAGE_HTML };
  }

  if (path === '/api/state') {
    if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
    const cur = await store.get();
    return json({ rev: cur.rev, role, data: O.rollWindow(cur.data, now) });
  }

  // /api/mutate
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  let body;
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ error: 'too_large' }, 413);
  try { body = JSON.parse(raw); } catch (e) { return json({ error: 'bad_json' }, 400); }
  if (!body || !Array.isArray(body.ops) || !body.ops.length) return json({ error: 'no_ops' }, 400);
  if (body.ops.length > 50) return json({ error: 'too_many_ops' }, 400);

  const cur = await store.get();
  // Optimistic concurrency. If the other phone got there first, the caller
  // refetches rather than writing over what it never saw.
  if (body.rev !== undefined && body.rev !== cur.rev) {
    return json({ error: 'stale', rev: cur.rev, data: O.rollWindow(cur.data, now) }, 409);
  }

  let state = cur.data;
  for (const op of body.ops) {
    if (!op || !ALLOWED[role].includes(op.t)) return json({ error: 'not_allowed', op: op && op.t }, 403);
    const r = O.apply(state, op, { now, who: role });
    if (r.error) return json({ error: r.error }, 400);
    state = r.state;
  }
  const problems = O.validate(state);
  if (problems.length) return json({ error: 'would_corrupt', problems }, 500);

  const saved = await store.put(state, cur.rev);
  if (!saved) return json({ error: 'stale', rev: (await store.get()).rev, data: O.rollWindow((await store.get()).data, now) }, 409);
  const after = await store.get();
  return json({ rev: after.rev, role, data: O.rollWindow(after.data, now) });
}

module.exports = { handle, roleFor, tokenEq, ALLOWED };
