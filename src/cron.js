// Keeping the dinner window full with nobody in the loop: no laptop, no browser,
// no model, no token. The Worker calls this on a schedule against its own KV.
// Pure: (state, now) -> { state, added }. test-cron.js is the other caller.
'use strict';
const O = require('./ops.js');

// Their dishes, copied from the live plan on Sep 5 2026, wording included.
// Nothing here is invented. Adding a dish means copying one they already cook.
const ROTATION = [
  { t: "Frozen pizzas",           mins: 5,  how: "Oven, two pizzas." },
  { t: "Bolognese",               mins: 20, how: "Brown the beef into a jar of roasted garlic marinara, over rigatoni." },
  { t: "Chicken nuggets",         mins: 5,  how: "Oven, frozen broccoli alongside." },
  { t: "Soft tacos",              mins: 20, how: "Brown the beef with taco seasoning. Toppings in bowls, everyone builds their own." },
  { t: "Lasagna",                 mins: 5,  how: "Oven, the refrigerated store-bought one, frozen broccoli alongside." },
  { t: "Steak tips",              mins: 20, how: "Grill the tips, jasmine rice, frozen broccoli." },
  { t: "Ramen",                   mins: 10, how: "Boil, add frozen broccoli to the pot." },
  { t: "Beef and broccoli bowls", mins: 20, how: "Brown the beef, frozen broccoli, over jasmine rice." }
];
const TAKEOUT = { t: "Order in", mins: 0, how: "" };

const DAY = 86400000;
function shift(date, n) {
  return new Date(Date.parse(date + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
}
function isFriday(date) { return new Date(date + "T00:00:00Z").getUTCDay() === 5; }

// "Steak tips" and "Steak tips, rice, broccoli" are the same dinner two nights
// running. Exact title matching would miss that, so compare loosely.
function echoes(a, b) {
  const x = O.norm(a), y = O.norm(b);
  return x === y || x.indexOf(y) === 0 || y.indexOf(x) === 0;
}
function between(dinners, date, back) {
  const from = shift(date, -back);
  return dinners.filter(d => d.date >= from && d.date < date);
}

// The last night this dish was cooked, "" if never. Drives the rotation, so a
// dish that has not been on in a fortnight comes up before one from last week.
function lastUsed(dinners, title) {
  let last = "";
  for (const d of dinners) if (echoes(d.t, title) && d.date > last) last = d.date;
  return last;
}

function pick(date, dinners) {
  const week = between(dinners, date, 7);
  // One takeout a week, on a Friday, which is where they already put it.
  if (isFriday(date) && !week.some(d => d.mins === 0)) return TAKEOUT;
  const recent = between(dinners, date, 5).map(d => d.t);
  const pool = ROTATION.filter(r => !recent.some(x => echoes(x, r.t)));
  // Longest-unseen first. Taking pool[0] instead biases hard toward whatever
  // sits at the top of ROTATION, which came out as pizza three times a week.
  const ranked = pool.slice().sort((a, b) => {
    const la = lastUsed(dinners, a.t), lb = lastUsed(dinners, b.t);
    if (la !== lb) return la < lb ? -1 : 1;
    return ROTATION.indexOf(a) - ROTATION.indexOf(b);
  });
  // At least two easy nights a week.
  if (week.filter(d => d.mins <= 5).length < 2) {
    const quick = ranked.find(r => r.mins <= 5);
    if (quick) return quick;
  }
  return ranked[0] || ROTATION[0];
}

// Fill every empty day from today through day nine. Never touches a day that
// already has a dinner, because those nights are theirs. This is a floor, not
// a planner: it stops the window emptying, it does not try to be clever.
function topUp(state, now) {
  const t = now || O.today();
  let s = state;
  const added = [];
  for (let i = 0; i < O.WINDOW_MAX; i++) {
    const date = shift(t, i);
    if (s.dinners.some(d => d.date === date)) continue;
    const dish = pick(date, s.dinners);
    const r = O.apply(s, { t: "setDinner", date: date, dish: dish.t, mins: dish.mins, how: dish.how },
                      { now: t, who: "cron" });
    if (r.error) break;   // cap reached or a refused day: leave the rest alone
    s = r.state;
    // Mark it as a guess. A night without this flag was chosen by a person and
    // must never be overwritten by anything downstream.
    s.dinners.find(d => d.date === date).auto = true;
    added.push({ date: date, t: dish.t, mins: dish.mins });
  }
  return { state: s, added: added };
}

module.exports = { ROTATION, TAKEOUT, topUp, pick, shift, isFriday, echoes, lastUsed };
