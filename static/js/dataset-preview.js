/* MedVision Dataset Preview — the anatomical coverage plate.
 *
 * Reads window.MEDVISION_EXPLORER (the same blob the Dataset Explorer uses; nothing here is
 * generated separately) and draws every body part MedVision covers against the anatomy labels it
 * contains, joined by leader lines. The panel reads in both directions:
 *
 *   pick a dataset   -> the body parts and anatomy labels it annotates light up (indigo)
 *   point at a row   -> the datasets carrying that body part or anatomy label light up (amber)
 *
 * Colour names the interaction rather than the direction, and each hue owns both ends of its own
 * relation: amber is everything the pointer touches, indigo everything the choice touches. A
 * selection and a probe can therefore be on screen at once without either being misread.
 *
 * Why leader lines and not a Sankey: `body_parts` is a PARTITION — each of the anatomy labels
 * belongs to exactly one body part — so the graph is a tree and the lines provably never cross.
 * They also carry no weight, because set membership has none; a ribbon whose thickness meant
 * nothing would be inventing a quantity the data does not have.
 *
 * The labels are real DOM (selectable, wrappable, reachable by find-in-page) and the connectors are
 * one SVG overlay measured FROM that DOM after layout, so text and lines can never disagree about
 * where a row is. No external dependencies. No-op if the #mv-preview mount is absent.
 */
