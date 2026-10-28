'use strict';
const { handle, tokenEq } = require('./src/api.js');
const O = require('./src/ops.js');
let pass = 0, fail = 0; const fails = [];
function eq(a, b, l) { const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x === y) pass++; else { fail++; fails.push(`${l}\n     got:      ${x}\n     expected: ${y}`); } }
function ok(c, l) { eq(!!c, true, l); }

const NOW = '2026-08-27';
const ENV = { CARTER_TOKEN: 'c'.repeat(40), PARTNER_TOKEN: 'm'.repeat(40),
              ADMIN_TOKEN: 'a'.repeat(40), PAGE_HTML: '<!doctype html>PAGE' };
const seed = () => ({
  built: NOW, aisles: O.AISLES,
  items: [
    { n:'Bananas', a:'Produce', s:'', need:true, why:'', since:'2026-08-20' },
    { n:'Milk', a:'Dairy & Eggs', s:'', need:true, why:'', since:'2026-08-25' },
    { n:'Bacon', a:'Meat & Fish', s:'', need:false, why:'', since:'' }
  ],
  dinners: [{ date:'2026-08-27', t:'Chicken nuggets', mins:5, how:'Oven.' },
            { date:'2026-08-28', t:'Frozen pizzas', mins:5, how:'Oven.' }]
});
function makeStore(initial) {
  let rev = 1, data = initial;
  return {
    get: async () => ({ rev, data: JSON.parse(JSON.stringify(data)) }),
    put: async (next, expected) => { if (expected !== rev) return false; data = next; rev++; return true; },
    force: (next) => { data = next; rev++; }
  };
}
function req(method, path, { token, body } = {}) {
  return {
    method, url: 'https://list.test' + path,
    headers: { get: k => (k.toLowerCase() === 'x-list-token' ? (token || null) : null) },
    text: async () => (body === undefined ? '' : JSON.stringify(body))
  };
}
const call = (m, p, o, store) => handle(req(m, p, o), ENV, store || makeStore(seed()), NOW);
const parse = r => JSON.parse(r.body);

