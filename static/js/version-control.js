/* MedVision annotation version ledger.
 *
 * Reads window.MEDVISION_EXPLORER (the same blob the Dataset Explorer uses) and renders a
 * dataset x task-type matrix of published annotation versions, plus a planner-version selector
 * that shows what each config would load.
 *
 * The point is geometric. Each cell lists only the versions that config actually published, in
 * ascending order, every bar labelled with its own version number. Choosing a planner version
 * lights the bar that loads. Two rules the release note states in prose become things you can see:
 *
 *   resolution  — "newest annotation published at or before the pin" = the lit bar, which is the
 *                 rightmost one that is not past the pin.
 *   ack         — "the pin is older than this config's newest" = a bar sits to the RIGHT of the
 *                 lit one. That right-hand bar IS the config-specific acknowledgement value.
 *
 * MedVision_ACK_RELEASE accepts either of two values (MedVision.py::_enforce_release_ack, which
 * tests `in (ack_value, latest_version)`), and they mean different things:
 *   - the config's newest annotation — "I know this dataset moved past my pin". Precise: it stops
 *     working the next time that dataset is regenerated, so you are re-prompted then and only then.
 *   - the release version — "I have read release X". Blanket, and the only one that composes across
 *     a catalogue sweep, since one env var cannot hold several distinct per-config values.
 * The ledger shows both: the release in the command block, the per-config value in its own column.
 *
 * No external dependencies. No-op if the #mv-versions mount is absent.
 */