(function () {
  "use strict";

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  ready(function () {
    var mount = document.getElementById("mv-preview");
    if (!mount) return;

    var DATA = window.MEDVISION_EXPLORER;
    if (!DATA || !Array.isArray(DATA.configs)) {
      mount.innerHTML = '<p class="mvp-empty">Preview data failed to load.</p>';
      return;
    }

    var SVG_NS = "http://www.w3.org/2000/svg";
    var BODY_PARTS = DATA.body_parts || {};
    var RELEASE = DATA.release_version;
    var DS_REPO_URL = "https://huggingface.co/datasets/YongchengYAO/MedVision";

    var reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

    // ── indices ───────────────────────────────────────────────────────────────
    // dataset -> labels it annotates; label -> datasets; and the label's owning body part.
    var COVER = {};        // dataset -> { label: true }
    var LABEL_DS = {};     // label   -> { dataset: true }
    var PART_OF = {};      // label   -> body part

    Object.keys(BODY_PARTS).forEach(function (part) {
      (BODY_PARTS[part] || []).forEach(function (label) { PART_OF[label] = part; });
    });

    DATA.configs.forEach(function (c) {
      var ds = c.dataset;
      COVER[ds] = COVER[ds] || {};
      (c.anatomy_groups || []).forEach(function (label) {
        COVER[ds][label] = true;
        (LABEL_DS[label] = LABEL_DS[label] || {})[ds] = true;
      });
    });

    function byName(a, b) {
      var x = a.toLowerCase(), y = b.toLowerCase();
      return x < y ? -1 : (x > y ? 1 : 0);
    }

    var DATASETS = Object.keys(COVER).sort(byName);
    var PARTS = Object.keys(BODY_PARTS);
    var N_LABELS = PARTS.reduce(function (n, p) { return n + (BODY_PARTS[p] || []).length; }, 0);

    // The reverse lookup, and the single source of every dataset count on the plate: the number
    // printed beside a row is the length of this list, so it can never disagree with the number of
    // chips that light when you point at that row.
    function datasetsFor(kind, key) {
      var labels = kind === "part" ? (BODY_PARTS[key] || []) : [key];
      var set = {};
      labels.forEach(function (l) {
        Object.keys(LABEL_DS[l] || {}).forEach(function (ds) { set[ds] = true; });
      });
      return Object.keys(set).sort(byName);
    }

    // Body parts a dataset touches, derived from its labels — never stored separately, so the
    // highlighted part can never contradict the highlighted labels under it.
    function partsOf(ds) {
      var set = {};
      Object.keys(COVER[ds] || {}).forEach(function (label) {
        if (PART_OF[label]) set[PART_OF[label]] = true;
      });
      return Object.keys(set);
    }

    // dataset: the committed choice (click). probe: the transient one (hover / keyboard focus).
    // They are independent — you can point at a row a selected dataset does not carry.
    var state = { dataset: null, probe: null };

    // ── DOM helpers ───────────────────────────────────────────────────────────
    function el(tag, cls, text) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      return e;
    }

    // Shared verbatim with explorer.js / version-control.js (no bundler here, and each panel file
    // is self-contained): this panel is rendered from medvision_ds data too, so it states the
    // release that produced it rather than leaving it implicit.
    function provenanceChip() {
      var a = el("a", "mv-provenance");
      a.href = DS_REPO_URL;
      a.target = "_blank";
      a.rel = "noopener";
      a.title = "Built from the medvision_ds dataset codebase at Release-v" + RELEASE
              + " — opens the Hugging Face dataset repo.";
      a.appendChild(el("span", "mv-provenance-src", "medvision_ds"));
      a.appendChild(el("span", "mv-provenance-ver", "Release-v" + RELEASE));
      return a;
    }

    function plural(n, word) { return n + " " + word + (n === 1 ? "" : "s"); }

    // ── build (once) ──────────────────────────────────────────────────────────
    var readout = el("div", "mvp-readout");

    var head = el("div", "mvp-head");
    var eyebrow = el("div", "mvp-eyebrow");
    eyebrow.appendChild(el("span", "mvp-dot"));
    eyebrow.appendChild(el("span", null, "DATASET PREVIEW"));
    head.appendChild(eyebrow);
    head.appendChild(provenanceChip());
    head.appendChild(readout);
    mount.appendChild(head);

    // Dataset panel. Deliberately unnumbered: the explorer below numbers its steps because they
    // are a sequence, and this is a single choice.
    var panel = el("div", "mvp-panel");
    var panelLabel = el("div", "mvp-panel-label");
    panelLabel.appendChild(el("span", null, "Dataset"));
    panelLabel.appendChild(el("span", "mvp-hint", "one at a time"));
    panel.appendChild(panelLabel);

    var chips = el("div", "mvp-chips");
    var chipFor = {};

    var allChip = el("button", "mvp-chip is-all is-active");
    allChip.type = "button";
    allChip.appendChild(el("span", null, "All datasets"));
    allChip.appendChild(el("span", "mvp-chip-n", String(DATASETS.length)));
    allChip.onclick = function () { select(null); };
    chips.appendChild(allChip);

    DATASETS.forEach(function (ds) {
      var chip = el("button", "mvp-chip");
      chip.type = "button";
      chip.appendChild(el("span", null, ds));
      chip.appendChild(el("span", "mvp-chip-n", String(Object.keys(COVER[ds]).length)));
      chip.title = ds + " annotates " + plural(Object.keys(COVER[ds]).length, "anatomy label");
      chip.onclick = function () { select(state.dataset === ds ? null : ds); };
      chipFor[ds] = chip;
      chips.appendChild(chip);
    });
    panel.appendChild(chips);
    mount.appendChild(panel);

    // The plate: body parts | leader-line channel | anatomy labels.
    var plate = el("div", "mvp-plate");
    plate.setAttribute("role", "group");
    plate.setAttribute("aria-label",
      "Anatomical coverage: " + PARTS.length + " body parts and the " + N_LABELS +
      " anatomy labels they contain");

    var colHeadL = el("div", "mvp-colhead is-left", "Body part");
    var colHeadR = el("div", "mvp-colhead is-right", "Anatomy label");
    colHeadL.style.gridArea = "1 / 1";
    colHeadR.style.gridArea = "1 / 3";
    plate.appendChild(colHeadL);
    plate.appendChild(colHeadR);

    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "mvp-wires");
    svg.setAttribute("aria-hidden", "true");           // decorative: the DOM already carries the grouping
    svg.setAttribute("preserveAspectRatio", "none");
    plate.appendChild(svg);

    // SVG has no z-index, so paint order is document order. Three groups, one per state, means a
    // wire is layered by living in the right group — no re-sorting on every pointer move, and a
    // wire only ever moves when its appearance was changing anyway.
    function group() {
      var g = document.createElementNS(SVG_NS, "g");
      svg.appendChild(g);
      return g;
    }
    var gRest = group();      // untouched by the current selection
    var gOn = group();        // covered by the selected dataset
    var gProbe = group();     // under the pointer / keyboard focus

    var partNodes = {};    // part  -> the dot element
    var labelNodes = {};   // label -> the dot element
    var partCells = {};
    var labelCells = {};
    var wires = [];        // { path, part, label }

    // Flat per-column lists, in visual order, so the arrow keys can mirror the plate's geometry.
    var NAV = { part: [], label: [] };   // [{ cell, key, sib }] — sib indexes the other column

    var row = 2;           // row 1 is the column headers
    PARTS.forEach(function (part) {
      var labels = BODY_PARTS[part] || [];
      if (!labels.length) return;

      var partIdx = NAV.part.length;
      var firstLabelIdx = NAV.label.length;

      var cell = el("div", "mvp-part");
      cell.style.gridArea = row + " / 1 / span " + labels.length + " / 2";
      var name = el("span", "mvp-name", part);
      cell.appendChild(name);
      cell.appendChild(el("span", "mvp-n", String(datasetsFor("part", part).length)));
      var pdot = el("span", "mvp-dot-node");
      cell.appendChild(pdot);
      partNodes[part] = pdot;
      partCells[part] = cell;
      attachProbe(cell, "part", part, partIdx, firstLabelIdx);
      plate.appendChild(cell);

      labels.forEach(function (label, i) {
        var lc = el("div", "mvp-label");
        lc.style.gridArea = (row + i) + " / 3 / span 1 / 4";
        var ldot = el("span", "mvp-dot-node");
        lc.appendChild(ldot);
        lc.appendChild(el("span", "mvp-name", label));
        lc.appendChild(el("span", "mvp-n", String(datasetsFor("label", label).length)));
        labelNodes[label] = ldot;
        labelCells[label] = lc;
        attachProbe(lc, "label", label, NAV.label.length, partIdx);
        plate.appendChild(lc);

        var path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("class", "mvp-wire");
        gRest.appendChild(path);
        wires.push({ path: path, part: part, label: label });
      });
      row += labels.length;
    });

    // grid-template-rows must be explicit: the body-part cells span their labels' rows, and a
    // spanning item cannot define the implicit rows it spans.
    plate.style.gridTemplateRows = "auto repeat(" + N_LABELS + ", var(--mvp-row))";
    mount.appendChild(plate);

    var foot = el("div", "mvp-foot");
    function footRow(k, text) {
      var r = el("div", "mvp-foot-row");
      r.appendChild(el("span", "mvp-foot-k", k));
      r.appendChild(el("span", null, text));
      foot.appendChild(r);
    }
    footRow("Counts",
      "datasets carrying that body part or anatomy label. Every label belongs to exactly one " +
      "body part, so the leader lines never cross.");
    footRow("Point",
      "hover a row — or tab into the plate and use the arrow keys — to light the datasets that carry it.");
    mount.appendChild(foot);

    // ── pointing ──────────────────────────────────────────────────────────────
    // Every row is a probe: it reads the relation backwards, from anatomy to the datasets that
    // carry it. Hover covers the mouse, focus covers keyboard and touch, and both go through the
    // same one-line entry point so the two can never drift apart.
    function attachProbe(cell, kind, key, idx, sib) {
      var n = datasetsFor(kind, key).length;
      cell.setAttribute("aria-label", key + ", " + plural(n, "dataset"));
      cell.tabIndex = -1;
      NAV[kind].push({ cell: cell, key: key, sib: sib });

      cell.addEventListener("mouseenter", function () { probe(kind, key); });
      cell.addEventListener("mouseleave", function () { probe(null); });
      cell.addEventListener("focus", function () { setRover(cell); probe(kind, key); });
      cell.addEventListener("blur", function () { probe(null); });
      cell.addEventListener("keydown", navKey(kind, idx));
    }

    var rover = null;
    function setRover(cell) {
      if (rover === cell) return;
      if (rover) rover.tabIndex = -1;
      rover = cell;
      rover.tabIndex = 0;
    }

    function focusAt(kind, idx) {
      var list = NAV[kind];
      if (!list.length) return;
      var e = list[Math.max(0, Math.min(idx, list.length - 1))];
      setRover(e.cell);
      e.cell.focus();
    }

    // One tab stop for the whole plate: 51 of them between the reader and the explorer below would
    // be a worse page than no keyboard support at all. Up/down walks a column, left/right crosses
    // the leader-line channel to the row's partner — the same move the eye makes.
    function navKey(kind, idx) {
      return function (e) {
        var handled = true;
        if (e.key === "ArrowDown") focusAt(kind, idx + 1);
        else if (e.key === "ArrowUp") focusAt(kind, idx - 1);
        else if (e.key === "Home") focusAt(kind, 0);
        else if (e.key === "End") focusAt(kind, NAV[kind].length - 1);
        else if (e.key === "ArrowRight" && kind === "part") focusAt("label", NAV.part[idx].sib);
        else if (e.key === "ArrowLeft" && kind === "label") focusAt("part", NAV.label[idx].sib);
        else if (e.key === "Escape") { NAV[kind][idx].cell.blur(); }
        else handled = false;
        if (handled) e.preventDefault();
      };
    }

    function probe(kind, key) {
      var p = kind ? { kind: kind, key: key } : null;
      var was = state.probe;
      if (!p && !was) return;
      if (p && was && was.kind === p.kind && was.key === p.key) return;
      state.probe = p;
      paint();
    }

    // ── geometry ──────────────────────────────────────────────────────────────
    // Paths are measured from the rendered DOM rather than computed from the row height, so a
    // wrapped label or a re-flowed font moves the line with the text it points at.
    function drawWires() {
      var box = plate.getBoundingClientRect();
      if (!box.width) return;
      svg.setAttribute("viewBox", "0 0 " + box.width + " " + box.height);
      svg.setAttribute("width", box.width);
      svg.setAttribute("height", box.height);

      function centre(node) {
        var r = node.getBoundingClientRect();
        return { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2 };
      }

      // Asymmetric control points, on purpose. A symmetric S-curve leaves the body-part node
      // almost horizontally, so the 14 abdominal lines stay bunched and read as a dark wedge at
      // the node. Pulling the first handle in (.22) lets them diverge at once, and pushing the
      // second one out (.62) flattens the approach to the label — a plate's leader lines radiate
      // from the structure and run level into the text.
      wires.forEach(function (w) {
        var a = centre(partNodes[w.part]);
        var b = centre(labelNodes[w.label]);
        var d = b.x - a.x;
        w.path.setAttribute("d",
          "M " + a.x.toFixed(1) + " " + a.y.toFixed(1) +
          " C " + (a.x + d * 0.22).toFixed(1) + " " + a.y.toFixed(1) +
          ", " + (b.x - d * 0.62).toFixed(1) + " " + b.y.toFixed(1) +
          ", " + b.x.toFixed(1) + " " + b.y.toFixed(1));
      });
    }

    // ── selection ─────────────────────────────────────────────────────────────
    function select(ds) {
      state.dataset = ds;
      paint();
      if (!ds || reduceMotion) return;
      var lit = [];
      wires.forEach(function (w) { if (w.path.parentNode === gOn) lit.push(w.path); });
      drawIn(lit);
    }

    // One pass writes every class from state, so the committed selection and the transient probe
    // can never leave a stale mark on each other.
    function paint() {
      var ds = state.dataset;
      var pr = state.probe;

      var covered = ds ? COVER[ds] : null;
      var coveredParts = {};
      if (ds) partsOf(ds).forEach(function (p) { coveredParts[p] = true; });

      var hit = {};    // datasets the probe matches
      var kin = {};    // labels sitting under a probed body part
      if (pr) {
        datasetsFor(pr.kind, pr.key).forEach(function (d) { hit[d] = true; });
        if (pr.kind === "part") (BODY_PARTS[pr.key] || []).forEach(function (l) { kin[l] = true; });
      }

      allChip.className = "mvp-chip is-all" + (ds ? "" : " is-active");
      allChip.setAttribute("aria-pressed", ds ? "false" : "true");
      DATASETS.forEach(function (name) {
        var c = "mvp-chip";
        if (name === ds) c += " is-active";
        if (pr) c += hit[name] ? " is-match" : " is-miss";
        chipFor[name].className = c;
        chipFor[name].setAttribute("aria-pressed", name === ds ? "true" : "false");
      });

      function mark(cell, base, on, probed, isKin) {
        var c = base;
        if (ds) c += on ? " is-on" : " is-off";
        if (probed) c += " is-probe";
        else if (isKin) c += " is-probe-kin";
        cell.className = c;
      }
      PARTS.forEach(function (p) {
        if (!partCells[p]) return;
        mark(partCells[p], "mvp-part", !!coveredParts[p],
             !!(pr && pr.kind === "part" && pr.key === p), false);
      });
      Object.keys(labelCells).forEach(function (l) {
        mark(labelCells[l], "mvp-label", !!(covered && covered[l]),
             !!(pr && pr.kind === "label" && pr.key === l), !!kin[l]);
      });

      wires.forEach(function (w) {
        var on = !!(covered && covered[w.label]);
        var probed = !!(pr && (pr.kind === "part" ? pr.key === w.part : pr.key === w.label));
        w.path.setAttribute("class",
          "mvp-wire" + (ds ? (on ? " is-on" : " is-off") : "") + (probed ? " is-probe" : ""));
        var g = probed ? gProbe : (on ? gOn : gRest);
        if (w.path.parentNode !== g) g.appendChild(w.path);
      });

      renderReadout(ds, pr, covered, coveredParts);
    }

    // The readout is the answer channel: the header is sticky, so this line stays legible however
    // far down the plate you have pointed, when the chips themselves have scrolled away.
    function renderReadout(ds, pr, covered, coveredParts) {
      readout.innerHTML = "";
      if (pr) {
        var found = datasetsFor(pr.kind, pr.key);
        readout.appendChild(el("b", "is-probe", pr.key));
        readout.appendChild(el("span", "sep", "›"));
        readout.appendChild(el("span", "mvp-hit", plural(found.length, "dataset")));
        if (found.length) {
          readout.appendChild(el("span", "sep", "·"));
          // Three names, then a count. A fixed budget keeps the line from jumping width as the
          // pointer moves; the chips above carry the full list.
          var shown = found.slice(0, 3).join(", ");
          if (found.length > 3) shown += " +" + (found.length - 3);
          readout.appendChild(el("span", "mvp-names", shown));
        }
        return;
      }
      if (!ds) {
        readout.appendChild(el("b", null, String(DATASETS.length) + " datasets"));
        readout.appendChild(el("span", "sep", "›"));
        readout.appendChild(el("span", null, plural(PARTS.length, "body part")));
        readout.appendChild(el("span", "sep", "·"));
        readout.appendChild(el("span", null, plural(N_LABELS, "label")));
      } else {
        readout.appendChild(el("b", null, ds));
        readout.appendChild(el("span", "sep", "›"));
        readout.appendChild(el("span", null, plural(Object.keys(coveredParts).length, "body part")));
        readout.appendChild(el("span", "sep", "·"));
        readout.appendChild(el("span", null, plural(Object.keys(covered).length, "label")));
      }
    }

    // The one orchestrated moment: the leader lines to the chosen dataset draw outward from the
    // body part, in the reading order of the plate. Pointing gets no such reveal — a hover has to
    // answer instantly, and a staggered one would feel like lag.
    function drawIn(paths) {
      paths.forEach(function (p, i) {
        var len;
        try { len = p.getTotalLength(); } catch (e) { return; }
        if (!len) return;
        p.style.transition = "none";
        p.style.strokeDasharray = len;
        p.style.strokeDashoffset = len;
        /* jshint -W030 */
        p.getBoundingClientRect();          // flush, so the transition below has a start value
        p.style.transition = "stroke-dashoffset .42s cubic-bezier(.22,.61,.36,1) " +
                             Math.min(i * 16, 260) + "ms";
        p.style.strokeDashoffset = 0;
      });
    }

    if (NAV.part.length) setRover(NAV.part[0].cell);
    paint();
    drawWires();

    // Re-measure whenever the plate can have moved: fonts arriving, container resize, or the
    // scroll-reveal transition finishing (the section starts translated 18px down).
    if (window.ResizeObserver) new window.ResizeObserver(drawWires).observe(plate);
    else window.addEventListener("resize", drawWires);
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(drawWires);
    }
    window.addEventListener("load", drawWires);
  });
})();
