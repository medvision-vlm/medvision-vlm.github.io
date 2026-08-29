/* MedVision interactive detection metrics vs box-to-image ratio.
 *
 * Reads window.MEDVISION_BOXSIZE (emitted by script/visualization/export_boxsize_data.py) and
 * renders one explorer per <div class="mv-boxsize" data-task="Detection"> mount. The interactive
 * twin of fig_detection__metrics-boxSize__*.pdf: a scatter panel of the selected metric plus the
 * stacked sample-size panel beneath it, sharing one clinical-target x axis.
 *
 * Encoding is the figure's, unchanged: COLOUR is the box-to-image ratio band (tab10, in band
 * order) and SHAPE is the model. So the model panel's chips carry the marker glyph, and the ratio
 * chips carry the colour swatch — the figure's two legends, made clickable.
 *
 * Faithful to viz_detection_sampleSize_per_label_x_boxSize.py: targets ordered by total sample
 * size (descending) and kept only at >= minLabelSamples; a marker is drawn only where the cell has
 * >= minCellSamples samples; alternate target columns are banded grey; tumor/lesion targets are
 * written in #770087. One deliberate departure: within a target the ratio bands are dodged across
 * the column instead of sharing one x. The figure lets them collide — at 22x26 inches that is
 * legible; in a browser the dodge is what makes a band's trend readable and each point hoverable.
 *
 * Marker glyphs come from static/js/marker-glyphs.js, which must load first; hollow here, since
 * colour is the ratio band and only the shape identifies the model.
 *
 * No other dependencies. No-op if no .mv-boxsize mount is present (safe to load on every page).
 */
