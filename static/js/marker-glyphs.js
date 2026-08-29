/* Matplotlib marker glyphs as SVG, shared by the interactive twins of the detection figures
 * (boxsize.js, boxratio.js).
 *
 * Both figures identify a model by its matplotlib marker name, exported verbatim in the data
 * blobs, so the page has to draw the same glyph vocabulary matplotlib does: o s D p d ^ v < > X
 * P H * h 8 1 2 3 4 x. Drawing them in one place keeps the legend chip and the plotted point
 * identical, and keeps the two widgets from drifting apart.
 *
 * Fill follows the source figure, and differs between the two:
 *   - fig_detection__metrics-boxSize (boxsize.js) plots facecolors="none", so markers are HOLLOW
 *     with a coloured edge — colour there encodes the box ratio, not the model;
 *   - metrics_boxImgRatio-dotline (boxratio.js) uses plot()'s default, so markers are FILLED in
 *     the model's line colour.
 * The "1".."4" and "x" glyphs are stroke-only in matplotlib too, so `filled` does not apply.
 *
 * Exposes window.MedVisionMarkers = { node, swatch }. No dependencies; safe to load anywhere.
 */
(function () {
  "use strict";

  var SVGNS = "http://www.w3.org/2000/svg";

  function svg(tag, attrs) {
    var e = document.createElementNS(SVGNS, tag);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function poly(pts) {
    return pts.map(function (p) { return p[0].toFixed(2) + "," + p[1].toFixed(2); }).join("L");
  }
  // n points on a circle of radius r, first point at `phase` clockwise from 12 o'clock.
  function ring(n, r, phase) {
    var pts = [];
    for (var i = 0; i < n; i++) {
      var a = phase + (i / n) * 2 * Math.PI;
      pts.push([r * Math.sin(a), -r * Math.cos(a)]);
    }
    return pts;
  }
  function star(r) {
    var pts = [];
    for (var i = 0; i < 10; i++) {
      var a = -Math.PI / 2 + (i / 10) * 2 * Math.PI;
      var rr = i % 2 === 0 ? r : r * 0.4;
      pts.push([rr * Math.cos(a), rr * Math.sin(a)]);
    }
    return pts;
  }
  // Outline of matplotlib's filled plus ("P") / filled x ("X") — a 12-point cross.
  function cross(r, rot) {
    var a = r * 0.36, b = r;
    var pts = [[-a, -b], [a, -b], [a, -a], [b, -a], [b, a], [a, a],
    [a, b], [-a, b], [-a, a], [-b, a], [-b, -a], [-a, -a]];
    if (!rot) return pts;
    var c = Math.cos(rot), s = Math.sin(rot);
    return pts.map(function (p) { return [p[0] * c - p[1] * s, p[0] * s + p[1] * c]; });
  }
  // Three spokes from the centre — matplotlib's tri_down / tri_up / tri_left / tri_right.
  function tri(dirs, r) {
    return dirs.map(function (d) {
      return "M0,0L" + (d[0] * r).toFixed(2) + "," + (d[1] * r).toFixed(2);
    }).join("");
  }

  var CLOSED = {
    s: function (r) { return ring(4, r, Math.PI / 4); },
    D: function (r) { return ring(4, r, 0); },
    d: function (r) { return [[0, -r], [r * 0.55, 0], [0, r], [-r * 0.55, 0]]; },
    p: function (r) { return ring(5, r, 0); },
    h: function (r) { return ring(6, r, 0); },
    H: function (r) { return ring(6, r, Math.PI / 6); },
    "8": function (r) { return ring(8, r, 0); },
    "^": function (r) { return ring(3, r, 0); },
    v: function (r) { return ring(3, r, Math.PI); },
    "<": function (r) { return ring(3, r, -Math.PI / 2); },
    ">": function (r) { return ring(3, r, Math.PI / 2); },
    "*": star,
    P: function (r) { return cross(r, 0); },
    X: function (r) { return cross(r, Math.PI / 4); }
  };
  var STROKED = {
    "1": [[0, 1], [-0.87, -0.5], [0.87, -0.5]],
    "2": [[0, -1], [-0.87, 0.5], [0.87, 0.5]],
    "3": [[-1, 0], [0.5, -0.87], [0.5, 0.87]],
    "4": [[1, 0], [-0.5, -0.87], [-0.5, 0.87]]
  };

  /* One marker centred on (cx, cy) with "radius" r, in `color`. */
  function node(marker, cx, cy, r, color, filled) {
    var at = "translate(" + cx.toFixed(2) + "," + cy.toFixed(2) + ")";
    var face = filled ? color : "none";
    if (marker === "o") {
      return svg("circle", {
        cx: cx, cy: cy, r: r, fill: face, stroke: color, "stroke-width": filled ? 0.8 : 1.7
      });
    }
    if (CLOSED[marker]) {
      return svg("path", {
        d: "M" + poly(CLOSED[marker](r)) + "Z", transform: at,
        fill: face, stroke: color, "stroke-width": filled ? 0.8 : 1.7, "stroke-linejoin": "round"
      });
    }
    if (marker === "x") {
      var q = r * 0.75;
      return svg("path", {
        d: "M" + (-q).toFixed(2) + "," + (-q).toFixed(2) + "L" + q.toFixed(2) + "," + q.toFixed(2) +
          "M" + (-q).toFixed(2) + "," + q.toFixed(2) + "L" + q.toFixed(2) + "," + (-q).toFixed(2),
        transform: at, fill: "none", stroke: color, "stroke-width": 1.9, "stroke-linecap": "round"
      });
    }
    if (STROKED[marker]) {
      return svg("path", {
        d: tri(STROKED[marker], r), transform: at,
        fill: "none", stroke: color, "stroke-width": 1.9, "stroke-linecap": "round"
      });
    }
    // Unknown glyph: a circle is a readable stand-in, and the legend still names the series.
    return svg("circle", {
      cx: cx, cy: cy, r: r, fill: face, stroke: color, "stroke-width": filled ? 0.8 : 1.7
    });
  }

  /* A 16x16 inline <svg> of one marker, for a legend chip or a tooltip header. */
  function swatch(marker, color, filled, cls) {
    var s = svg("svg", { viewBox: "0 0 16 16", class: cls || "mvb-glyph", "aria-hidden": "true" });
    s.appendChild(node(marker, 8, 8, 5, color, filled));
    return s;
  }

  window.MedVisionMarkers = { node: node, swatch: swatch };
})();
