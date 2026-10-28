(function () {
  "use strict";

  var TOKEN = location.pathname.replace(/^\//, "");
  var POLL_MS = 15000;
  var AISLES = ["Produce","Meat & Fish","Dairy & Eggs","Bakery","Pantry","Frozen","Drinks","Household"];
  var MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  var DOWS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  var MEALS = [
    ["Soft tacos",20,"Brown the beef with taco seasoning. Toppings in bowls, everyone builds their own."],
    ["Bolognese over rigatoni",30,"Brown 2 lb beef, add roasted garlic marinara, simmer while the rigatoni cooks."],
    ["Steak tips, rice, broccoli",20,"Marinate the night before. Grill hot and fast, about 8 minutes."],
    ["Meatballs over pasta",15,"Frozen meatballs into marinara on the stove, 20 minutes. Rigatoni alongside."],
    ["Lasagna",5,"The refrigerated one from the grocery store. 40 minutes in the oven, broccoli, done."],
    ["Chicken nuggets",5,"Nuggets and frozen broccoli. The night nobody has anything left."],
    ["Ramen",10,"Ramen with whatever is in the fridge on top."],
    ["Frozen pizzas",5,"Oven 15 minutes, broccoli, done."],
    ["Order in",0,"The takeout night."],
    ["Hot dogs",10,"On the grill, with whatever side is open."],
    ["Leftovers",5,"Whatever is in the fridge from earlier in the week."],
    ["Chicken parm bake",10,"Frozen breaded cutlets in a dish, marinara over the top, mozzarella. 25 minutes in the oven."],
    ["Beef and broccoli bowls",20,"Ground beef and frozen broccoli in a skillet with teriyaki sauce. Over rice."],
    ["Meatball subs",15,"Frozen meatballs in marinara, into rolls with mozzarella, under the broiler."],
    ["Quesadillas",15,"Same ingredients as taco night, folded and griddled."],
    ["Baked ziti",15,"Rigatoni, marinara, mozzarella, one dish, 25 minutes in the oven."]
  ];

  var $ = function (i) { return document.getElementById(i); };
  function el(t, c, x) { var n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; }

  var state = null, rev = null, role = null;
  var filter = "buy";
  var busy = {};          // item name -> true while its change is in flight
  var pollTimer = null, offline = false;

  /* ---------- talking to the server ---------- */

  function api(path, opts) {
    var o = opts || {};
    o.headers = o.headers || {};
    o.headers["x-list-token"] = TOKEN;
    o.cache = "no-store";
    return fetch(path, o).then(function (r) {
      return r.text().then(function (t) {
        var body = null;
        try { body = JSON.parse(t); } catch (e) {}
        if (!r.ok) throw { status: r.status, body: body };
        return body;
      });
    });
  }

  function banner(msg, good) {
    var b = $("banner");
    if (!msg) { b.hidden = true; b.textContent = ""; return; }
    b.textContent = msg;
    b.className = "banner" + (good ? " ok" : "");
    b.hidden = false;
  }

  function adopt(payload) {
    state = payload.data;
    rev = payload.rev;
    role = payload.role;
    offline = false;
    banner(null);
    render();
  }

  function load() {
    return api("/api/state").then(adopt, function (e) {
      if (e && e.status === 401) {
        $("rows").innerHTML = '<div class="empty"><b>This link does not work.</b>' +
          'It may have been cut short when it was copied. Ask Carter for it again.</div>';
        $("when").textContent = "";
        stopPolling();
        return;
      }
      offline = true;
      banner("Cannot reach the list. Showing what was last loaded.");
    });
  }

  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
  function startPolling() {
    stopPolling();
    pollTimer = setInterval(function () {
      if (document.hidden || Object.keys(busy).length) return;
      api("/api/state").then(function (p) {
        if (p.rev !== rev) adopt(p);
        else { offline = false; banner(null); }
      }, function () { offline = true; banner("Cannot reach the list. Showing what was last loaded."); });
    }, POLL_MS);
  }
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && !Object.keys(busy).length) load();
  });

  // One change at a time, applied to the screen straight away and confirmed after.
  function send(ops, keys) {
    (keys || []).forEach(function (k) { busy[k] = true; });
    render();
    return api("/api/mutate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rev: rev, ops: ops })
    }).then(function (p) {
      (keys || []).forEach(function (k) { delete busy[k]; });
      adopt(p);
    }, function (e) {
      (keys || []).forEach(function (k) { delete busy[k]; });
      if (e && e.status === 409 && e.body && e.body.data) {
        // Someone else got there first. Take their version and reapply.
        adopt({ data: e.body.data, rev: e.body.rev, role: role });
        return api("/api/mutate", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ rev: rev, ops: ops })
        }).then(adopt, showErr);
      }
      showErr(e);
    });
  }
  function showErr(e) {
    render();
    var msg = (e && e.body && e.body.error) || "";
    if (e && e.status === 403) banner("That change is not yours to make.");
    else if (msg && !/^(stale|bad_json|no_ops)$/.test(msg)) banner(msg);
    else banner("That did not save. Try again.");
    setTimeout(function () { banner(null); }, 4000);
  }

  /* ---------- dates ---------- */

  function dnum(iso) {
    var p = String(iso || "").split("-").map(Number);
    if (p.length !== 3 || !p[0] || !p[1] || !p[2]) return null;
    return Date.UTC(p[0], p[1] - 1, p[2]);
  }
  function todayNum() { var n = new Date(); return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()); }
  function dayLabel(iso) {
    var d = dnum(iso); if (d === null) return "";
    var k = Math.round((d - todayNum()) / 86400000);
    if (k === 0) return "Today";
    if (k === 1) return "Tmrw";
    return DOWS[new Date(d).getUTCDay()];
  }
  function timeLabel(m) { return (typeof m !== "number") ? "" : (m === 0 ? "no cooking" : m + " min"); }

  function norm(s) {
    return String(s || "").toLowerCase().replace(/['’]/g, "")
      .replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  }
  function hits(q, name, aisle) {
    var hay = norm(name) + " " + norm(aisle);
    return norm(q).split(" ").every(function (w) { return !w || hay.indexOf(w) !== -1; });
  }

  /* ---------- rendering ---------- */

  function render() {
    if (!state) return;
    var need = state.items.filter(function (i) { return i.need; }).length;
    $("tally").textContent = String(need);
    $("acts").hidden = false;
    $("dinners").hidden = false;
    $("footnote").textContent = role === "carter"
      ? "You can change dinners and remove things from the catalog. Partner sees every change."
      : "Everything you tick or add shows up on Carter's list too.";

    var b = dnum(state.built);
    if (b !== null) {
      var days = Math.round((todayNum() - b) / 86400000);
      var w = $("when");
      w.className = "when";
      w.textContent = days <= 0 ? "Up to date" : days === 1 ? "Planned yesterday" : "Planned " + days + " days ago";
      if (days > 3) { w.className = "when stale"; w.textContent = "Last planned " + days + " days ago."; }
    }

    var q = filter === "all" ? String($("q").value || "").trim() : "";
    var groups = {}, shown = 0;
    state.items.forEach(function (it) {
      if (filter === "buy" && !it.need) return;
      if (q && !hits(q, it.n, it.a)) return;
      (groups[it.a] = groups[it.a] || []).push(it);
      shown++;
    });

    if (!shown) {
      var d = el("div", "empty");
      d.appendChild(el("b", null, filter === "buy" ? "All done." : "Nothing matches."));
      d.appendChild(document.createTextNode(filter === "buy"
        ? "Nothing left to buy. Add something above, or tap Everything."
        : "Try a shorter word."));
      $("rows").replaceChildren(d);
    } else {
      var frag = document.createDocumentFragment();
      var order = AISLES.concat(Object.keys(groups).filter(function (a) { return AISLES.indexOf(a) < 0; }));
      order.forEach(function (a) {
        if (!groups[a]) return;
        var box = el("div", "aisle");
        box.appendChild(el("h2", null, a));
        var ul = el("ul");
        groups[a].forEach(function (it) { ul.appendChild(rowFor(it)); });
        box.appendChild(ul);
        frag.appendChild(box);
      });
      $("rows").replaceChildren(frag);
    }
    renderDinners();
  }

  function rowFor(it) {
    var li = document.createElement("li");
    var pending = !!busy[it.n];
    var btn = el("button", "row" + (pending ? " pending" : ""));
    btn.type = "button";
    btn.disabled = pending;
    btn.setAttribute("aria-pressed", it.need ? "true" : "false");
    btn.setAttribute("aria-label", (it.need ? "Cross off " : "Put back ") + it.n);
    var bx = el("div", "box", "✓"); bx.setAttribute("aria-hidden", "true");
    btn.appendChild(bx);
    var nm = el("div", "nm");
    var t = el("span", "t", it.n);
    if (it.need && it.by && it.by !== role) t.appendChild(el("span", "who", it.by === "carter" ? "Carter" : "Partner"));
    nm.appendChild(t);
    if (it.why && it.need) nm.appendChild(el("span", "w", it.why));
    btn.appendChild(nm);
    if (pending) btn.appendChild(el("span", "spin"));
    if (it.s) btn.appendChild(el("span", "store", "Store " + it.s));
    btn.addEventListener("click", function () { send([{ t: "toggle", n: it.n }], [it.n]); });
    li.appendChild(btn);

    // In Everything, anyone can move a misfiled item. A native select gives the
    // phone's own picker. The first option is just the button face.
    if (filter === "all") {
      var mv = document.createElement("select");
      mv.className = "mv";
      mv.disabled = pending;
      mv.setAttribute("aria-label", "Move " + it.n + " to another aisle");
      var face = el("option", null, "\u21C4"); face.value = ""; face.selected = true; face.disabled = true;
      mv.appendChild(face);
      AISLES.forEach(function (a) {
        if (a === it.a) return;
        var o = el("option", null, a); o.value = a; mv.appendChild(o);
      });
      mv.addEventListener("change", function () {
        if (mv.value) send([{ t: "move", n: it.n, a: mv.value }], [it.n]);
      });
      li.appendChild(mv);
    }

    if (role === "carter" && filter === "all" && !it.need) {
      var k = el("button", "kill", "×");
      k.type = "button";
      k.setAttribute("aria-label", "Remove " + it.n + " from the catalog for good");
      k.addEventListener("click", function () { send([{ t: "remove", n: it.n }], [it.n]); });
      li.appendChild(k);
    }
    return li;
  }

  function renderDinners() {
    var dl = $("dl");
    dl.replaceChildren();
    var live = state.dinners || [];
    if (!live.length) {
      var d = el("div", "empty");
      d.appendChild(el("b", null, "No dinners planned."));
      d.appendChild(document.createTextNode("The daily plan fills this in."));
      dl.appendChild(d);
      return;
    }
    live.forEach(function (dn, i) {
      var li = document.createElement("li");
      var lbl = dayLabel(dn.date);
      if (lbl === "Today") li.className = "istoday";
      li.appendChild(el("b", null, lbl));
      var body = el("div", "dbody");
      var top = el("div", "dtop");
      top.appendChild(el("span", "dt", dn.t));
      top.appendChild(el("span", "dmin", timeLabel(dn.mins)));
      body.appendChild(top);
      if (dn.how) body.appendChild(el("span", "dhow", dn.how));
      li.appendChild(body);

      if (role === "carter") {
        var ed = el("div", "dedit");
        var ch = el("button", null, "✎"); ch.type = "button";
        ch.setAttribute("aria-label", "Change " + lbl + " from " + dn.t);
        ch.addEventListener("click", function () { openPicker(dn); });
        var dw = el("button", null, "↓"); dw.type = "button";
        dw.setAttribute("aria-label", "Swap " + dn.t + " with the next day");
        dw.disabled = i === live.length - 1;
        dw.addEventListener("click", function () {
          send([{ t: "swapDinner", a: dn.date, b: live[i + 1].date }], ["dinner"]);
        });
        ed.appendChild(ch); ed.appendChild(dw);
        li.appendChild(ed);
      }
      dl.appendChild(li);
    });
  }

  /* ---------- the dinner picker ---------- */

  var picker = $("picker"), target = null;
  function openPicker(dn) {
    target = dn;
    $("picker-title").textContent = dayLabel(dn.date) + ": " + dn.t;
    var ul = $("picker-opts"); ul.replaceChildren();
    MEALS.forEach(function (m) {
      var li = document.createElement("li");
      var b = el("button", m[0] === dn.t ? "on" : null); b.type = "button";
      b.appendChild(document.createTextNode(m[0]));
      b.appendChild(el("small", null, timeLabel(m[1]) + (m[2] ? " · " + m[2] : "")));
      b.addEventListener("click", function () {
        closePicker();
        send([{ t: "setDinner", date: dn.date, dish: m[0], mins: m[1], how: m[2] }], ["dinner"]);
      });
      li.appendChild(b); ul.appendChild(li);
    });
    $("picker-custom").value = "";
    $("picker-mins").value = "20";
    if (typeof picker.showModal === "function") picker.showModal(); else picker.setAttribute("open", "");
  }
  function closePicker() {
    target = null;
    if (typeof picker.close === "function") picker.close(); else picker.removeAttribute("open");
  }
  $("picker-save").addEventListener("click", function () {
    if (!target) return;
    var v = $("picker-custom").value.trim();
    if (!v) { $("picker-custom").focus(); return; }
    var mins = parseInt($("picker-mins").value, 10);
    if (!(mins >= 0 && mins <= 120)) mins = 20;
    var dn = target;
    closePicker();
    send([{ t: "setDinner", date: dn.date, dish: v, mins: mins, how: "" }], ["dinner"]);
  });
  $("picker-close").addEventListener("click", closePicker);

  /* ---------- controls ---------- */

  function setFilter(f) {
    filter = f;
    $("f-buy").setAttribute("aria-pressed", f === "buy" ? "true" : "false");
    $("f-all").setAttribute("aria-pressed", f === "all" ? "true" : "false");
    $("searchwrap").hidden = f !== "all";
    if (f !== "all") $("q").value = "";
    render();
  }
  $("f-buy").addEventListener("click", function () { setFilter("buy"); });
  $("f-all").addEventListener("click", function () { setFilter("all"); });
  $("q").addEventListener("input", render);
  $("refresh").addEventListener("click", function () { load(); });

  $("addform").addEventListener("submit", function (e) {
    e.preventDefault();
    var box = $("add-name");
    var name = box.value.trim();
    if (!name) { box.focus(); return; }
    box.value = "";
    send([{ t: "add", n: name }], [name]);
  });

  load().then(startPolling);
})();
