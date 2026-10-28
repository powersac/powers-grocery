'use strict';
const O = require('./src/ops.js');
let pass = 0, fail = 0; const fails = [];
function eq(a, b, l) { const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x === y) pass++; else { fail++; fails.push(`${l}\n     got:      ${x}\n     expected: ${y}`); } }
function ok(c, l) { eq(!!c, true, l); }

const NOW = '2026-08-27';
const base = () => ({
  built: NOW, aisles: O.AISLES,
  items: [
    { n:'Bananas', a:'Produce', s:'', need:true,  why:'', since:'2026-08-20', by:'carter' },
    { n:'Milk',    a:'Dairy & Eggs', s:'', need:true, why:'', since:'2026-08-25', by:'carter' },
    { n:'Bacon',   a:'Meat & Fish', s:'', need:false, why:'', since:'' },
    { n:"Chef's Marinara", a:'Pantry', s:'', need:false, why:'', since:'' }
  ],
  dinners: [
    { date:'2026-08-27', t:'Chicken nuggets', mins:5,  how:'Oven.' },
    { date:'2026-08-28', t:'Frozen pizzas',   mins:5,  how:'Oven.' },
    { date:'2026-08-29', t:'Order in',        mins:0,  how:'' }
  ]
});
const run = (st, op, who) => O.apply(st, op, { now: NOW, who: who || 'partner' });

/* ---- ticking is shared, which is the entire point of hosting this ---- */
{
  const r = run(base(), { t:'toggle', n:'Milk' });
  ok(!r.error, 'toggle: it works');
  const m = O.find(r.state.items, 'Milk');
  eq(m.need, false, 'toggle: milk comes off the list');
  eq(m.since, '', 'toggle: and loses its since date');

  const back = run(r.state, { t:'toggle', n:'Milk' }, 'carter');
  eq(O.find(back.state.items, 'Milk').need, true, 'toggle: and can go back on');
  eq(O.find(back.state.items, 'Milk').since, NOW, 'toggle: with a fresh since date');
  eq(O.find(back.state.items, 'Milk').by, 'carter', 'toggle: recording who put it on');

  eq(run(base(), { t:'toggle', n:'Nothing' }).error, 'no such item: Nothing', 'toggle: an unknown item is refused');
  ok(!run(base(), { t:'toggle', n:'  milk  ' }).error, 'toggle: names are matched loosely');
}

/* ---- adding ---- */
{
  const r = run(base(), { t:'add', n:'Paper towels' });
  const it = O.find(r.state.items, 'Paper towels');
  ok(!!it, 'add: a new item lands');
  eq(it.a, 'Household', 'add: filed by a guess at the aisle');
  eq(it.need, true, 'add: and on the list');
  eq(it.since, NOW, 'add: stamped today');

  // Something already in the catalog goes back on rather than duplicating.
  const r2 = run(base(), { t:'add', n:'bacon' });
  eq(r2.state.items.filter(i => O.sameName(i.n, 'Bacon')).length, 1, 'add: no duplicate row');
  eq(O.find(r2.state.items, 'Bacon').need, true, 'add: it just goes on the list');

  // Apostrophes are how people actually type.
  const r3 = run(base(), { t:'add', n:'chefs marinara' });
  eq(r3.state.items.filter(i => /Chef/.test(i.n)).length, 1, 'add: chefs matches Chef’s');

  eq(run(base(), { t:'add', n:'   ' }).error, 'an item needs a name', 'add: an empty name is refused');
  ok(run(base(), { t:'add', n:'x'.repeat(200) }).error, 'add: an absurd name is refused');
  eq(run(base(), { t:'add', n:'Sponges', a:'Nowhere' }).state.items.find(i => i.n === 'Sponges').a,
     'Household', 'add: an unknown aisle falls back to a guess');
  eq(run(base(), { t:'add', n:'Sponges', s:'Costco' }).state.items.find(i => i.n === 'Sponges').s,
     '', 'add: an unknown store tag is dropped');
  ok(run(base(), { t:'add', n:'Zucchini' }).state.items.map(i => i.a)
       .every((a, i, arr) => i === 0 || O.AISLES.indexOf(a) >= O.AISLES.indexOf(arr[i-1])),
     'add: the list stays grouped in aisle order');
}

