/* ============================================================================
 * annot-preview.js — Annotation Preview filmstrip (Images & Annotations)
 * ----------------------------------------------------------------------------
 * Two groups (TL, AD), each a single rolling strip of pre-rendered
 * landmark/ellipse QC figures, round-robin interleaved across the datasets
 * currently checked in that group's dataset panel. Reads
 * window.MEDVISION_ANNOT_PREVIEW (annot-preview-data.js, loaded first).
 * No external deps.
 *
 * Tab switching itself is handled by leaderboard.js's generic .mv-tabs
 * component (static markup in explorer.md) — this script only populates the
 * dataset chips (plus an All/None quick-select pair, styled like the radar
 * widget's .mvr-quickbtn on index.md) + track inside each panel, and keeps
 * the shared count badge + play/pause button in sync on tab clicks.
 *
 * Hovering a thumbnail highlights its dataset's chip in the .ap-datasets
 * panel (amber, matching Dataset Preview's hover-probe color) — transient,
 * cleared on mouseout. Delegation lives on .ap-viewport (stable across
 * re-renders) rather than per-thumbnail, since render() rebuilds .ap-track's
 * contents on every dataset-chip toggle.
 *
 * The play/pause switch (#ap-play-toggle, static markup beside the #ap-count
 * badge) is ONE shared button, not one per group — like the count badge, it
 * always reflects whichever tab is currently active (tracked in `activeKey`)
 * and is hidden when that group has nothing animating (empty/static state).
 * Each Group still keeps its OWN `paused` flag, so switching tabs and back
 * remembers that group's state; only the button's DOM is shared.
 * ==========================================================================*/
