/* -------------------------------------------------------------------
   DUST INDEX — Burning Man 2026
   Everything runs off window.BM (see data.js). No network at runtime.
   ------------------------------------------------------------------- */

(function () {
  "use strict";

  var BM = window.BM;
  var EV = BM.events;
  var DAYS = BM.days;
  var EPOCH = Date.UTC(2026, 7, 29, 0, 0); // Aug 29 2026, playa midnight
  var STORE = "dustindex.v1";
  var ALL = "all";                          // day-rail sentinel: the whole week

  /* ---------- state ------------------------------------------------ */

  var S = {
    view: "now",
    day: 0,
    q: "",
    filters: { starred: false, sunrise: false, sunset: false, music: false, food: false, drink: false, adult: false,
               saji: false, sjmust: false, sjshould: false, sjgood: false },
    stars: new Set(),
    limit: 300,
    playaDays: true, // noon-to-noon nights (RSL style) vs plain calendar days
    sajiPlan: false, // when on, everything on Saji's list counts as starred
    offsetMin: 0 // manual clock nudge, in minutes
  };

  // Stars live in this browser's localStorage and nowhere else — nothing is
  // ever sent anywhere. Some browsers refuse storage for pages opened straight
  // off the filesystem, so probe it and say so rather than losing picks quietly.
  var storageOK = (function () {
    try {
      localStorage.setItem(STORE + ".probe", "1");
      var ok = localStorage.getItem(STORE + ".probe") === "1";
      localStorage.removeItem(STORE + ".probe");
      return ok;
    } catch (e) { return false; }
  })();

  function load() {
    if (!storageOK) return;
    try {
      var raw = JSON.parse(localStorage.getItem(STORE) || "{}");
      if (Array.isArray(raw.stars)) S.stars = new Set(raw.stars);
      if (typeof raw.offsetMin === "number") S.offsetMin = raw.offsetMin;
      if (typeof raw.playaDays === "boolean") S.playaDays = raw.playaDays;
      if (typeof raw.sajiPlan === "boolean") S.sajiPlan = raw.sajiPlan;
    } catch (e) { /* first run */ }
  }
  function save() {
    if (!storageOK) return;
    try {
      localStorage.setItem(STORE, JSON.stringify({
        stars: Array.from(S.stars), offsetMin: S.offsetMin, playaDays: S.playaDays,
        sajiPlan: S.sajiPlan
      }));
    } catch (e) { storageOK = false; }
  }

  /* ---------- time -------------------------------------------------- */

  // Absolute playa minutes since Aug 29 2026 00:00, from the device clock.
  function nowMin() {
    var d = new Date();
    var local = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes());
    return Math.round((local - EPOCH) / 60000) + S.offsetMin;
  }

  function clock(min) {
    var m = ((min % 1440) + 1440) % 1440;
    var h = Math.floor(m / 60), mm = m % 60;
    var ap = h < 12 ? "am" : "pm";
    var h12 = h % 12 || 12;
    return h12 + (mm ? ":" + String(mm).padStart(2, "0") : "") + ap;
  }

  function span(e) {
    if (e.e == null) return clock(e.b);
    return clock(e.b) + "–" + clock(e.e);
  }

  // Playa mode: noon-to-noon nights, so the morning after belongs to the
  // night before. Calendar mode: plain midnight-to-midnight dates.
  function playaDay(min) {
    if (!S.playaDays) return Math.floor(min / 1440);
    var d = Math.floor(min / 1440), h = min - d * 1440;
    return h < BM.cutoff ? d - 1 : d;
  }
  function eDay(e) {
    if (S.playaDays) return e.d;
    return e.cd !== undefined ? e.cd : e.d;
  }

  var PHASES = [
    [0,   300,  "deep night", "var(--phase-deep)"],
    [300, 480,  "sunrise",    "var(--phase-sunrise)"],
    [480, 720,  "morning",    "var(--phase-day)"],
    [720, 1020, "afternoon",  "var(--phase-day)"],
    [1020, 1230, "sunset",    "var(--phase-dusk)"],
    [1230, 1440, "night",     "var(--phase-night)"]
  ];
  function phase(min) {
    var m = ((min % 1440) + 1440) % 1440;
    for (var i = 0; i < PHASES.length; i++) {
      if (m >= PHASES[i][0] && m < PHASES[i][1]) return PHASES[i];
    }
    return PHASES[0];
  }

  // Both computed at build time: curated sources only, gated by the actual
  // sun clock — the official event book never gets these tags.
  function isSunrise(e) { return e.tg && e.tg.indexOf("sunrise") > -1; }
  function isSunset(e) { return e.tg && e.tg.indexOf("sunset") > -1; }

  function isEst(e) { return e.tg && e.tg.indexOf("est") > -1; }

  var SJ = { "sj-must": "🔥 MUST", "sj-should": "🚲 SHOULD", "sj-good": "🍃 GOOD" };
  function sajiTag(e) {
    if (!e.tg) return null;
    if (e.tg.indexOf("sj-must") > -1) return "sj-must";
    if (e.tg.indexOf("sj-should") > -1) return "sj-should";
    if (e.tg.indexOf("sj-good") > -1) return "sj-good";
    return null;
  }
  var SAJI_IDS = [];
  EV.forEach(function (e) { if (sajiTag(e)) SAJI_IDS.push(e.i); });

  // What counts as starred right now: your own stars, plus everything on
  // Saji's list while the "Saji's plan" toggle is on.
  function isStarred(e) {
    if (S.stars.has(e.i)) return true;
    return S.sajiPlan && sajiTag(e) !== null;
  }

  /* ---------- search index ------------------------------------------ */

  var HAY = EV.map(function (e) {
    return ((e.t || "") + " " + (e.c || "") + " " + (e.l || "") + " " + (e.n || "")).toLowerCase();
  });

  var MUSIC = { rsl: 1, lineup: 1, artist: 1, pick: 1, anchor: 1 };

  function matches(e, i) {
    var f = S.filters;
    if (f.starred && !isStarred(e)) return false;
    if (f.sunrise && !isSunrise(e)) return false;
    if (f.sunset && !isSunset(e)) return false;
    if (f.music && !MUSIC[e.src]) return false;
    if (f.food && (!e.tg || e.tg.indexOf("food") < 0)) return false;
    if (f.drink && (!e.tg || e.tg.indexOf("drink") < 0)) return false;
    if (f.adult && (!e.tg || e.tg.indexOf("adult") < 0)) return false;
    if (f.saji && !sajiTag(e)) return false;
    if (f.sjmust && sajiTag(e) !== "sj-must") return false;
    if (f.sjshould && sajiTag(e) !== "sj-should") return false;
    if (f.sjgood && sajiTag(e) !== "sj-good") return false;
    if (S.q) {
      var terms = S.q.toLowerCase().split(/\s+/).filter(Boolean);
      for (var k = 0; k < terms.length; k++) {
        if (HAY[i].indexOf(terms[k]) === -1) return false;
      }
    }
    return true;
  }

  function dayEvents(dayIdx) {
    var out = [];
    for (var i = 0; i < EV.length; i++) {
      if (eDay(EV[i]) !== dayIdx) continue;
      if (!matches(EV[i], i)) continue;
      out.push(EV[i]);
    }
    return out;
  }

  function allEvents() {
    var out = [];
    for (var i = 0; i < EV.length; i++) {
      if (matches(EV[i], i)) out.push(EV[i]);
    }
    return out;
  }

  /* ---------- conflicts --------------------------------------------- */

  var DEFAULT_LEN = 75; // minutes, when a set has no published end

  function starList() {
    var out = EV.filter(function (e) { return isStarred(e); });
    out.sort(function (a, b) { return a.b - b.b; });
    return out;
  }

  function conflictSet() {
    var list = starList(), bad = new Set();
    for (var i = 0; i < list.length; i++) {
      var ae = list[i].e == null ? list[i].b + DEFAULT_LEN : list[i].e;
      for (var j = i + 1; j < list.length; j++) {
        if (list[j].b >= ae) break;
        bad.add(list[i].i); bad.add(list[j].i);
      }
    }
    return bad;
  }

  /* ---------- dom helpers -------------------------------------------- */

  function el(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }
  function $(sel) { return document.querySelector(sel); }

  var SRC_LABEL = {
    pick: "master", anchor: "burn", artist: "artist post",
    lineup: "camp poster", rsl: "rsl guide", playa: "playa guide"
  };
  var PRIO_CLASS = { "MUST++": "must2", "MUST": "must", "HIGH": "high", "ALT": "alt", "OPT": "opt" };

  function eventNode(e, conflicts) {
    var starred = isStarred(e);
    var b = el("button", "ev");
    b.dataset.id = e.i;
    if (starred) b.classList.add("starred");
    if (conflicts && conflicts.has(e.i)) b.classList.add("conflict");

    var main = el("div");
    main.appendChild(el("div", "ttl", e.t));

    var meta = el("div", "meta");
    meta.appendChild(el("span", null, (isEst(e) ? "~" : "") + span(e)));
    if (e.c) {
      meta.appendChild(el("span", "at", "  ·  "));
      meta.appendChild(el("span", null, e.c));
    }
    if (e.l) {
      meta.appendChild(el("span", "at", "  ·  "));
      meta.appendChild(el("span", null, e.l));
    }
    main.appendChild(meta);

    if (e.n) main.appendChild(el("div", "note", e.n));

    var bad = el("div", "badges");
    if (isSunrise(e)) bad.appendChild(el("span", "b sun", "sunrise"));
    if (isSunset(e)) bad.appendChild(el("span", "b dusk", "sunset"));
    if (isEst(e)) bad.appendChild(el("span", "b est", "~ est time"));
    if (e.tg && e.tg.indexOf("mv") > -1) bad.appendChild(el("span", "b mv", "art car"));
    // One row per event; the tags say which sources reported it.
    [e.src].concat(e.also || []).forEach(function (s) {
      bad.appendChild(el("span", "b", SRC_LABEL[s] || s));
    });
    var sj = sajiTag(e);
    if (sj) bad.appendChild(el("span", "b saji", SJ[sj]));
    if (bad.children.length) main.appendChild(bad);

    b.appendChild(main);
    var st = el("span", "star", starred ? "★" : "☆");
    st.setAttribute("aria-hidden", "true");
    b.appendChild(st);
    b.setAttribute("aria-pressed", starred ? "true" : "false");
    b.setAttribute("aria-label", (starred ? "Starred. " : "") + e.t + ", " + span(e));
    return b;
  }

  function hourGroups(list) {
    var groups = [], cur = null;
    list.forEach(function (e) {
      var h = Math.floor(e.b / 60);
      if (!cur || cur.h !== h) { cur = { h: h, items: [] }; groups.push(cur); }
      cur.items.push(e);
    });
    return groups;
  }

  function renderList(container, list, conflicts, cap) {
    var shown = cap === false ? list : list.slice(0, S.limit);
    hourGroups(shown).forEach(function (g) {
      var min = g.h * 60;
      var ph = phase(min);
      var row = el("div", "hour");
      row.style.setProperty("--phase", ph[3]);
      var mark = el("div", "mark");
      mark.appendChild(el("span", "t", clock(min)));
      mark.appendChild(el("span", "ph", ph[2]));
      row.appendChild(mark);
      var ul = el("div", "list");
      g.items.forEach(function (e) { ul.appendChild(eventNode(e, conflicts)); });
      row.appendChild(ul);
      container.appendChild(row);
    });
    if (list.length > shown.length) {
      var more = el("button", "more",
        "Show " + Math.min(300, list.length - shown.length) + " more  ·  " +
        (list.length - shown.length) + " hidden");
      more.onclick = function () { S.limit += 300; render(); };
      container.appendChild(more);
    }
  }

  function emptyNode(title, hint) {
    var d = el("div", "empty");
    d.appendChild(el("b", null, title));
    d.appendChild(document.createTextNode(hint));
    return d;
  }

  /* ---------- views --------------------------------------------------- */

  function viewNow(root) {
    var t = nowMin();
    var pd = playaDay(t);

    var strip = el("div", "strip");
    strip.appendChild(el("h1", null,
      DAYS[pd] ? DAYS[pd].dow.toUpperCase() + " NIGHT" : "BEFORE THE BURN"));
    strip.appendChild(el("div", "sub",
      DAYS[pd] ? DAYS[pd].label + " · " + phase(t)[2] : "Gates open Sun Aug 30"));
    root.appendChild(strip);

    if (!storageOK) root.appendChild(storageWarning());

    // One chronological list from this minute forward: sets still running,
    // then what's next, in clock order. No reshuffling — starred rows sit in
    // their real slot, and the star filter on Schedule is where you narrow.
    var list = EV.filter(function (e) {
      var end = e.e == null ? e.b + DEFAULT_LEN : e.e;
      return end > t && e.b < t + 8 * 60 && (MUSIC[e.src] || isStarred(e) || sajiTag(e));
    }).sort(function (a, b) { return a.b - b.b; });

    root.appendChild(el("div", "sect", "From now · next 8 hours"));
    if (list.length) {
      var w = el("div"); renderList(w, list, conflictSet(), false); root.appendChild(w);
    } else {
      root.appendChild(emptyNode("Quiet stretch",
        "No sets in the next eight hours. Schedule has everything else — camp events, food, workshops."));
    }
  }

  function renderSimple(container, list) {
    var conflicts = conflictSet();
    var ul = el("div", "list");
    ul.style.padding = "6px 12px 10px";
    list.forEach(function (e) { ul.appendChild(eventNode(e, conflicts)); });
    container.appendChild(ul);
  }

  function storageWarning() {
    var w = el("div", "banner warn");
    w.appendChild(el("div", "lab", "Stars won't survive a reload"));
    w.appendChild(el("div", "msg",
      "This browser is refusing to save for a page opened from a file. Copy your " +
      "share code before you close the tab, or use the installed version instead."));
    return w;
  }

  function viewPlan(root) {
    var list = starList();

    var strip = el("div", "strip");
    strip.appendChild(el("h1", null, "YOUR RUN"));
    var nights = new Set(list.map(function (e) { return e.d; })).size;
    strip.appendChild(el("div", "sub",
      list.length ? list.length + " starred · " + nights + (nights === 1 ? " night" : " nights")
                  : "Nothing starred yet"));
    root.appendChild(strip);

    var actions = el("div", "actions");
    var share = el("button", "btn go", "Share / backup");
    share.onclick = openShare;
    actions.appendChild(share);
    if (SAJI_IDS.length) {
      var sj = el("button", "btn saji-toggle", (S.sajiPlan ? "✓ " : "") + "Saji" + String.fromCharCode(8217) + "s picks");
      sj.setAttribute("aria-pressed", S.sajiPlan ? "true" : "false");
      sj.title = "On: everything on Saji's list is starred for you. Off: pick your own.";
      sj.onclick = function () {
        S.sajiPlan = !S.sajiPlan;
        save(); render();
        toast(S.sajiPlan ? "Saji's picks on — " + SAJI_IDS.length + " starred"
                         : "Saji's picks off — your own stars only");
      };
      actions.appendChild(sj);
      var allIn = SAJI_IDS.every(function (i) { return S.stars.has(i); });
      var copy = el("button", "btn", allIn ? "Un-copy Saji" + String.fromCharCode(8217) + "s picks"
                                           : "Copy into my stars");
      copy.title = allIn
        ? "Remove everything on Saji's list from your own stars."
        : "One-time copy of Saji's list into your own stars, so you can edit from there.";
      copy.onclick = function () {
        var before = S.stars.size;
        if (allIn) {
          SAJI_IDS.forEach(function (i) { S.stars.delete(i); });
          save(); render();
          toast("Removed " + (before - S.stars.size) + " of Saji's picks from your stars");
        } else {
          SAJI_IDS.forEach(function (i) { S.stars.add(i); });
          save(); render();
          toast("Copied " + (S.stars.size - before) + " of Saji's picks into your stars");
        }
      };
      actions.appendChild(copy);
    }
    root.appendChild(actions);

    // Off-playa links — they need signal, so they live here rather than
    // anywhere the on-playa flow depends on.
    var links = el("div", "actions links");
    var cal = el("a", "btn link", "📅 Group calendar");
    cal.href = "https://calendar.google.com/calendar/u/0?cid=ZmFtaWx5MDI0MTk1ODA0MTIyNTc0ODc3OTdAZ3JvdXAuY2FsZW5kYXIuZ29vZ2xlLmNvbQ";
    cal.target = "_blank"; cal.rel = "noopener";
    links.appendChild(cal);
    var art = el("a", "btn link", "📝 Shared notes");
    art.href = "https://claude.ai/public/artifacts/23d3c37a-2af3-45b5-b034-1a29eef3c838";
    art.target = "_blank"; art.rel = "noopener";
    links.appendChild(art);
    root.appendChild(links);

    if (!storageOK) root.appendChild(storageWarning());
    if (!list.length) {
      root.appendChild(emptyNode("Nothing starred",
        "Tap the star on any event to build your run. Open Music or Everything to start."));
      return;
    }
    var conflicts = conflictSet();
    if (conflicts.size) {
      var warn = el("div", "banner");
      warn.appendChild(el("div", "lab", "Overlaps"));
      warn.appendChild(el("div", "msg",
        conflicts.size + " starred events collide. They are outlined below — pick one and drop the rest."));
      root.appendChild(warn);
    }
    renderGrouped(root, list, conflicts);
  }

  // Nights run one after another under sticky headers. Used whenever the list
  // spans more than one night: the All tab, and any search.
  function renderGrouped(root, list, conflicts) {
    var shown = list.slice(0, S.limit);
    DAYS.forEach(function (day, i) {
      var chunk = shown.filter(function (e) { return eDay(e) === i; });
      if (!chunk.length) return;
      var h = el("div", "nightbar");
      h.appendChild(el("span", "nb-dow", day.dow + (S.playaDays ? " night" : "")));
      h.appendChild(el("span", "nb-date", day.label));
      if (day.note) h.appendChild(el("span", "nb-note", day.note));
      h.appendChild(el("span", "nb-count", String(chunk.length)));
      root.appendChild(h);
      var wrap = el("div");
      renderList(wrap, chunk, conflicts, false);
      root.appendChild(wrap);
    });
    if (list.length > shown.length) {
      var more = el("button", "more",
        "Show more  ·  " + (list.length - shown.length) + " hidden");
      more.onclick = function () { S.limit += 300; render(); };
      root.appendChild(more);
    }
  }

  function viewDay(root) {
    // A search is a whole-week question — "where is Monolink playing?" — so a
    // query drops the day filter. So does picking All in the rail.
    var searching = S.q.trim().length > 0;
    var spanning = searching || S.day === ALL;
    var list = spanning ? allEvents() : dayEvents(S.day);

    var d = DAYS[S.day];
    var strip = el("div", "strip");
    strip.appendChild(el("h1", null,
      spanning ? "THE WHOLE WEEK"
               : d.dow.toUpperCase() + (S.playaDays ? " NIGHT" : " " + d.label.split(" ")[0].toUpperCase() + " " + d.label.split(" ")[1])));
    var sub = el("div", "sub");
    if (searching) {
      sub.appendChild(document.createTextNode(
        list.length + (list.length === 1 ? " match for “" : " matches for “") + S.q.trim() + "”"));
    } else if (spanning) {
      sub.appendChild(document.createTextNode(
        list.length + " events · Sat Aug 29 – Sun Sep 6"));
    } else {
      sub.appendChild(document.createTextNode(d.label + " · " + list.length + " events"));
      if (d.note) {
        sub.appendChild(document.createTextNode(" · "));
        sub.appendChild(el("b", null, d.note));
      }
    }
    strip.appendChild(sub);
    root.appendChild(strip);

    if (!list.length) {
      root.appendChild(emptyNode("Nothing here",
        searching ? "Nothing across the week matches “" + S.q.trim() + "”. Try a shorter word, " +
                    "or turn off the filters above."
                  : "No events with the filters you have on. Tap a filter again to clear it."));
      return;
    }

    var conflicts = conflictSet();
    if (spanning) {
      renderGrouped(root, list, conflicts);
    } else {
      var w = el("div");
      renderList(w, list, conflicts);
      root.appendChild(w);
    }
  }

  /* ---------- chrome -------------------------------------------------- */

  function renderRail() {
    var rail = $("#rail");
    rail.innerHTML = "";
    var today = playaDay(nowMin());

    // A day earns a pill only if something happens on it in the current
    // mode — Mon Sep 7 is empty in playa mode (its small hours belong to
    // Sunday night) but real in calendar mode.
    var count = {};
    EV.forEach(function (e) { var k = eDay(e); count[k] = (count[k] || 0) + 1; });
    var shown = DAYS.map(function (d, i) { return i; }).filter(function (i) { return count[i]; });

    var all = el("button", "day all");
    all.setAttribute("aria-selected", S.day === ALL ? "true" : "false");
    all.appendChild(el("span", "dow", "All"));
    all.appendChild(el("span", "dat", shown.length + " nights"));
    all.onclick = function () { S.day = ALL; S.limit = 300; window.scrollTo(0, 0); render(); };
    rail.appendChild(all);

    DAYS.forEach(function (d, i) {
      if (shown.indexOf(i) < 0) return;
      var b = el("button", "day");
      if (/BURN/i.test(d.note)) b.classList.add("burn");
      if (i === today) b.classList.add("today");
      b.setAttribute("aria-selected", i === S.day ? "true" : "false");
      b.appendChild(el("span", "dow", d.dow));
      b.appendChild(el("span", "dat", d.label.replace(" ", " ")));
      b.onclick = function () { S.day = i; S.limit = 300; window.scrollTo(0, 0); render(); };
      rail.appendChild(b);
    });
    var sel = rail.querySelector('[aria-selected="true"]');
    if (sel) sel.scrollIntoView({ inline: "center", block: "nearest" });
  }

  function renderTools() {
    var t = $("#tools");
    t.innerHTML = "";
    var inp = el("input", "search");
    inp.type = "search";
    inp.placeholder = "Search artist, camp, address…";
    inp.value = S.q;
    inp.oninput = function () { S.q = inp.value; S.limit = 300; render(true); };
    t.appendChild(inp);

    var seg = el("div", "seg");
    [["Playa days", true, "noon-to-noon: the night owns its morning"],
     ["Calendar", false, "plain dates: 2am counts as the new day"]].forEach(function (o) {
      var b = el("button", "seg-btn", o[0]);
      b.title = o[2];
      b.setAttribute("aria-pressed", S.playaDays === o[1] ? "true" : "false");
      b.onclick = function () {
        if (S.playaDays === o[1]) return;
        S.playaDays = o[1];
        save(); S.limit = 300; render();
      };
      seg.appendChild(b);
    });
    t.appendChild(seg);

    var chips = el("div", "chips");
    var defs = [
      ["starred", "Starred", ""],
      ["sunrise", "Sunrise", "sun"],
      ["sunset", "Sunset", "dusk"],
      ["music", "Music", ""],
      ["food", "Food", ""],
      ["drink", "Drinks", ""],
      ["adult", "18+", "ember"]
    ];
    if (SAJI_IDS.length) defs.push(
      ["saji", "Saji" + String.fromCharCode(8217) + "s", "saji"],
      ["sjmust", "🔥 Must", "saji"],
      ["sjshould", "🚲 Should", "saji"],
      ["sjgood", "🌫 Good", "saji"]);
    defs.forEach(function (c) {
      var b = el("button", "chip " + c[2], c[1]);
      b.setAttribute("aria-pressed", S.filters[c[0]] ? "true" : "false");
      b.onclick = function () {
        S.filters[c[0]] = !S.filters[c[0]];
        S.limit = 300;
        render();
      };
      chips.appendChild(b);
    });
    t.appendChild(chips);
  }

  function renderNav() {
    var nav = $("#nav");
    nav.innerHTML = "";
    [
      ["all", "Schedule", "browse & filter"],
      ["plan", "Plan", "your run"],
      ["now", "Now", "this minute"]
    ].forEach(function (v) {
      var b = el("button");
      b.appendChild(el("span", "n", v[1]));
      if (v[0] === "plan" && S.stars.size) {
        b.appendChild(el("span", "count", String(S.stars.size)));
      } else {
        b.appendChild(el("span", null, v[2]));
      }
      if (S.view === v[0]) b.setAttribute("aria-current", "page");
      b.onclick = function () { S.view = v[0]; S.limit = 300; window.scrollTo(0, 0); render(); };
      nav.appendChild(b);
    });
  }

  // The rail's real height depends on which fonts actually loaded, so measure
  // it rather than guessing — the sticky night headers park directly beneath it.
  function syncChrome() {
    var rail = $("#rail"), tools = $("#tools"), nav = $("#nav");
    var railH = rail && !rail.hidden ? Math.round(rail.getBoundingClientRect().height) : 0;
    var toolsH = tools && !tools.hidden ? Math.round(tools.getBoundingClientRect().height) : 0;
    // --railbar-h: where the tools bar pins. --rail-h: where night headers pin
    // (beneath rail + tools, since both stay on screen while you scroll).
    document.documentElement.style.setProperty("--railbar-h", railH + "px");
    document.documentElement.style.setProperty("--rail-h", (railH + toolsH) + "px");
    if (nav) document.documentElement.style.setProperty(
      "--nav-h", Math.round(nav.getBoundingClientRect().height) + "px");
  }

  function render(keepFocus) {
    var active = document.activeElement;
    var caret = active && active.classList && active.classList.contains("search")
      ? active.selectionStart : null;

    // Only Schedule browses. Now answers one question — what do I do in the
    // next few hours — and Plan always shows your whole run, so on both of
    // them the night picker and the filters did nothing. They're hidden
    // rather than left there inert.
    var chrome = S.view === "all";
    $("#rail").hidden = !chrome;
    $("#tools").hidden = !chrome;
    if (chrome) {
      renderRail();
      renderTools();
    }
    renderNav();

    var root = $("#main");
    root.innerHTML = "";
    if (S.view === "now") viewNow(root);
    else if (S.view === "plan") viewPlan(root);
    else viewDay(root);

    syncChrome();

    if (keepFocus) {
      var s = $(".search");
      if (s) { s.focus(); if (caret != null) s.setSelectionRange(caret, caret); }
    }
  }

  /* ---------- star toggling ------------------------------------------- */

  document.addEventListener("click", function (ev) {
    var row = ev.target.closest ? ev.target.closest(".ev") : null;
    if (!row) return;
    var id = Number(row.dataset.id);
    if (S.stars.has(id)) S.stars.delete(id); else S.stars.add(id);
    save();
    render();
  });

  /* ---------- share / backup ------------------------------------------ */

  function toast(msg) {
    var old = $(".toast");
    if (old) old.remove();
    var t = el("div", "toast", msg);
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }

  function encodePlan() {
    return "DI1." + Array.from(S.stars).sort(function (a, b) { return a - b; }).join(".");
  }
  function decodePlan(code) {
    var parts = String(code).trim().split(".");
    if (parts[0] !== "DI1") return null;
    var ids = parts.slice(1).map(Number).filter(function (n) {
      return Number.isInteger(n) && n >= 0 && n < EV.length;
    });
    return ids;
  }

  function openShare() {
    var bg = el("div", "sheet-bg");
    var sh = el("div", "sheet");
    sh.appendChild(el("h2", null, "Share your run"));
    sh.appendChild(el("p", null,
      "Your stars are saved in this browser only — nothing leaves the phone. This code " +
      "holds all " + S.stars.size + " of them. Send it to a friend running the same build " +
      "and they can load your picks. Keep a copy as your backup."));

    var code = el("code", null, encodePlan());
    sh.appendChild(code);

    var row = el("div", "btnrow");
    var copy = el("button", "btn go", "Copy code");
    copy.onclick = function () {
      var text = encodePlan();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () { toast("Code copied"); },
          function () { toast("Copy failed — select the code and copy it by hand"); });
      } else {
        toast("Select the code above and copy it by hand");
      }
    };
    row.appendChild(copy);
    sh.appendChild(row);

    sh.appendChild(el("p", null, "Paste a friend's code to add their picks to yours."));
    var ta = el("textarea");
    ta.placeholder = "DI1.42.108.317…";
    sh.appendChild(ta);

    var row2 = el("div", "btnrow");
    var add = el("button", "btn go", "Add to my plan");
    add.onclick = function () {
      var ids = decodePlan(ta.value);
      if (!ids) { toast("That code isn't a Dust Index plan"); return; }
      var before = S.stars.size;
      ids.forEach(function (i) { S.stars.add(i); });
      save();
      bg.remove();
      render();
      toast("Added " + (S.stars.size - before) + " events");
    };
    row2.appendChild(add);

    var wipe = el("button", "btn warn", "Clear my stars");
    wipe.onclick = function () {
      if (!confirm("Remove all " + S.stars.size + " starred events?")) return;
      S.stars.clear(); save(); bg.remove(); render(); toast("Stars cleared");
    };
    row2.appendChild(wipe);

    var close = el("button", "btn", "Done");
    close.onclick = function () { bg.remove(); };
    row2.appendChild(close);
    sh.appendChild(row2);

    sh.appendChild(el("p", null,
      "Clock off? Nudge playa time: " ));
    var row3 = el("div", "btnrow");
    [-60, -15, 15, 60].forEach(function (n) {
      var b = el("btn", "btn", (n > 0 ? "+" : "") + n + " min");
      b = el("button", "btn", (n > 0 ? "+" : "") + n + " min");
      b.onclick = function () { S.offsetMin += n; save(); render(); toast("Playa time " + clock(nowMin())); };
      row3.appendChild(b);
    });
    sh.appendChild(row3);

    bg.onclick = function (e) { if (e.target === bg) bg.remove(); };
    bg.appendChild(sh);
    document.body.appendChild(bg);
  }

  /* ---------- boot ------------------------------------------------------ */

  load();

  // Inside the event, open on the night that is actually happening. Outside it,
  // "Now" has nothing to say — open on the first night with a real music
  // programme instead, or on the plan if there already is one.
  var pd = playaDay(nowMin());
  S.view = "all";
  if (pd >= 0 && pd < DAYS.length) {
    S.day = pd;
  } else {
    S.day = 1;
    for (var di = 0; di < DAYS.length; di++) {
      var n = 0;
      for (var ei = 0; ei < EV.length && n < 60; ei++) {
        if (EV[ei].d === di && MUSIC[EV[ei].src]) n++;
      }
      if (n >= 60) { S.day = di; break; }
    }
  }

  render();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncChrome);
  window.addEventListener("resize", syncChrome);
  setInterval(function () { if (S.view === "now") render(); }, 60000);
})();