/* ---- removing from the catalog ---- */
{
  ok(run(base(), { t:'remove', n:'Milk' }).error, 'remove: something on the list is protected');
  ok(/Take it off first/.test(run(base(), { t:'remove', n:'Milk' }).error), 'remove: and says how');
  const r = run(base(), { t:'remove', n:'Bacon' });
  ok(!O.find(r.state.items, 'Bacon'), 'remove: something off the list goes');
  ok(run(base(), { t:'remove', n:'Ghost' }).error, 'remove: an unknown item is refused');
}

/* ---- dinners ---- */
{
  const r = run(base(), { t:'setDinner', date:'2026-08-28', dish:'Soft tacos', mins:20, how:'Brown the beef.' });
  const d = r.state.dinners.find(x => x.date === '2026-08-28');
  eq([d.t, d.mins, d.how], ['Soft tacos', 20, 'Brown the beef.'], 'dinner: it is set');

  ok(run(base(), { t:'setDinner', date:'2026-08-26', dish:'x', mins:5, how:'' }).error, 'dinner: a day already past is refused');
  ok(run(base(), { t:'setDinner', date:'2026-08-28', dish:'', mins:5, how:'' }).error, 'dinner: a blank dish is refused');
  ok(run(base(), { t:'setDinner', date:'2026-08-28', dish:'x', mins:'20', how:'' }).error, 'dinner: minutes as a string is refused');
  ok(run(base(), { t:'setDinner', date:'2026-08-28', dish:'x', mins:12.5, how:'' }).error, 'dinner: a fractional time is refused');
  ok(run(base(), { t:'setDinner', date:'2026-08-28', dish:'x', mins:999, how:'' }).error, 'dinner: an absurd time is refused');

  const s = run(base(), { t:'swapDinner', a:'2026-08-27', b:'2026-08-28' });
  eq(s.state.dinners[0].t, 'Frozen pizzas', 'swap: the days trade places');
  eq(s.state.dinners[1].t, 'Chicken nuggets', 'swap: both ways');
  eq(s.state.dinners[0].date, '2026-08-27', 'swap: the dates themselves do not move');
  ok(run(base(), { t:'swapDinner', a:'2026-08-27', b:'2030-01-01' }).error, 'swap: an unknown day is refused');
}

/* ---- the aisle guess: whole words, phrases first ---- */
{
  const want = {
    'Lemonade':'Drinks', 'Pink lemonade':'Drinks', 'Limeade':'Drinks', 'Lemons':'Produce', 'Limes':'Produce',
    'Lemon juice':'Drinks', 'Orange juice':'Drinks', 'Apple juice':'Drinks', 'Apple cider':'Drinks',
    'Milk tea':'Drinks', 'Iced tea':'Drinks', 'Cream soda':'Drinks', 'Ginger ale':'Drinks', 'Kombucha':'Drinks',
    'Sparkling water':'Drinks', 'Seltzer':'Drinks',
    'Eggplant':'Produce', 'Watermelon':'Produce', 'Oranges':'Produce', 'Grapes':'Produce', 'Tomatoes':'Produce',
    'Cucumber':'Produce', 'Blueberries':'Produce', 'Strawberries':'Produce', 'Bell peppers':'Produce', 'Ginger':'Produce',
    'Eggs':'Dairy & Eggs', 'Milk':'Dairy & Eggs', 'Buttermilk':'Dairy & Eggs', 'Sour cream':'Dairy & Eggs',
    'Chocolate milk':'Dairy & Eggs', 'Cream cheese':'Dairy & Eggs',
    'Peanut butter':'Pantry', 'Applesauce':'Pantry', 'Pasta':'Pantry',
    'Pepperoni':'Meat & Fish', 'Chicken thighs':'Meat & Fish',
    'Sourdough':'Bakery', 'Bagels':'Bakery',
    'Ice cream':'Frozen', 'Frozen peas':'Frozen',
    'Paper towels':'Household', 'Toilet paper rolls':'Household'
  };
  for (const [n, a] of Object.entries(want)) eq(O.guessAisle(n), a, 'guess: ' + n);
}

