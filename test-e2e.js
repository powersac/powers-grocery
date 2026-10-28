// Two phones, one server. Loads the REAL page in a real DOM, wires fetch to the
// REAL request handler over an in-memory store, and clicks the REAL buttons.
'use strict';
const fs = require('fs');
const { JSDOM } = require('jsdom');
const { handle } = require('./src/api.js');
const O = require('./src/ops.js');

let pass = 0, fail = 0; const fails = [];
function eq(a, b, l) { const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x === y) pass++; else { fail++; fails.push(`${l}\n     got:      ${x}\n     expected: ${y}`); } }
function ok(c, l) { eq(!!c, true, l); }

const PAGE = fs.readFileSync(__dirname + '/page.preview.html', 'utf8');
const NOW = '2026-08-27';
const CT = 'c'.repeat(40), MT = 'm'.repeat(40);
const ENV = { CARTER_TOKEN: CT, PARTNER_TOKEN: MT, ADMIN_TOKEN: 'a'.repeat(40), PAGE_HTML: PAGE };

function seed() {
  return { built: NOW, aisles: O.AISLES,
    items: [
      { n:'Bananas', a:'Produce', s:'', need:true, why:'', since:'2026-08-20', by:'carter' },
      { n:'Milk', a:'Dairy & Eggs', s:'', need:true, why:'', since:'2026-08-25', by:'carter' },
      { n:'Eggs', a:'Dairy & Eggs', s:'', need:true, why:'', since:'2026-08-25', by:'carter' },
      { n:'Bacon', a:'Meat & Fish', s:'', need:false, why:'', since:'' },
      { n:'Pesto', a:'Pantry', s:'', need:false, why:'', since:'' }
    ],
    dinners: [
      { date:'2026-08-27', t:'Chicken nuggets', mins:5, how:'Oven, broccoli, done.' },
      { date:'2026-08-28', t:'Frozen pizzas', mins:5, how:'Oven 15 minutes.' },
      { date:'2026-08-29', t:'Order in', mins:0, how:'' }
    ] };
}

// One server, shared by every phone in a scenario.
function server(initial) {
  let rev = 1, data = initial;
  let down = false;
  const store = {
    get: async () => ({ rev, data: JSON.parse(JSON.stringify(data)) }),
    put: async (next, expected) => { if (expected !== rev) return false; data = next; rev++; return true; }
  };
  return {
    store,
    setDown: v => { down = v; },
    peek: () => JSON.parse(JSON.stringify(data)),
    async fetch(url, opts) {
      if (down) throw new Error('network');
      const o = opts || {};
      const req = {
        method: o.method || 'GET',
        url: 'https://list.test' + url,
        headers: { get: k => (o.headers || {})[k] || (o.headers || {})[k.toLowerCase()] || null },
        text: async () => o.body || ''
      };
      const r = await handle(req, ENV, store, NOW);
      return { ok: (r.status || 200) < 400, status: r.status || 200, text: async () => r.body };
    }
  };
}

const OPEN = [];
function phone(srv, token) {
  const dom = new JSDOM(PAGE, { runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'https://list.test/' + token,
    beforeParse(w) {
      w.fetch = (u, o) => srv.fetch(u, o);
      w.HTMLDialogElement && (w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); });
      w.HTMLDialogElement && (w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); });
    } });
  const d = dom.window.document;
  const api = {
    dom, doc: d,
    $: q => d.querySelector(q), all: q => Array.from(d.querySelectorAll(q)),
    rows: () => api.all('#rows .row'),
    names: () => api.rows().map(r => r.querySelector('.nm .t').textContent.replace(/(Carter|Partner)$/, '')),
    tally: () => api.$('#tally').textContent,
    banner: () => (api.$('#banner').hidden ? '' : api.$('#banner').textContent),
    dinners: () => api.all('#dl li').map(li => li.querySelector('.dt').textContent),
    click: q => api.$(q).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })),
    hit: n => { const r = api.rows().find(x => x.querySelector('.nm .t').textContent.replace(/(Carter|Partner)$/, '') === n);
                if (!r) throw new Error('no row ' + n);
                r.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); },
    type: (q, v) => { const e = api.$(q); e.value = v; e.dispatchEvent(new dom.window.Event('input', { bubbles: true })); },
    submit: q => api.$(q).dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })),
    settle: async () => { for (let i = 0; i < 12; i++) await new Promise(r => setImmediate(r)); }
  };
  OPEN.push(dom);
  return api;
}

