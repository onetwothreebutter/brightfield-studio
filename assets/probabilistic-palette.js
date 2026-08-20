// Probabilistic Color Palette — core engine.
//
// A palette here is not a list of colors to pick from uniformly. It is a
// *color system*: a vocabulary (which colors exist), a hierarchy (how likely
// each one is), a geography (how those likelihoods shift across the canvas and
// with shape size), and a controlled amount of seed-driven variation. The goal
// is output that feels related without feeling identical.
//
// This file is deliberately DOM-free and renderer-free so the same palette can
// drive any generative algorithm. `probabilistic-palette-ui.js` is the editor,
// `probabilistic-palette-demo.js` is one reference consumer.
//
// Everything random routes through the seeded RNG below — never Math.random —
// so (seed + geometry + palette + settings) always reproduces the same output.
(function () {
  'use strict';

  // ── Seeded RNG ────────────────────────────────────────────────────────────
  // xfnv1a string hash + mulberry32. Both are tiny, well-distributed, and (the
  // reason they're used here rather than anything fancier) exactly reproducible
  // across browsers and Node, which is what determinism actually requires.

  function hashString(str) {
    var h = 2166136261 >>> 0;
    str = String(str);
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // Combines a base seed with arbitrary tag parts into a new uint32 seed. Used
  // to give every decision its own independent stream, so that (say) changing
  // the print-density roll for shape 12 can't shift the color roll for shape 13.
  function deriveSeed(seed) {
    var parts = Array.prototype.slice.call(arguments, 1);
    return hashString(String(seed) + '\u0000' + parts.join('\u0000'));
  }

  function makeRng(seed) {
    var a = (typeof seed === 'number' ? seed : hashString(seed)) >>> 0;
    return function rng() {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Symmetric [-1, 1] draw — the shape generative weight variation wants.
  function rngSigned(rng) { return rng() * 2 - 1; }

  // ── Per-element rolls, for decisions a GPU has to make ────────────────────
  // A fragment shader can't call deriveSeed: it has no strings, and it reaches
  // its element by computing an index, not by walking a list. So an element's
  // stream is mixed from an integer instead — the golden-ratio constant is the
  // standard 32-bit spread, and it is the only thing that differs from the tag
  // path above.
  //
  // Both functions exist so the GLSL in shader-base.js has something to be a
  // transcription *of*: makeRng is pure uint32 arithmetic (Math.imul is the low
  // 32 bits of the product, `>>>` wraps), and WebGL2 uint math wraps mod 2^32
  // the same way, so the shader reaches the same decision as this does — on
  // every GPU, without a readback. `test/probabilistic-palette.test.js` pins
  // the values the GLSL is expected to reproduce.
  function elementSeed(base, id) {
    return ((base >>> 0) ^ Math.imul(id >>> 0, 0x9E3779B1)) >>> 0;
  }

  // The odds an element prints, given how much of the design's ink it carries.
  //
  // A flat roll makes `printDensity` mean "this fraction of *elements*", which
  // is the honest reading when elements are interchangeable — a halftone dot
  // grid — and a misleading one when they are not. circle-on-line's power warp
  // makes its first line about 6x the average cell and its last about 0.4x, so
  // a flat roll lets one coin flip delete a third of the artwork.
  //
  // `weight` is the element's extent relative to the average (1 = average), and
  // the exponent form is what makes this usable in a fragment shader: it needs
  // nothing but the element's own weight — no total, no second pass, no sorting
  // — and it preserves both endpoints exactly, since density 0 and 1 are fixed
  // points of pow(). Bigger than average ⇒ exponent below 1 ⇒ likelier to print.
  // isFinite before clamp, not clamp alone: NaN fails both of clamp's
  // comparisons and falls straight through it, which would turn one bad weight
  // into a NaN chance and an element that neither prints nor doesn't.
  function elementPrintChance(density, weight) {
    var d = typeof density === 'number' && isFinite(density) ? clamp(density, 0, 1) : 1;
    var w = typeof weight === 'number' && isFinite(weight) ? clamp(weight, 0.05, 20) : 1;
    return Math.pow(d, 1 / w);
  }

  // The single draw a print/skip decision is: printed when roll < the chance above.
  //
  // Quantized to 24 bits rather than the full 32 makeRng returns, because a
  // fragment shader's float carries a 24-bit mantissa at best and cannot hold
  // the wider value. Throwing the same 8 bits away on this side is what makes
  // the GPU's roll the same decision as this one instead of nearly it — the
  // multiply is exact, since makeRng's output is k/2^32 for integer k.
  function elementRoll(base, id) {
    return ((makeRng(elementSeed(base, id))() * 4294967296) >>> 8) / 16777216;
  }

  // ── Weights ───────────────────────────────────────────────────────────────

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // Weights never have to sum to 1 — anywhere a caller supplies them, they are
  // normalized on read. `[3, 1]` and `[0.75, 0.25]` are the same palette.
  function normalizeWeights(weights) {
    var total = 0, i;
    for (i = 0; i < weights.length; i++) {
      var w = weights[i];
      total += (typeof w === 'number' && isFinite(w) && w > 0) ? w : 0;
    }
    var out = new Array(weights.length);
    for (i = 0; i < weights.length; i++) {
      var v = weights[i];
      v = (typeof v === 'number' && isFinite(v) && v > 0) ? v : 0;
      out[i] = total > 0 ? v / total : (1 / weights.length);
    }
    return out;
  }

  function weightsOf(colors) {
    return colors.map(function (c) { return c && typeof c.weight === 'number' ? c.weight : 0; });
  }

  // Normalized share (0–1) of each entry in a `[{ color, weight }]` list.
  function paletteShares(colors) { return normalizeWeights(weightsOf(colors)); }

  // ── Weighted pick ─────────────────────────────────────────────────────────

  // Index-level primitive. `rng` must be a seeded generator (see makeRng).
  function weightedRandomIndex(weights, rng) {
    if (!weights || !weights.length) return -1;
    var norm = normalizeWeights(weights);
    var r = rng(), acc = 0;
    for (var i = 0; i < norm.length; i++) {
      acc += norm[i];
      if (r < acc) return i;
    }
    // Only reachable through float drift at the very top of the range.
    for (var j = norm.length - 1; j >= 0; j--) if (norm[j] > 0) return j;
    return norm.length - 1;
  }

  // The reusable utility: pick one color from `[{ color, weight }]` according
  // to its weights. Weights auto-normalize, so they need not sum to 1.
  function weightedRandomColor(palette, rng) {
    if (!palette || !palette.length) return null;
    var idx = weightedRandomIndex(weightsOf(palette), rng || makeRng(0));
    return idx < 0 ? null : palette[idx].color;
  }

  // ── Hierarchy tiers ───────────────────────────────────────────────────────
  // Thresholds are on the normalized share, so they read the same regardless of
  // whether the author typed weights as percentages, counts, or fractions.

  var TIER_THRESHOLDS = { dominant: 0.28, supporting: 0.13, accent: 0.04 };

  var TIERS = {
    dominant:   { key: 'dominant',   label: 'Dominant' },
    supporting: { key: 'supporting', label: 'Supporting' },
    accent:     { key: 'accent',     label: 'Accent' },
    spark:      { key: 'spark',      label: 'Spark' }
  };

  // A color explicitly marked as a spark stays a spark even if its weight
  // drifts up — the author's intent outranks the arithmetic.
  function classifyTier(share, entry) {
    if (entry && entry.spark) return 'spark';
    if (share >= TIER_THRESHOLDS.dominant) return 'dominant';
    if (share >= TIER_THRESHOLDS.supporting) return 'supporting';
    if (share >= TIER_THRESHOLDS.accent) return 'accent';
    return 'spark';
  }

  function classifyPalette(colors) {
    var shares = paletteShares(colors);
    return colors.map(function (c, i) { return classifyTier(shares[i], c); });
  }

  // ── Generative weights ────────────────────────────────────────────────────
  // The seed nudges the base probabilities so each artwork gets its own read on
  // the palette, while the palette stays recognizable. Variation is
  // multiplicative and log-symmetric (a color is as likely to halve as to
  // double at a given magnitude), then renormalized.
  //
  // Colors with `variationScale: 0` are held at their exact base share — the
  // usual choice for sparks, where 2% drifting to 3% is a meaningful change in
  // how special the color feels. Locked shares are reserved first and the
  // remaining budget is split among the varied colors.

  var MAX_LOG_SWING = 1.5; // variation 1.0 → up to e^1.5 ≈ 4.5x on a color

  function applyGenerativeVariation(colors, seed, variation) {
    var base = paletteShares(colors);
    if (!colors.length || !variation) return base;
    var amount = clamp(variation, 0, 1);

    var lockedTotal = 0, variedTotal = 0;
    var varied = new Array(colors.length);

    colors.forEach(function (c, i) {
      var scale = c && typeof c.variationScale === 'number' ? clamp(c.variationScale, 0, 1) : 1;
      if (scale === 0 || base[i] === 0) {
        varied[i] = null;
        lockedTotal += base[i];
        return;
      }
      // One stream per color index, so adding a color to the end of the palette
      // doesn't re-roll the ones before it.
      var rng = makeRng(deriveSeed(seed, 'weight-variation', i, c.id || c.color));
      // `scale` is graduated, not just a 0/1 lock: the field is named and
      // clamped as an amplitude, so it has to behave like one. Every shipped
      // caller passes 0 or nothing, so this changes no current output.
      var swing = rngSigned(rng) * amount * scale * MAX_LOG_SWING;
      varied[i] = base[i] * Math.exp(swing);
      variedTotal += varied[i];
    });

    var budget = 1 - lockedTotal;
    return base.map(function (b, i) {
      if (varied[i] === null) return b;
      return variedTotal > 0 ? (varied[i] / variedTotal) * budget : b;
    });
  }

  // ── Spatial probability fields ────────────────────────────────────────────
  // Each mode maps a normalized canvas position to t ∈ [0, 1]. Per-color
  // `spatial: [wNear, wFar]` weights are then interpolated at t. Probabilities
  // are interpolated — never the RGB values — so every shape keeps a discrete
  // palette color while the composition drifts between color families.

  var SPATIAL_MODES = {
    'top-bottom':  { label: 'Top → Bottom',  field: function (x, y) { return clamp(y, 0, 1); } },
    'left-right':  { label: 'Left → Right',  field: function (x)    { return clamp(x, 0, 1); } },
    'center-edge': { label: 'Center → Edge', field: function (x, y) {
      // Chebyshev distance from center: iso-lines are squares, so the field
      // reaches 1 in the corners *and* at the edge midpoints of a square canvas.
      return clamp(Math.max(Math.abs(x - 0.5), Math.abs(y - 0.5)) * 2, 0, 1);
    } },
    'radial':      { label: 'Radial', field: function (x, y) {
      var dx = x - 0.5, dy = y - 0.5;
      return clamp(Math.sqrt(dx * dx + dy * dy) / 0.7071067811865476, 0, 1);
    } }
  };

  function spatialField(mode, x, y) {
    var m = SPATIAL_MODES[mode] || SPATIAL_MODES['top-bottom'];
    return m.field(x, y);
  }

  // ── Geometry-aware modifiers ──────────────────────────────────────────────
  // `sizeCurve` is a piecewise-linear multiplier over normalized shape size
  // (0 = smallest shape in the composition, 1 = largest), given as
  // [[t, multiplier], ...]. Deliberately generic: "large shapes are mostly
  // ivory and blue" is expressed as curves, not special-cased in code.
  //
  //   ivory: [[0, 0.2], [1, 1.6]]   → grows with size
  //   gold:  [[0, 1.8], [0.5, 1], [1, 0.1]]  → small shapes only

  function evalCurve(curve, t) {
    if (!curve || !curve.length) return 1;
    if (curve.length === 1) return curve[0][1];
    var x = clamp(t, 0, 1);
    if (x <= curve[0][0]) return curve[0][1];
    for (var i = 1; i < curve.length; i++) {
      var a = curve[i - 1], b = curve[i];
      if (x <= b[0]) {
        var span = b[0] - a[0];
        return span <= 0 ? b[1] : lerp(a[1], b[1], (x - a[0]) / span);
      }
    }
    return curve[curve.length - 1][1];
  }

  // Ready-made curves for the UI's size-bias dropdown. Authors can still hand-
  // write any curve; these just cover the common intents.
  var SIZE_CURVE_PRESETS = {
    none:   null,
    large:  [[0, 0.15], [0.5, 0.7], [1, 1.8]],
    medium: [[0, 0.25], [0.5, 1.7], [1, 0.25]],
    small:  [[0, 1.8], [0.5, 0.7], [1, 0.15]],
    tiny:   [[0, 2.2], [0.25, 1.0], [0.6, 0.1], [1, 0.05]]
  };

  // ── Size groups ───────────────────────────────────────────────────────────
  // A third way to build structure, alongside spatial fields (where a shape is)
  // and inheritance (what a shape is next to): group by *scale*. Every shape of
  // roughly the same size takes one color, so a composition reads as a few
  // deliberate tiers rather than as per-shape variety — the big forms one
  // colour, the mid forms another, wherever they happen to sit.
  //
  // Boundaries are found from the composition's own size distribution rather
  // than imposed: sort the sizes, and split where the gaps are widest. A
  // subdivision that genuinely has three scales gets three groups; a smooth
  // scatter with no natural break gets one, which is the honest answer.

  // 0.02 rather than something coarser: measured across both reference
  // generators, that is the setting where real tiers appear (4–5 well-populated
  // groups per composition). Much above it and most compositions collapse to a
  // single group, because generative size distributions are usually smooth.
  var DEFAULT_SIZE_GROUPS = { enabled: false, mode: 'clusters', minGap: 0.02, maxGroups: 5, minShare: 0.06 };

  function sizeGroupSettings(palette) {
    var s = (palette && palette.sizeGroups) || {};
    return {
      enabled: !!s.enabled,
      // Grouping recolours; by default it does not also delete. Print density is
      // a separate decision from "which cohort is this", and letting the two run
      // together means turning grouping on silently removes elements the design
      // had a moment earlier — which reads as grouping being broken rather than
      // as density doing its job. Opt in per palette to get both.
      dropElements: !!s.dropElements,
      mode: s.mode === 'bands' ? 'bands' : 'clusters',
      // Floor at 0.001 rather than 0.005 so a caller can go below the spacing of
      // a densely sampled field and force splits out of it. Worth knowing what
      // that buys: on a field with no real gaps every candidate gap is the same
      // width, so the widest-first sort is a tie and the cuts land wherever
      // `minShare` first allows — bunched together, not spread. Legitimate for
      // prising tiers out of a smooth distribution, but the tiers are imposed at
      // that point, which is what `bands` does deliberately and legibly.
      minGap: typeof s.minGap === 'number' ? clamp(s.minGap, 0.001, 1) : DEFAULT_SIZE_GROUPS.minGap,
      maxGroups: Math.max(1, Math.round(typeof s.maxGroups === 'number' ? s.maxGroups : DEFAULT_SIZE_GROUPS.maxGroups)),
      minShare: typeof s.minShare === 'number' ? clamp(s.minShare, 0, 0.5) : DEFAULT_SIZE_GROUPS.minShare
    };
  }

  // Returns the split points between groups: sizes are grouped as
  // [0, b0), [b0, b1), … [bn, 1]. Pure and deterministic — the same sizes always
  // produce the same boundaries, with no RNG involved at all.
  //
  // Two modes, and the choice is a real one:
  //
  //   clusters — splits follow the composition's own distribution, so the tiers
  //              are the ones actually in the geometry. A design with no break
  //              in scale honestly comes back as one group.
  //   bands    — the size range is cut into `maxGroups` equal slices, so you
  //              always get that many tiers regardless of the geometry. Reliable
  //              count, at the cost of splitting where nothing changes — and on
  //              a skewed distribution (a power-law scatter) most shapes can
  //              land in one band.
  function sizeGroupBounds(sizes, opts) {
    opts = opts || {};
    var minGap = typeof opts.minGap === 'number' ? opts.minGap : DEFAULT_SIZE_GROUPS.minGap;
    var maxGroups = Math.max(1, Math.round(opts.maxGroups || DEFAULT_SIZE_GROUPS.maxGroups));
    if (!sizes || sizes.length < 2 || maxGroups < 2) return [];

    if (opts.mode === 'bands') {
      var bands = [];
      for (var b = 1; b < maxGroups; b++) bands.push(b / maxGroups);
      return bands;
    }

    var sorted = sizes.slice().sort(function (a, b) { return a - b; });
    var gaps = [];
    for (var i = 1; i < sorted.length; i++) {
      var gap = sorted[i] - sorted[i - 1];
      // The boundary sits in the middle of the empty band, so a shape landing
      // just inside either edge still falls on the side it belongs to.
      if (gap >= minGap) gaps.push({ at: (sorted[i] + sorted[i - 1]) / 2, gap: gap, below: i });
    }
    if (!gaps.length) return [];

    // Widest gaps win — the most pronounced breaks in the distribution are the
    // real tiers.
    gaps.sort(function (a, b) { return b.gap - a.gap; });

    // …but a split is only kept if both sides of it hold a real population.
    // Without this, a single outlier shape is the widest gap in almost every
    // composition, and grouping degenerates into "everything, plus three
    // singletons" — technically the biggest gaps, useless as a color structure.
    var minMembers = Math.max(1, Math.round((opts.minShare != null ? opts.minShare : DEFAULT_SIZE_GROUPS.minShare) * sorted.length));
    var accepted = [];   // cut positions as indices into `sorted`, kept ascending
    for (var g = 0; g < gaps.length && accepted.length < maxGroups - 1; g++) {
      var cut = gaps[g].below;
      var lo = 0, hi = sorted.length;
      for (var k = 0; k < accepted.length; k++) {
        if (accepted[k].below < cut) lo = Math.max(lo, accepted[k].below);
        else hi = Math.min(hi, accepted[k].below);
      }
      if (cut - lo < minMembers || hi - cut < minMembers) continue;
      accepted.push(gaps[g]);
      accepted.sort(function (a, b) { return a.below - b.below; });
    }

    return accepted.map(function (a) { return a.at; })
      .sort(function (a, b) { return a - b; });
  }

  function groupIndexOf(bounds, size) {
    for (var i = 0; i < bounds.length; i++) if (size < bounds[i]) return i;
    return bounds.length;
  }

  // ── Spark eligibility ─────────────────────────────────────────────────────
  // Conditions that gate a color entirely (weight → 0) rather than just
  // reweighting it. Any condition may be combined; all must pass.

  function regionAllows(region, x, y) {
    if (!region) return true;
    if (typeof region.xMin === 'number' && x < region.xMin) return false;
    if (typeof region.xMax === 'number' && x > region.xMax) return false;
    if (typeof region.yMin === 'number' && y < region.yMin) return false;
    if (typeof region.yMax === 'number' && y > region.yMax) return false;
    if (typeof region.rMin === 'number' || typeof region.rMax === 'number') {
      var dx = x - 0.5, dy = y - 0.5;
      var r = Math.sqrt(dx * dx + dy * dy) / 0.7071067811865476;
      if (typeof region.rMin === 'number' && r < region.rMin) return false;
      if (typeof region.rMax === 'number' && r > region.rMax) return false;
    }
    return true;
  }

  // `stats` carries the running counters maintained by the assigner; `null` is
  // accepted so eligibility can be tested statelessly (e.g. from the UI).
  function isEligible(entry, ctx, stats, index) {
    var cond = entry && entry.conditions;
    if (!cond) return true;
    var size = typeof ctx.size === 'number' ? ctx.size : 0.5;
    if (typeof cond.minSize === 'number' && size < cond.minSize) return false;
    if (typeof cond.maxSize === 'number' && size > cond.maxSize) return false;
    if (!regionAllows(cond.region, ctx.x != null ? ctx.x : 0.5, ctx.y != null ? ctx.y : 0.5)) return false;
    if (cond.afterColor && stats) {
      if (String(stats.previousColor || '').toLowerCase() !== String(cond.afterColor).toLowerCase()) return false;
    }
    if (typeof cond.maxShare === 'number' && stats) {
      var used = stats.used[index] || 0;
      if (stats.expectedEligible > 0) {
        // Total shape count known up front: a hard cap reads more predictably
        // than a running ratio ("at most 3 of ~60 shapes").
        if (used >= Math.max(1, Math.round(cond.maxShare * stats.expectedEligible))) return false;
      } else if (used > cond.maxShare * (stats.eligible[index] || 0)) {
        return false;
      }
    }
    return true;
  }

  // ── Effective weights for one shape ───────────────────────────────────────

  // ctx: { x, y, size } — all normalized 0–1. Returns normalized shares, plus
  // the raw pre-normalization weights for debugging/preview.
  //
  // `basisOverride` replaces the seed-varied share each color starts from, for
  // callers that need a different vocabulary than the palette's own — the size
  // group draw uses it to take sparks out. A zero entry there means "not in
  // this draw at all", which has to be a hard gate: spatial weights otherwise
  // *replace* the base weight, so a muted color with a `spatial` pair would
  // walk straight back into contention.
  function effectiveWeights(palette, ctx, stats, basisOverride) {
    var colors = palette.colors || [];
    var basis = basisOverride || (stats && stats.variedShares) || paletteShares(colors);
    ctx = ctx || {};
    var x = ctx.x != null ? ctx.x : 0.5;
    var y = ctx.y != null ? ctx.y : 0.5;
    var size = ctx.size != null ? ctx.size : 0.5;

    var spatialOn = !!(palette.spatial && palette.spatial.enabled);
    var t = spatialOn ? spatialField(palette.spatial.mode, x, y) : 0;
    // Spatial weights are authored as absolute weights at each end of the
    // field, so they replace the base weight rather than scaling it. The
    // generative-variation multiplier is carried over so both systems compose.
    var baseShares = spatialOn ? paletteShares(colors) : null;

    var raw = colors.map(function (c, i) {
      var w;
      if (basisOverride && !(basisOverride[i] > 0)) return 0;
      if (spatialOn && c.spatial && c.spatial.length === 2) {
        var variationFactor = baseShares[i] > 0 ? basis[i] / baseShares[i] : 1;
        w = lerp(c.spatial[0], c.spatial[1], t) * variationFactor;
      } else {
        w = basis[i];
      }
      if (w <= 0) return 0;
      if (palette.geometryEnabled !== false && c.sizeCurve) w *= Math.max(0, evalCurve(c.sizeCurve, size));
      if (!isEligible(c, { x: x, y: y, size: size }, stats, i)) return 0;
      return w;
    });

    var any = raw.some(function (w) { return w > 0; });
    // Every color gated out (e.g. a size-restricted palette meeting an
    // out-of-range shape) — fall back to the unmodified hierarchy rather than
    // returning nothing to draw.
    if (!any) raw = basis.slice();

    return { weights: normalizeWeights(raw), raw: raw, field: t };
  }

  // ── Assigner ──────────────────────────────────────────────────────────────
  // Stateful driver for one artwork. Owns the per-shape RNG streams, the
  // inheritance chain, and the spark counters.
  //
  //   var assigner = ProbabilisticPalette.createAssigner(palette, { seed: 'a1', totalShapes: 120 });
  //   var r = assigner.assign({ index: 0, x: 0.5, y: 0.2, size: 0.8 });
  //   if (r.printed) ctx.fillStyle = r.color;   // else: leave transparent
  //
  // Shapes are expected to be assigned in a stable order; `index` identifies
  // the stream, so re-running the same geometry reproduces the same colors.

  function createAssigner(palette, opts) {
    opts = opts || {};
    var seed = opts.seed != null ? opts.seed : 0;
    var colors = palette.colors || [];
    var variation = typeof palette.weightVariation === 'number' ? palette.weightVariation : 0;

    var stats = {
      // Seed-varied base shares, computed once: every shape in an artwork reads
      // the same generatively-shifted hierarchy.
      variedShares: palette.generativeWeights === false
        ? paletteShares(colors)
        : applyGenerativeVariation(colors, seed, variation),
      used: colors.map(function () { return 0; }),
      eligible: colors.map(function () { return 0; }),
      expectedEligible: opts.totalShapes || 0,
      previousColor: null,
      previousIndex: -1,
      printedCount: 0,
      totalCount: 0
    };

    var byIndex = {};   // shape index → assigned color, for parent inheritance

    // ── Size groups ─────────────────────────────────────────────────────────
    // Needs the whole composition up front — a cohort can't be found one shape
    // at a time — so grouping only engages when the caller passes `shapes`.
    // Without it the assigner behaves exactly as it always has.
    var groupCfg = sizeGroupSettings(palette);
    var shapes = opts.shapes || null;
    var bounds = [];
    var groupColors = [];
    var grouping = groupCfg.enabled && !!(shapes && shapes.length);

    if (grouping) {
      bounds = sizeGroupBounds(shapes.map(function (s) {
        return s && typeof s.size === 'number' ? s.size : 0.5;
      }), groupCfg);

      // One representative context per group: the cohort's mean size and its
      // centroid. A size group is spread across the canvas by definition, so
      // its centroid is the only position that means anything for spatial
      // weights — the group is one decision, not one per member.
      var acc = [];
      shapes.forEach(function (s) {
        var g = groupIndexOf(bounds, s && typeof s.size === 'number' ? s.size : 0.5);
        if (!acc[g]) acc[g] = { n: 0, x: 0, y: 0, size: 0 };
        acc[g].n++;
        acc[g].x += s && s.x != null ? s.x : 0.5;
        acc[g].y += s && s.y != null ? s.y : 0.5;
        acc[g].size += s && s.size != null ? s.size : 0.5;
      });

      // Sparks are drawn out of the group vocabulary: a spark that wins a group
      // stops being a find and becomes a whole tier of the artwork. They stay
      // available per-shape below, which is where rarity actually lives.
      //
      // This has to be a basis override, not a zeroed `weight` on a clone:
      // effectiveWeights reads its shares from stats.variedShares (frozen from
      // the real palette) and its spatial pairs from the color entries, so a
      // muted `weight` would never be looked at.
      var groupBasis = stats.variedShares.map(function (share, i) {
        return colors[i] && colors[i].spark ? 0 : share;
      });

      for (var g = 0; g < bounds.length + 1; g++) {
        var a = acc[g];
        if (!a || !a.n) { groupColors.push(null); continue; }
        var ctx = { x: a.x / a.n, y: a.y / a.n, size: a.size / a.n };
        var grng = makeRng(deriveSeed(seed, 'size-group', g));
        var geff = effectiveWeights(palette, ctx, stats, groupBasis);
        var gpick = weightedRandomIndex(geff.weights, grng);
        groupColors.push(gpick >= 0 && colors[gpick]
          ? { color: colors[gpick].color, colorIndex: gpick, group: g }
          : null);
      }
    }

    // Spark colors stay reachable inside a group: their weight decides how often
    // one lands, their conditions decide where, exactly as ungrouped.
    function sparkOverride(ctx, rng) {
      var sparkWeights = colors.map(function (c, i) {
        if (!c || !c.spark) return 0;
        var w = stats.variedShares[i];
        if (w <= 0) return 0;
        return isEligible(c, ctx, stats, i) ? w : 0;
      });
      var total = sparkWeights.reduce(function (a, b) { return a + b; }, 0);
      if (total <= 0) return null;
      // One roll against the sparks' combined share, then which spark.
      if (rng() >= total) return null;
      var pick = weightedRandomIndex(sparkWeights, rng);
      return pick >= 0 && colors[pick]
        ? { color: colors[pick].color, colorIndex: pick }
        : null;
    }

    function assign(shape) {
      shape = shape || {};
      var index = shape.index != null ? shape.index : stats.totalCount;
      var x = shape.x != null ? shape.x : 0.5;
      var y = shape.y != null ? shape.y : 0.5;
      var size = shape.size != null ? shape.size : 0.5;
      stats.totalCount++;

      var rng = makeRng(deriveSeed(seed, 'shape', index));

      // 1. Print or expose the shirt. The roll is drawn first and *always* —
      //    including when it cannot remove anything — so the print/skip pattern
      //    and every roll after it are identical whether or not grouping is
      //    allowed to drop elements. Toggling that setting must re-colour the
      //    composition, not reshuffle it.
      var printRoll = rng();
      var density = typeof palette.printDensity === 'number' ? clamp(palette.printDensity, 0, 1) : 1;
      var mayDrop = !grouping || groupCfg.dropElements;
      if (mayDrop && printRoll >= density) {
        return {
          index: index, printed: false, color: null, colorIndex: -1,
          inherited: false, tier: null, field: 0
        };
      }
      stats.printedCount++;

      // 2. Size group, when one is active. The cohort's color was drawn once,
      //    up front, so every shape at this scale gets it wherever it sits —
      //    which is the whole point, and why inheritance is skipped here: a
      //    group is already the grouping.
      if (grouping) {
        var gIdx = groupIndexOf(bounds, size);
        var g = groupColors[gIdx];
        var spark = sparkOverride({ x: x, y: y, size: size }, rng);
        var chosen = spark || g;
        if (chosen) {
          stats.used[chosen.colorIndex] = (stats.used[chosen.colorIndex] || 0) + 1;
          stats.eligible[chosen.colorIndex] = (stats.eligible[chosen.colorIndex] || 0) + 1;
          stats.previousColor = chosen.color;
          stats.previousIndex = chosen.colorIndex;
          var gOut = {
            index: index,
            printed: true,
            color: chosen.color,
            colorIndex: chosen.colorIndex,
            inherited: !spark,          // the group is where the color came from
            group: gIdx,
            spark: !!spark,
            field: 0,
            tier: classifyTier(stats.variedShares[chosen.colorIndex], colors[chosen.colorIndex])
          };
          byIndex[index] = gOut;
          return gOut;
        }
        // No group color (an empty cohort, or every color gated out) — fall
        // through to the ordinary per-shape path rather than dropping the shape.
      }

      // 3. Inheritance. A shape can take the color of its parent (or, failing
      //    that, the previous printed shape) instead of drawing a new one —
      //    this is what turns confetti into color regions.
      var inheritRoll = rng();
      var inheritance = typeof palette.inheritance === 'number' ? clamp(palette.inheritance, 0, 1) : 0;
      var source = null, sourceIndex = -1;
      if (shape.parentIndex != null && byIndex[shape.parentIndex]) {
        source = byIndex[shape.parentIndex].color;
        sourceIndex = byIndex[shape.parentIndex].colorIndex;
      } else if (shape.inheritFrom) {
        source = shape.inheritFrom.color;
        sourceIndex = shape.inheritFrom.colorIndex != null ? shape.inheritFrom.colorIndex : -1;
      } else if (stats.previousColor) {
        source = stats.previousColor;
        sourceIndex = stats.previousIndex;
      }

      var result;
      if (source && inheritRoll < inheritance) {
        result = { color: source, colorIndex: sourceIndex, inherited: true, field: 0 };
      } else {
        // 4. Fresh weighted draw against this shape's effective hierarchy.
        var eff = effectiveWeights(palette, { x: x, y: y, size: size }, stats);
        // Count eligibility before the draw so a maxShare cap measures against
        // the shapes that could have taken the color, not the ones that did.
        colors.forEach(function (c, i) {
          if (eff.raw[i] > 0) stats.eligible[i] = (stats.eligible[i] || 0) + 1;
        });
        var pick = weightedRandomIndex(eff.weights, rng);
        result = {
          color: colors[pick] ? colors[pick].color : null,
          colorIndex: pick,
          inherited: false,
          field: eff.field
        };
      }

      if (result.colorIndex >= 0) stats.used[result.colorIndex] = (stats.used[result.colorIndex] || 0) + 1;
      stats.previousColor = result.color;
      stats.previousIndex = result.colorIndex;

      var out = {
        index: index,
        printed: true,
        color: result.color,
        colorIndex: result.colorIndex,
        inherited: result.inherited,
        field: result.field,
        tier: result.colorIndex >= 0
          ? classifyTier(stats.variedShares[result.colorIndex], colors[result.colorIndex])
          : null
      };
      byIndex[index] = out;
      return out;
    }

    return {
      assign: assign,
      stats: stats,
      // The size cohorts this composition was split into, or null when grouping
      // is off (or when the caller didn't pass `shapes`). Boundaries are the
      // split points; colors[i] is the one color group i paints with.
      groups: function () {
        if (!grouping) return null;
        return {
          bounds: bounds.slice(),
          colors: groupColors.map(function (g) {
            return g ? { color: g.color, colorIndex: g.colorIndex } : null;
          })
        };
      },
      shares: function () { return stats.variedShares.slice(); },
      // Observed distribution, for the preview's "what actually came out" read.
      tally: function () {
        var total = stats.printedCount || 1;
        return stats.used.map(function (n) { return n / total; });
      }
    };
  }

  // ── Palette helpers ───────────────────────────────────────────────────────

  function createPalette(overrides) {
    var p = {
      id: 'palette-' + hashString(String((overrides && overrides.name) || 'untitled')).toString(36),
      name: 'Untitled Palette',
      printDensity: 1.0,
      inheritance: 0,
      weightVariation: 0,
      generativeWeights: false,
      geometryEnabled: true,
      spatial: { enabled: false, mode: 'top-bottom' },
      sizeGroups: {
        enabled: false, mode: DEFAULT_SIZE_GROUPS.mode,
        minGap: DEFAULT_SIZE_GROUPS.minGap, maxGroups: DEFAULT_SIZE_GROUPS.maxGroups
      },
      colors: []
    };
    Object.keys(overrides || {}).forEach(function (k) { p[k] = overrides[k]; });
    return p;
  }

  function clonePalette(palette, name) {
    var copy = JSON.parse(JSON.stringify(palette));
    copy.name = name || (palette.name + ' copy');
    copy.id = 'palette-' + hashString(copy.name + ':' + JSON.stringify(copy.colors)).toString(36);
    return copy;
  }

  // Percent-formatted view of the hierarchy, for previews and strip labels.
  function describe(palette, seed) {
    var colors = palette.colors || [];
    var shares = (seed != null && palette.generativeWeights)
      ? applyGenerativeVariation(colors, seed, palette.weightVariation || 0)
      : paletteShares(colors);
    return colors.map(function (c, i) {
      return {
        name: c.name || c.color,
        color: c.color,
        share: shares[i],
        percent: Math.round(shares[i] * 1000) / 10,
        tier: classifyTier(shares[i], c)
      };
    });
  }

  // ── Import ────────────────────────────────────────────────────────────────
  // A palette found on Coolors or Pinterest arrives as a list of hex codes.
  // Getting it into the system should take seconds, not one hand-entered swatch
  // at a time. Both functions below are pure and fully deterministic — no RNG,
  // no DOM — so an import is reproducible from its input alone.

  // Tokenize rather than scan: every separator those sources produce — comma,
  // newline, space, hyphen, slash — is a non-hex character, so one split covers
  // `#606c38, #283618`, newline-separated lists, bare `606c38 283618`, and a
  // full `https://coolors.co/palette/606c38-283618-fefae0` alike. Prose shreds
  // into 1–2 character fragments that fail validation.
  function parseHexList(text) {
    if (text == null) return [];
    var tokens = String(text).split(/[^0-9a-fA-F#]+/);
    var out = [], seen = {};
    tokens.forEach(function (raw) {
      if (!raw) return;
      var hashed = raw.charAt(0) === '#';
      var body = hashed ? raw.slice(1) : raw;
      if (body.indexOf('#') >= 0) return;
      var hex = null;
      if (/^[0-9a-fA-F]{6}$/.test(body)) {
        hex = body.toUpperCase();
      } else if (hashed && /^[0-9a-fA-F]{3}$/.test(body)) {
        // Shorthand is only honored with an explicit `#`. Without that rule,
        // ordinary words in pasted prose — `abc`, `fad`, `bed` — become colors.
        hex = body.charAt(0) + body.charAt(0) + body.charAt(1) + body.charAt(1) +
              body.charAt(2) + body.charAt(2);
        hex = hex.toUpperCase();
      }
      if (!hex) return;
      hex = '#' + hex;
      if (seen[hex]) return;   // first occurrence wins, order preserved
      seen[hex] = true;
      out.push(hex);
    });
    return out;
  }

  // ── Naming ────────────────────────────────────────────────────────────────
  // Imported rows read as `Bone`, `Bright Blue`, `Deep Olive` rather than raw
  // hex, so the editor and the preview strip stay legible.

  // Hue (0–360), chroma (max − min), lightness, and saturation relative to the
  // color's own brightness — enough to name a color, not a color space.
  function hexMetrics(hex) {
    var r = parseInt(hex.substr(1, 2), 16) / 255;
    var g = parseInt(hex.substr(3, 2), 16) / 255;
    var b = parseInt(hex.substr(5, 2), 16) / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var c = max - min;
    var l = (max + min) / 2;
    var h = 0;
    if (c > 0) {
      if (max === r) h = ((g - b) / c) % 6;
      else if (max === g) h = (b - r) / c + 2;
      else h = (r - g) / c + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h: h, c: c, l: l, s: max > 0 ? c / max : 0 };
  }

  // Upper hue bound → name. Red wraps, so it appears at both ends.
  var HUE_NAMES = [
    [8, 'Red'], [24, 'Vermilion'], [38, 'Amber'], [52, 'Gold'], [74, 'Olive'],
    [145, 'Green'], [166, 'Mint'], [186, 'Teal'], [200, 'Cyan'], [240, 'Blue'],
    [266, 'Indigo'], [290, 'Violet'], [320, 'Magenta'], [345, 'Pink'], [361, 'Red']
  ];

  function hexColorName(hex) {
    var d = hexMetrics(hex);
    // Chroma, not HSL saturation: the HSL formula blows up near white, which
    // would call a cream like #FEFAE0 a vivid olive. Chroma alone isn't enough
    // either — every dark color has low chroma — so a dark color counts as
    // neutral only if it is also unsaturated relative to its own brightness.
    if (d.c < 0.14 && d.s < 0.35) {
      if (d.l >= 0.92) return 'Chalk';
      if (d.l >= 0.6) return 'Bone';
      if (d.l >= 0.32) return 'Ash';
      return 'Slate';
    }
    var name = 'Red';
    for (var i = 0; i < HUE_NAMES.length; i++) {
      if (d.h < HUE_NAMES[i][0]) { name = HUE_NAMES[i][1]; break; }
    }
    if (d.l < 0.3) return 'Deep ' + name;
    if (d.c >= 0.55 && d.l > 0.45) return 'Bright ' + name;
    return name;
  }

  function slugify(text, fallback) {
    var s = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return s || fallback;
  }

  // ── Palette from a hex list ───────────────────────────────────────────────
  // Geometric decay in paste order: the first color leads, each following one
  // takes ~two thirds of its predecessor. That is a hierarchy on arrival rather
  // than a flat list of equals, which is the whole point of the system.

  var AUTO_WEIGHT_RATIO = 0.66;

  function paletteFromHexList(hexes, opts) {
    opts = opts || {};
    // Both forms go through the parser, so a hand-built array gets the same
    // uppercase normalization, validation and dedupe as a pasted string.
    var list = parseHexList(typeof hexes === 'string' ? hexes : (hexes || []).join(' '));
    var n = list.length;

    // With four or more colors the tail is rare enough to read as a spark; a
    // fixed 3 puts it under TIER_THRESHOLDS.accent no matter how the ramp lands.
    var hasSpark = n >= 4;
    var rampCount = hasSpark ? n - 1 : n;
    var rampTotal = hasSpark ? 97 : 100;

    var raw = [], sum = 0, i;
    for (i = 0; i < rampCount; i++) {
      var v = Math.pow(AUTO_WEIGHT_RATIO, i);
      raw.push(v);
      sum += v;
    }
    // Floored at 0.5 so a long list doesn't end in effectively-invisible colors,
    // and rounded to a tenth so the editor's number fields stay readable.
    var weights = raw.map(function (w) {
      return Math.max(0.5, Math.round((w / sum) * rampTotal * 10) / 10);
    });
    if (hasSpark) weights.push(3);

    // Two colors can easily land on the same name (two ambers, two blues), and
    // ids have to stay unique — they key the per-color variation stream.
    var taken = {};
    function uniqueId(base) {
      var id = base, k = 2;
      while (taken[id]) { id = base + '-' + k; k++; }
      taken[id] = true;
      return id;
    }

    var colors = list.map(function (hex, index) {
      var spark = hasSpark && index === n - 1;
      var band = Math.floor((index * 3) / Math.max(1, rampCount));
      var curveKey = spark ? 'tiny' : (band <= 0 ? 'large' : (band === 1 ? 'medium' : 'small'));
      var name = hexColorName(hex);
      var w = weights[index];
      var entry = {
        // `id` is the stable tag for the generative-variation RNG stream, so it
        // has to exist and stay put — otherwise editing a hex re-rolls that
        // color's variation.
        id: uniqueId(slugify(name, 'color')),
        name: name,
        color: hex,
        weight: w,
        // Flat pair: no geography until the author adds one, but populated so
        // the editor's start/end fields show real numbers.
        spatial: [w, w],
        sizeCurve: JSON.parse(JSON.stringify(SIZE_CURVE_PRESETS[curveKey]))
      };
      if (spark) {
        entry.spark = true;
        entry.variationScale = 0;
        entry.conditions = { maxSize: 0.35, maxShare: 0.05 };
      }
      return entry;
    });

    // Defaults match Brightfield / Black 01, so an import looks right on a
    // black tee before anything is tuned.
    var overrides = {
      name: 'Imported Palette',
      printDensity: 0.68,
      inheritance: 0.65,
      weightVariation: 0.10,
      generativeWeights: true,
      geometryEnabled: true,
      spatial: { enabled: false, mode: 'top-bottom' }
    };
    Object.keys(opts).forEach(function (k) {
      if (k !== 'colors' && opts[k] !== undefined) overrides[k] = opts[k];
    });
    overrides.colors = colors;
    return createPalette(overrides);
  }

  // ── Presets ───────────────────────────────────────────────────────────────
  // Registered by name so new probabilistic palettes are a data addition, not
  // a code change. Every preset is a plain object — safe to clone and edit.

  var PRESETS = {};

  function registerPreset(palette) {
    PRESETS[palette.name] = palette;
    return palette;
  }

  registerPreset(createPalette({
    id: 'brightfield-black-01',
    name: 'Brightfield / Black 01',
    description: 'Warm-white-led palette for black tees. Two thirds ink, one third exposed shirt.',
    printDensity: 0.68,
    inheritance: 0.65,
    weightVariation: 0.10,
    generativeWeights: true,
    geometryEnabled: true,
    spatial: { enabled: false, mode: 'top-bottom' },
    colors: [
      { id: 'warm-white', name: 'Warm White', color: '#EFE6D2', weight: 39,
        spatial: [55, 20], sizeCurve: [[0, 0.5], [0.5, 1.0], [1, 1.5]] },
      { id: 'blue',       name: 'Blue',       color: '#4472E8', weight: 25,
        spatial: [30, 10], sizeCurve: [[0, 0.5], [0.5, 1.0], [1, 1.4]] },
      { id: 'vermilion',  name: 'Vermilion',  color: '#EF6045', weight: 17,
        spatial: [8, 35],  sizeCurve: [[0, 1.2], [0.5, 1.3], [1, 0.6]] },
      { id: 'gold',       name: 'Gold',       color: '#E5AF3C', weight: 11,
        spatial: [5, 25],  sizeCurve: [[0, 1.7], [0.5, 1.0], [1, 0.3]] },
      { id: 'pink',       name: 'Pink',       color: '#EF5A9D', weight: 6,
        spatial: [2, 10],  sizeCurve: [[0, 2.0], [0.4, 1.0], [1, 0.2]] },
      // Mint is the spark: locked out of weight variation so it stays exactly
      // 2%, restricted to small shapes, and capped at 5% of eligible shapes so
      // it reads as a find rather than a texture.
      { id: 'mint',       name: 'Mint',       color: '#69CDB5', weight: 2,
        spark: true, variationScale: 0, spatial: [2, 4],
        sizeCurve: SIZE_CURVE_PRESETS.tiny,
        conditions: { maxSize: 0.35, maxShare: 0.05 } }
    ]
  }));

  registerPreset(createPalette({
    id: 'brightfield-black-02',
    name: 'Brightfield / Black 02 — Ember',
    description: 'Hot palette that cools toward the top; heavy exposure for an airy print.',
    printDensity: 0.52,
    inheritance: 0.78,
    weightVariation: 0.18,
    generativeWeights: true,
    geometryEnabled: true,
    spatial: { enabled: true, mode: 'top-bottom' },
    colors: [
      { id: 'bone',    name: 'Bone',    color: '#F2EDE4', weight: 30, spatial: [42, 14],
        sizeCurve: [[0, 0.4], [1, 1.6]] },
      { id: 'ember',   name: 'Ember',   color: '#E8452F', weight: 26, spatial: [12, 40] },
      { id: 'amber',   name: 'Amber',   color: '#F0A125', weight: 22, spatial: [10, 30],
        sizeCurve: SIZE_CURVE_PRESETS.medium },
      { id: 'plum',    name: 'Plum',    color: '#7B3B8C', weight: 15, spatial: [30, 12],
        sizeCurve: SIZE_CURVE_PRESETS.small },
      { id: 'ice',     name: 'Ice',     color: '#8FD8F2', weight: 5, spark: true, variationScale: 0,
        spatial: [6, 4], conditions: { maxSize: 0.4, maxShare: 0.08 } }
    ]
  }));

  registerPreset(createPalette({
    id: 'brightfield-black-03',
    name: 'Brightfield / Black 03 — Signal',
    description: 'Near-monochrome field with a single saturated signal color kept rare.',
    printDensity: 0.74,
    inheritance: 0.35,
    weightVariation: 0.25,
    generativeWeights: true,
    geometryEnabled: true,
    spatial: { enabled: true, mode: 'center-edge' },
    colors: [
      { id: 'chalk',  name: 'Chalk',  color: '#E9E9E4', weight: 52, spatial: [60, 34] },
      { id: 'ash',    name: 'Ash',    color: '#9A9A94', weight: 28, spatial: [22, 38] },
      { id: 'slate',  name: 'Slate',  color: '#4A4E58', weight: 16, spatial: [12, 24],
        sizeCurve: SIZE_CURVE_PRESETS.large },
      { id: 'signal', name: 'Signal', color: '#FF3B1F', weight: 4, spark: true, variationScale: 0,
        spatial: [6, 4], sizeCurve: SIZE_CURVE_PRESETS.small,
        conditions: { maxSize: 0.5, maxShare: 0.06 } }
    ]
  }));

  window.ProbabilisticPalette = {
    // RNG
    hashString: hashString,
    deriveSeed: deriveSeed,
    makeRng: makeRng,
    // weights
    normalizeWeights: normalizeWeights,
    paletteShares: paletteShares,
    weightedRandomIndex: weightedRandomIndex,
    weightedRandomColor: weightedRandomColor,
    applyGenerativeVariation: applyGenerativeVariation,
    // hierarchy
    TIERS: TIERS,
    TIER_THRESHOLDS: TIER_THRESHOLDS,
    classifyTier: classifyTier,
    classifyPalette: classifyPalette,
    // geography
    SPATIAL_MODES: SPATIAL_MODES,
    spatialField: spatialField,
    // size cohorts
    DEFAULT_SIZE_GROUPS: DEFAULT_SIZE_GROUPS,
    sizeGroupBounds: sizeGroupBounds,
    groupIndexOf: groupIndexOf,
    elementSeed: elementSeed,
    elementRoll: elementRoll,
    elementPrintChance: elementPrintChance,
    SIZE_CURVE_PRESETS: SIZE_CURVE_PRESETS,
    evalCurve: evalCurve,
    isEligible: isEligible,
    effectiveWeights: effectiveWeights,
    // driving an artwork
    createAssigner: createAssigner,
    // palette objects
    createPalette: createPalette,
    clonePalette: clonePalette,
    describe: describe,
    // import
    parseHexList: parseHexList,
    paletteFromHexList: paletteFromHexList,
    hexColorName: hexColorName,
    PRESETS: PRESETS,
    registerPreset: registerPreset
  };
})();