/* ---- moving a misfiled item ---- */
{
  const st = base();
  st.items.push({ n:'Lemonade', a:'Produce', s:'', need:true, why:'', since:'2026-08-26', by:'partner' });
  const r = run(st, { t:'move', n:'lemonade', a:'Drinks' });
  ok(!r.error, 'move: it works');
  const it = O.find(r.state.items, 'Lemonade');
  eq(it.a, 'Drinks', 'move: the item lands in the new aisle');
  eq(it.need, true, 'move: and stays on the list');
  eq(it.since, '2026-08-26', 'move: without touching anything else');
  eq(r.state.items[r.state.items.length - 1].n, 'Lemonade', 'move: and the list is re-sorted');
  const again = run(r.state, { t:'add', n:'Lemonade' });
  eq(O.find(again.state.items, 'Lemonade').a, 'Drinks', 'move: the fix sticks when it is added again');
  eq(run(st, { t:'move', n:'Nothing', a:'Drinks' }).error, 'no such item: Nothing', 'move: an unknown item is refused');
  eq(run(st, { t:'move', n:'Lemonade', a:'Garage' }).error, 'no such aisle: Garage', 'move: an unknown aisle is refused');
}

/* ---- anything unexpected is refused rather than guessed at ---- */
{
  ok(run(base(), { t:'drop tables' }).error, 'safety: an unknown op is refused');
  ok(run(base(), {}).error, 'safety: an empty op is refused');
  const before = base();
  run(before, { t:'toggle', n:'Milk' });
  eq(O.find(before.items, 'Milk').need, true, 'safety: apply never mutates what it was given');
}

/* ---- the rolling window ---- */
{
  const r = O.rollWindow(base(), '2026-08-29');
  eq(r.dinners.map(d => d.date), ['2026-08-29'], 'roll: days already gone are dropped');
  eq(O.rollWindow(base(), '2026-08-27').dinners.length, 3, 'roll: today is kept');
}

/* ---- the shape the page depends on ---- */
{
  eq(O.validate(base()), [], 'validate: a good state passes');
  const bad = base(); bad.items[0].since = '';
  ok(O.validate(bad).length, 'validate: an item on the list with no since is caught');
  const bad2 = base(); bad2.items.push({ n:'Milk', a:'Pantry', s:'', need:false, why:'', since:'' });
  ok(O.validate(bad2).length, 'validate: a duplicate name is caught');
  const bad3 = base(); bad3.dinners[0].mins = 'quick';
  ok(O.validate(bad3).length, 'validate: a bad prep time is caught');
  // Every op leaves a state the page can still render.
  for (const op of [{t:'toggle',n:'Milk'}, {t:'add',n:'Sponges'}, {t:'move',n:'Milk',a:'Drinks'}, {t:'remove',n:'Bacon'},
                    {t:'setDinner',date:'2026-08-27',dish:'Ramen',mins:10,how:'Boil.'},
                    {t:'swapDinner',a:'2026-08-27',b:'2026-08-28'}]) {
    const r = run(base(), op);
    eq(O.validate(r.state), [], 'validate: still valid after ' + op.t);
  }
}

console.log('');
if (fail) { console.log(`FAILED  ${fail} of ${pass + fail}`); fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log(`All ${pass} list-logic tests pass.`);