(function () {
  "use strict";

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  ready(function () {
    var mount = document.getElementById("mv-versions");
    if (!mount) return;

    var DATA = window.MEDVISION_EXPLORER;
    if (!DATA || !DATA.annotation_index) {
      mount.innerHTML = '<p class="mvv-empty">Version data failed to load.</p>';
      return;
    }

    var INDEX = DATA.annotation_index;
    var RELEASE = DATA.release_version;
    // The whole ledger is the annotation index exported from the medvision_ds dataset codebase, so
    // the release that produced it is stated in the header rather than left implicit.
    var DS_REPO_URL = "https://huggingface.co/datasets/YongchengYAO/MedVision";

    // The three quantitative task types, in the order they appear on the page. Mask-Size is
    // excluded here for the same reason the explorer excludes it: it is not a measurement task.
    // T/L and A/D both read the biometry plan, and no dataset carries both families
    // (MedVision.py::_BIOMETRY_FAMILY makes that assumption executable), so the biometry versions
    // land in exactly one of the two columns.
    var COLUMNS = [
      { task: "BoxSize", kind: "detection", label: "Detection" },
      { task: "TumorLesionSize", kind: "biometry", label: "Tumor / lesion size" },
      { task: "BiometricsFromLandmarks", kind: "biometry", label: "Angle / distance" }
    ];

    // ── model ─────────────────────────────────────────────────────────────────
    function vcmp(a, b) {
      var x = String(a).split("."), y = String(b).split(".");
      for (var i = 0; i < 3; i++) {
        var xi = Number(x[i] || 0), yi = Number(y[i] || 0);
        if (xi !== yi) return xi < yi ? -1 : 1;
      }
      return 0;
    }

    // Which task types each dataset actually publishes, taken from the shipped configs rather
    // than from the index: the index is keyed by plan kind, which cannot tell T/L from A/D.
    var published = {};
    (DATA.configs || []).forEach(function (c) {
      (published[c.dataset] = published[c.dataset] || {})[c.task_type] = true;
    });
    var DATASETS = Object.keys(published).sort(function (a, b) {
      return a.toLowerCase() < b.toLowerCase() ? -1 : 1;
    });

    function versionsAt(dataset, col) {
      if (!(published[dataset] || {})[col.task]) return null;      // no such task here
      return ((INDEX[dataset] || {})[col.kind] || []).slice().sort(vcmp);
    }

    // The shared axis: every release at which ANY annotation was published, oldest first.
    var AXIS = (function () {
      var seen = {};
      DATASETS.forEach(function (ds) {
        COLUMNS.forEach(function (col) {
          (versionsAt(ds, col) || []).forEach(function (v) { seen[v] = true; });
        });
      });
      return Object.keys(seen).sort(vcmp);
    })();

    // What each accepted value actually changed, from the release notes (doc/release-v1.2.0.md,
    // "How annotation versions are resolved", and doc/release-v1.2.1.md). Shown as the pill's
    // tooltip: the selector is the accepted set — the loader refuses anything else as a typo — so it
    // is the right place to say what choosing one means. Keyed by version and looked up defensively,
    // so a future version simply gets no tooltip. Everything else here is data-driven; this table
    // and its "latest" line are the one thing a release has to update by hand.
    var PIN_MEANING = {
      "latest": "Resolves to the current release, 1.2.1.",
      "1.2.1": "Corrects MAMA-MIA and PI-CAI to RAS+; their v1.2.0 is withdrawn.",
      "1.2.0": "Adds 8 datasets; existing annotations unchanged.",
      "1.1.1": "Fixes transposed in-plane voxel spacing in the tumor/lesion ellipse fit.",
      "1.1.0": "Corrected tumor/lesion filtering, cluster threshold 20px.",
      "1.0.0": "Original tumor/lesion filtering, cluster threshold 200px."
    };

    // "latest" is offered alongside the explicit releases because it is what the docs recommend;
    // it resolves to the newest release, and the readout says so rather than leaving it implicit.
    var PINS = ["latest"].concat(AXIS.slice().reverse());
    var state = { pin: "latest" };

    function pinRelease() { return state.pin === "latest" ? AXIS[AXIS.length - 1] : state.pin; }

    // Newest published version at or before the pin — null when the pin predates the config.
    function resolveAt(versions, pin) {
      var out = null;
      versions.forEach(function (v) { if (vcmp(v, pin) <= 0) out = v; });   // versions are sorted
      return out;
    }

    function cellState(versions) {
      if (versions === null) return { kind: "absent" };
      if (!versions.length) return { kind: "absent" };
      var newest = versions[versions.length - 1];
      var loaded = resolveAt(versions, pinRelease());
      // Nothing at or before the pin. The config still exists — its annotations were either first
      // published later, or withdrawn (MAMA-MIA and PI-CAI at 1.2.0, removed from the hub in
      // v1.2.1) — so this is "nothing to load here", not "not released yet". Both causes read the
      // same way to a user: the earliest version on offer is above their pin.
      if (loaded === null) return { kind: "none", newest: newest, first: versions[0] };
      return {
        kind: vcmp(loaded, newest) < 0 ? "ack" : "loaded",
        loaded: loaded, newest: newest
      };
    }

    // ── view helpers ──────────────────────────────────────────────────────────
    function el(tag, cls, text) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      return e;
    }
    function srOnly(text) { return el("span", "mvv-sr", text); }

    // Header provenance chip, shared verbatim with explorer.js (no bundler here, and each panel
    // file is self-contained). Sits between the eyebrow and the readout so the readout's
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

    // Only the env block is built as markup (it needs per-token colouring). Its interpolations are
    // generated values, but they are escaped anyway — same contract as explorer.js's command panel.
    function esc(s) {
      return String(s).replace(/[&<>"]/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
      });
    }

    function tally() {
      var t = { loaded: 0, ack: 0, none: 0, total: 0 };
      DATASETS.forEach(function (ds) {
        COLUMNS.forEach(function (col) {
          var s = cellState(versionsAt(ds, col));
          if (s.kind === "absent") return;
          t.total++;
          t[s.kind]++;
        });
      });
      return t;
    }

    // ── view ──────────────────────────────────────────────────────────────────
    function header(t) {
      var head = el("div", "mvv-head");
      var eyebrow = el("div", "mvv-eyebrow");
      eyebrow.appendChild(el("span", "mvv-dot"));
      eyebrow.appendChild(el("span", null, "ANNOTATION VERSION CONTROL"));
      head.appendChild(eyebrow);
      head.appendChild(provenanceChip());

      var readout = el("div", "mvv-readout");
      readout.appendChild(el("b", null, "v" + pinRelease()));
      readout.appendChild(el("span", "sep", "›"));
      readout.appendChild(el("span", null, t.loaded + t.ack + " of " + t.total + " configs load"));
      if (t.ack) {
        readout.appendChild(el("span", "sep", "·"));
        readout.appendChild(el("b", "is-warn", t.ack + " need acknowledgement"));
      }
      head.appendChild(readout);
      return head;
    }

    function pinPanel() {
      var block = el("div", "mvv-block");
      var lab = el("div", "mvv-label");
      lab.appendChild(el("span", null, "Planner version"));
      lab.appendChild(el("span", "mvv-hint", "what you export before loading"));
      block.appendChild(lab);

      var opts = el("div", "mvv-options");
      PINS.forEach(function (p) {
        var pill = el("button", "mvv-pill" + (state.pin === p ? " is-active" : ""));
        pill.type = "button";
        pill.appendChild(el("span", null, p === "latest" ? "latest" : "v" + p));
        if (p === "latest") pill.appendChild(el("span", "mvv-sub", "→ v" + AXIS[AXIS.length - 1]));
        pill.setAttribute("aria-pressed", state.pin === p ? "true" : "false");
        if (PIN_MEANING[p]) pill.title = PIN_MEANING[p];
        pill.onclick = function () { state.pin = p; render(); };
        opts.appendChild(pill);
      });
      block.appendChild(opts);
      return block;
    }

    // Distinct per-config acknowledgement values needed at this pin — i.e. the newest annotation of
    // each config that resolves below it. Usually one number; a sweep can hit several, which is
    // precisely why the release value exists.
    function ackValues() {
      var seen = {}, out = [];
      DATASETS.forEach(function (ds) {
        COLUMNS.forEach(function (col) {
          var st = cellState(versionsAt(ds, col));
          if (st.kind === "ack" && !seen[st.newest]) { seen[st.newest] = true; out.push(st.newest); }
        });
      });
      return out.sort(vcmp);
    }

    function envPanel(t) {
      var pre = el("pre", "mvv-cmd");
      var lines = [
        ['<span class="c"># pick the annotations, then load any config</span>'],
        ['export <span class="k">MedVision_PLANNER_VERSION</span>=<span class="s">' +
         esc(state.pin) + "</span>"]
      ];
      if (t.ack) {
        var vals = ackValues();
        lines.push("");
        lines.push('<span class="c"># ' + t.ack + (t.ack > 1
                     ? " configs resolve below their newest annotations"
                     : " config resolves below its newest annotation") +
                   ". Acknowledge with EITHER:</span>");
        lines.push('export <span class="k">MedVision_ACK_RELEASE</span>=<span class="s">' +
                   esc(RELEASE) + '</span>   <span class="c"># the whole release — needed for a sweep</span>');
        lines.push('<span class="c">#</span> export <span class="k">MedVision_ACK_RELEASE</span>=' +
                   '<span class="s">' + esc(vals.length === 1 ? vals[0] : vals.join(" | ")) +
                   '</span>   <span class="c"># that config\'s newest — see the table</span>');
      }
      pre.innerHTML = lines.join("\n");
      return pre;
    }

    function summary(t) {
      var note = el("div", "mvv-note");
      if (state.pin === "latest") {
        note.appendChild(el("b", null, "Every config loads its newest annotation. "));
        note.appendChild(document.createTextNode(
          "Nothing to acknowledge, and nothing is missing — this is the recommended setting."));
        return note;
      }
      var bits = [];
      bits.push(t.loaded + t.ack + " of " + t.total + " configs load");
      if (t.ack) bits.push(t.ack + " resolve to an older annotation and need an acknowledgement");
      note.appendChild(el("b", null, "v" + pinRelease() + ": "));
      note.appendChild(document.createTextNode(bits.join(" · ") + "."));
      return note;
    }

    function legend() {
      var wrap = el("div", "mvv-legend");
      var items = [
        ["loaded", "loads at this pin"],
        ["ack", "loads, but needs acknowledgement"],
        ["skipped", "newer annotation being skipped"]
      ];
      items.forEach(function (it) {
        var k = el("span", "mvv-key");
        k.appendChild(el("span", "mvv-swatch is-" + it[0]));
        k.appendChild(el("span", null, it[1]));
        wrap.appendChild(k);
      });
      return wrap;
    }

    // One cell: the shared axis with a bar in every published slot.
    function cell(versions, dataset, colLabel) {
      var td = el("td", "mvv-cell");
      var s = cellState(versions);
      if (s.kind === "absent") {
        td.className += " is-absent";
        td.appendChild(el("span", "mvv-dash", "—"));
        td.appendChild(srOnly(dataset + " publishes no " + colLabel + " task."));
        return td;
      }
      td.className += " is-" + s.kind;

      // Each bar carries its own version number, so a cell shows only the releases that config
      // actually published — no empty placeholder columns. Bars stay in ascending order, which is
      // what keeps the reading rule intact: the lit bar is what loads, and anything to its RIGHT
      // is a newer annotation being skipped, i.e. exactly what the acknowledgement covers.
      var bars = el("div", "mvv-bars");
      versions.forEach(function (v) {
        var cls = "mvv-bar";
        if (s.kind === "none") cls += " is-older";      // nothing lit in this cell
        else if (v === s.loaded) cls += (s.kind === "ack" ? " is-ack" : " is-loaded");
        else if (vcmp(v, s.loaded) > 0) cls += " is-skipped";
        else cls += " is-older";
        bars.appendChild(el("span", cls, v));
      });
      td.appendChild(bars);

      var msg;
      if (s.kind === "none") {
        msg = dataset + " " + colLabel + ": nothing to load at this pin — its earliest annotation " +
              "is v" + s.first + ".";
      } else if (s.kind === "ack") {
        // Both accepted values, per-config first — matching envPanel and ackCell. This string is
        // the tooltip AND the screen-reader text, and a screen-reader user never reaches the
        // acknowledge column that carries the per-config number, so naming only the release here
        // told them the panel's own story wrong.
        msg = dataset + " " + colLabel + ": loads v" + s.loaded + "; v" + s.newest +
              " exists, so MedVision_ACK_RELEASE=" + s.newest + " is required (or " + RELEASE +
              " to acknowledge the whole release).";
      } else {
        msg = dataset + " " + colLabel + ": loads v" + s.loaded + ", its newest.";
      }
      td.title = msg;
      td.appendChild(srOnly(msg));
      return td;
    }

    // The config-specific acknowledgement value: the newest annotation of each config in this row
    // that resolves below it. It is the same number as the rightmost bar in that row's cell — the
    // newer annotation being skipped — restated here as the value you would actually export.
    function ackCell(states, dataset) {
      var td = el("td", "mvv-cell mvv-ackcell");
      var vals = [], seen = {};
      states.forEach(function (st) {
        if (st.kind === "ack" && !seen[st.newest]) { seen[st.newest] = true; vals.push(st.newest); }
      });
      if (!vals.length) {
        td.className += " is-absent";
        td.appendChild(el("span", "mvv-dash", "—"));
        td.appendChild(srOnly(dataset + " needs no acknowledgement at this pin."));
        return td;
      }
      var wrap = el("div", "mvv-bars");
      vals.sort(vcmp).forEach(function (v) { wrap.appendChild(el("span", "mvv-ackval", v)); });
      td.appendChild(wrap);
      var msg = dataset + ": export MedVision_ACK_RELEASE=" + vals.join(" or ") +
                ", or " + RELEASE + " to acknowledge the whole release.";
      td.title = msg;
      td.appendChild(srOnly(msg));
      return td;
    }

    function ledger() {
      var scroll = el("div", "mvv-scroll");
      var table = el("table", "mvv-table");
      var cap = el("caption", "mvv-sr",
        "Annotation versions published for each dataset and task type, which one loads at " +
        "MedVision_PLANNER_VERSION=" + state.pin + ", and the config-specific acknowledgement value.");
      table.appendChild(cap);

      var thead = el("thead");
      var r1 = el("tr");
      var corner = el("th", "mvv-corner", "Dataset");
      corner.scope = "col";
      r1.appendChild(corner);
      COLUMNS.forEach(function (col) {
        var th = el("th", "mvv-colhead");
        th.scope = "col";
        th.appendChild(el("span", "mvv-coltitle", col.label));
        // How many datasets publish this task at all. Pin-independent, so it does not flicker as
        // you change the planner version — and it is the honest reason a column looks mostly empty.
        var n = DATASETS.filter(function (ds) { return (published[ds] || {})[col.task]; }).length;
        th.appendChild(el("span", "mvv-colcount", n + " datasets"));
        r1.appendChild(th);
      });
      var ackTh = el("th", "mvv-colhead is-ackcol");
      ackTh.scope = "col";
      ackTh.appendChild(el("span", "mvv-coltitle", "Acknowledge with"));
      ackTh.appendChild(el("span", "mvv-colcount", "or " + RELEASE));
      r1.appendChild(ackTh);
      thead.appendChild(r1);
      table.appendChild(thead);

      var tbody = el("tbody");
      DATASETS.forEach(function (ds) {
        var states = COLUMNS.map(function (col) { return cellState(versionsAt(ds, col)); });
        var needsAck = states.some(function (s) { return s.kind === "ack"; });
        var tr = el("tr", "mvv-row" + (needsAck ? " needs-ack" : ""));
        var th = el("th", "mvv-rowhead", ds);
        th.scope = "row";
        tr.appendChild(th);
        COLUMNS.forEach(function (col) {
          tr.appendChild(cell(versionsAt(ds, col), ds, col.label));
        });
        tr.appendChild(ackCell(states, ds));
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      scroll.appendChild(table);
      return scroll;
    }

    function render() {
      var t = tally();
      mount.innerHTML = "";
      mount.appendChild(header(t));
      mount.appendChild(pinPanel());
      mount.appendChild(envPanel(t));
      mount.appendChild(summary(t));
      mount.appendChild(legend());
      mount.appendChild(ledger());
    }

    render();
  });
})();
