/* MedVision interactive detection metrics vs box-to-image ratio (aggregate curves).
 *
 * Reads window.MEDVISION_BOXRATIO (emitted by script/visualization/export_boxratio_data.py) and
 * renders one chart per <div class="mv-boxratio" data-task="Detection"> mount. The interactive
 * twin of metrics_boxImgRatio-dotline.pdf: one line per model over the ratio bins, with the
 * sample size behind each bin on a shared x axis beneath.
 *
 * It answers the same question as the box-size explorer above it, one level up: that widget asks
 * how size interacts with each clinical target, this one collapses the targets and shows the trend
 * itself — and adds the random-box control the per-target view has no room for.
 *
 * Faithful to viz_detection_performance_per_boxImgRatio.py: a point sits at its bin MIDPOINT, x
 * spans 0-0.5, y spans -0.05..1.05, the grid is dashed, colour AND marker identify the model
 * (tab10, darkened past the first cycle), and the "Random" baseline keeps its own treatment —
 * black, star, dashed. The figure's fourth subplot, a log bar chart of samples per bin, becomes a
 * strip under the curves instead of a detached panel, so a bin's reliability is read off the same
 * x position as the point it explains.
 *
 * Marker glyphs come from static/js/marker-glyphs.js, which must load first; filled here, matching
 * plot()'s default in the figure.
 *
 * No other dependencies. No-op if no .mv-boxratio mount is present (safe to load on every page).
 */
