// The scheduled top-up. This is the floor under the whole system: if every
// other path to the Worker is blocked, this is what keeps a plan on the fridge.
'use strict';
const O = require('./src/ops.js');
const C = require('./src/cron.js');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL ' + m)); };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + '  got ' + JSON.stringify(a));

const NOW = '2026-09-05';                       // a Saturday
const state = dinners => ({ built: NOW, aisles: O.AISLES, items: [], dinners: dinners });
const live = (s, now) => s.dinners.filter(d => d.date >= (now || NOW));

/* ---- an empty plan comes back full ---- */
{
  const r = C.topUp(state([]), NOW);
  eq(r.added.length, 10, 'empty: ten nights added');
  eq(live(r.state).length, 10, 'empty: the live window is ten days');
  eq(live(r.state).map(d => d.date),
     ['2026-09-05','2026-09-06','2026-09-07','2026-09-08','2026-09-09',
      '2026-09-10','2026-09-11','2026-09-12','2026-09-13','2026-09-14'],
     'empty: ten consecutive days starting today');
  eq(O.validate(r.state), [], 'empty: the result validates');
}

/* ---- nights they already set are never touched ---- */
{
  const theirs = [
    { date: '2026-09-05', t: 'Steak tips, rice, broccoli', mins: 20, how: 'Marinate the night before.' },
    { date: '2026-09-06', t: 'Soft tacos', mins: 20, how: 'Brown the beef.' },
    { date: '2026-09-11', t: 'Dinner out', mins: 0, how: 'Booked.' }
  ];
  const r = C.topUp(state(theirs.map(d => Object.assign({}, d))), NOW);
  const got = live(r.state);
  theirs.forEach(t => {
    const found = got.find(d => d.date === t.date);
    eq([found.t, found.mins, found.how], [t.t, t.mins, t.how], 'kept: ' + t.date + ' is untouched');
  });
  eq(got.length, 10, 'kept: the gaps around them are filled');
  eq(r.added.some(a => a.date === '2026-09-11'), false, 'kept: an occupied Friday is not overwritten');
}

/* ---- running twice changes nothing the second time ---- */
{
  const first = C.topUp(state([]), NOW);
  const second = C.topUp(first.state, NOW);
  eq(second.added.length, 0, 'idempotent: the second run adds nothing');
  eq(second.state.dinners, first.state.dinners, 'idempotent: the plan is unchanged');
}

/* ---- the house rules hold on a plan built from nothing ---- */
{
  const w = live(C.topUp(state([]), NOW).state);
  for (let i = 0; i < w.length; i++) {
    for (let j = i + 1; j < w.length && j <= i + 4; j++) {
      ok(!C.echoes(w[i].t, w[j].t), 'rules: no repeat inside five days (' + w[i].date + ' vs ' + w[j].date + ')');
    }
  }
  const week = w.slice(0, 7);
  eq(week.filter(d => d.mins === 0).length, 1, 'rules: exactly one takeout in the first seven');
  ok(week.filter(d => d.mins <= 5).length >= 2, 'rules: at least two nights at five minutes or less');
  ok(w.every(d => Number.isInteger(d.mins) && d.mins >= 0 && d.mins <= 120), 'rules: every mins is a whole number 0 to 120');
  ok(w.every(d => typeof d.how === 'string'), 'rules: every night has a how');
  eq(w.filter(d => C.isFriday(d.date)).map(d => d.t), ['Order in'], 'rules: the takeout lands on the Friday');
}

/* ---- the real Sep 5 shape: stale past days must not fill the cap ---- */
{
  const stale = [];
  for (let i = 20; i >= 1; i--) stale.push({ date: C.shift(NOW, -i), t: 'Ramen', mins: 10, how: 'Boil.' });
  stale.push({ date: '2026-09-05', t: 'Steak tips', mins: 20, how: 'Grill.' });
  stale.push({ date: '2026-09-06', t: 'Soft tacos', mins: 20, how: 'Brown the beef.' });
  const r = C.topUp(state(stale), NOW);
  eq(live(r.state).length, 10, 'stale: the live window still reaches ten');
  eq(r.state.dinners.length, 30, 'stale: stored history is kept, not pruned');
  eq(O.validate(r.state), [], 'stale: the result validates');
}

/* ---- an already-full window is left completely alone ---- */
{
  const full = [];
  for (let i = 0; i < 10; i++) full.push({ date: C.shift(NOW, i), t: 'Dish ' + i, mins: 10, how: 'x' });
  const r = C.topUp(state(full), NOW);
  eq(r.added.length, 0, 'full: nothing added');
  eq(r.state.dinners, full, 'full: nothing changed');
}

/* ---- a dish unseen for longer comes up before a recent one ---- */
{
  const hist = [
    { date: '2026-09-01', t: 'Bolognese', mins: 20, how: 'x' },
    { date: '2026-08-20', t: 'Ramen', mins: 10, how: 'x' }
  ];
  ok(C.lastUsed(hist, 'Ramen') < C.lastUsed(hist, 'Bolognese'), 'rotation: lastUsed orders by date');
  ok(C.echoes('Steak tips, rice, broccoli', 'Steak tips'), 'rotation: a longer title still counts as the same dish');
  ok(!C.echoes('Soft tacos', 'Steak tips'), 'rotation: different dishes do not collide');
}

/* ---- guessed nights are flagged, chosen nights are not ---- */
{
  const theirs = { date: '2026-09-06', t: 'Soft tacos', mins: 20, how: 'Brown the beef.' };
  const r = C.topUp(state([Object.assign({}, theirs)]), NOW);
  const got = live(r.state);
  eq(got.find(d => d.date === '2026-09-06').auto, undefined, 'flag: a night they set carries no auto flag');
  ok(got.filter(d => d.date !== '2026-09-06').every(d => d.auto === true), 'flag: every guessed night is marked auto');
  eq(O.validate(r.state), [], 'flag: the flag does not break validation');

  // Editing a guessed night through the API makes it theirs.
  const edited = O.apply(r.state, { t: 'setDinner', date: '2026-09-08', dish: 'Hot dogs', mins: 10, how: 'Grill.' },
                         { now: NOW, who: 'carter' });
  ok(!edited.error, 'flag: a guessed night can be edited');
  eq(edited.state.dinners.find(d => d.date === '2026-09-08').auto, undefined,
     'flag: editing clears auto, so it is theirs now');
  // And the next cron run leaves it alone.
  const again = C.topUp(edited.state, NOW);
  eq(again.added.length, 0, 'flag: the next run adds nothing');
  eq(again.state.dinners.find(d => d.date === '2026-09-08').t, 'Hot dogs', 'flag: their edit survives the next run');
}

console.log('\n' + (fail ? fail + ' FAILED, ' : 'All ') + pass + ' cron tests pass.');
process.exit(fail ? 1 : 0);
