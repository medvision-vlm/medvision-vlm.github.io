/* MedVision interactive per-task radar viewer.
 *
 * Reads window.MEDVISION_RADAR (emitted by script/visualization/export_radar_data.py) and renders
 * one radar per <div class="mv-radar" data-task="Detection|TL|AD"> mount. Each spoke is a clinical
 * target, each model is a line trace. Interactivity: toggle which models are shown, switch the metric
 * (Detection) or Angle/Distance group (A/D), and hover any vertex to read the underlying value.
 *
 * Faithful to script/visualization/viz_radar.py: radius = higher_better ? clamp(v,0,1) : 1-clamp(v,0,1)
 * (MRE/MAE inverted so outer = best); tumor/lesion spokes coloured #770087; the affine window
 * (v+0.3)/1.4 hollows the centre like matplotlib's ylim(-0.3,1.1).
 *
 * No external dependencies. No-op if no .mv-radar mount is present (safe to load on every page).
 */
(function () {
  "use strict";

  var SVGNS = "http://www.w3.org/2000/svg";
  var TASK_LABEL = {
    Detection: "Detection", TL: "Tumor / Lesion size", AD: "Angle / Distance",
    "TL-Pilot": "Pilot study (T/L)"
  };
  // Fallback label for the single-group tasks (their group.name is null) so the always-on "Task"
  // control still reads meaningfully; A/D uses its real group names (Angle / Distance).
  var TASK_GROUP_LABEL = {
    Detection: "Detection", TL: "Tumor/Lesion", AD: "Angle / Distance",
    "TL-Pilot": "Pilot · T/L"
  };

  // Geometry (SVG user units). The affine window mirrors viz_radar's ylim(-0.3, 1.1): a plotted
  // value 0 sits on an inner ring (hollow centre), 1.0 near the outer edge.
  var VB = 600, CX = 300, CY = 300, RMAX = 205;
  // Whole-radar rotation. pt() places theta=0 at the top and increases clockwise, so a positive
  // offset rotates clockwise; +PI/2 puts spoke 1 at 3 o'clock (90° CW from top).
  var ROT = Math.PI / 2;
  var Y_MIN = -0.3, Y_SPAN = 1.4;                 // (1.1 - (-0.3))
  var RINGS = [0, 0.2, 0.4, 0.6, 0.8, 1.0];
  var C_TUMOR = "#770087", C_ANATOMY = "#1f2430", C_GRID = "rgba(15,23,42,.16)";

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
  function clamp01(x) { return Math.min(Math.max(x, 0), 1); }
  function pixelR(plotted) { return ((plotted - Y_MIN) / Y_SPAN) * RMAX; }
  function pt(r, theta) { return [CX + r * Math.sin(theta), CY - r * Math.cos(theta)]; }
  // Spokes numbered counterclockwise. theta increases clockwise, so subtract to advance CCW; ROT
  // still anchors spoke 1 at 3 o'clock (the 90° CW rotation).
  function spokeAngle(i, N) { return ROT - (i / N) * 2 * Math.PI; }

  ready(function () {
    var mounts = document.querySelectorAll(".mv-radar");
    if (!mounts.length) return;
    var DATA = window.MEDVISION_RADAR;
    for (var i = 0; i < mounts.length; i++) {
      if (!DATA || !DATA.models || !DATA.tasks) {
        mounts[i].innerHTML = '<p class="mvr-empty">Radar data failed to load.</p>';
      } else {
        initRadar(mounts[i], DATA);
      }
    }
  });

  function initRadar(mount, DATA) {
    var taskKey = mount.getAttribute("data-task");
    var task = DATA.tasks[taskKey];
    if (!task) { mount.innerHTML = ""; mount.appendChild(el("p", "mvr-empty", "Unknown task: " + taskKey + ".")); return; }

    var groups = task.groups;                          // [{name, spokes, values}]
    var metrics = task.metrics;                        // [{key,label,higher_better,default}]
    // Only the models present in THIS task (the pilot compares a 3-model subset). Colour comes from
    // the global union entry, so a model keeps one colour across every radar it appears in.
    var present = groups[0].values;
    var MODELS = DATA.models.filter(function (m) { return present[m.name] !== undefined; });

    // ── state ────────────────────────────────────────────────────────────────
    var defaultMetric = (metrics.filter(function (m) { return m.default; })[0] || metrics[0]).key;
    // A/D groups are [Angle, Distance] — default to Distance to match the page's default A/D tab.
    var defaultGroup = 0;
    for (var gi = 0; gi < groups.length; gi++) if (groups[gi].name === "Distance") defaultGroup = gi;
    var state = { metric: defaultMetric, groupIdx: defaultGroup, active: {}, emphasis: null };
    MODELS.forEach(function (m) { state.active[m.name] = true; });

    function metricDef() { return metrics.filter(function (m) { return m.key === state.metric; })[0]; }
    function group() { return groups[state.groupIdx]; }
    function activeNames() { return MODELS.filter(function (m) { return state.active[m.name]; }).map(function (m) { return m.name; }); }

    // ── shell (built once; only the SVG + legend redraw on interaction) ───────
    mount.innerHTML = "";
    mount.setAttribute("role", "group");
    mount.setAttribute("aria-label", TASK_LABEL[taskKey] + " performance radar");

    // header
    var head = el("div", "mvr-head");
    var eyebrow = el("div", "mvr-eyebrow");
    eyebrow.appendChild(el("span", "mvr-dot"));
    eyebrow.appendChild(el("span", null, "PERFORMANCE RADAR"));
    var crumb = el("div", "mvr-crumb");
    head.appendChild(eyebrow);
    head.appendChild(crumb);
    mount.appendChild(head);

    // controls: metric selector + task (group) toggle — both always shown, even when single-item.
    var controls = el("div", "mvr-controls");
    controls.appendChild(segmented("Metric", metrics.map(function (m) {
      return { id: m.key, label: m.label + (m.higher_better ? " ↑" : " ↓") };
    }), function () { return state.metric; }, function (id) { state.metric = id; redraw(); }));
    controls.appendChild(segmented("Task", groups.map(function (g, i) {
      return { id: String(i), label: g.name || TASK_GROUP_LABEL[taskKey] || TASK_LABEL[taskKey] };
    }), function () { return String(state.groupIdx); }, function (id) { state.groupIdx = +id; redraw(); }));
    mount.appendChild(controls);

    // chart + spoke-number legend
    var stage = el("div", "mvr-stage");
    var svgHolder = el("div", "mvr-svgwrap");
    var mapPanel = el("div", "mvr-map");
    stage.appendChild(svgHolder);
    stage.appendChild(mapPanel);
    mount.appendChild(stage);

    // model legend (rendered once; chip classes toggle in place)
    var legend = el("div", "mvr-legend");
    var quick = el("div", "mvr-quick");
    quick.appendChild(quickBtn("All", function () { setAll(true); }));
    quick.appendChild(quickBtn("None", function () { setAll(false); }));
    quick.appendChild(quickBtn("Only " + MODELS[0].name.replace(/\s*\(.*/, ""), function () { onlyFirst(); }));
    legend.appendChild(quick);
    var chips = el("div", "mvr-chips");
    var chipByName = {};
    MODELS.forEach(function (m) {
      var chip = el("button", "mvr-chip is-active");
      chip.type = "button";
      chip.setAttribute("aria-pressed", "true");
      var sw = el("span", "mvr-sw"); sw.style.background = m.color;
      chip.appendChild(sw);
      chip.appendChild(el("span", "mvr-chipname", m.name));
      chip.addEventListener("click", function () { toggle(m.name); });
      chip.addEventListener("mouseenter", function () { setEmphasis(m.name); });
      chip.addEventListener("mouseleave", function () { setEmphasis(null); });
      chip.addEventListener("focus", function () { setEmphasis(m.name); });
      chip.addEventListener("blur", function () { setEmphasis(null); });
      chipByName[m.name] = chip;
      chips.appendChild(chip);
    });
    legend.appendChild(chips);
    mount.appendChild(legend);

    // floating tooltip (one per mount)
    var tip = el("div", "mvr-tip");
    tip.style.display = "none";
    mount.appendChild(tip);

    // ── interactions ─────────────────────────────────────────────────────────
    function toggle(name) {
      state.active[name] = !state.active[name];
      chipByName[name].classList.toggle("is-active", state.active[name]);
      chipByName[name].setAttribute("aria-pressed", state.active[name] ? "true" : "false");
      redraw();
    }
    function setAll(on) {
      MODELS.forEach(function (m) {
        state.active[m.name] = on;
        chipByName[m.name].classList.toggle("is-active", on);
        chipByName[m.name].setAttribute("aria-pressed", on ? "true" : "false");
      });
      redraw();
    }
    function onlyFirst() {
      MODELS.forEach(function (m, i) {
        state.active[m.name] = i === 0;
        chipByName[m.name].classList.toggle("is-active", i === 0);
        chipByName[m.name].setAttribute("aria-pressed", i === 0 ? "true" : "false");
      });
      redraw();
    }
    function setEmphasis(name) {
      state.emphasis = name;
      var paths = svgHolder.querySelectorAll(".mvr-trace");
      for (var i = 0; i < paths.length; i++) {
        var pn = paths[i].getAttribute("data-model");
        var on = name == null || pn === name;
        paths[i].setAttribute("opacity", on ? (name && pn === name ? "1" : "0.85") : "0.10");
        paths[i].setAttribute("stroke-width", name && pn === name ? "3.2" : "2");
      }
    }

    // ── drawing ────────────────────────────────────────────────────────────────
    function redraw() {
      var g = group(), md = metricDef();
      var names = activeNames();

      // crumb
      crumb.innerHTML = "";
      crumb.appendChild(document.createTextNode("metric="));
      crumb.appendChild(strong(md.label));
      crumb.appendChild(sep());
      crumb.appendChild(document.createTextNode((g.name ? g.name + " · " : "")));
      crumb.appendChild(strong(names.length + "/" + MODELS.length));
      crumb.appendChild(document.createTextNode(" models"));

      drawChart(g, md, names);
      drawMap(g);
      setEmphasis(state.emphasis);
    }

    function drawChart(g, md, names) {
      var spokes = g.spokes, N = spokes.length;
      var root = svg("svg", {
        viewBox: "0 0 " + VB + " " + VB, class: "mvr-svg",
        role: "img", "aria-label": TASK_LABEL[taskKey] + " " + md.label + ", " + names.length + " models"
      });

      // rings + radial value labels
      RINGS.forEach(function (ry) {
        var r = pixelR(ry);
        root.appendChild(svg("circle", {
          cx: CX, cy: CY, r: r, fill: "none", stroke: C_GRID,
          "stroke-width": ry === 1.0 ? 1.4 : 1
        }));
        var label = ringLabel(ry, md.higher_better);
        if (label != null) {
          var p = pt(r, ROT);                            // along the rotated reference spoke
          var t = svg("text", {
            x: p[0] + 7, y: p[1] + 3, class: "mvr-ringlab",
            "text-anchor": "start"
          });
          t.textContent = label;
          root.appendChild(t);
        }
      });

      // spokes: gridline + number
      for (var i = 0; i < N; i++) {
        var theta = spokeAngle(i, N);
        var a = pt(pixelR(0), theta), b = pt(pixelR(1.0), theta);
        root.appendChild(svg("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: C_GRID, "stroke-width": 1 }));
        var np = pt(pixelR(1.0) + 20, theta);
        var num = svg("text", {
          x: np[0], y: np[1], class: "mvr-spokenum",
          "text-anchor": "middle", "dominant-baseline": "middle",
          fill: spokes[i].purple ? C_TUMOR : C_ANATOMY,
          "font-weight": spokes[i].purple ? 700 : 500
        });
        num.textContent = spokes[i].n;
        var title = svg("title"); title.textContent = spokes[i].name; num.appendChild(title);
        root.appendChild(num);
      }

      // model traces (lines only, no fill) + hover vertices. A metric that is null/NaN — a target the
      // model failed on EVERY sample (SR 0), so MRE/MAE is undefined — is skipped: no vertex and the
      // line breaks into a gap, the same way matplotlib drops NaN. Never plotted at the centre or rim.
      names.forEach(function (name) {
        var color = colorOf(name);
        var series = g.values[name];
        var verts = [];
        for (var i = 0; i < N; i++) {
          var v = series[i] ? series[i][md.key] : null;
          if (v == null || isNaN(v)) { verts.push(null); continue; }
          var cv = clamp01(v);
          var plotted = md.higher_better ? cv : 1 - cv;
          verts.push(pt(pixelR(plotted), spokeAngle(i, N)));
        }
        var d = radarPath(verts);
        if (d) root.appendChild(svg("path", {
          d: d, fill: "none", stroke: color, "stroke-width": 2,
          "stroke-linejoin": "round", "stroke-linecap": "round",
          opacity: 0.85, class: "mvr-trace", "data-model": name
        }));
        for (var i = 0; i < N; i++) {
          if (!verts[i]) continue;
          var c = svg("circle", {
            cx: verts[i][0], cy: verts[i][1], r: 3.4, fill: color, class: "mvr-vertex",
            "data-model": name, "data-spoke": i
          });
          bindHover(c, name, g, md, i);
          root.appendChild(c);
        }
      });

      svgHolder.innerHTML = "";
      svgHolder.appendChild(root);
    }

    function drawMap(g) {
      mapPanel.innerHTML = "";
      mapPanel.appendChild(el("div", "mvr-maptitle", "Targets" + (g.name ? " · " + g.name : "")));
      var list = el("div", "mvr-maplist");
      g.spokes.forEach(function (s) {
        var row = el("div", "mvr-maprow" + (s.purple ? " is-tl" : ""));
        row.appendChild(el("span", "mvr-mapn", s.n));
        row.appendChild(el("span", "mvr-mapname", s.name));
        list.appendChild(row);
      });
      mapPanel.appendChild(list);
    }

    function bindHover(node, name, g, md, spokeIdx) {
      node.addEventListener("mouseenter", function (ev) { showTip(ev, name, g, md, spokeIdx); node.setAttribute("r", 5); });
      node.addEventListener("mousemove", function (ev) { moveTip(ev); });
      node.addEventListener("mouseleave", function () { tip.style.display = "none"; node.setAttribute("r", 3.4); });
    }

    function showTip(ev, name, g, md, spokeIdx) {
      var cell = g.values[name][spokeIdx] || {};
      var v = cell[md.key];
      var spoke = g.spokes[spokeIdx];
      tip.innerHTML = "";
      var h = el("div", "mvr-tiphead");
      var sw = el("span", "mvr-tipsw"); sw.style.background = colorOf(name);
      h.appendChild(sw); h.appendChild(el("span", null, name));
      tip.appendChild(h);
      tip.appendChild(el("div", "mvr-tiptarget" + (spoke.purple ? " is-tl" : ""), spoke.n + ". " + spoke.name));
      var line = md.label + ": " + fmtPct(v);
      var sub = [];
      if (cell.SR != null) sub.push("SR " + fmtPct(cell.SR));
      if (cell.n != null) sub.push("n=" + cell.n);
      tip.appendChild(el("div", "mvr-tipval", line));
      if (sub.length) tip.appendChild(el("div", "mvr-tipsub", sub.join("  ·  ")));
      tip.style.display = "block";
      moveTip(ev);
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

    var colorMap = {};
    MODELS.forEach(function (m) { colorMap[m.name] = m.color; });
    function colorOf(name) { return colorMap[name] || "#888"; }

    redraw();
  }

  // ── small builders ──────────────────────────────────────────────────────────
  function segmented(label, items, getActive, onPick) {
    var wrap = document.createElement("div");
    wrap.className = "mvr-seg";
    wrap.appendChild(el("span", "mvr-seglabel", label));
    // A single option isn't a choice — show it as a static readout, not a lone button.
    if (items.length === 1) {
      wrap.appendChild(el("span", "mvr-segstatic", items[0].label));
      return wrap;
    }
    var group = el("div", "mvr-segbtns");
    items.forEach(function (it) {
      var b = el("button", "mvr-segbtn", it.label);
      b.type = "button";
      b.setAttribute("data-id", it.id);
      b.addEventListener("click", function () {
        onPick(it.id);
        var all = group.querySelectorAll(".mvr-segbtn");
        for (var i = 0; i < all.length; i++) {
          var on = all[i].getAttribute("data-id") === getActive();
          all[i].classList.toggle("is-active", on);
          all[i].setAttribute("aria-pressed", on ? "true" : "false");
        }
      });
      group.appendChild(b);
    });
    wrap.appendChild(group);
    // initial active state
    var all = group.querySelectorAll(".mvr-segbtn");
    for (var i = 0; i < all.length; i++) {
      var on = all[i].getAttribute("data-id") === getActive();
      all[i].classList.toggle("is-active", on);
      all[i].setAttribute("aria-pressed", on ? "true" : "false");
    }
    return wrap;
  }
  function quickBtn(text, fn) {
    var b = el("button", "mvr-quickbtn", text);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }
  function strong(t) { var e = document.createElement("b"); e.textContent = t; return e; }
  function sep() { var e = el("span", "mvr-sep", "·"); return e; }

  function ringLabel(plotted, higherBetter) {
    // Reference viz_radar: non-inverted skips r=0; inverted shows "≥1" at r=0 and reverses others.
    if (plotted === 0) return higherBetter ? null : "≥1";
    return (higherBetter ? plotted : 1 - plotted).toFixed(1);
  }
  function fmtPct(v) {
    if (v == null) return "n/a";
    return (v * 100).toFixed(1) + "%";
  }
  function fmtXY(p) { return p[0].toFixed(1) + " " + p[1].toFixed(1); }
  function radarPath(verts) {
    // Closed polygon when every spoke is defined; otherwise open runs of consecutive defined
    // vertices (cyclic), breaking at each missing spoke so a gap is never bridged by a chord.
    var N = verts.length, i, complete = true;
    for (i = 0; i < N; i++) if (!verts[i]) { complete = false; break; }
    if (complete) {
      var d = "M" + fmtXY(verts[0]);
      for (i = 1; i < N; i++) d += "L" + fmtXY(verts[i]);
      return d + "Z";
    }
    var start = 0;
    while (start < N && verts[start]) start++;          // first missing spoke (exists: not complete)
    var path = "", pen = false;
    for (var k = 1; k <= N; k++) {                        // walk the cycle starting after the gap
      var p = verts[(start + k) % N];
      if (!p) { pen = false; continue; }
      path += (pen ? "L" : "M") + fmtXY(p);
      pen = true;
    }
    return path;
  }
})();
