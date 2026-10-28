#!/usr/bin/env node
// Put the starting list into KV. Run once, after the first deploy:
//   node seed.js > seed.json
//   npx wrangler kv key put --binding=LIST state --path=seed.json --remote
'use strict';
const O = require('./src/ops.js');

const today = O.today();
const day = n => new Date(Date.parse(today + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

const CATALOG = [
  ["Bananas","Produce","",1],["Strawberries","Produce","",1],["Limes","Produce","",1],
  ["Avocados","Produce","",1],["Yellow onions","Produce","",1],["Garlic","Produce","",1],
  ["Lemons","Produce","",0],["Greens","Produce","",0],["Parsley","Produce","",0],
  ["Ground beef","Meat & Fish","",1],["Steak tips","Meat & Fish","B",1],["Hot dogs","Meat & Fish","",1],
  ["Bacon","Meat & Fish","",0],["Shrimp","Meat & Fish","",0],["Charcuterie","Meat & Fish","A",0],
  ["Milk","Dairy & Eggs","",1],["Eggs","Dairy & Eggs","",1],["Plain yogurt","Dairy & Eggs","",1],
  ["Sour cream","Dairy & Eggs","",1],["Shredded mozzarella","Dairy & Eggs","",1],
  ["Shredded Mexican blend cheese","Dairy & Eggs","",1],["Lasagna, refrigerated","Dairy & Eggs","A",1],
  ["American cheese slices","Dairy & Eggs","",0],["Butter (Earth Balance)","Dairy & Eggs","",0],
  ["Parmesan","Dairy & Eggs","",0],["Spinach tortellini","Dairy & Eggs","A",0],
  ["Bread","Bakery","",1],["Hot dog buns","Bakery","",1],["Soft taco tortillas","Bakery","",1],
  ["Sandwich rolls","Bakery","",0],
  ["Cinnamon Toast Crunch","Pantry","",1],["Honey Nut Cheerios","Pantry","",1],["Rice Krispies","Pantry","",1],
  ["Granola","Pantry","",1],["Jasmine rice","Pantry","",1],["Rigatoni","Pantry","",1],
  ["Roasted garlic marinara","Pantry","",1],["Salsa","Pantry","",1],["Black beans","Pantry","",1],
  ["Taco seasoning","Pantry","",1],["Teriyaki sauce","Pantry","A",1],
  ["Wheaties","Pantry","",0],["Pesto","Pantry","",0],["Olive oil","Pantry","",0],["Ramen packs","Pantry","",0],
  ["Mac N Cheese","Pantry","",0],["Spaghetti-Os","Pantry","",0],["Peanut butter","Pantry","",0],
  ["Peanut butter sauce","Pantry","",0],["Ritz crackers","Pantry","",0],
  ["Frozen broccoli","Frozen","",1],["Frozen pizzas","Frozen","",1],["Chicken nuggets","Frozen","",1],
  ["Breaded chicken cutlets","Frozen","A",1],["Frozen lunches","Frozen","A",1],
  ["Meatballs","Frozen","",0],["Spicy chicken patties","Frozen","",0],["Chocolate ice cream","Frozen","",0],
  ["Seltzer, plain","Drinks","",1],["Pinot noir","Drinks","",0],["Malbec","Drinks","",0],["Orange wine","Drinks","",0],
  ["Trash bags, purple","Household","",0]
];

const WHY = {
  "Ground beef":"Tacos and bolognese, 2 lb", "Steak tips":"Grill night",
  "Frozen broccoli":"3 bags, the side for most nights", "Roasted garlic marinara":"Bolognese and chicken parm",
  "Breaded chicken cutlets":"Chicken parm", "Teriyaki sauce":"Beef and broccoli bowls",
  "Frozen lunches":"Carter, 5 for the week", "Hot dogs":"Labor Day", "Hot dog buns":"Labor Day"
};

const PLAN = [
  ["Chicken nuggets",5,"Nuggets and frozen broccoli. The night nobody has anything left."],
  ["Frozen pizzas",5,"Oven 15 minutes, broccoli, done."],
  ["Order in",0,"The takeout night."],
  ["Hot dogs",10,"On the grill, with whatever side is open."],
  ["Bolognese over rigatoni",30,"Brown 2 lb beef, add roasted garlic marinara, simmer while the rigatoni cooks."],
  ["Beef and broccoli bowls",20,"Ground beef and frozen broccoli in a skillet with teriyaki sauce. Over rice."],
  ["Lasagna",5,"The refrigerated one from the grocery store. 40 minutes in the oven, broccoli, done."],
  ["Order in",0,"The takeout night."],
  ["Steak tips, rice, broccoli",20,"Marinate the night before. Grill hot and fast, about 8 minutes."],
  ["Soft tacos",20,"Brown the beef with taco seasoning. Toppings in bowls, everyone builds their own."]
];

const state = {
  built: today,
  aisles: O.AISLES,
  items: O.sortItems(CATALOG.map(([n, a, s, need]) => ({
    n, a, s, need: !!need, why: need && WHY[n] ? WHY[n] : "",
    since: need ? today : "", by: need ? "carter" : undefined
  }))),
  dinners: PLAN.map(([t, mins, how], i) => ({ date: day(i), t, mins, how }))
};

const problems = O.validate(state);
if (problems.length) { console.error('seed is not valid:\n  - ' + problems.join('\n  - ')); process.exit(1); }
process.stdout.write(JSON.stringify({ rev: 1, data: state }, null, 2) + '\n');
