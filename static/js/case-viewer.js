/* ============================================================================
 * case-viewer.js — MedVision interactive case viewer
 * ----------------------------------------------------------------------------
 * One viewer per .case-viewer element (scoped to its data-task). Builds:
 *   - a model-selection panel (one button per model)
 *   - a compact arrow navigator (‹ NN / TOTAL ›)
 *   - a left text column: [Prompt] + [Response] (token-by-token); [Metrics]
 *     reveals only AFTER the Response finishes animating
 *   - a right figure viewport (axis-scaled GT-vs-prediction overlay)
 *
 * Reads window.MEDVISION_CASES (cases.js, loaded first). No external deps.
 * Schema (current): MEDVISION_CASES[task] = { "<model>": [case, ...], ... }
 * Back-compat: MEDVISION_CASES[task] may be a bare [case, ...] (single model).
 * Each case: { title, image, segments:[{label, html}], holdMs, parseFailed? }.
 * ==========================================================================*/

(function () {
  "use strict";

  var TASK_ORDER = [
    { key: "Detection", label: "Detection" },
    { key: "TL", label: "Tumor / Lesion Size" },
    { key: "AD", label: "Angle / Distance" },
    { key: "TL-Pilot", label: "Tumor / Lesion Size · Pilot" }
  ];

  // Landmark definitions for the AD task — used to render the reference panel.
  var AD_LANDMARKS = {
    "Ceph": {
      "P1": "sella", "P2": "nasion", "P3": "orbitale", "P4": "porion",
      "P5": "subspinale", "P6": "supramentale", "P7": "pogonion", "P8": "menton",
      "P9": "gnathion", "P10": "gonion", "P11": "incision inferius",
      "P12": "incision superius", "P13": "upper lip", "P14": "lower lip",
      "P15": "subnasale", "P16": "soft tissue pogonion",
      "P17": "posterior nasal spine", "P18": "anterior nasal spine",
      "P19": "articulare"
    },
    "FeTA24": {
      "P1": "most anterior point of corpus callosum",
      "P2": "most posterior point of corpus callosum",
      "P3": "most superior point of vermis",
      "P4": "most inferior point of vermis",
      "P5": "right parietal eminence",
      "P6": "left parietal eminence",
      "P7": "right skull parietal eminence",
      "P8": "left skull parietal eminence",
      "P9": "most right point of cerebellar hemisphere",
      "P10": "most left point of cerebellar hemisphere"
    }
  };

  // Model-button order per task = the leaderboard order in Tables 2/3/4 on the page.
  // Names must match the case model keys exactly (= the table row labels). Models not
  // listed here sort to the end, keeping their original cases.js order.
  var MODEL_ORDER = {
    Detection: ["MedVision-V0 (7B)", "Lingshu (32B)", "MedGemma (27B)", "MedGemma (4B)",
      "Qwen2.5-VL (32B)", "LLaVA-OneVision (72B)", "InternVL3 (38B)", "Qwen2.5-VL (7B)",
      "Gemma3 (27B)", "HealthGPT-L14 (14B)", "MedDr (40B)", "HuatuoGPT-Vision (34B)",
      "Llama3.2-Vision (11B)"],
    TL: ["MedVision-V0 (7B)", "Lingshu (32B)", "HealthGPT-L14 (14B)", "HuatuoGPT-Vision (34B)",
      "Llama3.2-Vision (11B)", "MedDr (40B)", "Gemma3 (27B)", "MedGemma (27B)",
      "LLaVA-OneVision (72B)", "Qwen2.5-VL (7B)", "Qwen2.5-VL (32B)", "InternVL3 (38B)",
      "MedGemma (4B)"],
    AD: ["MedVision-V0 (7B)", "HealthGPT-L14 (14B)", "Lingshu (32B)", "MedDr (40B)",
      "MedGemma (27B)", "Qwen2.5-VL (32B)", "Llama3.2-Vision (11B)", "LLaVA-OneVision (72B)",
      "Gemma3 (27B)", "HuatuoGPT-Vision (34B)", "InternVL3 (38B)", "MedGemma (4B)",
      "Qwen2.5-VL (7B)"],
    // Pilot study (not a ranked leaderboard): MedVision-V0 first as the reference,
    // then the API model. Medals are suppressed for this task (see MEDAL_TASKS).
    "TL-Pilot": ["MedVision-V0 (7B)", "Claude-Fable-5"]
  };

  // Tasks whose model buttons show 🥇🥈🥉 medals (= the ranked leaderboard tables).
  // The pilot viewer is a 2-model comparison, not a ranking, so it is omitted.
  var MEDAL_TASKS = { Detection: 1, TL: 1, AD: 1 };

  // Anthropic logomark (single-path), painted with currentColor so it tracks the
  // model button's text color across default/hover/active states. Shown before
  // Anthropic (Claude) model names in the model panel.
  var ANTHROPIC_ICON =
    '<svg class="cv-model-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442' +
    'l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.541Zm-.3712 10.2232 ' +
    '2.2914-5.9456 2.2914 5.9456Z"/></svg>';

  // Sort model keys by their position in the task's leaderboard table; unknown models
  // (absent from MODEL_ORDER[taskKey]) are appended in their original order.
  function orderModels(keys, taskKey) {
    var order = MODEL_ORDER[taskKey] || [];
    return keys.slice().sort(function (a, b) {
      var ia = order.indexOf(a), ib = order.indexOf(b);
      if (ia < 0) ia = Infinity;
      if (ib < 0) ib = Infinity;
      return ia - ib;
    });
  }

  var COLOR_TAGS = ["orange", "green", "blue", "purple", "teal", "pink"];
  var DEFAULT_HOLD_MS = 5000; // pause per case when auto-play is enabled

  // Token reveal timing (the per-token delay is set inline as CSS var --step).
  var TOK_STEP = 50;        // max per-token delay (ms) — used for short responses
  var TOK_DUR  = 500;       // per-token animation duration (ms; matches CSS .cv-token)
  var REVEAL_BUDGET = 9000; // target max total reveal (ms); long responses compress so
                            // EVERY token still staggers (no fixed cap that freezes the tail)

  document.addEventListener("DOMContentLoaded", function () {
    revealOnScroll();

    var hosts = document.querySelectorAll(".case-viewer");
    if (!hosts.length) {
      var legacy = document.getElementById("case-viewer");
      if (legacy) hosts = [legacy];
    }

    var cases = window.MEDVISION_CASES;
    for (var i = 0; i < hosts.length; i++) {
      var host = hosts[i];
      var task = pickTask(cases, host.getAttribute("data-task"));
      if (!task) {
        host.innerHTML = "";
        var note = document.createElement("p");
        note.className = "cv-note";
        note.textContent = "No cases available yet.";
        host.appendChild(note);
        continue;
      }
      new CaseViewer(host, task).init();
    }
  });

  function revealOnScroll() {
    var els = document.querySelectorAll(".reveal");
    if (!els.length) return;
    if (!("IntersectionObserver" in window)) {
      for (var i = 0; i < els.length; i++) els[i].classList.add("in-view");
      return;
    }
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("in-view"); obs.unobserve(e.target); }
      });
    }, { threshold: 0.06 });
    for (var j = 0; j < els.length; j++) obs.observe(els[j]);
  }

  // Normalize a task's data into { modelName: [cases] }, dropping empty models.
  // Accepts the new nested object OR a bare array (legacy single-model).
  function normalizeModels(v) {
    var out = {};
    if (Array.isArray(v)) { if (v.length) out["MedVision-V0"] = v; return out; }
    if (v && typeof v === "object") {
      for (var k in v) {
        if (Object.prototype.hasOwnProperty.call(v, k) && v[k] && v[k].length) out[k] = v[k];
      }
    }
    return out;
  }

  function pickTask(cases, filterKey) {
    if (!cases || typeof cases !== "object") return null;
    for (var i = 0; i < TASK_ORDER.length; i++) {
      var t = TASK_ORDER[i];
      if (filterKey && t.key !== filterKey) continue;
      var models = normalizeModels(cases[t.key]);
      if (Object.keys(models).length) return { key: t.key, label: t.label, models: models };
    }
    return null;
  }

  // Back-compat for <hl-X> shorthand (exporter now emits inline-styled spans).
  function rewriteColorTags(html) {
    for (var i = 0; i < COLOR_TAGS.length; i++) {
      var c = COLOR_TAGS[i];
      html = html
        .replace(new RegExp("<hl-" + c + ">", "g"), '<span class="hl-' + c + '">')
        .replace(new RegExp("</hl-" + c + ">", "g"), "</span>");
    }
    return html;
  }

  function plainText(s) {
    var d = document.createElement("div");
    d.innerHTML = String(s == null ? "" : s);
    return d.textContent || "";
  }

  function escHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  // -------------------------------------------------------------------------
  function CaseViewer(host, task) {
    this.host = host;
    this.label = task.label;
    this.models = task.models;
    this.modelKeys = orderModels(Object.keys(task.models), task.key);
    this.modelIndex = 0;
    this.cases = task.models[this.modelKeys[0]];
    this.taskKey = task.key;
    this.activeTarget = "All";
    this.filteredIndex = 0;
    this.landmarkEl = null;
    this.playing = host.getAttribute("data-autoplay") === "true";
    this.paused = false;
    this.timer = null;
    this.originMode = "default";   // "default" = top-left, "alt" = lower-left (off-the-shelf TL/AD)
  }

  CaseViewer.prototype.init = function () {
    this.build();
    this.bind();
    this.render();
    this.replayWhenVisible();
  };

  // First render runs on DOMContentLoaded (often before the viewer is in view),
  // so its token reveal would finish unseen. Replay once on first intersection.
  CaseViewer.prototype.replayWhenVisible = function () {
    var self = this;
    if (!("IntersectionObserver" in window)) return;
    var obs = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) { obs.disconnect(); self.render(); break; }
      }
    }, { threshold: 0.25 });
    obs.observe(this.host);
  };

  CaseViewer.prototype.build = function () {
    var host = this.host;
    host.innerHTML = "";

    // Header: eyebrow (left) + arrow navigator (right).
    var head = el("div", "cv-head");
    var eyebrow = el("div", "cv-eyebrow");
    eyebrow.innerHTML = '<span class="cv-dot"></span>CASE STUDY · ' +
      plainText(this.label).toUpperCase();
    head.appendChild(eyebrow);

    var nav = el("div", "cv-nav");
    this.prevBtn = ctrlBtn("cv-prev", "‹", "Previous case");
    this.countEl = el("span", "cv-count");
    this.nextBtn = ctrlBtn("cv-next", "›", "Next case");
    this.playBtn = ctrlBtn("cv-play", this.playing ? "❚❚" : "▶", "Play / pause");
    if (this.playing) this.playBtn.classList.add("is-on");
    nav.appendChild(this.prevBtn);
    nav.appendChild(this.countEl);
    nav.appendChild(this.nextBtn);
    nav.appendChild(this.playBtn);
    head.appendChild(nav);
    host.appendChild(head);

    // Model-selection panel.
    this.modelsEl = el("div", "cv-models");
    var lbl = el("span", "cv-models-label");
    lbl.textContent = "MODEL";
    this.modelsEl.appendChild(lbl);
    var MEDALS = ["🥇", "🥈", "🥉"];
    var showMedals = !!MEDAL_TASKS[this.taskKey];
    for (var m = 0; m < this.modelKeys.length; m++) {
      var mb = el("button", "cv-model");
      mb.setAttribute("type", "button");
      mb.setAttribute("data-mi", String(m));
      var medalPrefix = (showMedals && m < 3 ? MEDALS[m] + " " : "");
      if (/^claude/i.test(this.modelKeys[m])) {
        mb.innerHTML = medalPrefix + ANTHROPIC_ICON + this.modelKeys[m];
      } else {
        mb.textContent = medalPrefix + this.modelKeys[m];
      }
      this.modelsEl.appendChild(mb);
    }
    host.appendChild(this.modelsEl);

    // Target-filter panel.
    var tWrap = el("div", "cv-models cv-targets");
    var tLbl = el("span", "cv-models-label");
    tLbl.textContent = "TARGET";
    tWrap.appendChild(tLbl);
    var tSeen = {}, tList = [];
    for (var ti = 0; ti < this.cases.length; ti++) {
      var tCase = this.cases[ti];
      if (tCase.target && !tSeen[tCase.target]) { tSeen[tCase.target] = true; tList.push(tCase.target); }
    }
    tList.sort();
    tList.unshift("All");
    this.targetBtns = [];
    for (var tj = 0; tj < tList.length; tj++) {
      var tBtn = el("button", "cv-target");
      tBtn.setAttribute("type", "button");
      tBtn.setAttribute("data-target", tList[tj]);
      tBtn.textContent = tList[tj];
      if (tList[tj] === "All") tBtn.classList.add("is-active");
      tWrap.appendChild(tBtn);
      this.targetBtns.push(tBtn);
    }
    host.appendChild(tWrap);

    // Origin-assumption toggle (off-the-shelf TL/AD only — shown per-case in render()).
    // The prompt omits the coordinate origin, so we render both interpretations.
    this.originEl = el("div", "cv-models cv-origin");
    this.originEl.style.display = "none";
    var oLbl = el("span", "cv-models-label");
    oLbl.innerHTML = "ASSUMED ORIGIN <sup>4</sup>";
    this.originEl.appendChild(oLbl);
    this.originBtns = [];
    var O = [["default", "Top-left"], ["alt", "Lower-left"]];
    for (var oi = 0; oi < O.length; oi++) {
      var oBtn = el("button", "cv-target");
      oBtn.setAttribute("type", "button");
      oBtn.setAttribute("data-origin", O[oi][0]);
      oBtn.textContent = O[oi][1];
      if (O[oi][0] === "default") oBtn.classList.add("is-active");
      this.originEl.appendChild(oBtn);
      this.originBtns.push(oBtn);
    }
    host.appendChild(this.originEl);

    // Landmark reference panel (AD task only — populated on each render).
    if (this.taskKey === "AD") {
      this.landmarkEl = el("div", "cv-lm-panel");
      this.landmarkEl.style.display = "none";
      host.appendChild(this.landmarkEl);
    }

    // Progress bar.
    var track = el("div", "cv-bar-track");
    this.barEl = el("div", "cv-bar");
    track.appendChild(this.barEl);
    host.appendChild(track);

    // Title.
    this.titleEl = el("div", "cv-title");
    host.appendChild(this.titleEl);

    // Image annotation note (static — same for every case).
    this.noteEl = el("div", "cv-img-note");
    var notesHtml =
      '<sup>1</sup> <strong>Overlay:</strong> The displayed image adds a scale bar ' +
      '(physical length), orientation labels (e.g., “Right →”), and raw image size — ' +
      'none of which the model sees.<br>' +
      '<sup>2</sup> <strong>Axes:</strong> input row (height) = <em>x</em>-axis, ' +
      'input column (width) = <em>y</em>-axis; <em>x</em>:<em>y</em> scale ratio = pixel-size ratio.<br>' +
      '<sup>3</sup> <strong>Per-model resize:</strong> Each VLM reshapes &amp; pads the input ' +
      'differently; the prompt’s image size and pixel spacing match what that model perceives.';

    // Coordinate-origin note (static): the measurement-task prompts under-specify the origin,
    // so off-the-shelf models and the fine-tuned MedVision-V0 disagree on it. We render each
    // model's predicted landmarks in the origin it actually used. Detection states its origin
    // in the prompt, so this note is omitted there.
    if (this.taskKey !== "Detection") {
      notesHtml +=
        '<br><sup>4</sup> <strong>Coordinate origin:</strong> The prompt omits the coordinate ' +
        'origin, so models infer it from their internal priors. MedVision-V0 uses a ' +
        '<em>lower-left</em> origin, while off-the-shelf models may assume <em>top-left</em>. ' +
        'This affects landmark overlay and localization error. Use the “Assumed origin” toggle ' +
        'to compare. Final size, distance, and angle remain unchanged (reflection-invariant).';
    }
    this.noteEl.innerHTML = notesHtml;
    host.appendChild(this.noteEl);

    // Stage: text (left) + figure (right).
    var stage = el("div", "cv-stage");
    this.textEl = el("div", "cv-text");
    var figCol = el("div", "cv-figcol");
    this.figEl = el("div", "cv-figs");
    var figCap = el("div", "cv-fig-cap");
    figCap.innerHTML =
      'This figure is the input image with an optional GT / prediction overlay; it differs from ' +
      'what each VLM actually receives in several respects<sup>1,2,3</sup>.';
    figCol.appendChild(this.figEl);
    figCol.appendChild(figCap);
    stage.appendChild(this.textEl);
    stage.appendChild(figCol);
    host.appendChild(stage);
  };

  CaseViewer.prototype.bind = function () {
    var self = this;
    this.prevBtn.addEventListener("click", function () { self.step(-1); });
    this.nextBtn.addEventListener("click", function () { self.step(1); });
    this.playBtn.addEventListener("click", function () { self.togglePlay(); });
    this.modelsEl.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest(".cv-model") : null;
      if (b) self.selectModel(parseInt(b.getAttribute("data-mi"), 10));
    });
    this.host.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest(".cv-target") : null;
      // Origin buttons share the .cv-target style but carry data-origin; route them separately.
      if (!b) return;
      if (b.hasAttribute("data-origin")) { self._setOrigin(b.getAttribute("data-origin")); }
      else if (b.hasAttribute("data-target")) { self._setTarget(b.getAttribute("data-target")); }
    });

    this.host.addEventListener("mouseenter", function () { self.setPause(true); });
    this.host.addEventListener("mouseleave", function () { self.setPause(false); });
    this.host.addEventListener("focusin", function () { self.setPause(true); });
    this.host.addEventListener("focusout", function () {
      if (!self.host.contains(document.activeElement)) self.setPause(false);
    });
  };

  CaseViewer.prototype._setOrigin = function (mode) {
    if (mode !== "default" && mode !== "alt") return;
    if (this.originMode === mode) return;
    this.originMode = mode;
    this.render();
  };

  CaseViewer.prototype._getFiltered = function () {
    if (this.activeTarget === "All") return this.cases;
    var t = this.activeTarget;
    return this.cases.filter(function (c) { return c.target === t; });
  };

  CaseViewer.prototype._setTarget = function (t) {
    var prevCase = this._getFiltered()[this.filteredIndex];
    this.activeTarget = t;
    var fc = this._getFiltered();
    var idx = prevCase ? fc.indexOf(prevCase) : -1;
    this.filteredIndex = idx >= 0 ? idx : 0;
    this.render();
  };

  CaseViewer.prototype.current = function () {
    var fc = this._getFiltered();
    if (!fc.length) return null;
    return fc[Math.min(this.filteredIndex, fc.length - 1)];
  };

  CaseViewer.prototype.selectModel = function (mi) {
    if (mi === this.modelIndex || !this.modelKeys[mi]) return;
    this.modelIndex = mi;
    this.cases = this.models[this.modelKeys[mi]];
    // Keep position: case lists are aligned across models (same samples, same order),
    // so switching models stays on the same sample — only the answer changes.
    var fc = this._getFiltered();
    if (this.filteredIndex >= fc.length) this.filteredIndex = Math.max(0, fc.length - 1);
    this.render();
  };

  CaseViewer.prototype.go = function (i) {
    var n = this._getFiltered().length;
    if (n === 0) return;
    this.filteredIndex = ((i % n) + n) % n;
    this.render();
  };
  CaseViewer.prototype.step = function (dir) { this.go(this.filteredIndex + dir); };

  CaseViewer.prototype.render = function () {
    this.clearTimer();
    var c = this.current();

    // Active model button.
    var mbtns = this.modelsEl.querySelectorAll(".cv-model");
    for (var b = 0; b < mbtns.length; b++) mbtns[b].classList.toggle("is-active", b === this.modelIndex);

    var fc = this._getFiltered();
    var fi = Math.min(this.filteredIndex, Math.max(0, fc.length - 1));
    this.countEl.textContent = fc.length === 0 ? "0 / 0" : pad2(fi + 1) + " / " + pad2(fc.length);
    this.barEl.style.width = fc.length === 0 ? "0%" : (((fi + 1) / fc.length) * 100) + "%";

    // Active target button.
    if (this.targetBtns) {
      for (var tb = 0; tb < this.targetBtns.length; tb++) {
        this.targetBtns[tb].classList.toggle("is-active",
          this.targetBtns[tb].getAttribute("data-target") === this.activeTarget);
      }
    }

    // Origin toggle: shown only for off-the-shelf TL/AD cases (originToggle). When "alt"
    // is active, the lower-left image + metrics are used; default is top-left.
    var hasOrigin = !!(c && c.originToggle);
    var useAlt = hasOrigin && this.originMode === "alt";
    if (this.originEl) {
      this.originEl.style.display = hasOrigin ? "" : "none";
      for (var ob = 0; ob < this.originBtns.length; ob++) {
        this.originBtns[ob].classList.toggle("is-active",
          this.originBtns[ob].getAttribute("data-origin") === this.originMode);
      }
    }

    // Landmark reference panel: update from current case's target prefix.
    if (this.landmarkEl) {
      var dsPrefix = c && c.target ? c.target.split(":")[0].trim() : null;
      var lmData = dsPrefix ? AD_LANDMARKS[dsPrefix] : null;
      if (lmData) {
        var lmKeys = Object.keys(lmData);
        var lmHtml = '<span class="cv-models-label">LANDMARKS · ' + escHtml(dsPrefix) + '</span>'
                   + '<div class="cv-lm-grid">';
        for (var li = 0; li < lmKeys.length; li++) {
          lmHtml += '<span class="cv-lm-entry">'
                  + '<span class="cv-lm-key">' + escHtml(lmKeys[li]) + '</span>'
                  + '<span class="cv-lm-sep"> — </span>'
                  + '<span class="cv-lm-val">' + escHtml(lmData[lmKeys[li]]) + '</span>'
                  + '</span>';
        }
        lmHtml += '</div>';
        this.landmarkEl.innerHTML = lmHtml;
        this.landmarkEl.style.display = "";
      } else {
        this.landmarkEl.style.display = "none";
      }
    }

    if (!c) {
      this.titleEl.innerHTML = "";
      this.textEl.innerHTML = "";
      this.figEl.innerHTML = "";
      return;
    }

    // Structured target info (falls back to the case title for older data).
    var info = [];
    if (c.target) info.push('<span class="cv-tk">Target:</span> ' + escHtml(c.target));
    if (c.modality) info.push('<span class="cv-tk">Image Modality:</span> ' + escHtml(c.modality));
    this.titleEl.innerHTML = info.length
      ? info.join('<span class="cv-tsep">·</span>')
      : escHtml(plainText(c.title).split("\n")[0].trim());

    // Panels. [Prompt] at once, [Response] token-by-token, [Metrics] after the
    // Response finishes (delay = response token count * step + duration).
    this.textEl.innerHTML = "";
    this.textEl.scrollTop = 0;
    var list = (useAlt && c.segments_alt) ? c.segments_alt : (c.segments || []);
    var respDur = 0, metricsSeg = null;
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      var isResp = /response/i.test(s.label || "");
      var isMetric = /metric/i.test(s.label || "");
      var seg = el("div", "cv-seg" + (isResp ? " cv-anim" : ""));
      if (s.label) {
        var lab = el("div", "cv-seg-label");
        lab.textContent = s.label;
        seg.appendChild(lab);
      }
      var body = el("div", "cv-seg-body");   // white-space:pre-wrap renders \n
      body.innerHTML = rewriteColorTags(s.html || "");
      if (isResp) {
        var ntok = splitTokens(body);
        var tstep = Math.min(TOK_STEP, REVEAL_BUDGET / Math.max(ntok, 1));
        seg.style.setProperty("--step", tstep + "ms");   // inherited by .cv-token
        respDur = ntok * tstep + TOK_DUR;
      }
      seg.appendChild(body);
      if (isMetric) { seg.classList.add("cv-after"); metricsSeg = seg; }
      this.textEl.appendChild(seg);
    }
    if (metricsSeg) metricsSeg.style.animationDelay = respDur + "ms";
    this.respDur = respDur;   // so auto-advance waits for the reveal + metrics

    this.renderFigure((useAlt && c.image_alt ? c.image_alt : c.image) || (c.images && c.images[0]));

    if (this.isAutoActive()) this.scheduleAdvance();
  };

  CaseViewer.prototype.renderFigure = function (src) {
    this.figEl.innerHTML = "";
    if (!src) {
      var ph0 = el("div", "cv-fig cv-fig-missing");
      ph0.textContent = "figure pending";
      this.figEl.appendChild(ph0);
      return;
    }
    var img = new Image();
    img.className = "cv-fig";
    img.setAttribute("loading", "lazy");
    img.alt = "";
    img.onerror = function () {
      var ph = el("div", "cv-fig cv-fig-missing");
      ph.textContent = "figure pending";
      if (img.parentNode) img.parentNode.replaceChild(ph, img);
    };
    img.src = src;
    this.figEl.appendChild(img);
  };

  CaseViewer.prototype.scheduleAdvance = function () {
    var c = this.current();
    if (!c) return;
    var self = this;
    // Wait for the token reveal + the delayed metrics fade before advancing.
    var hold = Math.max(c.holdMs || DEFAULT_HOLD_MS, (this.respDur || 0) + 2200);
    this.timer = setTimeout(function () {
      if (self.isAutoActive()) self.step(1);
    }, hold);
  };

  CaseViewer.prototype.togglePlay = function () {
    this.playing = !this.playing;
    this.playBtn.innerHTML = this.playing ? "❚❚" : "▶";
    this.playBtn.classList.toggle("is-on", this.playing);
    if (this.playing) this.scheduleAdvance();
    else this.clearTimer();
  };

  CaseViewer.prototype.setPause = function (paused) {
    if (this.paused === paused) return;
    this.paused = paused;
    if (paused) this.clearTimer();
    else if (this.playing) this.scheduleAdvance();
  };

  CaseViewer.prototype.isAutoActive = function () { return this.playing && !this.paused; };
  CaseViewer.prototype.clearTimer = function () {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  };

  // ---- helpers ------------------------------------------------------------
  function el(tag, className) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  // Wrap each TOKEN (number/word run, or a single punctuation/symbol) in a
  // .cv-token span with a staggered --i index; recurse into colored spans so
  // their tokens keep color and animate. Returns the total token count.
  function splitTokens(root) {
    var i = 0;
    (function walk(node) {
      var kids = Array.prototype.slice.call(node.childNodes);
      for (var k = 0; k < kids.length; k++) {
        var ch = kids[k];
        if (ch.nodeType === 3) {
          var toks = ch.textContent.match(/\s+|[\w.\-]+|[^\s\w.\-]/g);
          if (!toks || !/\S/.test(ch.textContent)) continue;
          var frag = document.createDocumentFragment();
          for (var p = 0; p < toks.length; p++) {
            var t = toks[p];
            if (/^\s+$/.test(t)) { frag.appendChild(document.createTextNode(t)); }
            else {
              var w = document.createElement("span");
              w.className = "cv-token";
              w.style.setProperty("--i", i++);
              w.textContent = t;
              frag.appendChild(w);
            }
          }
          node.replaceChild(frag, ch);
        } else if (ch.nodeType === 1) {
          walk(ch);
        }
      }
    })(root);
    return i;
  }

  function ctrlBtn(cls, glyph, label) {
    var b = el("button", cls);
    b.setAttribute("type", "button");
    b.setAttribute("aria-label", label);
    b.innerHTML = glyph;
    return b;
  }
})();