(function () {
  "use strict";

  var SVGNS = "http://www.w3.org/2000/svg";
  var MARKERS = window.MedVisionMarkers;   // static/js/marker-glyphs.js — must load first

  // Geometry (SVG user units == CSS px).
  var PAD_L = 56, PAD_R = 24, PAD_T = 12;
  var H_PLOT = 320, GAP = 34, H_BARS = 92, X_LAB = 30, X_TITLE = 26;
  var MIN_W = 520;
  var Y_PAD = 0.05;                         // matplotlib ylim(-0.05, 1.05)
  var RINGS = [0, 0.2, 0.4, 0.6, 0.8, 1.0];
  var X_STEP = 0.05;                        // figure: xticks every 0.05
  var R_MODEL = 4.4, R_BASE = 6, HIT_R = 9;
  var C_GRID = "rgba(15,23,42,.16)";

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
  function fmtPct(v) { return v == null ? "n/a" : (v * 100).toFixed(1) + "%"; }
  function fmtInt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

  function initBoxratio(mount, DATA) {
    var MODELS = DATA.models;                 // [{name,color,marker,baseline}] — config order
    var METRICS = DATA.metrics;
    var BINS = DATA.bins;                     // [{name,label,mid,n}]

    var defMetric = (METRICS.filter(function (m) { return m.default; })[0] || METRICS[0]).key;
    // Every series on by default — this is the figure's own view, and a line chart carries 19
    // series far better than the per-target scatter above it can.
    var state = { metric: defMetric, emphasis: null, model: {} };
    MODELS.forEach(function (m) { state.model[m.name] = true; });

    function metricDef() { return METRICS.filter(function (m) { return m.key === state.metric; })[0]; }
    function activeModels() { return MODELS.filter(function (m) { return state.model[m.name]; }); }

    // ── shell ────────────────────────────────────────────────────────────────
    mount.innerHTML = "";
    mount.setAttribute("role", "group");
    mount.setAttribute("aria-label", "Detection performance versus box-to-image ratio");

    var head = el("div", "mvb-head");
    var eyebrow = el("div", "mvb-eyebrow");
    eyebrow.appendChild(el("span", "mvb-dot"));
    eyebrow.appendChild(el("span", null, "SIZE RESPONSE CURVES"));
    var crumb = el("div", "mvb-crumb");
    head.appendChild(eyebrow);
    head.appendChild(crumb);
    mount.appendChild(head);

    var controls = el("div", "mvb-controls");
    controls.appendChild(segmented("Metric", METRICS.map(function (m) {
      return { id: m.key, label: m.label + " ↑" };
    }), function () { return state.metric; }, function (id) { state.metric = id; redraw(); }));
    mount.appendChild(controls);

    var stage = el("div", "mvb-stage");
    var svgHolder = el("div", "mvb-svgwrap");
    stage.appendChild(svgHolder);
    mount.appendChild(stage);

    var legend = el("div", "mvb-legend");
    legend.appendChild(legendTitle("Models", [
      quickBtn("All", function () { setAll(true); }),
      quickBtn("None", function () { setAll(false); }),
      quickBtn("Only " + MODELS[0].name.replace(/\s*\(.*/, "") + " + baseline", function () { onlyFirst(); })
    ]));
    var chips = el("div", "mvb-chips");
    var chipByModel = {};
    MODELS.forEach(function (m) {
      var chip = el("button", "mvb-chip");
      chip.type = "button";
      // One filled glyph in the model's own colour carries both encodings the figure uses.
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
    // The baseline is what makes a single curve readable, so "Only" keeps it.
    function onlyFirst() {
      MODELS.forEach(function (m, i) {
        var on = i === 0 || m.baseline;
        state.model[m.name] = on;
        syncChip(chipByModel[m.name], on);
      });
      redraw();
    }
    function setEmphasis(name) {
      state.emphasis = name;
      var nodes = svgHolder.querySelectorAll(".mvb-series");
      for (var i = 0; i < nodes.length; i++) {
        var on = name == null || nodes[i].getAttribute("data-model") === name;
        nodes[i].style.opacity = on ? "" : "0.10";
      }
    }
    MODELS.forEach(function (m) { syncChip(chipByModel[m.name], true); });

    // ── drawing ──────────────────────────────────────────────────────────────
    function redraw() {
      var md = metricDef(), models = activeModels();

      crumb.innerHTML = "";
      crumb.appendChild(document.createTextNode("metric="));
      crumb.appendChild(strong(md.label));
      crumb.appendChild(sep());
      crumb.appendChild(strong(models.length + "/" + MODELS.length));
      crumb.appendChild(document.createTextNode(" series"));
      crumb.appendChild(sep());
      crumb.appendChild(strong(String(BINS.length)));
      crumb.appendChild(document.createTextNode(" ratio bins"));

      drawChart(md, models);
      setEmphasis(state.emphasis);
    }

    function drawChart(md, models) {
      var W = Math.max(MIN_W, svgHolder.clientWidth || mount.clientWidth || 900);
      var plotW = W - PAD_L - PAD_R;
      // The figure fixes x at 0-0.5, which is where the data ends today. Take the wider of that
      // and the data's own reach, so a future bin past 50% is never silently clipped.
      var lastMid = BINS[BINS.length - 1].mid;
      var xMax = Math.max(0.5, Math.ceil((lastMid + 0.025) / X_STEP) * X_STEP);

      var yTopA = PAD_T, yBotA = PAD_T + H_PLOT;
      var yTopB = yBotA + GAP, yBotB = yTopB + H_BARS;
      var H = yBotB + X_LAB + X_TITLE;

      function xAt(r) { return PAD_L + (r / xMax) * plotW; }
      function yAt(v) { return yBotA - ((v + Y_PAD) / (1 + 2 * Y_PAD)) * H_PLOT; }

      var root = svg("svg", {
        viewBox: "0 0 " + W + " " + H, width: W, height: H, class: "mvb-svg",
        role: "img",
        "aria-label": "Detection " + md.label + " versus box-to-image ratio, " +
          models.length + " series"
      });

      // ── grid: dashed, as in the figure ─────────────────────────────────────
      RINGS.forEach(function (v) {
        var y = yAt(v);
        root.appendChild(svg("line", {
          x1: PAD_L, y1: y, x2: W - PAD_R, y2: y, stroke: C_GRID,
          "stroke-width": 1, "stroke-dasharray": "4 4"
        }));
        var t = svg("text", { x: PAD_L - 9, y: y + 3.5, class: "mvb-axlab", "text-anchor": "end" });
        t.textContent = v.toFixed(1);
        root.appendChild(t);
      });
      for (var r = 0; r <= xMax + 1e-9; r += X_STEP) {
        var x = xAt(r);
        root.appendChild(svg("line", {
          x1: x, y1: yTopA, x2: x, y2: yBotA, stroke: C_GRID,
          "stroke-width": 1, "stroke-dasharray": "4 4"
        }));
      }
      root.appendChild(axisTitle(md.label, PAD_L - 36, (yTopA + yBotA) / 2));

      // ── one line + markers per model; the baseline keeps the figure's dashes ─
      models.forEach(function (m) {
        var series = DATA.values[m.name];
        if (!series) return;
        var g = svg("g", { class: "mvb-series", "data-model": m.name });
        var isBase = !!m.baseline;
        var r = isBase ? R_BASE : R_MODEL;

        // A null bin breaks the line rather than being bridged, the way matplotlib drops NaN.
        var d = "", pen = false, pts = [];
        BINS.forEach(function (b, i) {
          var cell = series[i];
          var v = cell ? cell[md.key] : null;
          if (v == null || isNaN(v)) { pen = false; return; }
          var p = [xAt(b.mid), yAt(Math.min(Math.max(v, 0), 1))];
          d += (pen ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1);
          pen = true;
          pts.push({ p: p, i: i, v: v, cell: cell });
        });
        if (d) {
          var line = svg("path", {
            d: d, fill: "none", stroke: m.color, "stroke-width": 2,
            "stroke-linejoin": "round", "stroke-linecap": "round"
          });
          if (isBase) line.setAttribute("stroke-dasharray", "7 5");
          g.appendChild(line);
        }
        pts.forEach(function (pt) {
          g.appendChild(MARKERS.node(m.marker, pt.p[0], pt.p[1], r, m.color, true));
          var hit = svg("circle", {
            cx: pt.p[0], cy: pt.p[1], r: HIT_R, fill: "transparent", class: "mvb-hit"
          });
          bindHover(hit, m, md, pt.i);
          g.appendChild(hit);
        });
        root.appendChild(g);
      });

      // ── sample size per bin (log), sharing the x axis ───────────────────────
      var maxN = 1;
      BINS.forEach(function (b) { maxN = Math.max(maxN, b.n); });
      var logTop = Math.log(maxN) / Math.LN10;
      function hOf(n) { return n <= 1 ? 0 : (Math.log(n) / Math.LN10 / logTop) * H_BARS; }

      for (var p = 1; Math.pow(10, p) <= maxN; p++) {
        var yg = yBotB - hOf(Math.pow(10, p));
        root.appendChild(svg("line", {
          x1: PAD_L, y1: yg, x2: W - PAD_R, y2: yg, stroke: C_GRID,
          "stroke-width": 1, "stroke-dasharray": "4 4"
        }));
        var gt = svg("text", { x: PAD_L - 9, y: yg + 3.5, class: "mvb-axlab", "text-anchor": "end" });
        gt.textContent = fmtInt(Math.pow(10, p));
        root.appendChild(gt);
      }
      root.appendChild(axisTitle("Samples", PAD_L - 36, (yTopB + yBotB) / 2));

      var bw = Math.max(6, (X_STEP / xMax) * plotW * 0.62);
      BINS.forEach(function (b, i) {
        var h = hOf(b.n), x0 = xAt(b.mid) - bw / 2;
        var rect = svg("rect", {
          x: x0, y: yBotB - h, width: bw, height: Math.max(1, h),
          fill: "#FEB05C", stroke: "#F37600", "stroke-width": 1.6, class: "mvb-bar"
        });
        bindBarHover(rect, i);
        root.appendChild(rect);
        var nt = svg("text", {
          x: xAt(b.mid), y: yBotB - h - 5, class: "mvb-barnum", "text-anchor": "middle"
        });
        nt.textContent = fmtInt(b.n);
        root.appendChild(nt);
      });
      root.appendChild(svg("line", {
        x1: PAD_L, y1: yBotB, x2: W - PAD_R, y2: yBotB, stroke: C_GRID, "stroke-width": 1.3
      }));

      // ── shared x axis ──────────────────────────────────────────────────────
      for (var r2 = 0; r2 <= xMax + 1e-9; r2 += X_STEP) {
        var xt = svg("text", {
          x: xAt(r2), y: yBotB + 17, class: "mvb-axlab", "text-anchor": "middle"
        });
        xt.textContent = r2.toFixed(2);
        root.appendChild(xt);
      }
      var xTitle = svg("text", {
        x: PAD_L + plotW / 2, y: yBotB + X_LAB + 16, class: "mvb-axtitle", "text-anchor": "middle"
      });
      xTitle.textContent = "Box-to-image area ratio";
      root.appendChild(xTitle);

      svgHolder.innerHTML = "";
      svgHolder.appendChild(root);
    }

    function axisTitle(text, x, y) {
      var t = svg("text", {
        x: x, y: y, class: "mvb-axtitle", "text-anchor": "middle",
        transform: "rotate(-90 " + x + " " + y + ")"
      });
      t.textContent = text;
      return t;
    }

    function bindHover(node, model, md, binIdx) {
      node.addEventListener("mouseenter", function (ev) {
        var cell = DATA.values[model.name][binIdx] || {};
        var b = BINS[binIdx];
        tip.innerHTML = "";
        var h = el("div", "mvb-tiphead");
        h.appendChild(MARKERS.swatch(model.marker, model.color, true));
        h.appendChild(el("span", null, model.name));
        tip.appendChild(h);
        var ratio = el("div", "mvb-tipratio");
        ratio.appendChild(el("span", null, "box/image " + b.label));
        tip.appendChild(ratio);
        tip.appendChild(el("div", "mvb-tipval", md.label + ": " + fmtPct(cell[md.key])));
        var others = METRICS.filter(function (m) { return m.key !== md.key; })
          .map(function (m) { return m.label + " " + fmtPct(cell[m.key]); }).join("  ·  ");
        tip.appendChild(el("div", "mvb-tipsub", others));
        var foot = "n=" + fmtInt(b.n);
        if (cell.SR != null) foot += "  ·  SR " + fmtPct(cell.SR);
        tip.appendChild(el("div", "mvb-tipsub", foot));
        tip.style.display = "block";
        moveTip(ev);
      });
      node.addEventListener("mousemove", moveTip);
      node.addEventListener("mouseleave", function () { tip.style.display = "none"; });
    }

    function bindBarHover(node, binIdx) {
      node.addEventListener("mouseenter", function (ev) {
        var b = BINS[binIdx];
        tip.innerHTML = "";
        tip.appendChild(el("div", "mvb-tipratio", "box/image " + b.label));
        tip.appendChild(el("div", "mvb-tipval", fmtInt(b.n) + " samples"));
        tip.appendChild(el("div", "mvb-tipsub", b.name));
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

  // ── small builders (same design as the box-size explorer above) ────────────
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
    var mounts = document.querySelectorAll(".mv-boxratio");
    if (!mounts.length) return;
    var DATA = window.MEDVISION_BOXRATIO;
    for (var i = 0; i < mounts.length; i++) {
      if (!DATA || !DATA.models || !DATA.bins) {
        mounts[i].innerHTML = '<p class="mvb-empty">Box-ratio data failed to load.</p>';
      } else {
        initBoxratio(mounts[i], DATA);
      }
    }
  });
})();
