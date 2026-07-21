/* ==========================================================================
   Leaderboard tables — sortable metrics, sub-task tabs, low-SR marking.

   Progressive enhancement: every table below stays readable with JS disabled;
   this module only adds interaction on top of the static markup.

   Applies to any <table class="mv-sortable">. Structure is read from the
   markup rather than configured here:

     - Column groups come from the colspan cells in the first <thead> row
       (tables with a flat single-row header are treated as one group).
     - The SR column of each group is found by its header text.
     - Sorting is one-way and follows the header arrow: &uarr; = higher is
       better, &darr; = lower is better. Clicking a metric always ranks its
       best value into the first row; there is no worst-first toggle.

   Cells may carry medal emoji ("7.8 🥉"), a currency prefix ("$101.3") or a
   dagger ("79.2 †"); all are stripped before comparison.
   ========================================================================== */
(function () {
  "use strict";

  /* Marks that scripting is available, so the stylesheet can collapse the
     inactive tab panels before first paint. Without JS every panel stays
     stacked and visible instead of being unreachable. */
  document.documentElement.classList.add("mv-js");

  /* Mark a sub-task's metrics when its success rate falls below this, since
     the remaining numbers are then computed on a minority of samples. */
  var SR_MIN = 50;

  function text(node) {
    return (node.textContent || "").replace(/\s+/g, " ").trim();
  }

  /* Numeric value of a data cell, or NaN when the cell holds no number.
     NaN always sorts last regardless of direction. */
  function value(cell) {
    var raw = text(cell).replace(/,/g, "").replace(/[^0-9.eE+-]/g, "");
    var n = parseFloat(raw);
    return isFinite(n) ? n : NaN;
  }

  /* Higher-is-better unless the header carries a down arrow. */
  function higherIsBetter(th) {
    return text(th).indexOf("↓") === -1;
  }

  function bodyRows(table) {
    var tb = table.tBodies[0];
    return tb ? Array.prototype.slice.call(tb.rows) : [];
  }

  /* ---- Header analysis --------------------------------------------------
     Returns { metricThs, groups } where metricThs[i] is the header for body
     cell i + 1 (cell 0 is always the model name), and each group is
     { first, last, srIndex } in metric-index space. */
  function analyze(table) {
    var head = table.tHead;
    if (!head || !head.rows.length) return null;

    var rows = head.rows;
    var twoRow = rows.length > 1;
    var metricThs = twoRow
      ? Array.prototype.slice.call(rows[1].cells)
      : Array.prototype.slice.call(rows[0].cells).slice(1);

    var groups = [];
    if (twoRow) {
      var at = 0;
      var top = Array.prototype.slice.call(rows[0].cells);
      for (var i = 0; i < top.length; i++) {
        var th = top[i];
        /* The model header spans both rows and covers no metric columns. */
        if (th.rowSpan > 1) continue;
        var span = th.colSpan || 1;
        groups.push({ first: at, last: at + span - 1, srIndex: -1 });
        at += span;
      }
    }
    /* Flat header, or a top row that described no groups: one group covering
       every metric column. */
    if (!groups.length) {
      groups.push({ first: 0, last: metricThs.length - 1, srIndex: -1 });
    }

    for (var g = 0; g < groups.length; g++) {
      for (var m = groups[g].first; m <= groups[g].last; m++) {
        if (metricThs[m] && /^SR\b/i.test(text(metricThs[m]))) {
          groups[g].srIndex = m;
          break;
        }
      }
    }
    return { metricThs: metricThs, groups: groups };
  }

  /* ---- Low-SR marking ---------------------------------------------------
     Mark only the metrics of the sub-task that fell below SR_MIN. A model can
     be reliable on one sub-task and not another, so the model name and the
     other groups are left alone. */
  function shade(table, info) {
    var rows = bodyRows(table);
    for (var r = 0; r < rows.length; r++) {
      var cells = rows[r].cells;
      for (var g = 0; g < info.groups.length; g++) {
        var grp = info.groups[g];
        if (grp.srIndex < 0) continue;
        var sr = value(cells[grp.srIndex + 1]);
        if (isNaN(sr) || sr >= SR_MIN) continue;
        for (var m = grp.first; m <= grp.last; m++) {
          if (cells[m + 1]) cells[m + 1].classList.add("is-lowsr");
        }
      }
    }
  }

  /* ---- Sorting ---------------------------------------------------------- */
  function sortBy(table, info, metricIndex, descending) {
    var col = metricIndex + 1;
    var rows = bodyRows(table);

    /* Decorate-sort-undecorate keeps ties in their existing order, so the
       curated ordering still shows through wherever metrics are equal. */
    var decorated = rows.map(function (row, i) {
      return { row: row, v: value(row.cells[col]), i: i };
    });
    decorated.sort(function (a, b) {
      var an = isNaN(a.v), bn = isNaN(b.v);
      if (an && bn) return a.i - b.i;
      if (an) return 1;
      if (bn) return -1;
      if (a.v === b.v) return a.i - b.i;
      return descending ? b.v - a.v : a.v - b.v;
    });

    var tb = table.tBodies[0];
    var frag = document.createDocumentFragment();
    for (var k = 0; k < decorated.length; k++) frag.appendChild(decorated[k].row);
    tb.appendChild(frag);

    for (var t = 0; t < info.metricThs.length; t++) {
      var th = info.metricThs[t];
      var active = t === metricIndex;
      th.classList.toggle("is-sorted", active);
      th.classList.toggle("is-sortcol", active);
      th.setAttribute("aria-sort", active ? (descending ? "descending" : "ascending") : "none");
    }
    /* Wash the active column down the table — with no sort arrow to point at,
       this is what identifies which metric the order came from. */
    for (var r2 = 0; r2 < rows.length; r2++) {
      var cs = rows[r2].cells;
      for (var c2 = 1; c2 < cs.length; c2++) {
        cs[c2].classList.toggle("is-sortcol", c2 === col);
      }
    }
    table.setAttribute("data-sorted-by", String(metricIndex));
  }

  /* Mark the first column of each sub-task after the first, so the stylesheet
     can draw a rule exactly where one measured group gives way to the next. */
  function markGroups(table, info) {
    var rows = bodyRows(table);
    var top = table.tHead.rows.length > 1
      ? Array.prototype.slice.call(table.tHead.rows[0].cells).filter(function (c) { return c.rowSpan <= 1; })
      : [];
    for (var g = 1; g < info.groups.length; g++) {
      var m = info.groups[g].first;
      if (info.metricThs[m]) info.metricThs[m].classList.add("is-groupstart");
      if (top[g]) top[g].classList.add("is-groupstart");
      for (var r = 0; r < rows.length; r++) {
        if (rows[r].cells[m + 1]) rows[r].cells[m + 1].classList.add("is-groupstart");
      }
    }
  }

  function initTable(table) {
    var info = analyze(table);
    if (!info || !info.metricThs.length) return;

    shade(table, info);
    markGroups(table, info);

    info.metricThs.forEach(function (th, idx) {
      th.classList.add("mv-th-sort");
      th.setAttribute("tabindex", "0");
      /* No role="button" here: that would override the th's implicit
         columnheader role, breaking the header/data-cell association screen
         readers rely on, and aria-sort is only honoured on columnheader. The
         keydown handler below supplies the keyboard behaviour instead. */
      th.setAttribute("aria-sort", "none");
      th.setAttribute("title", "Sort by " + text(th).replace(/[↑↓]/g, "").trim() + " — best first");

      function activate() {
        /* One-way. A metric always sorts its best value into the first row —
           the header arrow already declares which direction "best" runs, so a
           reversing toggle would only ever produce a worst-first ranking. */
        sortBy(table, info, idx, higherIsBetter(th));
      }

      th.addEventListener("click", activate);
      th.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
          e.preventDefault();
          activate();
        }
      });
    });

    /* Default ordering: best-first on the column named by data-default-sort,
       falling back to the first metric. */
    var def = parseInt(table.getAttribute("data-default-sort"), 10);
    if (isNaN(def) || def < 0 || def >= info.metricThs.length) def = 0;
    sortBy(table, info, def, higherIsBetter(info.metricThs[def]));
  }

  /* ---- Tabs -------------------------------------------------------------
     Sub-task switcher (e.g. Angle vs Distance). Panels are plain elements;
     only the active one is shown. */
  function initTabs(root) {
    var tabs = Array.prototype.slice.call(root.querySelectorAll(".mv-tab"));
    if (!tabs.length) return;

    function show(idx) {
      tabs.forEach(function (tab, i) {
        var panel = document.getElementById(tab.getAttribute("aria-controls"));
        var active = i === idx;
        tab.classList.toggle("is-active", active);
        tab.setAttribute("aria-selected", active ? "true" : "false");
        tab.setAttribute("tabindex", active ? "0" : "-1");
        if (panel) panel.hidden = !active;
      });
    }

    tabs.forEach(function (tab, i) {
      tab.addEventListener("click", function () { show(i); });
      tab.addEventListener("keydown", function (e) {
        var next = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : -1;
        if (next < 0 || next >= tabs.length) return;
        e.preventDefault();
        tabs[next].focus();
        show(next);
      });
    });

    var initial = 0;
    tabs.forEach(function (tab, i) {
      if (tab.classList.contains("is-active")) initial = i;
    });
    show(initial);
    /* Hands panel visibility over from the pre-paint CSS rule to [hidden]. */
    root.classList.add("is-ready");
  }

  document.addEventListener("DOMContentLoaded", function () {
    /* Isolated so one malformed table cannot abort the loop and leave a later
       tab group uninitialised — which would strand its panels hidden. */
    function safely(fn) {
      return function (node) {
        try { fn(node); } catch (e) { if (typeof console !== "undefined") console.error(e); }
      };
    }
    Array.prototype.forEach.call(
      document.querySelectorAll("table.mv-sortable"),
      safely(initTable)
    );
    Array.prototype.forEach.call(
      document.querySelectorAll(".mv-tabs"),
      safely(initTabs)
    );
  });
})();
