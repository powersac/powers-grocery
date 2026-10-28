// The list logic, shared by the Worker and the tests. Pure: (state, op) -> state.
// Kept out of the Worker file so it can be tested without a Cloudflare runtime.
'use strict';

const AISLES = ["Produce","Meat & Fish","Dairy & Eggs","Bakery","Pantry","Frozen","Drinks","Household"];
const WINDOW_MIN = 7, WINDOW_MAX = 10;

// First match wins, so the order matters: phrases and the more specific
// aisles go first ("ice cream" before "cream", "lemonade" before "lemon").
// Words match whole, with an optional plural, so "lemon" no longer catches
// "lemonade" and "egg" no longer catches "eggplant".
const words = list => new RegExp("\\b(" + list.join("|") + ")(s|es)?\\b", "i");
const GUESS = [
  [words(["frozen", "pizza", "nugget", "ice cream", "waffle", "fries", "broccoli", "popsicle"]), "Frozen"],
  [words(["peanut butter", "almond butter", "apple ?sauce", "hot sauce", "soy sauce"]), "Pantry"],
  [words(["seltzer", "juice", "soda", "wine", "beer", "coffee", "water", "tea", "milk tea", "iced tea",
          "lemonade", "limeade", "kombucha", "ginger ale", "cider", "gatorade", "sparkling"]), "Drinks"],
  [words(["milk", "buttermilk", "yogurt", "cheese", "butter", "cream", "egg", "sour cream"]), "Dairy & Eggs"],
  [words(["beef", "chicken", "steak", "pork", "bacon", "sausage", "fish", "shrimp", "turkey", "hot dog",
          "meatball", "pepperoni", "salami", "ham", "salmon"]), "Meat & Fish"],
  [words(["towel", "soap", "detergent", "sponge", "trash", "foil", "ziploc", "toilet", "napkin", "wipe"]), "Household"],
  [words(["bread", "bun", "roll", "bagel", "tortilla", "muffin", "lasagna", "sourdough"]), "Bakery"],
  [words(["apple", "banana", "\\w*berr(y|ies)", "lettuce", "onion", "garlic", "lemon", "lime", "avocado",
          "carrot", "pepper", "greens", "potato", "parsley", "orange", "grape", "tomato", "cucumber",
          "eggplant", "spinach", "celery", "cilantro", "basil", "ginger", "mushroom", "zucchini", "kale",
          "pear", "peach", "plum", "melon", "watermelon", "squash", "clementine", "cherry", "cherries"]), "Produce"]
];

