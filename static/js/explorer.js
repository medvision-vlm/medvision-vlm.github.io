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
    var VERSIONS = DATA.versions || ["1.1.1"];
    var LATEST = DATA.latest_version || VERSIONS[0];
    var DATASET_INFO = DATA.dataset_info || {};
    var TASKS = DATA.tasks || {};
    var MODALITY_ORDER = ["CT", "MRI", "Ultrasound", "X-Ray", "PET"];

    // Anatomy pills of the current render, by group — so hovering a config can highlight the
    // anatomy it covers without re-rendering (which would drop hover/focus).
    var anatomyPills = {};

    var TASK_LABEL = {
      BoxSize: "Detection",
      TumorLesionSize: "Tumor/Lesion size",
      BiometricsFromLandmarks: "Biometrics"
    };

    // The loader's default is the single-instance (filtered) set; "multi" adds one env line.
    var state = { bodyPart: null, anatomy: {}, modality: null, dataset: null, version: LATEST,
                  instanceMode: "single" };

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

      var crumb = el("div", "mvx-crumb");
      var parts = [];
      if (state.bodyPart) parts.push(state.bodyPart);
      var anat = selectedAnatomy();
      if (anat.length) parts.push(anat.join(" · "));
      if (state.modality) parts.push(state.modality);
      if (state.dataset) { parts.push(state.dataset); parts.push("v" + state.version); }
      if (!parts.length) {
        crumb.textContent = "pick a body part to begin";
      } else {
        parts.forEach(function (p, i) {
          if (i) crumb.appendChild(el("span", "sep", "›"));  // ›
          crumb.appendChild(el("b", null, p));
        });
      }
      head.appendChild(crumb);
      return head;
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

      // Step 5 — version
      var s5 = stepBlock(5, "Annotation version");
      var ctrls = el("div", "mvx-controls");
      var sel = el("select", "mvx-select");
      VERSIONS.forEach(function (v) {
        var o = el("option", null, "v" + v + (v === LATEST ? " (latest)" : ""));
        o.value = v;
        if (v === state.version) o.selected = true;
        sel.appendChild(o);
      });
      sel.onchange = function () { state.version = sel.value; render(); };
      ctrls.appendChild(sel);
      s5.appendChild(ctrls);
      s5.appendChild(el("div", "mvx-note",
        "Only tumor/lesion (T/L) annotations differ across versions. The leaderboard uses v1.0.0; " +
        "v1.1.1 is recommended for new work."));
      mount.appendChild(s5);

      // Step 6 — matching configs + command
      var s6 = stepBlock(6, "Load command");
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
      s6.appendChild(cfgLine);
      if (chosenCfg) s6.appendChild(taskPanel(chosenCfg));
      if (chosenCfg) s6.appendChild(instancePanel(chosenCfg));

      var result = el("div", "mvx-result");
      var wrap = el("div", "mvx-cmd-wrap");
      var pre = el("pre", "mvx-cmd");
      pre.innerHTML = commandHTML(state.chosenConfig, state.version, isMulti(chosenCfg));
      var copy = el("button", "mvx-copy", "Copy");
      copy.onclick = function () {
        var text = commandText(state.chosenConfig, state.version, isMulti(chosenCfg));
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
      s6.appendChild(result);
      mount.appendChild(s6);
    }

    // ── command builders ──────────────────────────────────────────────────────
    function esc(s) {
      return String(s).replace(/[&<>"]/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
      });
    }

    function ackLine(version, html) {
      if (version === LATEST) return "";
      var comment = html
        ? '<span class="c"># Pinned below the latest — acknowledge the release:</span>\n'
        : "# Pinned below the latest — acknowledge the release:\n";
      var line = html
        ? 'os.environ[<span class="s">"MedVision_ACK_RELEASE"</span>] = <span class="s">"' + esc(LATEST) + '"</span>\n'
        : 'os.environ["MedVision_ACK_RELEASE"] = "' + LATEST + '"\n';
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

    function commandText(config, version, multi) {
      return (
        "import os\n" +
        "from datasets import load_dataset          # pip install datasets==3.6.0\n\n" +
        'os.environ["MedVision_DATA_DIR"] = "/path/to/Data"\n' +
        'os.environ["MedVision_PLANNER_VERSION"] = "' + version + '"\n' +
        ackLine(version, false) +
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

    function commandHTML(config, version, multi) {
      return (
        '<span class="k">import</span> os\n' +
        '<span class="k">from</span> datasets <span class="k">import</span> load_dataset          <span class="c"># pip install datasets==3.6.0</span>\n\n' +
        'os.environ[<span class="s">"MedVision_DATA_DIR"</span>] = <span class="s">"/path/to/Data"</span>\n' +
        'os.environ[<span class="s">"MedVision_PLANNER_VERSION"</span>] = <span class="s">"' + esc(version) + '"</span>\n' +
        ackLine(version, true) +
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
