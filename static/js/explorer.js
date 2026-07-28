/* MedVision Dataset Explorer viewer.
 *
 * Reads window.MEDVISION_EXPLORER (emitted by script/visualization/export_explorer_data.py) and
 * builds a cascading filter: body part -> anatomy -> modality -> dataset -> version -> load command.
 * No external dependencies. No-op if the #mv-explorer mount is absent (safe to load on every page).
 */
(function () {
  "use strict";

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  ready(function () {
    var mount = document.getElementById("mv-explorer");
    if (!mount) return;

    var DATA = window.MEDVISION_EXPLORER;
    if (!DATA || !Array.isArray(DATA.configs)) {
      mount.innerHTML = '<p class="mvx-empty">Explorer data failed to load.</p>';
      return;
    }

    var CONFIGS = DATA.configs;
    var BODY_PARTS = DATA.body_parts || {};
    // The repo release, hardcoded in MedVision.py — this is what MedVision_ACK_RELEASE must equal.
    // Deliberately NOT the newest annotation version: a release that regenerates nothing still
    // advances this and still invalidates old acknowledgements.
    var RELEASE = DATA.release_version;
    // Everything this panel shows — configs, labels, annotation versions — is exported from the
    // medvision_ds dataset codebase, so the release that produced it is stated in the header
    // rather than left implicit. Version comes from the blob, never hardcoded.
    var DS_REPO_URL = "https://huggingface.co/datasets/YongchengYAO/MedVision";
    var ANNOTATION_INDEX = DATA.annotation_index || {};
    var DATASET_INFO = DATA.dataset_info || {};
    var TASKS = DATA.tasks || {};
    var MODALITY_ORDER = ["CT", "MRI", "Ultrasound", "X-Ray", "PET"];

    // ── annotation versions ───────────────────────────────────────────────────
    // From v1.2.0 the release version and the annotation version are separate: MedVision_PLANNER_
    // VERSION names a release, and each (dataset, plan kind) loads the newest annotation published
    // at or before it. The selector therefore offers a config's OWN annotation versions, not the
    // catalogue's release list — KiTS23 T/L publishes 1.0.0/1.1.0/1.1.1, so v1.1.1 is its newest
    // and v1.2.0 never appears for it even though that release exists. Two payoffs: every option
    // maps 1:1 to a distinct set of annotation files (picking a release that resolves to the same
    // files as another was a distinction without a difference), and the pinned version IS the
    // version loaded, so the landmark folder and the label map can be read straight off it.
    // MedVision_ACK_RELEASE still mirrors _enforce_release_ack(): required below a config's newest.
    function vcmp(a, b) {
      var x = String(a).split("."), y = String(b).split(".");
      for (var i = 0; i < 3; i++) {
        var xi = Number(x[i] || 0), yi = Number(y[i] || 0);
        if (xi !== yi) return xi < yi ? -1 : 1;
      }
      return 0;
    }

    function declaredFor(cfg) {
      var task = TASKS[cfg.task_key];
      var kind = (task && task.kind) || String(cfg.task_key || "").split("|")[1] || "";
      return (ANNOTATION_INDEX[cfg.dataset] || {})[kind] || [];
    }

    // A config's own annotation versions, newest first.
    function versionsFor(cfg) {
      return declaredFor(cfg).slice().sort(function (a, b) { return vcmp(b, a); });
    }

    function newestFor(cfg) { return versionsFor(cfg)[0] || null; }

    function ackNeeded(cfg, version) {
      var newest = newestFor(cfg);
      return !!(newest && vcmp(version, newest) < 0);
    }

    // Anatomy pills of the current render, by group — so hovering a config can highlight the
    // anatomy it covers without re-rendering (which would drop hover/focus).
    var anatomyPills = {};

    var TASK_LABEL = {
      BoxSize: "Detection",
      TumorLesionSize: "Tumor/Lesion size",
      BiometricsFromLandmarks: "Biometrics"
    };

    // The loader's default is the single-instance (filtered) set; "multi" adds one env line.
    // Two version fields, deliberately. `versionPref` is the last version the reader explicitly
    // picked; `version` is what the current config actually resolves to. Collapsing them into one
    // silently downgrades: KiTS23's detection config publishes only 1.0.0, so moving from it to
    // the T/L config — which also publishes 1.0.0 — would keep a v1.0.0 the reader never chose,
    // instead of the v1.1.1 they would get arriving at T/L directly. Keeping the preference apart
    // means an explicit v1.0.0 sweep still sticks, while an auto-clamp does not become a choice.
    var state = { bodyPart: null, anatomy: {}, modality: null, dataset: null,
                  versionPref: null, version: null, instanceMode: "single" };

    var CONCEPTS_URL = "https://medvision.readthedocs.io/en/latest/dataset/concepts.html" +
                       "#multi-instance-vs-single-instance-annotations";

    // A/D samples are never dropped — the loader only splits them by metric_type — so the
    // filtering switch provably does nothing for them.
    function filteringApplies(cfg) { return !!cfg && cfg.task_type !== "BiometricsFromLandmarks"; }
    function isMulti(cfg) { return state.instanceMode === "multi" && filteringApplies(cfg); }

    // ── selection helpers ─────────────────────────────────────────────────────
    function selectedAnatomy() { return Object.keys(state.anatomy).filter(function (g) { return state.anatomy[g]; }); }

    function anatomyMatch(cfg) {
      var sel = selectedAnatomy();
      if (!sel.length) return false;
      for (var i = 0; i < cfg.anatomy_groups.length; i++) {
        if (state.anatomy[cfg.anatomy_groups[i]]) return true;
      }
      return false;
    }

    // configs passing the filters up to (but not including) an optional stage
    function filtered(opts) {
      opts = opts || {};
      return CONFIGS.filter(function (c) {
        if (opts.anatomy !== false && !anatomyMatch(c)) return false;
        if (opts.modality !== false && state.modality && c.modality !== state.modality) return false;
        if (opts.dataset !== false && state.dataset && c.dataset !== state.dataset) return false;
        return true;
      });
    }

    function countDatasetsForGroup(group) {
      // distinct datasets whose anatomy includes `group` — same unit as the modality/dataset steps
      var set = {};
      for (var i = 0; i < CONFIGS.length; i++) {
        if (CONFIGS[i].anatomy_groups.indexOf(group) !== -1) set[CONFIGS[i].dataset] = true;
      }
      return Object.keys(set).length;
    }

    function datasetsForModality(mod) {
      var set = {};
      CONFIGS.forEach(function (c) { if (c.modality === mod && anatomyMatch(c)) set[c.dataset] = true; });
      return Object.keys(set);
    }

    // ── DOM helpers ───────────────────────────────────────────────────────────
    function el(tag, cls, text) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      return e;
    }
    // Header provenance chip, shared verbatim with version-control.js (no bundler here, and each
    // panel file is self-contained). Sits between the eyebrow and the crumb so the crumb's
    // margin-left:auto still pins it right.
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

    function stepBlock(num, label, hintText) {
      var step = el("div", "mvx-step");
      var lab = el("div", "mvx-label");
      lab.appendChild(el("span", "mvx-num", String(num)));
      lab.appendChild(el("span", null, label));
      if (hintText) lab.appendChild(el("span", "mvx-hint", hintText));
      step.appendChild(lab);
      return step;
    }

    // Module header: eyebrow + a live monospace "query breadcrumb" of the current selection.
    function moduleHeader() {
      var head = el("div", "mvx-head");
      var eyebrow = el("div", "mvx-eyebrow");
      eyebrow.appendChild(el("span", "mvx-dot"));
      eyebrow.appendChild(el("span", null, "DATASET EXPLORER"));
      head.appendChild(eyebrow);
      head.appendChild(provenanceChip());

      var parts = [];
      if (state.bodyPart) parts.push(state.bodyPart);
      var anat = selectedAnatomy();
      if (anat.length) parts.push(anat.join(" · "));
      if (state.modality) parts.push(state.modality);
      if (state.dataset) parts.push(state.dataset);

      crumbNode = el("div", "mvx-crumb");
      if (!parts.length) crumbNode.textContent = "pick a body part to begin";
      else parts.forEach(crumbPush);
      head.appendChild(crumbNode);
      return head;
    }

    // The header is emitted before the version is known — step 6 settles it per config — so the
    // crumb is left open and the version appended there. Writing it from `state.version` up here
    // would render the PREVIOUS selection's version for one frame after every change.
    var crumbNode = null;
    function crumbPush(text) {
      if (!crumbNode) return;
      if (crumbNode.children.length) crumbNode.appendChild(el("span", "sep", "›"));  // ›
      crumbNode.appendChild(el("b", null, text));
    }

    // Highlight (or clear) the anatomy pills covered by a config's labels. Called on hover/focus
    // of a config chip; uses the config's resolved anatomy_groups — the same field the filter
    // matches on, so the highlight can never contradict why the config was surfaced.
    function hintAnatomy(groups, on) {
        (groups || []).forEach(function (g) {
            var pill = anatomyPills[g];
            if (!pill) return;  // group lives under a different body part, so it isn't on screen
            if (on) pill.classList.add("is-hint");
            else pill.classList.remove("is-hint");
        });
    }

    function linkRow(label, urls) {
        var row = el("div", "mvx-kv");
        row.appendChild(el("span", "mvx-k", label));
        var vals = el("div", "mvx-v");
        urls.forEach(function (u) {
            var a = el("a", "mvx-link", u);
            a.href = u;
            a.target = "_blank";
            a.rel = "noopener";
            vals.appendChild(a);
        });
        row.appendChild(vals);
        return row;
    }

    function textRow(label, value, cls) {
        var row = el("div", "mvx-kv");
        row.appendChild(el("span", "mvx-k", label));
        var v = el("div", "mvx-v");
        v.appendChild(el("span", cls || null, value));
        row.appendChild(v);
        return row;
    }

    // Dataset provenance — compiled from the medvision_ds preprocess modules.
    function datasetPanel(ds) {
        var info = DATASET_INFO[ds];
        var box = el("div", "mvx-info");
        if (!info) {
            box.appendChild(el("div", "mvx-note", "No dataset information recorded for " + ds + "."));
            return box;
        }
        if (info.dataset_website) box.appendChild(linkRow("Website", [info.dataset_website]));
        if (info.dataset_data && info.dataset_data.length) box.appendChild(linkRow("Source", info.dataset_data));
        // Present only for datasets we redistribute (those with a download_fast.py); this is the
        // copy the loader actually pulls, so it goes above the upstream paper.
        if (info.hf_data && info.hf_data.length) box.appendChild(linkRow("HF data", info.hf_data));
        if (info.paper && info.paper.length) box.appendChild(linkRow("Paper", info.paper));
        if (info.license && info.license.length) {
            var row = el("div", "mvx-kv");
            row.appendChild(el("span", "mvx-k", "License"));
            var vals = el("div", "mvx-v");
            info.license.forEach(function (l) { vals.appendChild(el("span", "mvx-lic", l)); });
            row.appendChild(vals);
            box.appendChild(row);
        }
        // Access caveats the compiled fields can't express — e.g. the three datasets that forbid
        // redistribution and need the reader to apply for access before MedVision can fetch them.
        (info.notes || []).forEach(function (n) {
            var note = el("div", "mvx-note", n.text);
            if (n.url) {
                var a = el("a", "mvx-link", " " + (n.url_label || "Details →"));
                a.href = n.url;
                a.target = "_blank";
                a.rel = "noopener";
                note.appendChild(a);
            }
            box.appendChild(note);
        });
        return box;
    }

    // The T/L planner stamps "-v<version>" onto the landmark folder, but only from v1.1.0 on
    // (benchmark_planner.py:2197); v1.0.0 predates that code and A/D never stamps at all.
    function landmarkFolder(task, version) {
        if (!task.landmark_folder) return null;
        if (!task.landmark_folder_versioned || version === "1.0.0") return task.landmark_folder;
        return task.landmark_folder + "-v" + version;
    }

    // Task panel for the chosen config: what the loader reads, and the label/landmark map.
    function taskPanel(cfg) {
        var task = TASKS[cfg.task_key];
        var box = el("div", "mvx-task");
        if (!task) {
            box.appendChild(el("div", "mvx-note", "No task details recorded for " + cfg.config + "."));
            return box;
        }
        if (task.image_description) box.appendChild(textRow("Image", task.image_description));
        if (task.image_folder) box.appendChild(textRow("Images", task.image_folder, "mvx-path"));
        if (task.mask_folder) box.appendChild(textRow("Masks", task.mask_folder, "mvx-path"));
        var lf = landmarkFolder(task, state.version);
        if (lf) box.appendChild(textRow("Landmarks", lf, "mvx-path"));

        var map = task.landmarks_map || task.labels_map;
        if (map) {
            var isLandmarks = !!task.landmarks_map;
            // is-block: the map needs the panel's full width, not the narrow value column
            var row = el("div", "mvx-kv is-block");
            row.appendChild(el("span", "mvx-k", isLandmarks ? "Landmark map" : "Label map"));
            var list = el("div", "mvx-map");
            Object.keys(map).forEach(function (k) {
                var item = el("div", "mvx-map-row" + (!isLandmarks && task.target_label === k ? " is-target" : ""));
                item.appendChild(el("span", "mvx-map-k", k));
                item.appendChild(el("span", "mvx-map-v", map[k]));
                if (!isLandmarks && task.target_label === k) item.appendChild(el("span", "mvx-map-tag", "measured"));
                list.appendChild(item);
            });
            row.appendChild(list);
            box.appendChild(row);
        }

        // Every dataset except Ceph-Biometrics-400 ships expert segmentation masks. Say it here,
        // beside the label map, because this is where the reader learns where those labels came from.
        var dsInfo = DATASET_INFO[cfg.dataset];
        if (dsInfo && dsInfo.has_segmentation) {
            box.appendChild(el("div", "mvx-note",
                "📝 This dataset also ships segmentation masks: dense manual ground truth drawn by " +
                "expert annotators" +
                (task.labels_map ? ", and the source of the label names above" : "") + ". " +
                (cfg.task_type === "BoxSize"
                    ? "Loading this detection config downloads the image and mask files, preprocessed " +
                      "into the dataset folder you specify."
                    : "To download the image and mask files, load one of this dataset's detection " +
                      "configs — the data is downloaded and preprocessed into the dataset folder you " +
                      "specify.")));
        }
        return box;
    }

    // Annotation set: single-instance (loader default) vs multi-instance (unfiltered).
    // Same config name either way — the switch is one env var read at generate time.
    function instancePanel(cfg) {
        var applies = filteringApplies(cfg);
        var box = el("div", "mvx-instance");

        var row = el("div", "mvx-kv");
        row.appendChild(el("span", "mvx-k", "Annotation set"));
        var vals = el("div", "mvx-v");
        var opts = el("div", "mvx-options");
        [
            { key: "single", label: "Single-instance", hint: "default" },
            { key: "multi", label: "Multi-instance", hint: "unfiltered" }
        ].forEach(function (o) {
            var disabled = o.key === "multi" && !applies;
            var active = (o.key === "single" ? !isMulti(cfg) : isMulti(cfg));
            var pill = el("button", "mvx-pill" + (active ? " is-active" : "") + (disabled ? " is-disabled" : ""));
            pill.appendChild(el("span", null, o.label));
            pill.appendChild(el("span", "mvx-count", o.hint));
            if (disabled) pill.disabled = true;
            else pill.onclick = function () { state.instanceMode = o.key; render(); };
            opts.appendChild(pill);
        });
        vals.appendChild(opts);
        row.appendChild(vals);
        box.appendChild(row);

        if (!applies) {
            box.appendChild(el("div", "mvx-note",
                "Angle/distance samples are never filtered — the single- and multi-instance sets are " +
                "identical for this task."));
            return box;
        }

        var warn = el("div", "mvx-warn");
        warn.appendChild(el("b", null, "Single-instance is the set to use for leaderboard comparison. "));
        warn.appendChild(el("span", null,
            "The multi-instance set is not — MedVision-V0's SFT/RFT training is not optimized for " +
            "multi-instance detection and measurement. "));
        var a = el("a", "mvx-link", "What the filters drop →");
        a.href = CONCEPTS_URL;
        a.target = "_blank";
        a.rel = "noopener";
        warn.appendChild(a);
        box.appendChild(warn);
        return box;
    }

    // ── render ────────────────────────────────────────────────────────────────
    function render() {
      mount.innerHTML = "";
      mount.appendChild(moduleHeader());

      // Step 1 — body part
      var s1 = stepBlock(1, "Body part");
      var opt1 = el("div", "mvx-options");
      Object.keys(BODY_PARTS).forEach(function (bp) {
        var pill = el("button", "mvx-pill" + (state.bodyPart === bp ? " is-active" : ""), bp);
        pill.onclick = function () {
          state.bodyPart = (state.bodyPart === bp) ? null : bp;
          state.anatomy = {}; state.modality = null; state.dataset = null;
          render();
        };
        opt1.appendChild(pill);
      });
      s1.appendChild(opt1);
      mount.appendChild(s1);
      if (!state.bodyPart) return;

      // Step 2 — anatomy (multi-select)
      var s2 = stepBlock(2, "Anatomy", "choose one or more");
      var opt2 = el("div", "mvx-options");
      anatomyPills = {};
      (BODY_PARTS[state.bodyPart] || []).forEach(function (g) {
        var active = !!state.anatomy[g];
        var pill = el("button", "mvx-pill" + (active ? " is-active" : ""));
        pill.appendChild(el("span", null, g));
        var cnt = el("span", "mvx-count", "(" + countDatasetsForGroup(g) + ")");
        pill.appendChild(cnt);
        pill.onclick = function () {
          if (state.anatomy[g]) delete state.anatomy[g]; else state.anatomy[g] = true;
          state.modality = null; state.dataset = null;
          render();
        };
        anatomyPills[g] = pill;
        opt2.appendChild(pill);
      });
      s2.appendChild(opt2);
      mount.appendChild(s2);
      if (!selectedAnatomy().length) return;

      // Step 3 — modality (single-select; disable those with no matching dataset)
      var s3 = stepBlock(3, "Imaging modality");
      var opt3 = el("div", "mvx-options");
      MODALITY_ORDER.forEach(function (mod) {
        var dss = datasetsForModality(mod);
        var disabled = dss.length === 0;
        var pill = el("button", "mvx-pill" + (state.modality === mod ? " is-active" : "") + (disabled ? " is-disabled" : ""));
        pill.appendChild(el("span", null, mod));
        pill.appendChild(el("span", "mvx-count", "(" + dss.length + ")"));
        if (!disabled) {
          pill.onclick = function () {
            state.modality = (state.modality === mod) ? null : mod;
            state.dataset = null;
            render();
          };
        } else {
          pill.disabled = true;
        }
        opt3.appendChild(pill);
      });
      s3.appendChild(opt3);
      mount.appendChild(s3);
      if (!state.modality) return;

      // Step 4 — datasets
      var matchConfigs = filtered({ dataset: false });   // anatomy + modality
      var dsMap = {};
      matchConfigs.forEach(function (c) { (dsMap[c.dataset] = dsMap[c.dataset] || []).push(c); });
      var dsNames = Object.keys(dsMap).sort();

      var s4 = stepBlock(4, "Dataset", dsNames.length + " match");
      if (!dsNames.length) {
        s4.appendChild(el("p", "mvx-empty", "No dataset has this anatomy in this modality — try another combination."));
        mount.appendChild(s4);
        return;
      }
      var dsWrap = el("div", "mvx-datasets");
      dsNames.forEach(function (ds) {
        var card = el("div", "mvx-ds" + (state.dataset === ds ? " is-active" : ""));
        card.appendChild(el("b", null, ds));
        card.appendChild(el("small", null, dsMap[ds].length + " test config" + (dsMap[ds].length > 1 ? "s" : "")));
        card.onclick = function () {
          state.dataset = (state.dataset === ds) ? null : ds;
          render();
        };
        dsWrap.appendChild(card);
      });
      s4.appendChild(dsWrap);
      if (state.dataset) s4.appendChild(datasetPanel(state.dataset));
      mount.appendChild(s4);
      if (!state.dataset) return;

      // Step 5 — which config. Must precede the version step: the annotation versions on offer
      // belong to the config's plan kind, and one dataset's kinds can differ (KiTS23 detection
      // publishes only 1.0.0 while its biometry publishes 1.0.0/1.1.0/1.1.1).
      var s5 = stepBlock(5, "Config", "task and plane");
      var mine = dsMap[state.dataset].slice().sort(function (a, b) {
        return a.config < b.config ? -1 : (a.config > b.config ? 1 : 0);
      });
      if (state.chosenConfig == null || mine.map(function (c) { return c.config; }).indexOf(state.chosenConfig) === -1) {
        state.chosenConfig = mine[0].config;
      }
      var cfgLine = el("div", "mvx-configline");
      var chosenCfg = null;
      mine.forEach(function (c) {
        var chip = el("button", "mvx-cfg" + (state.chosenConfig === c.config ? " is-active" : ""));
        var tt = TASK_LABEL[c.task_type] || c.task_type;
        if (c.subtype) tt += " · " + c.subtype;
        chip.appendChild(el("span", null, c.plane + " · Task " + c.task_id));
        chip.appendChild(el("span", "mvx-tag", "  " + tt));
        chip.onclick = function () { state.chosenConfig = c.config; render(); };
        // Hovering (or tabbing to) a config previews the anatomy its labels map to.
        chip.onmouseenter = function () { hintAnatomy(c.anatomy_groups, true); };
        chip.onmouseleave = function () { hintAnatomy(c.anatomy_groups, false); };
        chip.onfocus = function () { hintAnatomy(c.anatomy_groups, true); };
        chip.onblur = function () { hintAnatomy(c.anatomy_groups, false); };
        if (state.chosenConfig === c.config) chosenCfg = c;
        cfgLine.appendChild(chip);
      });
      s5.appendChild(cfgLine);
      mount.appendChild(s5);
      if (!chosenCfg) return;

      // Step 6 — annotation version, scoped to what THIS config publishes.
      var s6 = stepBlock(6, "Annotation version");
      var versions = versionsFor(chosenCfg);
      // Honour an explicit pick when this config publishes it; otherwise show its newest.
      state.version = (state.versionPref && versions.indexOf(state.versionPref) !== -1)
        ? state.versionPref : versions[0];
      crumbPush("v" + state.version);
      var ctrls = el("div", "mvx-controls");
      var sel = el("select", "mvx-select");
      versions.forEach(function (v) {
        var o = el("option", null, "v" + v + (v === versions[0] ? " (latest)" : ""));
        o.value = v;
        if (v === state.version) o.selected = true;
        sel.appendChild(o);
      });
      sel.onchange = function () { state.versionPref = sel.value; render(); };
      ctrls.appendChild(sel);
      s6.appendChild(ctrls);
      var vnote = "These are the annotation versions published for this config. ";
      vnote += versions.length === 1
        ? "It has been published once, at v" + versions[0] + ", and never regenerated — so no other " +
          "version exists for it, whatever release you pin."
        : "Only tumor/lesion (T/L) annotations have ever been regenerated; the leaderboard uses v1.0.0.";
      s6.appendChild(el("div", "mvx-note", vnote));
      mount.appendChild(s6);

      // Step 7 — what the config loads, and the command
      var s7 = stepBlock(7, "Load command");
      s7.appendChild(taskPanel(chosenCfg));
      s7.appendChild(instancePanel(chosenCfg));

      var result = el("div", "mvx-result");
      var needAck = ackNeeded(chosenCfg, state.version);
      var wrap = el("div", "mvx-cmd-wrap");
      var pre = el("pre", "mvx-cmd");
      pre.innerHTML = commandHTML(state.chosenConfig, state.version, isMulti(chosenCfg), needAck);
      var copy = el("button", "mvx-copy", "Copy");
      copy.onclick = function () {
        var text = commandText(state.chosenConfig, state.version, isMulti(chosenCfg), needAck);
        function done() { copy.textContent = "Copied!"; setTimeout(function () { copy.textContent = "Copy"; }, 1500); }
        function fail() { copy.textContent = "Select & copy"; setTimeout(function () { copy.textContent = "Copy"; }, 2000); }
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done, fail);
          } else { fail(); }
        } catch (e) { fail(); }
      };
      wrap.appendChild(pre); wrap.appendChild(copy);
      result.appendChild(wrap);
      result.appendChild(el("div", "mvx-note",
        "Loading a *_Test config downloads the full source dataset — the loader fetches and preprocesses the raw " +
        "images for both the training and testing subjects (the split is applied per-subject after download), so " +
        "budget for the whole dataset's footprint even when you only need the test slices."));
      s7.appendChild(result);
      mount.appendChild(s7);
    }

    // ── command builders ──────────────────────────────────────────────────────
    function esc(s) {
      return String(s).replace(/[&<>"]/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
      });
    }

    // `needed` is per config: the gate fires only when the pin is older than this config's newest
    // annotation. The VALUE is the repo release, not that annotation version — so acknowledging an
    // old KiTS23 T/L pin means "1.2.0", and the next release invalidates it again.
    function ackLine(needed, html) {
      if (!needed) return "";
      var comment = html
        ? '<span class="c"># Older than this config\'s newest annotation — acknowledge the release:</span>\n'
        : "# Older than this config's newest annotation — acknowledge the release:\n";
      var line = html
        ? 'os.environ[<span class="s">"MedVision_ACK_RELEASE"</span>] = <span class="s">"' + esc(RELEASE) + '"</span>\n'
        : 'os.environ["MedVision_ACK_RELEASE"] = "' + RELEASE + '"\n';
      return comment + line;
    }

    // The loader parses this env var as .lower() == "true", so the literal must be "true"
    // ("1"/"yes" silently do nothing). Omitted entirely for the default single-instance set.
    function multiLine(multi, html) {
      if (!multi) return "";
      return html
        ? 'os.environ[<span class="s">"MedVision_DISABLE_SAMPLE_FILTERING"</span>] = <span class="s">"true"</span>' +
          '   <span class="c"># multi-instance (unfiltered)</span>\n'
        : 'os.environ["MedVision_DISABLE_SAMPLE_FILTERING"] = "true"   # multi-instance (unfiltered)\n';
    }

    function commandText(config, version, multi, needAck) {
      return (
        "import os\n" +
        "from datasets import load_dataset          # pip install datasets==3.6.0\n\n" +
        'os.environ["MedVision_DATA_DIR"] = "/path/to/Data"\n' +
        'os.environ["MedVision_PLANNER_VERSION"] = "' + version + '"\n' +
        ackLine(needAck, false) +
        multiLine(multi, false) +
        "\n" +
        "ds = load_dataset(\n" +
        '    "YongchengYAO/MedVision",\n' +
        '    name="' + config + '",\n' +
        "    trust_remote_code=True,\n" +
        '    split="test",\n' +
        ")\n"
      );
    }

    function commandHTML(config, version, multi, needAck) {
      return (
        '<span class="k">import</span> os\n' +
        '<span class="k">from</span> datasets <span class="k">import</span> load_dataset          <span class="c"># pip install datasets==3.6.0</span>\n\n' +
        'os.environ[<span class="s">"MedVision_DATA_DIR"</span>] = <span class="s">"/path/to/Data"</span>\n' +
        'os.environ[<span class="s">"MedVision_PLANNER_VERSION"</span>] = <span class="s">"' + esc(version) + '"</span>\n' +
        ackLine(needAck, true) +
        multiLine(multi, true) +
        "\n" +
        "ds = load_dataset(\n" +
        '    <span class="s">"YongchengYAO/MedVision"</span>,\n' +
        '    name=<span class="s">"' + esc(config) + '"</span>,\n' +
        '    trust_remote_code=<span class="k">True</span>,\n' +
        '    split=<span class="s">"test"</span>,\n' +
        ")\n"
      );
    }

    render();
  });
})();
