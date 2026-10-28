// The dinner window: can it grow? Everything here is about the bug that let
// the plan shrink from ten days to two between Aug 28 and Sep 5, 2026.
'use strict';
const O = require('./src/ops.js');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL ' + m)); };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + '  got ' + JSON.stringify(a));

const base = () => ({
  built: '2026-08-27', aisles: O.AISLES, items: [],
  dinners: [
    { date: '2026-08-27', t: 'Chicken nuggets', mins: 5, how: 'Oven.' },
    { date: '2026-08-28', t: 'Frozen pizzas', mins: 5, how: 'Oven.' },
    { date: '2026-08-29', t: 'Ramen', mins: 10, how: 'Boil.' }
  ]
});
const A = (st, op, now) => O.apply(st, op, { now: now || '2026-08-27', who: 'admin' });

/* ---- the bug: a day past the seeded range could never be added ---- */
{
  const r = A(base(), { t: 'setDinner', date: '2026-09-30', dish: 'Soft tacos', mins: 20, how: 'Brown the beef.' });
  ok(!r.error, 'append: a day past the seeded range is accepted');
  eq(r.state.dinners.length, 4, 'append: the day landed');
  eq(r.state.dinners[3].date, '2026-09-30', 'append: it sorts to the end');
  eq([r.state.dinners[3].t, r.state.dinners[3].mins, r.state.dinners[3].how],
     ['Soft tacos', 20, 'Brown the beef.'], 'append: the fields survive');
  eq(O.validate(r.state), [], 'append: the result still validates');
}

/* ---- editing an existing day still edits, never duplicates ---- */
{
  const r = A(base(), { t: 'setDinner', date: '2026-08-28', dish: 'Bolognese', mins: 20, how: 'Brown the beef.' });
  eq(r.state.dinners.length, 3, 'edit: no duplicate row');
  eq(r.state.dinners.map(d => d.t), ['Chicken nuggets', 'Bolognese', 'Ramen'], 'edit: the right day changed');
}

/* ---- what is still refused ---- */
{
  ok(A(base(), { t: 'setDinner', date: '2026-08-26', dish: 'x', mins: 5, how: '' }).error, 'refuse: a day already past');
  ok(A(base(), { t: 'setDinner', date: 'not-a-date', dish: 'x', mins: 5, how: '' }).error, 'refuse: a junk date');
  ok(A(base(), { t: 'setDinner', date: '', dish: 'x', mins: 5, how: '' }).error, 'refuse: a missing date');
  ok(A(base(), { t: 'setDinner', date: '2026-09-30', dish: '', mins: 5, how: '' }).error, 'refuse: a blank dish');
  ok(A(base(), { t: 'setDinner', date: '2026-09-30', dish: 'x', mins: '20', how: '' }).error, 'refuse: minutes as a string');
  ok(A(base(), { t: 'setDinner', date: '2026-09-30', dish: 'x', mins: 12.5, how: '' }).error, 'refuse: a fractional time');
  ok(A(base(), { t: 'setDinner', date: '2026-09-30', dish: 'x', mins: 999, how: '' }).error, 'refuse: an absurd time');
}

/* ---- the cap ---- */
{
  let st = base();
  for (let i = 1; i <= 7; i++) {
    st = A(st, { t: 'setDinner', date: '2026-09-0' + i, dish: 'x', mins: 5, how: 'y' }).state;
  }
  eq(st.dinners.length, O.WINDOW_MAX, 'cap: ten days is allowed');
  ok(A(st, { t: 'setDinner', date: '2026-09-08', dish: 'x', mins: 5, how: 'y' }).error, 'cap: an eleventh live day is refused');
}

/* ---- the cap counts live days only, not the stale ones still in storage ----
   This is the real shape of the data on Sep 5 2026: the stored array still held
   every day back to Aug 28, while the API only ever showed the future ones. A
   cap that counted the whole array would refuse every append forever.        */
{
  const stale = base();
  stale.dinners = [];
  for (let i = 1; i <= 20; i++) stale.dinners.push({ date: '2026-08-' + String(i).padStart(2, '0'), t: 'old', mins: 5, how: 'y' });
  stale.dinners.push({ date: '2026-09-05', t: 'Steak tips', mins: 20, how: 'Grill.' });
  stale.dinners.push({ date: '2026-09-06', t: 'Soft tacos', mins: 20, how: 'Brown the beef.' });

  let s = stale;
  for (const d of ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10',
                   '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14']) {
    const r = A(s, { t: 'setDinner', date: d, dish: 'x', mins: 5, how: 'y' }, '2026-09-05');
    ok(!r.error, 'stale cap: ' + d + ' is accepted');
    if (r.state) s = r.state;
  }
  eq(O.rollWindow(s, '2026-09-05').dinners.length, 10, 'stale cap: the live window is ten days');
  eq(s.dinners.length, 30, 'stale cap: the stored array keeps its history');
  ok(A(s, { t: 'setDinner', date: '2026-09-15', dish: 'x', mins: 5, how: 'y' }, '2026-09-05').error,
     'stale cap: the eleventh live day is still refused');
  eq(O.validate(s), [], 'stale cap: the result still validates');
}

console.log('\n' + (fail ? fail + ' FAILED, ' : 'All ') + pass + ' window tests pass.');
process.exit(fail ? 1 : 0);