(function () {
  "use strict";

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  function el(tag, cls) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    return node;
  }

  function reducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  // Universal rolling speed, in seconds for one figure to traverse its own width.
  // Duration MUST scale linearly with the figure count: the keyframe always travels
  // translateX(-50%) of the doubled track (== exactly one full list), so a fixed
  // duration would make a longer strip move proportionally faster. That was the old
  // behaviour -- a min(90s, ...) clamp pinned every strip to the same 225s loop, so
  // T/L (660 figures) scrolled ~6.6x faster than A/D (100), and toggling a dataset
  // silently changed the speed. Every figure shares a fixed height, so seconds-per-
  // figure is a good stand-in for pixels-per-second without measuring layout.
  var SEC_PER_FIGURE = 4.5;

  // Datasets hidden from the preview UI. Filtered here (not in the data file):
  // annot-preview-data.js is auto-generated with no hardcoded dataset list, so
  // an edit there would be clobbered on the next export.
  var EXCLUDED_DATASETS = ["AFIDs", "PDDCA", "VerSe"];

  function withoutExcluded(byDataset) {
    var out = {};
    Object.keys(byDataset || {}).forEach(function (ds) {
      if (EXCLUDED_DATASETS.indexOf(ds) === -1) out[ds] = byDataset[ds];
    });
    return out;
  }

  // Round-robin flatten so the strip mixes datasets instead of running one
  // dataset's whole block before the next.
  function interleave(perDataset, datasets) {
    var out = [];
    var i = 0;
    var remaining = true;
    while (remaining) {
      remaining = false;
      for (var d = 0; d < datasets.length; d++) {
        var list = perDataset[datasets[d]] || [];
        if (i < list.length) {
          out.push({ dataset: datasets[d], src: list[i] });
          remaining = true;
        }
      }
      i++;
    }
    return out;
  }

  function basenameNoExt(path) {
    var base = path.split("/").pop() || path;
    return base.replace(/\.[a-z0-9]+$/i, "");
  }

  function buildFig(item) {
    var caption = item.dataset + " — " + basenameNoExt(item.src);
    var frame = el("span", "ap-fig-frame");
    frame.setAttribute("data-ap-dataset", item.dataset);
    var img = el("img", "ap-fig");
    img.setAttribute("loading", "lazy");
    img.alt = caption;
    img.src = item.src;
    frame.appendChild(img);
    return frame;
  }

  function Group(key, byDataset) {
    this.key = key;
    this.byDataset = byDataset;
    this.datasets = Object.keys(byDataset).sort();
    this.selected = {};
    for (var i = 0; i < this.datasets.length; i++) this.selected[this.datasets[i]] = true;
    this.panel = document.getElementById("ap-panel-" + key.toLowerCase());
    this.tab = document.getElementById("ap-tab-" + key.toLowerCase());
    this.datasetsEl = this.panel.querySelector('.ap-datasets[data-group="' + key + '"]');
    this.viewportEl = this.panel.querySelector('.ap-viewport[data-group="' + key + '"]');
    this.trackEl = this.viewportEl.querySelector(".ap-track");
    this.emptyEl = null;
    this.paused = false; // user-toggled stop, independent of the hover-pause
  }

  Group.prototype.totalAvailable = function () {
    var n = 0;
    for (var i = 0; i < this.datasets.length; i++) n += (this.byDataset[this.datasets[i]] || []).length;
    return n;
  };

  // Row 1: label + All/None (radar-style quick-select); row 2: the dataset chips.
  Group.prototype.buildDatasetPanel = function (onChange) {
    var self = this;
    var head = el("div", "ap-datasets-head");
    var label = el("span", "ap-datasets-label");
    label.textContent = "DATASETS";
    var quick = el("div", "ap-quick");
    var allBtn = el("button", "ap-quickbtn");
    allBtn.type = "button";
    allBtn.textContent = "All";
    var noneBtn = el("button", "ap-quickbtn");
    noneBtn.type = "button";
    noneBtn.textContent = "None";
    quick.appendChild(allBtn);
    quick.appendChild(noneBtn);
    head.appendChild(label);
    head.appendChild(quick);
    this.datasetsEl.appendChild(head);

    var chipsRow = el("div", "ap-datasets-chips");
    var chips = [];
    this.datasets.forEach(function (ds) {
      // A pressed toggle button, not a native checkbox — matches every other
      // selectable control on the site (.mvp-chip / .mvx-pill / .cv-target).
      var chip = el("button", "ap-chip is-active");
      chip.type = "button";
      chip.setAttribute("data-ap-dataset", ds);
      chip.setAttribute("aria-pressed", "true");
      chip.appendChild(document.createTextNode(ds));
      var n = el("span", "ap-chip-n");
      n.textContent = "(" + self.byDataset[ds].length + ")";
      chip.appendChild(n);
      chip.addEventListener("click", function () {
        setOne(ds, chip, !self.selected[ds]);
        onChange(self);
      });
      chips.push(chip);
      chipsRow.appendChild(chip);
    });
    this.datasetsEl.appendChild(chipsRow);

    function setOne(ds, chip, on) {
      self.selected[ds] = on;
      chip.classList.toggle("is-active", on);
      chip.setAttribute("aria-pressed", on ? "true" : "false");
    }
    function setAll(on) {
      chips.forEach(function (chip, i) { setOne(self.datasets[i], chip, on); });
      onChange(self);
    }
    allBtn.addEventListener("click", function () { setAll(true); });
    noneBtn.addEventListener("click", function () { setAll(false); });
  };

  // ---- dataset-chip highlight (hover on a figure) --------------------------
  Group.prototype.highlightChip = function (ds) {
    var chips = this.datasetsEl.querySelectorAll(".ap-chip");
    for (var i = 0; i < chips.length; i++) {
      chips[i].classList.toggle("is-highlighted", chips[i].getAttribute("data-ap-dataset") === ds);
    }
  };

  Group.prototype.clearChipHighlight = function () {
    var chips = this.datasetsEl.querySelectorAll(".ap-chip");
    for (var i = 0; i < chips.length; i++) chips[i].classList.remove("is-highlighted");
  };

  Group.prototype.bindHover = function () {
    var self = this;
    // mouseover/mouseout (not mouseenter/mouseleave) so delegation on the
    // viewport works; both carry relatedTarget for the contains() guard below.
    this.viewportEl.addEventListener("mouseover", function (e) {
      var frame = e.target.closest ? e.target.closest(".ap-fig-frame") : null;
      if (frame) self.highlightChip(frame.getAttribute("data-ap-dataset"));
    });
    this.viewportEl.addEventListener("mouseout", function (e) {
      var frame = e.target.closest ? e.target.closest(".ap-fig-frame") : null;
      if (!frame || frame.contains(e.relatedTarget)) return;
      self.clearChipHighlight();
    });
  };

  Group.prototype.selectedItems = function () {
    var self = this;
    var active = this.datasets.filter(function (ds) { return self.selected[ds]; });
    return interleave(this.byDataset, active);
  };

  Group.prototype.render = function () {
    var items = this.selectedItems();
    var track = this.trackEl;
    track.innerHTML = "";
    this.viewportEl.classList.remove("is-animated", "is-static");
    if (this.emptyEl) { this.emptyEl.parentNode.removeChild(this.emptyEl); this.emptyEl = null; }

    if (!items.length) {
      this.emptyEl = el("p", "ap-empty");
      this.emptyEl.textContent = "No datasets selected — pick at least one above to preview its annotated figures.";
      this.viewportEl.appendChild(this.emptyEl);
      return items.length;
    }

    if (reducedMotion()) {
      this.viewportEl.classList.add("is-static");
      items.forEach(function (item) { track.appendChild(buildFig(item)); });
    } else {
      this.viewportEl.classList.add("is-animated");
      // Doubled track (same list twice) + a translateX(-50%) loop == seamless scroll.
      items.concat(items).forEach(function (item) { track.appendChild(buildFig(item)); });
      track.style.setProperty("--ap-duration", items.length * SEC_PER_FIGURE + "s");
    }
    return items.length;
  };

  Group.prototype.togglePlay = function () {
    this.paused = !this.paused;
    this.viewportEl.classList.toggle("is-user-paused", this.paused);
  };

  function updateCount(group) {
    var shown = group.render();
    var total = group.totalAvailable();
    document.getElementById("ap-count").textContent = shown + " / " + total + " shown";
    refreshPlayButton(group);
  }

  // Syncs the ONE shared play/pause button to `group`'s state — call only for
  // whichever group is currently the visible tab (see the header note above).
  var playToggleEl = null;
  function refreshPlayButton(group) {
    if (!playToggleEl) return;
    var animated = group.viewportEl.classList.contains("is-animated");
    playToggleEl.classList.toggle("is-hidden", !animated);
    playToggleEl.textContent = group.paused ? "▶" : "❚❚";
    // .is-on == motion is running, matching .cv-play.is-on in the case viewer.
    playToggleEl.classList.toggle("is-on", !group.paused);
    playToggleEl.setAttribute("aria-pressed", group.paused ? "true" : "false");
    playToggleEl.setAttribute("aria-label", group.paused ? "Resume rolling" : "Stop rolling");
  }

  ready(function () {
    var mount = document.getElementById("mv-annot-preview");
    if (!mount) return;

    var data = window.MEDVISION_ANNOT_PREVIEW;
    var tlData = withoutExcluded(data && data.TL);
    var adData = withoutExcluded(data && data.AD);
    if (!Object.keys(tlData).length && !Object.keys(adData).length) {
      mount.innerHTML = '<p class="cv-note">No preview figures available yet.</p>';
      return;
    }

    playToggleEl = document.getElementById("ap-play-toggle");

    var groups = {
      TL: new Group("TL", tlData),
      AD: new Group("AD", adData),
    };

    // Build + render BOTH groups upfront (so the hidden tab's track is ready the
    // instant it's switched to), but the two groups share one #ap-count badge and
    // one play/pause button, so only the group whose tab is actually visible may
    // write them — otherwise whichever group finishes initializing last silently
    // wins the shared UI.
    var activeKey = "TL";
    mount.querySelectorAll(".mv-tab").forEach(function (tab) {
      if (tab.classList.contains("is-active")) {
        activeKey = tab.id === "ap-tab-ad" ? "AD" : "TL";
      }
    });

    Object.keys(groups).forEach(function (key) {
      groups[key].bindHover();
      groups[key].buildDatasetPanel(updateCount);
      groups[key].render();
    });
    updateCount(groups[activeKey]);

    if (playToggleEl) {
      playToggleEl.addEventListener("click", function () {
        groups[activeKey].togglePlay();
        refreshPlayButton(groups[activeKey]);
      });
    }

    // Keep the shared count badge + play button in sync with whichever tab
    // leaderboard.js just switched to.
    mount.querySelectorAll(".mv-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        activeKey = tab.id === "ap-tab-ad" ? "AD" : "TL";
        updateCount(groups[activeKey]);
      });
    });
  });
})();