function norm(s) {
  return String(s || "").toLowerCase().replace(/['’]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}
function sameName(a, b) { return norm(a) === norm(b) && norm(a) !== ""; }
function guessAisle(name) {
  for (const [re, a] of GUESS) if (re.test(name)) return a;
  return "Pantry";
}
function today(now) {
  const d = now ? new Date(now) : new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10);
}
function sortItems(items) {
  return items.slice().sort((a, b) => {
    const x = AISLES.indexOf(a.a), y = AISLES.indexOf(b.a);
    if (x !== y) return (x < 0 ? 99 : x) - (y < 0 ? 99 : y);
    return a.n.localeCompare(b.n);
  });
}
function find(items, name) { return items.find(i => sameName(i.n, name)); }

// Every mutation the page can ask for. Anything not listed is rejected, so a
// stray request can never reshape the state into something the page cannot render.
function apply(state, op, ctx) {
  const now = (ctx && ctx.now) || today();
  const who = (ctx && ctx.who) || "someone";
  const s = JSON.parse(JSON.stringify(state));

  switch (op.t) {
    case "toggle": {
      const it = find(s.items, op.n);
      if (!it) return { error: "no such item: " + op.n };
      if (it.need) { it.need = false; it.since = ""; it.why = ""; }
      else { it.need = true; it.since = now; it.by = who; }
      break;
    }
    case "add": {
      const name = String(op.n || "").trim();
      if (!name) return { error: "an item needs a name" };
      if (name.length > 80) return { error: "that name is too long" };
      const known = find(s.items, name);
      if (known) {
        if (!known.need) { known.need = true; known.since = now; known.by = who; }
        break;
      }
      const aisle = AISLES.includes(op.a) ? op.a : guessAisle(name);
      const store = (op.s === "A" || op.s === "B") ? op.s : "";
      s.items.push({ n: name, a: aisle, s: store, need: true, why: "", since: now, by: who });
      s.items = sortItems(s.items);
      break;
    }
    case "remove": {
      const i = s.items.findIndex(x => sameName(x.n, op.n));
      if (i < 0) return { error: "no such item: " + op.n };
      if (s.items[i].need) return { error: s.items[i].n + " is on the list. Take it off first." };
      s.items.splice(i, 1);
      break;
    }
    case "move": {                  // fix a misfiled item; it stays put from then on
      const it = find(s.items, op.n);
      if (!it) return { error: "no such item: " + op.n };
      if (!AISLES.includes(op.a)) return { error: "no such aisle: " + String(op.a) };
      it.a = op.a;
      s.items = sortItems(s.items);
      break;
    }
    case "clearBought": {           // everything ticked off in one go
      s.items.forEach(i => { if (i.need === false) { i.since = ""; i.why = ""; } });
      break;
    }
    case "setDinner": {
      const date = String(op.date || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "a dinner needs a YYYY-MM-DD date" };
      const t = String(op.dish || "").trim();
      if (!t) return { error: "a dinner needs a name" };
      // Number("20") is 20, which would quietly accept a string from a
      // hand-rolled request. The type has to be right, not just coercible.
      const mins = op.mins;
      if (typeof mins !== "number" || !Number.isInteger(mins) || mins < 0 || mins > 120)
        return { error: "prep time must be 0 to 120 whole minutes" };
      const how = String(op.how || "");
      const d = s.dinners.find(x => x.date === date);
      // Editing a night makes it theirs, whoever set it first. The auto flag
      // marks a night the scheduled top-up guessed, and only those may be
      // improved later without asking.
      if (d) { d.t = t; d.mins = mins; d.how = how; delete d.auto; break; }
      // No entry for that day yet, so append it. The absence of this branch is
      // why rollWindow could only ever shrink the plan, never extend it.
      if (date < now) return { error: "cannot plan " + date + ", it is already past" };
      // Count only days from today on. Stale past days are still in the stored
      // array and must not be allowed to fill the cap.
      const live = s.dinners.filter(x => x.date >= now).length;
      if (live >= WINDOW_MAX) return { error: "the plan is already " + WINDOW_MAX + " days long" };
      s.dinners.push({ date: date, t: t, mins: mins, how: how });
      s.dinners.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
      break;
    }
    case "swapDinner": {
      const a = s.dinners.find(x => x.date === op.a);
      const b = s.dinners.find(x => x.date === op.b);
      if (!a || !b) return { error: "cannot swap those days" };
      const t = a.t, m = a.mins, h = a.how;
      a.t = b.t; a.mins = b.mins; a.how = b.how;
      b.t = t; b.mins = m; b.how = h;
      break;
    }
    default:
      return { error: "unknown change: " + String(op && op.t) };
  }
  return { state: s };
}

// Drop days that have passed, so the window always starts today.
function rollWindow(state, now) {
  const t = now || today();
  const s = JSON.parse(JSON.stringify(state));
  s.dinners = s.dinners.filter(d => d.date >= t);
  return s;
}

function validate(d) {
  const p = [];
  if (!d || typeof d !== "object") return ["state is not an object"];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.built || "")) p.push("built must be YYYY-MM-DD");
  if (!Array.isArray(d.aisles) || !d.aisles.length) p.push("aisles is empty");
  if (!Array.isArray(d.items)) p.push("items must be an array");
  else {
    const seen = new Set();
    d.items.forEach((it, i) => {
      const at = "items[" + i + "]";
      if (!it || typeof it !== "object") { p.push(at + " is not an object"); return; }
      if (typeof it.n !== "string" || !it.n.trim()) p.push(at + " has no name");
      else {
        const k = norm(it.n);
        if (seen.has(k)) p.push("duplicate item: " + it.n);
        seen.add(k);
      }
      if (typeof it.need !== "boolean") p.push(at + " (" + it.n + ") need must be a boolean");
      if (it.need && !/^\d{4}-\d{2}-\d{2}$/.test(it.since || "")) p.push(at + " (" + it.n + ") is on the list and needs a since date");
      if (!it.need && it.since) p.push(at + " (" + it.n + ") is off the list so it must have no since");
    });
  }
  if (!Array.isArray(d.dinners)) p.push("dinners must be an array");
  else d.dinners.forEach((x, i) => {
    if (!x || !/^\d{4}-\d{2}-\d{2}$/.test(x.date || "")) p.push("dinners[" + i + "] needs a real date");
    if (typeof x.t !== "string" || !x.t.trim()) p.push("dinners[" + i + "] has no meal");
    if (!Number.isInteger(x.mins) || x.mins < 0 || x.mins > 120) p.push("dinners[" + i + "] mins must be 0 to 120 whole minutes");
    if (typeof x.how !== "string") p.push("dinners[" + i + "] how must be a string");
  });
  return p;
}

module.exports = { AISLES, WINDOW_MIN, WINDOW_MAX, norm, sameName, guessAisle, today, sortItems, find, apply, rollWindow, validate };