(async () => {

/* ---- who gets in ---- */
{
  eq((await call('GET', '/' + ENV.CARTER_TOKEN)).status, 200, 'auth: Carter’s link serves the page');
  eq((await call('GET', '/' + ENV.PARTNER_TOKEN)).status, 200, 'auth: Partner’s link serves the page');
  eq((await call('GET', '/' + 'x'.repeat(40))).status, 404, 'auth: a wrong token is a plain 404');
  eq((await call('GET', '/')).status, 302, 'auth: the bare root gives nothing away');
  ok(!/PAGE/.test((await call('GET', '/' + 'x'.repeat(40))).body), 'auth: and never leaks the page');
  eq((await call('GET', '/api/state', { token: 'nope' })).status, 401, 'auth: the API refuses a bad token');
  eq(parse(await call('GET', '/api/state', { token: 'nope' })).error, 'not_authorised', 'auth: with no hint why');

  // A short token must never pass by prefix.
  ok(!tokenEq('c'.repeat(39), ENV.CARTER_TOKEN), 'auth: a truncated token fails');
  ok(!tokenEq('', ''), 'auth: two empty tokens are not a match');
  eq((await call('GET', '/api/state', { token: '' })).status, 401, 'auth: an empty token is refused');

  const page = await call('GET', '/' + ENV.CARTER_TOKEN);
  eq(page.headers['x-robots-tag'], 'noindex, nofollow', 'auth: the page asks not to be indexed');
  eq(page.headers['referrer-policy'], 'no-referrer', 'auth: and not to leak the token onward');
  eq(page.headers['cache-control'], 'no-store', 'auth: and not to be cached');
}

/* ---- reading ---- */
{
  const r = parse(await call('GET', '/api/state', { token: ENV.PARTNER_TOKEN }));
  eq(r.role, 'partner', 'state: it says who you are');
  eq(r.data.items.length, 3, 'state: the list comes back');
  eq(r.rev, 1, 'state: with a revision to write against');
}

/* ---- both of them can tick and add ---- */
{
  for (const [who, token] of [['partner', ENV.PARTNER_TOKEN], ['carter', ENV.CARTER_TOKEN]]) {
    const store = makeStore(seed());
    const r = parse(await call('POST', '/api/mutate',
      { token, body: { rev: 1, ops: [{ t: 'toggle', n: 'Milk' }] } }, store));
    eq(O.find(r.data.items, 'Milk').need, false, who + ': can cross something off');
    eq(r.rev, 2, who + ': and the revision moves');

    const r2 = parse(await call('POST', '/api/mutate',
      { token, body: { rev: 2, ops: [{ t: 'add', n: 'Paper towels' }] } }, store));
    ok(O.find(r2.data.items, 'Paper towels'), who + ': can add something new');
  }
}

/* ---- both of them can move a misfiled item ---- */
{
  for (const [who, token] of [['partner', ENV.PARTNER_TOKEN], ['carter', ENV.CARTER_TOKEN]]) {
    const r = await call('POST', '/api/mutate',
      { token, body: { rev: 1, ops: [{ t: 'move', n: 'Milk', a: 'Drinks' }] } }, makeStore(seed()));
    eq(r.status, 200, who + ': can move an item');
    eq(O.find(parse(r).data.items, 'Milk').a, 'Drinks', who + ': and it moves');
  }
  const bad = await call('POST', '/api/mutate',
    { token: ENV.PARTNER_TOKEN, body: { rev: 1, ops: [{ t: 'move', n: 'Milk', a: 'Garage' }] } }, makeStore(seed()));
  eq(bad.status, 400, 'move: a made-up aisle is refused by the server');
}

/* ---- what only Carter can do ---- */
{
  for (const op of [{ t:'remove', n:'Bacon' },
                    { t:'setDinner', date:'2026-08-27', dish:'Ramen', mins:10, how:'Boil.' },
                    { t:'swapDinner', a:'2026-08-27', b:'2026-08-28' }]) {
    const m = await call('POST', '/api/mutate', { token: ENV.PARTNER_TOKEN, body: { rev:1, ops:[op] } });
    eq(m.status, 403, 'role: Partner cannot ' + op.t);
    const c = await call('POST', '/api/mutate', { token: ENV.CARTER_TOKEN, body: { rev:1, ops:[op] } });
    eq(c.status, 200, 'role: Carter can ' + op.t);
  }
}

/* ---- two phones at once ---- */
{
  const store = makeStore(seed());
  // Both load rev 1. Partner ticks first.
  await call('POST', '/api/mutate', { token: ENV.PARTNER_TOKEN, body: { rev:1, ops:[{ t:'toggle', n:'Milk' }] } }, store);
  // Carter's phone still thinks it is on rev 1.
  const late = await call('POST', '/api/mutate',
    { token: ENV.CARTER_TOKEN, body: { rev:1, ops:[{ t:'toggle', n:'Bananas' }] } }, store);
  eq(late.status, 409, 'race: the second write is refused, not silently applied');
  const b = parse(late);
  eq(b.error, 'stale', 'race: and says why');
  eq(b.rev, 2, 'race: handing back the revision to retry against');
  eq(O.find(b.data.items, 'Milk').need, false, 'race: with the winning state, so nothing is lost');

  // Retrying against the fresh revision works.
  const retry = await call('POST', '/api/mutate',
    { token: ENV.CARTER_TOKEN, body: { rev:2, ops:[{ t:'toggle', n:'Bananas' }] } }, store);
  eq(retry.status, 200, 'race: the retry lands');
  const f = parse(retry);
  eq(O.find(f.data.items, 'Milk').need, false, 'race: keeping her change');
  eq(O.find(f.data.items, 'Bananas').need, false, 'race: and his');
}

/* ---- rubbish in ---- */
{
  const bad = [
    ['GET', '/api/mutate', { token: ENV.CARTER_TOKEN }, 405, 'a GET to mutate'],
    ['POST', '/api/state', { token: ENV.CARTER_TOKEN }, 405, 'a POST to state'],
    ['POST', '/api/mutate', { token: ENV.CARTER_TOKEN, body: undefined }, 400, 'an empty body'],
    ['POST', '/api/mutate', { token: ENV.CARTER_TOKEN, body: { rev:1, ops:[] } }, 400, 'no operations'],
    ['POST', '/api/mutate', { token: ENV.CARTER_TOKEN, body: { rev:1, ops:'toggle' } }, 400, 'ops that are not a list'],
    ['POST', '/api/mutate', { token: ENV.CARTER_TOKEN, body: { rev:1, ops:new Array(60).fill({t:'toggle',n:'Milk'}) } }, 400, 'a flood of operations'],
    ['POST', '/api/mutate', { token: ENV.CARTER_TOKEN, body: { rev:1, ops:[{ t:'nonsense' }] } }, 403, 'an operation nobody is allowed'],
    ['POST', '/api/mutate', { token: ENV.CARTER_TOKEN, body: { rev:1, ops:[{ t:'toggle', n:'Ghost' }] } }, 400, 'an item that does not exist'],
    ['POST', '/api/mutate', { token: ENV.CARTER_TOKEN, body: { rev:1, ops:[{ t:'remove', n:'Milk' }] } }, 400, 'removing something on the list']
  ];
  for (const [m, p, o, want, label] of bad) eq((await call(m, p, o)).status, want, 'bad input: ' + label);

  const r = await call('POST', '/api/mutate', { token: ENV.CARTER_TOKEN, body: { rev:1, ops:[{ t:'toggle', n:'Ghost' }] } });
  ok(/no such item/.test(parse(r).error), 'bad input: the message says what was wrong');
}

/* ---- a partly-applied batch must not land ---- */
{
  const store = makeStore(seed());
  const r = await call('POST', '/api/mutate',
    { token: ENV.CARTER_TOKEN, body: { rev:1, ops:[{ t:'toggle', n:'Milk' }, { t:'toggle', n:'Ghost' }] } }, store);
  eq(r.status, 400, 'batch: one bad op fails the whole batch');
  const after = await store.get();
  eq(O.find(after.data.items, 'Milk').need, true, 'batch: and nothing before it was saved');
  eq(after.rev, 1, 'batch: the revision did not move');
}

/* ---- the window rolls on read, without needing a write ---- */
{
  const store = makeStore(seed());
  const r = parse(await handle(req('GET', '/api/state', { token: ENV.CARTER_TOKEN }), ENV, store, '2026-08-28'));
  eq(r.data.dinners.map(d => d.date), ['2026-08-28'], 'roll: yesterday is gone on read');
  eq((await store.get()).rev, 1, 'roll: without writing anything');
}

console.log('');
if (fail) { console.log(`FAILED  ${fail} of ${pass + fail}`); fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log(`All ${pass} API tests pass.`);
})();
