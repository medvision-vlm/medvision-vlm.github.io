/* MedVision interactive benchmark performance vs model release date.
 *
 * Reads window.MEDVISION_TIMELINE (emitted by script/visualization/export_timeline_data.py) and
 * renders one chart per <div class="mv-timeline"> mount. The interactive twin of
 * leaderboard_timeline.pdf, and the opening claim of the Leaderboard section: two years of vision
 * language models on one release-date axis, with MedVision-V0 sitting above all of them.
 *
 * Faithful to viz_leaderboard_timeline.py where it matters — the same four task/metric pairs, the
 * same log y axis, a dotted line joining a model SERIES in release order, and marker = series, so
 * a family reads as a family. Two deliberate departures, both because the widget shows ONE task at
 * a time while the figure stacks all four:
 *
 *   - colour encodes the MODEL, not the task. A single-task panel has nothing to disambiguate with
 *     colour, and the page's other widgets (radar, box-size, box-ratio) already give every model
 *     one colour; reusing it here keeps a model recognisable across the whole section. The task's
 *     own accent from the PDF survives on the task chip and the axis title.
 *   - only MedVision-V0 is labelled in place. The figure has to name every linked point because
 *     paper readers cannot hover; here the name is a pointer away, so the plot stays uncluttered
 *     and a chip hover reveals the label of exactly the model being asked about.
 *
 * The dashed rule across MedVision-V0's score, and the "N x the best off-the-shelf model" readout
 * in the crumb, are what turn the scatter into the section's argument rather than a lookup table.
 *
 * Marker glyphs come from static/js/marker-glyphs.js, which must load first; filled here, since
 * colour is doing model duty and a hollow glyph would read as a second, absent encoding.
 *
 * No other dependencies. No-op if no .mv-timeline mount is present (safe to load on every page).
 */