(async () => {

/* ============ it loads ============ */
{
  const s = server(seed());
  const p = phone(s, MT);
  await p.settle();
  eq(p.tally(), '3', 'load: the tally is what is on the list');
  eq(p.names().sort(), ['Bananas', 'Eggs', 'Milk'], 'load: only things to buy');
  eq(p.dinners().length, 3, 'load: the dinners are there');
  ok(!p.$('#dinners').hidden, 'load: and visible without hunting');
  ok(/Carter/.test(p.$('#footnote').textContent), 'load: she is told her changes are shared');
  eq(p.banner(), '', 'load: no error banner');
}

/* ============ THE POINT: a tick on one phone reaches the other ============ */
{
  const s = server(seed());
  const partner = phone(s, MT);
  const carter = phone(s, CT);
  await partner.settle(); await carter.settle();

  partner.hit('Milk');
  await partner.settle();
  eq(partner.tally(), '2', 'sync: her screen updates');
  eq(O.find(s.peek().items, 'Milk').need, false, 'sync: and the server has it');

  carter.click('#refresh');
  await carter.settle();
  ok(!carter.names().includes('Milk'), 'sync: milk is gone from his phone too');
  eq(carter.tally(), '2', 'sync: and his tally matches hers');
}

/* ============ adding travels the same way ============ */
{
  const s = server(seed());
  const partner = phone(s, MT);
  const carter = phone(s, CT);
  await partner.settle(); await carter.settle();

  partner.type('#add-name', 'Paper towels');
  partner.submit('#addform');
  await partner.settle();
  ok(partner.names().includes('Paper towels'), 'add: it appears for her');
  eq(partner.$('#add-name').value, '', 'add: and the box clears');

  carter.click('#refresh');
  await carter.settle();
  ok(carter.names().includes('Paper towels'), 'add: and for him, with no text message');
  const row = carter.rows().find(r => /Paper towels/.test(r.textContent));
  ok(/Partner/.test(row.textContent), 'add: labelled with who added it');
}

/* ============ what each of them is allowed to do ============ */
{
  const s = server(seed());
  const partner = phone(s, MT);
  const carter = phone(s, CT);
  await partner.settle(); await carter.settle();

  eq(partner.all('#dl .dedit').length, 0, 'role: Partner cannot edit dinners');
  eq(carter.all('#dl .dedit').length, 3, 'role: Carter can');

  partner.click('#f-all'); await partner.settle();
  eq(partner.all('#rows .kill').length, 0, 'role: Partner gets no delete buttons');
  carter.click('#f-all'); await carter.settle();
  ok(carter.all('#rows .kill').length > 0, 'role: Carter does');

  // And the server enforces it even if the button were forged.
  const forged = await s.fetch('/api/mutate', { method: 'POST',
    headers: { 'x-list-token': MT, 'content-type': 'application/json' },
    body: JSON.stringify({ rev: 1, ops: [{ t: 'remove', n: 'Bacon' }] }) });
  eq(forged.status, 403, 'role: the server refuses it too, not just the UI');
}

/* ============ Partner fixes a misfiled item ============ */
{
  const start = seed();
  start.items.push({ n:'Lemonade', a:'Produce', s:'', need:true, why:'', since:'2026-08-26', by:'partner' });
  const s = server(start);
  const partner = phone(s, MT);
  const carter = phone(s, CT);
  await partner.settle(); await carter.settle();

  eq(partner.all('#rows .mv').length, 0, 'move: no move control on the shopping view');
  partner.click('#f-all'); await partner.settle();
  const li = partner.all('#rows li').find(x => /Lemonade/.test(x.textContent));
  const sel = li.querySelector('.mv');
  ok(sel, 'move: Everything shows a move control');
  ok(!Array.from(sel.options).some(o => o.value === 'Produce'), 'move: it does not offer the aisle it is already in');
  sel.value = 'Drinks';
  sel.dispatchEvent(new partner.dom.window.Event('change', { bubbles: true }));
  await partner.settle();
  eq(O.find(s.peek().items, 'Lemonade').a, 'Drinks', 'move: the server has it in Drinks');
  const box = partner.all('#rows .aisle').find(b => /Lemonade/.test(b.textContent));
  eq(box.querySelector('h2').textContent, 'Drinks', 'move: her screen shows it under Drinks');
  eq(O.find(s.peek().items, 'Lemonade').need, true, 'move: and it is still on the list');

  carter.click('#refresh'); await carter.settle();
  const cbox = carter.all('#rows .aisle').find(b => /Lemonade/.test(b.textContent));
  eq(cbox.querySelector('h2').textContent, 'Drinks', 'move: and his');
}

/* ============ Carter changes a dinner ============ */
{
  const s = server(seed());
  const carter = phone(s, CT);
  const partner = phone(s, MT);
  await carter.settle(); await partner.settle();

  carter.$('#dl li .dedit button').dispatchEvent(new carter.dom.window.MouseEvent('click', { bubbles: true }));
  ok(carter.$('#picker').hasAttribute('open'), 'dinner: the picker opens');
  const opt = carter.all('#picker-opts button').find(b => /Soft tacos/.test(b.textContent));
  opt.dispatchEvent(new carter.dom.window.MouseEvent('click', { bubbles: true }));
  await carter.settle();
  eq(carter.dinners()[0], 'Soft tacos', 'dinner: it changed');
  ok(/20 min/.test(carter.$('#dl .dmin').textContent), 'dinner: with its prep time');

  partner.click('#refresh');
  await partner.settle();
  eq(partner.dinners()[0], 'Soft tacos', 'dinner: and she sees it');
  ok(/Brown the beef/.test(partner.$('#dl .dhow').textContent), 'dinner: with how to cook it');
}

/* ============ both tapping at the same moment ============ */
{
  const s = server(seed());
  const partner = phone(s, MT);
  const carter = phone(s, CT);
  await partner.settle(); await carter.settle();

  // Neither has refreshed; both are on the same revision.
  partner.hit('Milk');
  carter.hit('Bananas');
  await partner.settle(); await carter.settle();
  await partner.settle(); await carter.settle();

  const final = s.peek();
  eq(O.find(final.items, 'Milk').need, false, 'race: her tick survived');
  eq(O.find(final.items, 'Bananas').need, false, 'race: and his');
  eq(carter.banner(), '', 'race: with no error shown to either of them');
}

/* ============ the network drops mid-shop ============ */
{
  const s = server(seed());
  const p = phone(s, MT);
  await p.settle();
  s.setDown(true);
  p.hit('Milk');
  await p.settle();
  ok(/Cannot reach|did not save/i.test(p.banner()), 'offline: she is told it did not save');
  ok(p.names().includes('Milk'), 'offline: and the row comes back rather than lying');

  s.setDown(false);
  p.click('#refresh');
  await p.settle();
  eq(p.banner(), '', 'offline: the banner clears when it is back');
  eq(p.tally(), '3', 'offline: showing the real state');
}

/* ============ a bad link ============ */
{
  const s = server(seed());
  const p = phone(s, 'x'.repeat(40));
  await p.settle();
  ok(/does not work/i.test(p.$('#rows').textContent), 'bad link: it says so plainly');
  ok(/cut short/i.test(p.$('#rows').textContent), 'bad link: and suggests the likely reason');
}

/* ============ an empty list ============ */
{
  const empty = seed(); empty.items.forEach(i => { i.need = false; i.since = ''; });
  const p = phone(server(empty), MT);
  await p.settle();
  eq(p.tally(), '0', 'empty: nothing to buy');
  ok(/All done/.test(p.$('#rows').textContent), 'empty: and it says so');
  ok(!p.$('#dinners').hidden, 'empty: the dinners are still there');
}

/* ============ searching ============ */
{
  const p = phone(server(seed()), MT);
  await p.settle();
  p.click('#f-all');
  p.type('#q', 'bacon');
  eq(p.names(), ['Bacon'], 'search: it finds an item that is not on the list');
  p.type('#q', 'zzz');
  ok(/Nothing matches/.test(p.$('#rows').textContent), 'search: and says when it finds nothing');
}

// Each page runs a poll timer; without closing them node never exits.
OPEN.forEach(d => { try { d.window.close(); } catch (e) {} });
console.log('');
if (fail) { console.log(`FAILED  ${fail} of ${pass + fail}`); fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log(`All ${pass} browser checks pass.`);
process.exit(0);
})();
