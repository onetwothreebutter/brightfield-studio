// Reference consumers for the probabilistic palette engine.
//
// These exist to *evaluate* palettes — the sample grid in the palette lab needs
// something to color — and to prove the palette layer is algorithm-agnostic:
// both generators below produce plain shape records and neither knows anything
// about weights, spatial fields, or sparks. Any other Brightfield generative
// algorithm can adopt the palette by emitting the same records.
//
// Shape record contract:
//   { x, y, size, parentIndex, ...draw data }   x/y/size normalized 0–1
//
// Geometry is seeded independently of color, so changing palette settings
// re-colors an identical composition rather than reshuffling it.
(function () {
  'use strict';

  var PP = window.ProbabilisticPalette;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // ── Algorithm: subdivision ────────────────────────────────────────────────
  // Recursive rect splitting. Gives every shape a genuine parent, which is what
  // makes color inheritance read as contiguous regions rather than noise.

  function generateSubdivision(opts) {
    var rng = PP.makeRng(PP.deriveSeed(opts.seed, 'geom', 'subdivision', opts.depth, opts.splitBias));
    var maxDepth = opts.depth || 5;
    var splitBias = opts.splitBias != null ? opts.splitBias : 0.85;
    var shapes = [];
    // The first few levels always split: without a guaranteed floor an unlucky
    // seed returns a handful of huge boxes, which tells you nothing about a
    // palette's size rules or its rare colors.
    var minDepth = Math.min(3, maxDepth);

    function subdivide(x, y, w, h, depth, parentIndex) {
      var keepSplitting = depth < maxDepth && (depth < minDepth || rng() < splitBias);
      if (!keepSplitting || w < 0.04 || h < 0.04) {
        var pad = 0.12 * Math.min(w, h) * rng();
        shapes.push({
          kind: rng() < 0.24 ? 'ellipse' : 'rect',
          x: x + w / 2, y: y + h / 2,
          w: w - pad, h: h - pad,
          extent: Math.sqrt((w - pad) * (h - pad)),
          parentIndex: parentIndex
        });
        return shapes.length - 1;
      }
      var vertical = (w >= h) ? rng() < 0.8 : rng() < 0.2;
      var cut = 0.3 + rng() * 0.4;
      var firstLeaf = -1;
      var boxes = vertical
        ? [[x, y, w * cut, h], [x + w * cut, y, w * (1 - cut), h]]
        : [[x, y, w, h * cut], [x, y + h * cut, w, h * (1 - cut)]];

      for (var i = 0; i < boxes.length; i++) {
        var b = boxes[i];
        // Later siblings hang off the branch's first leaf, so a whole branch
        // tends to share a color family once inheritance is turned up.
        var leaf = subdivide(b[0], b[1], b[2], b[3], depth + 1, i === 0 ? parentIndex : firstLeaf);
        if (i === 0) firstLeaf = leaf;
      }
      return firstLeaf;
    }

    subdivide(0, 0, 1, 1, 0, null);
    return normalizeSizes(shapes);
  }

  // ── Algorithm: scatter ────────────────────────────────────────────────────
  // Loose circle/ring packing with a power-law radius distribution, so the
  // composition has a genuine spread of shape sizes for size-aware palettes to
  // bite on. Parents are the nearest already-placed neighbor.

  function generateScatter(opts) {
    var rng = PP.makeRng(PP.deriveSeed(opts.seed, 'geom', 'scatter', opts.count, opts.sizeSpread));
    var count = opts.count || 90;
    var spread = opts.sizeSpread != null ? opts.sizeSpread : 2.4;
    var shapes = [];

    for (var i = 0; i < count; i++) {
      // Math.pow(u, spread) biases hard toward small radii; larger `spread`
      // means fewer big shapes and a longer tail of tiny ones.
      var r = 0.012 + Math.pow(rng(), spread) * 0.16;
      var x = r + rng() * (1 - 2 * r);
      var y = r + rng() * (1 - 2 * r);

      var parentIndex = null, best = Infinity;
      for (var j = 0; j < shapes.length; j++) {
        var dx = shapes[j].x - x, dy = shapes[j].y - y;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < best) { best = d; parentIndex = j; }
      }
      // Only inherit from a neighbor that is actually nearby — otherwise an
      // isolated shape would take its color from across the canvas.
      if (best > 0.22) parentIndex = null;

      shapes.push({
        kind: rng() < 0.22 ? 'ring' : 'ellipse',
        x: x, y: y, w: r * 2, h: r * 2, extent: r * 2,
        ringWidth: 0.25 + rng() * 0.3,
        parentIndex: parentIndex
      });
    }
    return normalizeSizes(shapes);
  }

  // `size` is the normalized 0–1 rank of a shape's extent within its own
  // composition — that is what geometry-aware palette rules are written
  // against, so it must not depend on canvas pixel dimensions.
  function normalizeSizes(shapes) {
    if (!shapes.length) return shapes;
    var min = Infinity, max = -Infinity;
    shapes.forEach(function (s) {
      if (s.extent < min) min = s.extent;
      if (s.extent > max) max = s.extent;
    });
    var span = max - min;
    shapes.forEach(function (s) { s.size = span > 0 ? (s.extent - min) / span : 0.5; });
    return shapes;
  }

  var ALGORITHMS = {
    subdivision: { label: 'Subdivision', generate: generateSubdivision },
    scatter:     { label: 'Scatter',     generate: generateScatter }
  };

  function generate(algorithm, opts) {
    var algo = ALGORITHMS[algorithm] || ALGORITHMS.subdivision;
    return algo.generate(opts || {});
  }

  // ── Render ────────────────────────────────────────────────────────────────

  // The shirt is not painted as a color — unprinted shapes are simply never
  // drawn, so the garment shows through. `shirt` only fills the preview canvas
  // so the page can show what the print looks like on black cotton.
  function render(ctx, shapes, palette, opts) {
    opts = opts || {};
    var w = opts.width || ctx.canvas.width;
    var h = opts.height || ctx.canvas.height;
    var assigner = PP.createAssigner(palette, { seed: opts.seed, totalShapes: shapes.length });

    ctx.clearRect(0, 0, w, h);
    if (opts.shirt !== false) {
      ctx.fillStyle = opts.shirt || '#0d0d0f';
      ctx.fillRect(0, 0, w, h);
    }

    shapes.forEach(function (s, i) {
      var a = assigner.assign({ index: i, x: s.x, y: s.y, size: s.size, parentIndex: s.parentIndex });
      if (!a.printed || !a.color) return;   // shirt shows through — no black ink
      ctx.fillStyle = a.color;
      ctx.strokeStyle = a.color;
      var cx = s.x * w, cy = s.y * h, sw = s.w * w, sh = s.h * h;
      // Round shapes scale off the short edge so they stay round on a
      // non-square print area; rects keep their own aspect and fill the grid.
      var r = (s.w / 2) * Math.min(w, h);

      if (s.kind === 'rect') {
        ctx.fillRect(cx - sw / 2, cy - sh / 2, sw, sh);
      } else if (s.kind === 'ring') {
        var lw = Math.max(1, r * s.ringWidth);
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(0.5, r - lw / 2), 0, Math.PI * 2);
        ctx.stroke();
      } else if (s.kind === 'ellipse' && s.h !== s.w) {
        // Subdivision cells are rectangular by construction — an inscribed
        // ellipse is the shape that belongs there.
        ctx.beginPath();
        ctx.ellipse(cx, cy, sw / 2, sh / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    return assigner;
  }

  window.ProbabilisticPaletteDemo = {
    ALGORITHMS: ALGORITHMS,
    generate: generate,
    render: render
  };
})();