(function () {
  "use strict";

  var SVGNS = "http://www.w3.org/2000/svg";
  var MARKERS = window.MedVisionMarkers;   // static/js/marker-glyphs.js — must load first

  // Geometry (SVG user units == CSS px; the stage scrolls horizontally when targets don't fit).
  var PAD_L = 52, PAD_R = 52, PAD_T = 12;
  var H_METRIC = 300, GAP = 30, H_BARS = 132, LABEL_GAP = 10;
  var MIN_STEP = 34;                       // per-target column width floor
  var Y_PAD = 0.05;                        // matplotlib ylim(-0.05, 1.05)
  var RINGS = [0, 0.2, 0.4, 0.6, 0.8, 1.0];
  var MARKER_R = 5.2, HIT_R = 9;
  var C_TUMOR = "#770087", C_INK = "#1f2430", C_GRID = "rgba(15,23,42,.16)";
  var LABEL_FONT = 10.5, LABEL_CHAR_W = 5.9;   // rotated x-tick extent estimate

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
  function fmtN(n) { return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : String(n); }

  function initBoxsize(mount, DATA) {
    var MODELS = DATA.models;                       // [{name, marker}] — config order
    var METRICS = DATA.metrics;                     // [{key,label,default}]
    var LEVELS = DATA.levels;                       // [{key,label,default,boxGroups,labels,values}]
    var MIN_N = DATA.minCellSamples;

    // ── state ────────────────────────────────────────────────────────────────
    var defMetric = (METRICS.filter(function (m) { return m.default; })[0] || METRICS[0]).key;
    var defLevel = 0;
    for (var li = 0; li < LEVELS.length; li++) if (LEVELS[li].default) defLevel = li;
    // Models start narrowed to the first entry (MedVision-V0). All 18 at once is 18 glyphs stacked
    // on every ratio band of every target — the same overplotting the PDF accepts at poster size,
    // which a browser column cannot carry. "All" is one click away in the panel.
    var state = {
      metric: defMetric, levelIdx: defLevel, emphasis: null,
      model: {}, band: {}
    };
    MODELS.forEach(function (m, i) { state.model[m.name] = i === 0; });

    function level() { return LEVELS[state.levelIdx]; }
    function metricDef() { return METRICS.filter(function (m) { return m.key === state.metric; })[0]; }
    function activeModels() { return MODELS.filter(function (m) { return state.model[m.name]; }); }
    function activeBands() {
      return level().boxGroups.map(function (g, i) { return i; })
        .filter(function (i) { return state.band[level().boxGroups[i].name] !== false; });
    }

    // ── shell ────────────────────────────────────────────────────────────────
    mount.innerHTML = "";
    mount.setAttribute("role", "group");
    mount.setAttribute("aria-label", "Detection performance by box-to-image ratio");

    var head = el("div", "mvb-head");
    var eyebrow = el("div", "mvb-eyebrow");
    eyebrow.appendChild(el("span", "mvb-dot"));
    eyebrow.appendChild(el("span", null, "OBJECT SIZE × TARGET"));
    var crumb = el("div", "mvb-crumb");
    head.appendChild(eyebrow);
    head.appendChild(crumb);
    mount.appendChild(head);

    var controls = el("div", "mvb-controls");
    controls.appendChild(segmented("Metric", METRICS.map(function (m) {
      return { id: m.key, label: m.label + " ↑" };
    }), function () { return state.metric; }, function (id) { state.metric = id; redraw(); }));
    controls.appendChild(segmented("Targets", LEVELS.map(function (lv, i) {
      return { id: String(i), label: lv.label };
    }), function () { return String(state.levelIdx); }, function (id) {
      state.levelIdx = +id;
      rebuildBands();
      redraw();
    }));
    mount.appendChild(controls);

    var stage = el("div", "mvb-stage");
    var svgHolder = el("div", "mvb-svgwrap");
    stage.appendChild(svgHolder);
    mount.appendChild(stage);

    // ratio legend — the figure's "Box-to-Image Ratio" legend, made clickable
    var bandLegend = el("div", "mvb-legend");
    bandLegend.appendChild(legendTitle("Box-to-image area ratio", [
      quickBtn("All", function () { setAllBands(true); }),
      quickBtn("None", function () { setAllBands(false); })
    ]));
    var bandChips = el("div", "mvb-chips");
    bandLegend.appendChild(bandChips);
    mount.appendChild(bandLegend);

    // model panel — the figure's "Models" legend; chips carry the marker glyph, not a colour
    var modelLegend = el("div", "mvb-legend");
    modelLegend.appendChild(legendTitle("Models", [
      quickBtn("All", function () { setAllModels(true); }),
      quickBtn("None", function () { setAllModels(false); }),
      quickBtn("Only " + MODELS[0].name.replace(/\s*\(.*/, ""), function () { onlyFirstModel(); })
    ]));
    var modelChips = el("div", "mvb-chips");
    var chipByModel = {};
    MODELS.forEach(function (m) {
      var chip = el("button", "mvb-chip");
      chip.type = "button";
      chip.appendChild(MARKERS.swatch(m.marker, C_INK, false));
      chip.appendChild(el("span", "mvb-chipname", m.name));
      chip.addEventListener("click", function () { toggleModel(m.name); });
      chip.addEventListener("mouseenter", function () { setEmphasis(m.name); });
      chip.addEventListener("mouseleave", function () { setEmphasis(null); });
      chip.addEventListener("focus", function () { setEmphasis(m.name); });
      chip.addEventListener("blur", function () { setEmphasis(null); });
      chipByModel[m.name] = chip;
      modelChips.appendChild(chip);
    });
    modelLegend.appendChild(modelChips);
    mount.appendChild(modelLegend);

    var tip = el("div", "mvb-tip");
    tip.style.display = "none";
    mount.appendChild(tip);

    // ── band chips (rebuilt when the level changes; band sets are identical today, but the
    //    blob does not promise that) ─────────────────────────────────────────
    var chipByBand = {};
    function rebuildBands() {
      bandChips.innerHTML = "";
      chipByBand = {};
      level().boxGroups.forEach(function (g) {
        if (state.band[g.name] === undefined) state.band[g.name] = true;
        var chip = el("button", "mvb-chip");
        chip.type = "button";
        var sw = el("span", "mvb-sw");
        sw.style.background = g.color;
        chip.appendChild(sw);
        chip.appendChild(el("span", "mvb-chipname", g.name));
        chip.addEventListener("click", function () { toggleBand(g.name); });
        chipByBand[g.name] = chip;
        bandChips.appendChild(chip);
        syncChip(chip, state.band[g.name]);
      });
    }

    function syncChip(chip, on) {
      chip.classList.toggle("is-active", !!on);
      chip.setAttribute("aria-pressed", on ? "true" : "false");
    }
    function toggleModel(name) {
      state.model[name] = !state.model[name];
      syncChip(chipByModel[name], state.model[name]);
      redraw();
    }
    function setAllModels(on) {
      MODELS.forEach(function (m) { state.model[m.name] = on; syncChip(chipByModel[m.name], on); });
      redraw();
    }
    function onlyFirstModel() {
      MODELS.forEach(function (m, i) {
        state.model[m.name] = i === 0;
        syncChip(chipByModel[m.name], i === 0);
      });
      redraw();
    }
    function toggleBand(name) {
      state.band[name] = !state.band[name];
      syncChip(chipByBand[name], state.band[name]);
      redraw();
    }
    function setAllBands(on) {
      level().boxGroups.forEach(function (g) { state.band[g.name] = on; syncChip(chipByBand[g.name], on); });
      redraw();
    }
    function setEmphasis(name) {
      state.emphasis = name;
      var nodes = svgHolder.querySelectorAll(".mvb-mark");
      for (var i = 0; i < nodes.length; i++) {
        var on = name == null || nodes[i].getAttribute("data-model") === name;
        nodes[i].style.opacity = on ? "" : "0.12";
      }
    }
    MODELS.forEach(function (m) { syncChip(chipByModel[m.name], state.model[m.name]); });
    rebuildBands();

    // ── drawing ──────────────────────────────────────────────────────────────
    function redraw() {
      var lv = level(), md = metricDef();
      var models = activeModels(), bands = activeBands();

      crumb.innerHTML = "";
      crumb.appendChild(document.createTextNode("metric="));
      crumb.appendChild(strong(md.label));
      crumb.appendChild(sep());
      crumb.appendChild(strong(String(lv.labels.length)));
      crumb.appendChild(document.createTextNode(" targets"));
      crumb.appendChild(sep());
      crumb.appendChild(strong(models.length + "/" + MODELS.length));
      crumb.appendChild(document.createTextNode(" models"));
      crumb.appendChild(sep());
      crumb.appendChild(strong(bands.length + "/" + lv.boxGroups.length));
      crumb.appendChild(document.createTextNode(" ratio bands"));

      drawChart(lv, md, models, bands);
      setEmphasis(state.emphasis);
    }

    function drawChart(lv, md, models, bands) {
      var labels = lv.labels, N = labels.length, G = lv.boxGroups.length;

      // width: fill the stage when the targets fit, else scroll at the column floor
      var avail = (svgHolder.clientWidth || mount.clientWidth || 900) - PAD_L - PAD_R;
      var step = Math.max(MIN_STEP, avail / N);
      var W = PAD_L + step * N + PAD_R;

      var longest = 0;
      labels.forEach(function (l) { longest = Math.max(longest, l.name.length); });
      var hLabels = Math.min(200, Math.round(longest * LABEL_CHAR_W) + 12);

      var yTopA = PAD_T, yBotA = PAD_T + H_METRIC;
      var yTopB = yBotA + GAP, yBotB = yTopB + H_BARS;
      var H = yBotB + LABEL_GAP + hLabels + 6;

      var root = svg("svg", {
        viewBox: "0 0 " + W + " " + H, width: W, height: H, class: "mvb-svg",
        role: "img",
        "aria-label": "Detection " + md.label + " by box-to-image ratio for " + N +
          " targets, " + models.length + " models"
      });

      function xCenter(i) { return PAD_L + step * (i + 0.5); }
      // Ratio bands are dodged over the middle of the column, by their FIXED band index, so a
      // point keeps its x when other bands are toggled off.
      function xDodge(bandIdx) {
        if (G < 2) return 0;
        return ((bandIdx - (G - 1) / 2) / (G - 1)) * step * 0.62;
      }
      function yMetric(v) {
        return yBotA - ((v + Y_PAD) / (1 + 2 * Y_PAD)) * H_METRIC;
      }

      var maxTotal = 0;
      labels.forEach(function (l) { maxTotal = Math.max(maxTotal, l.total); });
      var barTop = maxTotal * 1.1 || 1;
      function yBar(v) { return yBotB - (v / barTop) * H_BARS; }

      // alternating column bands (figure: axvspan on every other target)
      for (var i = 0; i < N; i += 2) {
        root.appendChild(svg("rect", {
          x: xCenter(i) - step / 2, y: yTopA, width: step, height: yBotB - yTopA,
          fill: "rgba(15,23,42,.045)"
        }));
      }

      // ── panel A: metric scatter ────────────────────────────────────────────
      RINGS.forEach(function (v) {
        var y = yMetric(v);
        root.appendChild(svg("line", {
          x1: PAD_L, y1: y, x2: W - PAD_R, y2: y, stroke: C_GRID,
          "stroke-width": v === 0 ? 1.3 : 1
        }));
        [PAD_L - 8, W - PAD_R + 8].forEach(function (x, k) {
          var t = svg("text", {
            x: x, y: y + 3.5, class: "mvb-axlab",
            "text-anchor": k === 0 ? "end" : "start"
          });
          t.textContent = v.toFixed(1);
          root.appendChild(t);
        });
      });
      root.appendChild(axisTitle(md.label, PAD_L - 34, (yTopA + yBotA) / 2));

      models.forEach(function (m) {
        var series = lv.values[m.name];
        if (!series) return;
        for (var i = 0; i < N; i++) {
          for (var b = 0; b < bands.length; b++) {
            var bi = bands[b];
            // The figure plots a point only where the cell carries enough samples to mean
            // anything; below that the metric is noise, so it is dropped rather than drawn faint.
            if (labels[i].sizes[bi] < MIN_N) continue;
            var cell = series[i] && series[i][bi];
            if (!cell) continue;
            var v = cell[md.key];
            if (v == null || isNaN(v)) continue;
            var cx = xCenter(i) + xDodge(bi), cy = yMetric(Math.min(Math.max(v, 0), 1));
            var color = lv.boxGroups[bi].color;
            var g = svg("g", { class: "mvb-mark", "data-model": m.name });
            g.appendChild(MARKERS.node(m.marker, cx, cy, MARKER_R, color, false));
            var hit = svg("circle", { cx: cx, cy: cy, r: HIT_R, fill: "transparent", class: "mvb-hit" });
            bindHover(hit, m, lv, md, i, bi);
            g.appendChild(hit);
            root.appendChild(g);
          }
        }
      });

      // ── panel B: stacked sample size ───────────────────────────────────────
      var barTicks = niceTicks(barTop);
      barTicks.forEach(function (v) {
        var y = yBar(v);
        root.appendChild(svg("line", {
          x1: PAD_L, y1: y, x2: W - PAD_R, y2: y, stroke: C_GRID, "stroke-width": 1
        }));
        [PAD_L - 8, W - PAD_R + 8].forEach(function (x, k) {
          var t = svg("text", {
            x: x, y: y + 3.5, class: "mvb-axlab",
            "text-anchor": k === 0 ? "end" : "start"
          });
          t.textContent = fmtN(v);
          root.appendChild(t);
        });
      });
      root.appendChild(axisTitle("Samples", PAD_L - 34, (yTopB + yBotB) / 2));

      var bw = step * 0.66;
      for (var i2 = 0; i2 < N; i2++) {
        var acc = 0;
        for (var b2 = 0; b2 < bands.length; b2++) {
          var bi2 = bands[b2];
          var n = labels[i2].sizes[bi2];
          if (!n) continue;
          var y0 = yBar(acc), y1 = yBar(acc + n);
          var rect = svg("rect", {
            x: xCenter(i2) - bw / 2, y: y1, width: bw, height: Math.max(0.6, y0 - y1),
            fill: lv.boxGroups[bi2].color, "fill-opacity": 0.8, class: "mvb-bar"
          });
          bindBarHover(rect, lv, i2, bi2);
          root.appendChild(rect);
          acc += n;
        }
      }

      // ── shared x axis: target names, rotated, tumor/lesion in purple ───────
      root.appendChild(svg("line", {
        x1: PAD_L, y1: yBotB, x2: W - PAD_R, y2: yBotB, stroke: C_GRID, "stroke-width": 1.3
      }));
      for (var i3 = 0; i3 < N; i3++) {
        var lb = labels[i3];
        var x = xCenter(i3), y = yBotB + LABEL_GAP;
        var t = svg("text", {
          x: x, y: y, class: "mvb-xlab", "text-anchor": "end",
          transform: "rotate(-90 " + x.toFixed(1) + " " + y.toFixed(1) + ")",
          fill: lb.purple ? C_TUMOR : C_INK,
          "font-weight": lb.purple ? 600 : 400,
          "font-size": LABEL_FONT
        });
        t.textContent = lb.name;
        var ttl = svg("title");
        ttl.textContent = lb.name + " — " + lb.total + " samples";
        t.appendChild(ttl);
        root.appendChild(t);
      }

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

    // ── tooltips ─────────────────────────────────────────────────────────────
    function bindHover(node, model, lv, md, labelIdx, bandIdx) {
      node.addEventListener("mouseenter", function (ev) {
        var cell = lv.values[model.name][labelIdx][bandIdx] || {};
        var lb = lv.labels[labelIdx], bg = lv.boxGroups[bandIdx];
        tip.innerHTML = "";
        var h = el("div", "mvb-tiphead");
        h.appendChild(MARKERS.swatch(model.marker, bg.color, false));
        h.appendChild(el("span", null, model.name));
        tip.appendChild(h);
        tip.appendChild(el("div", "mvb-tiptarget" + (lb.purple ? " is-tl" : ""), lb.name));
        var ratio = el("div", "mvb-tipratio");
        var sw = el("span", "mvb-tipsw"); sw.style.background = bg.color;
        ratio.appendChild(sw);
        ratio.appendChild(el("span", null, "box/image " + bg.name));
        tip.appendChild(ratio);
        tip.appendChild(el("div", "mvb-tipval", md.label + ": " + fmtPct(cell[md.key])));
        var others = METRICS.filter(function (m) { return m.key !== md.key; })
          .map(function (m) { return m.label + " " + fmtPct(cell[m.key]); }).join("  ·  ");
        tip.appendChild(el("div", "mvb-tipsub", others));
        tip.appendChild(el("div", "mvb-tipsub", "n=" + lb.sizes[bandIdx]));
        tip.style.display = "block";
        moveTip(ev);
      });
      node.addEventListener("mousemove", moveTip);
      node.addEventListener("mouseleave", function () { tip.style.display = "none"; });
    }

    function bindBarHover(node, lv, labelIdx, bandIdx) {
      node.addEventListener("mouseenter", function (ev) {
        var lb = lv.labels[labelIdx], bg = lv.boxGroups[bandIdx];
        tip.innerHTML = "";
        tip.appendChild(el("div", "mvb-tiptarget" + (lb.purple ? " is-tl" : ""), lb.name));
        var ratio = el("div", "mvb-tipratio");
        var sw = el("span", "mvb-tipsw"); sw.style.background = bg.color;
        ratio.appendChild(sw);
        ratio.appendChild(el("span", null, "box/image " + bg.name));
        tip.appendChild(ratio);
        tip.appendChild(el("div", "mvb-tipval", fmtN(lb.sizes[bandIdx]) + " samples"));
        tip.appendChild(el("div", "mvb-tipsub", fmtN(lb.total) + " across all ratios"));
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

    // Re-fit the column width when the stage resizes; the SVG is laid out in px, not scaled.
    var resizeTimer = null;
    window.addEventListener("resize", function () {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(redraw, 150);
    });

    redraw();
  }

  // ── small builders ────────────────────────────────────────────────────────
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
  function niceTicks(top) {
    var raw = top / 4;
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var step = [1, 2, 2.5, 5, 10].filter(function (s) { return s * mag >= raw; })[0] * mag;
    var out = [];
    for (var v = 0; v <= top + 1e-9; v += step) out.push(Math.round(v));
    return out;
  }

  // Bootstrap last. ready() runs its callback SYNCHRONOUSLY when the document is already parsed
  // (a deferred or end-of-body load), and initBoxsize reaches the marker tables below, which are
  // vars — hoisted but not yet assigned. Starting from the end of the module makes the widget
  // independent of when the file happens to be loaded.
  ready(function () {
    var mounts = document.querySelectorAll(".mv-boxsize");
    if (!mounts.length) return;
    var DATA = window.MEDVISION_BOXSIZE;
    for (var i = 0; i < mounts.length; i++) {
      if (!DATA || !DATA.models || !DATA.levels) {
        mounts[i].innerHTML = '<p class="mvb-empty">Box-size data failed to load.</p>';
      } else {
        initBoxsize(mounts[i], DATA);
      }
    }
  });
})();