(function () {
  "use strict";

  var SVGNS = "http://www.w3.org/2000/svg";
  var MARKERS = window.MedVisionMarkers;   // static/js/marker-glyphs.js — must load first

  // Geometry (SVG user units == CSS px).
  var PAD_L = 66, PAD_R = 26, PAD_T = 18, PAD_B = 62;
  var H_PLOT = 380, MIN_W = 520;
  var R_MODEL = 5, R_OURS = 8.5, HIT_R = 11;
  var C_GRID = "rgba(15,23,42,.16)";
  var C_LINK = "rgba(15,23,42,.34)";       // series link — neutral, so it never fights model colour
  var DAY = 86400000;
  var PAD_DAYS_L = 30, PAD_DAYS_R = 55;    // breathing room at each end of the date axis
  // Vertical headroom, as a FRACTION of the visible log span rather than a fixed factor: T/L runs
  // from 2.7e-05 to 3.9 (five decades), where a constant "x1.55" is under 4% of the panel and the
  // extreme markers touch the edges. A floor keeps a two-model comparison from looking airless.
  var Y_PAD_FRAC = 0.07, Y_PAD_MIN = 1.5;

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }
  function svg(tag, attrs) {
    var e = document.createElementNS(SVGNS, tag);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function strong(t) { var e = document.createElement("b"); e.textContent = t; return e; }
  function sep() { return el("span", "mvb-sep", "·"); }

  // ISO "YYYY-MM-DD" -> ms. Parsed as UTC so the axis does not shift by a day per timezone.
  function toMs(iso) {
    var p = iso.split("-");
    return Date.UTC(+p[0], +p[1] - 1, +p[2]);
  }
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtDate(ms) {
    var d = new Date(ms);
    return MONTHS[d.getUTCMonth()] + " " + d.getUTCFullYear();
  }
  function fmtFullDate(ms) {
    var d = new Date(ms);
    return MONTHS[d.getUTCMonth()] + " " + d.getUTCDate() + ", " + d.getUTCFullYear();
  }
  /* Three significant figures. Below 1e-3 the fixed form stops being readable ("0.000027"), so the
   * deep end of 1/MRE — where MedGemma 4B's T/L score lives — switches to an exponent. */
  function fmtNum(v) {
    if (v == null || !isFinite(v)) return "n/a";
    var a = Math.abs(v);
    if (a >= 100) return v.toFixed(0);
    if (a >= 10) return v.toFixed(1);
    if (a >= 1) return v.toFixed(2);
    if (a >= 0.001) return v.toFixed(3);
    return v.toExponential(1).replace("e-", "e−");
  }
  function fmtPct(v) { return v == null ? "n/a" : (v * 100).toFixed(1) + "%"; }

  /* 1-2-5 ticks spanning [lo, hi] on a log axis, thinned to at most `max` labels. */
  function logTicks(lo, hi, max) {
    var out = [];
    var k = Math.floor(Math.log(lo) / Math.LN10) - 1;
    var top = Math.ceil(Math.log(hi) / Math.LN10) + 1;
    for (; k <= top; k++) {
      [1, 2, 5].forEach(function (m) {
        var v = m * Math.pow(10, k);
        if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v);
      });
    }
    // Too dense: fall back to decades, then to every other decade.
    if (out.length > max) out = out.filter(function (v) {
      var l = Math.log(v) / Math.LN10;
      return Math.abs(l - Math.round(l)) < 1e-9;
    });
    while (out.length > max) out = out.filter(function (_, i) { return i % 2 === 0; });
    return out;
  }

  /* Quarter starts covering [lo, hi] ms, thinned so labels never collide. */
  function dateTicks(lo, hi, maxLabels) {
    var d = new Date(lo), ticks = [];
    var y = d.getUTCFullYear(), q = Math.floor(d.getUTCMonth() / 3);
    for (var ms = Date.UTC(y, q * 3, 1); ms <= hi; ) {
      if (ms >= lo) ticks.push(ms);
      q += 1;
      if (q > 3) { q = 0; y += 1; }
      ms = Date.UTC(y, q * 3, 1);
    }
    var step = Math.ceil(ticks.length / Math.max(2, maxLabels));
    return ticks.filter(function (_, i) { return i % step === 0; });
  }

  function initTimeline(mount, DATA) {
    var TASKS = DATA.tasks;
    var MODELS = DATA.models;                 // release order (exporter sorts)
    var OURS = MODELS.filter(function (m) { return m.ours; })[0] || null;

    var state = { task: TASKS[0].key, emphasis: null, model: {} };
    MODELS.forEach(function (m) { state.model[m.name] = true; });

    function taskDef() {
      return TASKS.filter(function (t) { return t.key === state.task; })[0];
    }
    // A strictly positive, finite score is what a LOG axis can place. The exporter rounds to
    // significant figures precisely so a very small score (MedGemma 4B scores 1/MRE = 2.7e-05 on
    // T/L) survives serialisation, but a model with no scored entry still has to drop out here
    // rather than be drawn at log(0).
    function valueOf(name) {
      var row = DATA.values[name];
      var cell = row && row[state.task];
      return cell && cell.v != null && isFinite(cell.v) && cell.v > 0 ? cell : null;
    }
    function activeModels() {
      return MODELS.filter(function (m) { return state.model[m.name] && valueOf(m.name); });
    }

    // ── shell ────────────────────────────────────────────────────────────────
    mount.innerHTML = "";
    mount.setAttribute("role", "group");
    mount.setAttribute("aria-label", "Benchmark performance versus model release date");

    var head = el("div", "mvb-head");
    var eyebrow = el("div", "mvb-eyebrow");
    eyebrow.appendChild(el("span", "mvb-dot"));
    eyebrow.appendChild(el("span", null, "PERFORMANCE OVER TIME"));
    var crumb = el("div", "mvb-crumb");
    head.appendChild(eyebrow);
    head.appendChild(crumb);
    mount.appendChild(head);

    var controls = el("div", "mvb-controls");
    controls.appendChild(segmented("Task", TASKS.map(function (t) {
      return { id: t.key, label: t.label, color: t.color };
    }), function () { return state.task; }, function (id) { state.task = id; redraw(); }));
    mount.appendChild(controls);

    var stage = el("div", "mvb-stage");
    var svgHolder = el("div", "mvb-svgwrap");
    stage.appendChild(svgHolder);
    mount.appendChild(stage);

    var legend = el("div", "mvb-legend");
    legend.appendChild(legendTitle("Models", [
      quickBtn("All", function () { setAll(true); }),
      quickBtn("None", function () { setAll(false); }),
      quickBtn("Medical only", function () { setGroup("medical"); }),
      quickBtn("General only", function () { setGroup("general"); })
    ]));
    var chips = el("div", "mvb-chips");
    var chipByModel = {};
    MODELS.forEach(function (m) {
      var chip = el("button", "mvb-chip");
      chip.type = "button";
      chip.appendChild(MARKERS.swatch(m.marker, m.color, true));
      chip.appendChild(el("span", "mvb-chipname", m.name));
      chip.addEventListener("click", function () { toggle(m.name); });
      chip.addEventListener("mouseenter", function () { setEmphasis(m.name); });
      chip.addEventListener("mouseleave", function () { setEmphasis(null); });
      chip.addEventListener("focus", function () { setEmphasis(m.name); });
      chip.addEventListener("blur", function () { setEmphasis(null); });
      chipByModel[m.name] = chip;
      chips.appendChild(chip);
    });
    legend.appendChild(chips);
    mount.appendChild(legend);

    var tip = el("div", "mvb-tip");
    tip.style.display = "none";
    mount.appendChild(tip);

    function syncChip(chip, on) {
      chip.classList.toggle("is-active", !!on);
      chip.setAttribute("aria-pressed", on ? "true" : "false");
    }
    function toggle(name) {
      state.model[name] = !state.model[name];
      syncChip(chipByModel[name], state.model[name]);
      redraw();
    }
    function setAll(on) {
      MODELS.forEach(function (m) { state.model[m.name] = on; syncChip(chipByModel[m.name], on); });
      redraw();
    }
    // Medical-domain models, by series. MedVision-V0 stays on either way — it is the comparison
    // every subset is drawn to make.
    var MEDICAL = { MedGemma: 1, Lingshu: 1, MedDr: 1, "HuatuoGPT-Vision": 1, HealthGPT: 1 };
    function setGroup(which) {
      MODELS.forEach(function (m) {
        var med = !!MEDICAL[m.series];
        var on = m.ours || (which === "medical" ? med : !med);
        state.model[m.name] = on;
        syncChip(chipByModel[m.name], on);
      });
      redraw();
    }
    function setEmphasis(name) {
      state.emphasis = name;
      var nodes = svgHolder.querySelectorAll(".mvb-series");
      for (var i = 0; i < nodes.length; i++) {
        var self = nodes[i].getAttribute("data-model") === name;
        nodes[i].style.opacity = (name == null || self) ? "" : "0.12";
      }
      // Reveal the hovered model's name in place; V0's own label is always on.
      var labels = svgHolder.querySelectorAll(".mvt-label");
      for (var j = 0; j < labels.length; j++) {
        var own = labels[j].getAttribute("data-model");
        labels[j].style.display =
          (own === name || labels[j].getAttribute("data-always") === "1") ? "" : "none";
      }
    }
    MODELS.forEach(function (m) { syncChip(chipByModel[m.name], true); });

    // ── drawing ──────────────────────────────────────────────────────────────
    function redraw() {
      var t = taskDef(), models = activeModels();

      // Crumb: the section's claim, recomputed for whichever task is on screen.
      crumb.innerHTML = "";
      crumb.appendChild(document.createTextNode("metric="));
      crumb.appendChild(strong(t.metric));
      crumb.appendChild(sep());
      crumb.appendChild(strong(models.length + "/" + MODELS.length));
      crumb.appendChild(document.createTextNode(" models"));
      var lead = leadFactor();
      if (lead) {
        crumb.appendChild(sep());
        crumb.appendChild(strong(OURS.name));
        crumb.appendChild(document.createTextNode(" leads by "));
        crumb.appendChild(strong(fmtNum(lead.factor) + "×"));
      }

      drawChart(t, models);
      setEmphasis(state.emphasis);
    }

    /* MedVision-V0 against the best off-the-shelf model on the current task. */
    function leadFactor() {
      if (!OURS) return null;
      var ours = valueOf(OURS.name);
      if (!ours) return null;
      var best = null;
      MODELS.forEach(function (m) {
        if (m.ours) return;
        var c = valueOf(m.name);
        if (c && (best == null || c.v > best.v)) best = { v: c.v, name: m.name };
      });
      if (!best || !best.v) return null;
      return { factor: ours.v / best.v, best: best };
    }

    function drawChart(t, models) {
      var W = Math.max(MIN_W, svgHolder.clientWidth || mount.clientWidth || 900);
      var plotW = W - PAD_L - PAD_R;
      var H = PAD_T + H_PLOT + PAD_B;
      var yTop = PAD_T, yBot = PAD_T + H_PLOT;

      // The date axis spans the whole roster, not just the visible subset, so toggling models
      // never slides the points sideways under the reader.
      var t0 = toMs(MODELS[0].release) - PAD_DAYS_L * DAY;
      var t1 = toMs(MODELS[MODELS.length - 1].release) + PAD_DAYS_R * DAY;

      // The y range DOES follow the visible subset: with 18 series spanning four decades, a fixed
      // range would flatten any two-model comparison into a single line.
      var lo = Infinity, hi = -Infinity;
      models.forEach(function (m) {
        var v = valueOf(m.name).v;   // valueOf already guarantees finite and > 0
        lo = Math.min(lo, v); hi = Math.max(hi, v);
      });
      if (!isFinite(lo) || !isFinite(hi)) { lo = 0.01; hi = 1; }
      if (lo === hi) { lo /= 2; hi *= 2; }
      var padLog = Math.max(Math.log(Y_PAD_MIN), (Math.log(hi) - Math.log(lo)) * Y_PAD_FRAC);
      lo = Math.exp(Math.log(lo) - padLog);
      hi = Math.exp(Math.log(hi) + padLog);

      var lLo = Math.log(lo), lSpan = Math.log(hi) - lLo;
      function xAt(ms) { return PAD_L + ((ms - t0) / (t1 - t0)) * plotW; }
      function yAt(v) { return yBot - ((Math.log(v) - lLo) / lSpan) * H_PLOT; }

      var root = svg("svg", {
        viewBox: "0 0 " + W + " " + H, width: W, height: H, class: "mvb-svg",
        role: "img",
        "aria-label": t.label + " " + t.metric + " against model release date, " +
          models.length + " models"
      });

      // ── grid ───────────────────────────────────────────────────────────────
      logTicks(lo, hi, 8).forEach(function (v) {
        var y = yAt(v);
        root.appendChild(svg("line", {
          x1: PAD_L, y1: y, x2: W - PAD_R, y2: y, stroke: C_GRID,
          "stroke-width": 1, "stroke-dasharray": "4 4"
        }));
        var lab = svg("text", { x: PAD_L - 9, y: y + 3.5, class: "mvb-axlab", "text-anchor": "end" });
        lab.textContent = fmtNum(v);
        root.appendChild(lab);
      });
      var xticks = dateTicks(t0, t1, Math.max(3, Math.floor(plotW / 78)));
      xticks.forEach(function (ms) {
        var x = xAt(ms);
        root.appendChild(svg("line", {
          x1: x, y1: yTop, x2: x, y2: yBot, stroke: C_GRID,
          "stroke-width": 1, "stroke-dasharray": "4 4"
        }));
        var lab = svg("text", { x: x, y: yBot + 20, class: "mvb-axlab", "text-anchor": "middle" });
        lab.textContent = fmtDate(ms);
        root.appendChild(lab);
      });
      root.appendChild(axisTitle(t.label + " — " + t.metric + " ↑", PAD_L - 46,
                                 (yTop + yBot) / 2, t.color));
      var xTitle = svg("text", {
        x: PAD_L + plotW / 2, y: H - 14, class: "mvb-axtitle", "text-anchor": "middle"
      });
      xTitle.textContent = "Model release date";
      root.appendChild(xTitle);

      // ── MedVision-V0 reference rule: the section's claim, drawn ─────────────
      var ourCell = OURS && state.model[OURS.name] ? valueOf(OURS.name) : null;
      if (ourCell) {
        var yv = yAt(ourCell.v);
        root.appendChild(svg("line", {
          x1: PAD_L, y1: yv, x2: W - PAD_R, y2: yv, stroke: OURS.color,
          "stroke-width": 1.4, "stroke-dasharray": "8 5", opacity: 0.55
        }));
      }

      // ── dotted links: one model series, in release order ────────────────────
      var bySeries = {};
      models.forEach(function (m) {
        (bySeries[m.series] = bySeries[m.series] || []).push(m);
      });
      Object.keys(bySeries).forEach(function (s) {
        var pts = bySeries[s];
        if (pts.length < 2) return;
        var d = pts.map(function (m, i) {
          return (i ? "L" : "M") + xAt(toMs(m.release)).toFixed(1) + "," +
            yAt(valueOf(m.name).v).toFixed(1);
        }).join("");
        root.appendChild(svg("path", {
          d: d, fill: "none", stroke: C_LINK, "stroke-width": 2,
          "stroke-dasharray": "2 4", "stroke-linecap": "round", class: "mvt-link"
        }));
      });

      // ── one marker per model ───────────────────────────────────────────────
      models.forEach(function (m) {
        var cell = valueOf(m.name);
        var x = xAt(toMs(m.release)), y = yAt(cell.v);
        var r = m.ours ? R_OURS : R_MODEL;
        var g = svg("g", { class: "mvb-series", "data-model": m.name });
        g.appendChild(MARKERS.node(m.marker, x, y, r, m.color, true));

        // Labels: V0 always, everyone else only while their chip is hovered (setEmphasis).
        var rightSide = x > PAD_L + plotW * 0.72;
        var lab = svg("text", {
          x: x + (rightSide ? -(r + 6) : r + 6), y: y + 4,
          class: "mvt-label" + (m.ours ? " is-ours" : ""),
          "text-anchor": rightSide ? "end" : "start",
          "data-model": m.name, "data-always": m.ours ? "1" : "0"
        });
        lab.textContent = m.name;
        if (!m.ours) lab.style.display = "none";
        g.appendChild(lab);

        var hit = svg("circle", { cx: x, cy: y, r: HIT_R, fill: "transparent", class: "mvb-hit" });
        bindHover(hit, m, t);
        g.appendChild(hit);
        root.appendChild(g);
      });

      // Axis rules last, so they sit above the dashed grid but below nothing that matters.
      root.appendChild(svg("line", {
        x1: PAD_L, y1: yBot, x2: W - PAD_R, y2: yBot, stroke: C_GRID, "stroke-width": 1.3
      }));

      svgHolder.innerHTML = "";
      svgHolder.appendChild(root);
    }

    function axisTitle(text, x, y, color) {
      var attrs = {
        x: x, y: y, class: "mvb-axtitle", "text-anchor": "middle",
        transform: "rotate(-90 " + x + " " + y + ")"
      };
      if (color) attrs.fill = color;
      var e = svg("text", attrs);
      e.textContent = text;
      return e;
    }

    function bindHover(node, model, t) {
      node.addEventListener("mouseenter", function (ev) {
        var cell = valueOf(model.name);
        // Rank among every model scored on this task, not just the visible ones — hiding a model
        // must not promote the rest.
        var scored = MODELS.map(function (m) { return valueOf(m.name); })
          .filter(Boolean).map(function (c) { return c.v; }).sort(function (a, b) { return b - a; });
        var rank = scored.indexOf(cell.v) + 1;

        tip.innerHTML = "";
        var h = el("div", "mvb-tiphead");
        h.appendChild(MARKERS.swatch(model.marker, model.color, true));
        h.appendChild(el("span", null, model.name));
        tip.appendChild(h);
        tip.appendChild(el("div", "mvb-tipratio", "released " + fmtFullDate(toMs(model.release))));
        tip.appendChild(el("div", "mvb-tipval", t.label + " " + t.metric + ": " + fmtNum(cell.v)));
        var sub = t.mre && cell.mre != null ? "MRE " + fmtPct(cell.mre) + "  ·  " : "";
        tip.appendChild(el("div", "mvb-tipsub", sub + "rank " + rank + " of " + scored.length));
        tip.appendChild(el("div", "mvb-tipsub", "series: " + model.series));
        tip.style.display = "block";
        moveTip(ev);
      });
      node.addEventListener("mousemove", moveTip);
      node.addEventListener("mouseleave", function () { tip.style.display = "none"; });
    }

    function moveTip(ev) {
      var rect = mount.getBoundingClientRect();
      var x = ev.clientX - rect.left, y = ev.clientY - rect.top;
      var tw = tip.offsetWidth, th = tip.offsetHeight;
      var left = x + 16, top = y + 16;
      if (left + tw > rect.width - 6) left = x - tw - 16;
      if (top + th > rect.height - 6) top = y - th - 16;
      tip.style.left = Math.max(6, left) + "px";
      tip.style.top = Math.max(6, top) + "px";
    }

    // Re-fit on resize; the SVG is laid out in px, not scaled.
    var resizeTimer = null;
    window.addEventListener("resize", function () {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(redraw, 150);
    });

    redraw();
  }

  // ── small builders (same design as the box-size / box-ratio explorers) ──────
  function segmented(label, items, getActive, onPick) {
    var wrap = el("div", "mvb-seg");
    wrap.appendChild(el("span", "mvb-seglabel", label));
    if (items.length === 1) {
      wrap.appendChild(el("span", "mvb-segstatic", items[0].label));
      return wrap;
    }
    var group = el("div", "mvb-segbtns");
    function sync() {
      var all = group.querySelectorAll(".mvb-segbtn");
      for (var i = 0; i < all.length; i++) {
        var on = all[i].getAttribute("data-id") === getActive();
        all[i].classList.toggle("is-active", on);
        all[i].setAttribute("aria-pressed", on ? "true" : "false");
      }
    }
    items.forEach(function (it) {
      var b = el("button", "mvb-segbtn", it.label);
      b.type = "button";
      b.setAttribute("data-id", it.id);
      // The task's PDF accent, carried onto its chip so the widget and Figure 4 agree.
      if (it.color) b.style.setProperty("--mvt-accent", it.color);
      b.addEventListener("click", function () { onPick(it.id); sync(); });
      group.appendChild(b);
    });
    wrap.appendChild(group);
    sync();
    return wrap;
  }
  function quickBtn(text, fn) {
    var b = el("button", "mvb-quickbtn", text);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }
  function legendTitle(text, buttons) {
    var row = el("div", "mvb-legendhead");
    row.appendChild(el("span", "mvb-legendtitle", text));
    var q = el("div", "mvb-quick");
    buttons.forEach(function (b) { q.appendChild(b); });
    row.appendChild(q);
    return row;
  }

  // Bootstrap last, so the module is fully defined whenever ready() fires synchronously.
  ready(function () {
    var mounts = document.querySelectorAll(".mv-timeline");
    if (!mounts.length) return;
    var DATA = window.MEDVISION_TIMELINE;
    for (var i = 0; i < mounts.length; i++) {
      if (!DATA || !DATA.models || !DATA.tasks) {
        mounts[i].innerHTML = '<p class="mvb-empty">Timeline data failed to load.</p>';
      } else {
        initTimeline(mounts[i], DATA);
      }
    }
  });
})();
