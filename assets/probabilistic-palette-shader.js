// Probabilistic palette → shader values.
//
// The engine (`probabilistic-palette.js`) colors *shapes*. A fragment shader has
// no shapes — it has a handful of color uniforms that the GLSL interpolates
// across the whole canvas. This module is the adapter: it treats each of a
// shader's color uniforms as one "shape" and runs the ordinary assigner over
// them, so print density, inheritance, generative weights, spatial weights and
// spark conditions all still decide what lands where.
//
// Like the engine it is DOM-free and renderer-free — it never touches WebGL, it
// only produces a `_shaderState.values` object — which is what makes it testable
// under jsdom. It does depend on `window.ShaderDefs` for the control defaults
// and the sRGB↔linear color math, so there is exactly one copy of each.
//
// Everything random goes through PP.makeRng / PP.deriveSeed. Same seed + palette
// + shader definition ⇒ byte-identical values, which is what makes a thumbnail
// grid reproducible across reloads.
(function () {
  'use strict';

  var PP = window.ProbabilisticPalette;
  var Defs = window.ShaderDefs;

  // The shader clock is frozen for offline rendering; every shader that reads
  // u_time gets the same instant, so a sample depends only on its seed.
  var FIXED_TIME = 12.0;

  // ── Which uniforms are inks ───────────────────────────────────────────────

  // u_a/u_b/u_c/u_d and u_palette_a–d look like colors in the GUI but are cosine
  // curve coefficients. Assigning a palette color to them would produce an
  // arbitrary rainbow, not that color — the reason four-stop mode is preferred
  // below wherever a shader offers it.
  function isCoefficient(key) {
    return !!(Defs.PALETTE_COEFF_KEYS && Defs.PALETTE_COEFF_KEYS[key]);
  }

  // Outline colors stay at their default black. Black is the shirt, never an
  // ink, so a black outline is the garment showing between the strokes — which
  // is exactly what the control is for.
  function isOutline(key) { return /outline/.test(key); }

  function findControl(def, key) {
    var found = null;
    (def.controls || []).forEach(function (c) { if (c.key === key) found = c; });
    return found;
  }

  // A full u_color0…u_color3 set, not just any u_colorN — chladni's u_color1 /
  // u_color2 are a pair of flat colors, not the ends of a four-stop gradient.
  function hasFourStopSlots(def) {
    var seen = {};
    (def.controls || []).forEach(function (c) {
      if (c.type === 'color' && /^u_color[0-3]$/.test(c.key)) seen[c.key] = true;
    });
    return !!(seen.u_color0 && seen.u_color1 && seen.u_color2 && seen.u_color3);
  }

  // Which value of `u_color_mode` this shader should run in.
  //
  // Four-stop wins wherever it is offered: its slots are literal colors, so a
  // palette color arrives on the shirt as itself. The alternatives are worse
  // fits — cosine mode takes curve coefficients rather than colors, and
  // four-circles' per-quadrant mode is a third path that four-stop already
  // covers. Shaders whose only discrete colors live on mode 0 (rise-shirt's
  // text/dot colors) fall back to it; chladni has no mode control at all and
  // simply always paints with its two color uniforms.
  function chooseColorMode(def) {
    var ctrl = findControl(def, 'u_color_mode');
    if (!ctrl) return null;
    if (ctrl.type === 'select') {
      var match = null;
      (ctrl.options || []).forEach(function (o) {
        if (match == null && /4[-\s]?(stop|color)/i.test(o.label)) match = o.value;
      });
      return match != null ? match : ctrl.value;
    }
    return hasFourStopSlots(def) ? 1 : 0;
  }

  // Any uniform the palette could take over: a literal color, not a curve
  // coefficient, not an outline.
  function isPaletteInk(ctrl) {
    return ctrl.type === 'color' && !isCoefficient(ctrl.key) && !isOutline(ctrl.key);
  }

  // Every key the palette owns for this shader, regardless of which mode it
  // lands in — what a control panel should hide, since editing it would just be
  // overwritten on the next render. Mode-independent on purpose: the live set
  // shifts with toggles like `u_use_text_color`, and a panel that reshuffled
  // itself mid-edit would be worse than one that stays put.
  function paletteOwnedKeys(def) {
    var keys = (def.controls || []).filter(isPaletteInk).map(function (c) { return c.key; });
    if (findControl(def, 'u_color_mode')) keys.unshift('u_color_mode');
    return keys;
  }

  // The color controls that are actually live given the chosen mode and the
  // current toggles. Assigning a hidden slot would silently spend a draw (and a
  // spark's budget) on a uniform the GLSL never reads.
  function colorSlots(def, values) {
    var mode = String(values.u_color_mode);
    return (def.controls || []).filter(function (c) {
      if (!isPaletteInk(c)) return false;
      if (c.paletteDependent) return mode === '0';
      if (c.stopDependent) return mode === '1';
      if (c.quadDependent) return mode === '2';
      if (c.textColorDependent) return !!values.u_use_text_color;
      if (c.wordDependent) return !!values.u_text_enabled;
      return true;
    }).map(function (c) { return c.key; });
  }

  // ── Control defaults ──────────────────────────────────────────────────────
  // Same shape `test-shaders.html` and `main-product.liquid` build at boot: a
  // full `_shaderState.values`, with colors pre-linearized and angles in radians.

  function defaultValues(def) {
    var values = {};
    (def.controls || []).forEach(function (c) {
      if (!c.key) return;
      values[c.key] = c.type === 'color'
        ? Defs.hexToRgb(c.value, c.key)
        : (c.toRadians ? c.value * Math.PI / 180 : c.value);
    });
    return values;
  }

  // ── Per-seed parameter variation ──────────────────────────────────────────
  // Colors come from the palette; this is everything else — how many lines, how
  // wide, which coefficients. `amount` (0–1) is how far a sample may stray from
  // the settings it was handed, so 0 gives a grid that varies only in color.

  function isVariable(ctrl) {
    if (!ctrl.key || ctrl.noRandomize) return false;
    if (ctrl.key === 'u_color_mode') return false;   // the palette owns the mode
    if (ctrl.key.charAt(0) === '_') return false;    // GUI-only preset pickers
    if (ctrl.type === 'color' || ctrl.type === 'text') return false;
    // Anything that re-typesets the text overlay: a thumbnail grid is for
    // judging color, and re-flowing the words in every cell is just noise.
    if (ctrl.textDirty || ctrl.key.indexOf('text') === 0) return false;
    return ctrl.type === 'range' || ctrl.type === 'toggle' || ctrl.type === 'select';
  }

  function varyParams(def, values, seed, amount) {
    if (!(amount > 0)) return values;
    (def.controls || []).forEach(function (c) {
      if (!isVariable(c)) return;
      var rng = PP.makeRng(PP.deriveSeed(seed, 'param', c.key));
      // Drift is measured from the value in hand, not from the control's own
      // default, so it stays relative to whatever the caller tuned.
      var from = values[c.key] != null ? values[c.key] : c.value;
      if (c.type === 'range') {
        var anchor = c.toRadians ? from * 180 / Math.PI : from;
        var lo = c.randomMin != null ? c.randomMin : c.min;
        var hi = c.randomMax != null ? c.randomMax : c.max;
        var steps = Math.round((hi - lo) / c.step);
        var target = lo + Math.floor(rng() * (steps + 1)) * c.step;
        // Interpolate from the anchor toward the draw, then re-snap: the
        // slider's step is load-bearing for integer counts (row counts, square
        // counts), where an off-step value aliases.
        var raw = anchor + (target - anchor) * amount;
        var val = Math.round((raw - c.min) / c.step) * c.step + c.min;
        val = parseFloat(Math.max(c.min, Math.min(c.max, val)).toFixed(10));
        values[c.key] = c.toRadians ? val * Math.PI / 180 : val;
      } else if (c.type === 'toggle') {
        // A toggle has no halfway house, so `amount` becomes the odds of
        // flipping it rather than a distance.
        if (rng() < amount * 0.5) values[c.key] = from === 1 ? 0 : 1;
      } else if (c.type === 'select') {
        var opts = c.options || [];
        if (opts.length && rng() < amount) {
          values[c.key] = opts[Math.floor(rng() * opts.length)].value;
        }
      }
    });
    return values;
  }

  // ── Palette → color slots ─────────────────────────────────────────────────

  // Slots are ordered along whatever axis the shader gradients over — the four
  // stops of `u_color0…u_color3` run top-to-bottom or left-to-right depending on
  // the shader — so slot i sits at t = i/(n-1) in the field. Passing that as both
  // x and y lets every spatial mode read it: top→bottom and left→right see the
  // gradient run end to end, center→edge and radial see ends-versus-middle.
  function slotContext(i, n) {
    var t = n > 1 ? i / (n - 1) : 0.5;
    // `size` is the one geometry input with no shader analogue — a gradient stop
    // has no area of its own — so it is pinned mid-range and `geometryEnabled`
    // is switched off below rather than letting size curves bite arbitrarily.
    return { index: i, x: t, y: t, size: 0.5 };
  }

  // ── Size groups on a shader ───────────────────────────────────────────────
  // The shader knows how big the element under each fragment is; only the CPU
  // can decide where the cohort boundaries fall and what color each one drew.
  // So this sends exactly that — see `paletteGroupColor` in shader-base.js.
  //
  // The size field of a procedural shader is continuous (a dot grid's radius
  // sweeps smoothly down the canvas), so it is modelled as a dense uniform
  // sample. That has a real consequence: natural clustering finds no gaps in a
  // uniform sample and honestly returns one group, which is why fixed bands is
  // the mode that does something here.
  var SIZE_FIELD_SAMPLES = 64;

  function sizeField() {
    var out = [];
    for (var i = 0; i < SIZE_FIELD_SAMPLES; i++) out.push(i / (SIZE_FIELD_SAMPLES - 1));
    return out;
  }

  var GROUP_MAX = 8;

  // Returns the u_group_* uniforms, or null when grouping is off.
  function groupUniforms(palette, seed) {
    var cfg = palette && palette.sizeGroups;
    if (!cfg || !cfg.enabled) return null;

    // Synthetic shapes spanning the size field, run through the ordinary
    // assigner: bounds, spark exclusion and the group draws all come from the
    // engine rather than being re-derived here.
    var field = sizeField();
    var shapes = field.map(function (size) { return { x: 0.5, y: 0.5, size: size }; });
    // GROUP_MAX is a hard GLSL array size, so the engine is asked for at most
    // that many cohorts rather than being allowed to produce more and having the
    // extras chopped off below. Truncating a 10-group solution is not the same
    // as an 8-group one: the boundaries would be the widest gaps of a split the
    // shader cannot represent, and cohorts 9 and 10 would vanish with their
    // colors. The editor's slider already caps at 8; this catches a pasted or
    // stored palette JSON carrying more, which sizeGroupSettings does not clamp.
    var forGroups = palette;
    if (cfg.maxGroups > GROUP_MAX) {
      forGroups = JSON.parse(JSON.stringify(palette));
      forGroups.sizeGroups.maxGroups = GROUP_MAX;
    }
    var groups = PP.createAssigner(forGroups, {
      seed: seed, totalShapes: shapes.length, shapes: shapes
    }).groups();
    if (!groups) return null;

    var bounds = groups.bounds.slice(0, GROUP_MAX - 1);
    var count = Math.min(GROUP_MAX, bounds.length + 1);
    // 1 unless the palette opts in: grouping recolours the design, it does not
    // thin it out. Sent as a uniform rather than dropped here so the GLSL keeps
    // one code path — density 1 makes every element's roll pass.
    var density = cfg.dropElements && typeof palette.printDensity === 'number'
      ? palette.printDensity : 1;

    var colors = [];
    var cohorts = [];
    for (var g = 0; g < count; g++) {
      var entry = groups.colors[g];
      // A cohort carries its color and nothing else. Print density is not
      // decided here: the GLSL rolls it per element against u_group_seed, so
      // density reads as texture within a tier instead of deleting the tier.
      // An empty cohort still goes black — black is the shirt, never an ink.
      colors.push(entry ? Defs.hexToRgb(entry.color, 'u_group_colors') : [0, 0, 0]);
      cohorts.push({
        key: 'group ' + (g + 1),
        hex: entry ? entry.color : '#000000',
        printed: !!entry,
        colorIndex: entry ? entry.colorIndex : -1
      });
    }

    return {
      u_group_mode: 1,
      u_group_count: count,
      u_group_bounds: bounds,
      u_group_colors: colors,
      // The shader's own stream for the per-element print roll. Tagged like any
      // other derived seed, so turning grouping on can't shift the slot draws.
      u_group_seed: PP.deriveSeed(seed, 'element-print'),
      u_group_density: density,
      // Not uploaded — the host's read of what each cohort became.
      cohorts: cohorts
    };
  }

  // Returns { values, slots, colorMode }.
  //
  //   values    — a complete _shaderState.values, ready to assign
  //   slots     — [{ key, hex, printed, colorIndex, color }] in gradient order
  //   colorMode — the u_color_mode this shader was put into (null if it has none)
  //
  // `opts.values` supplies the settings to start from — a control panel's
  // current state — and defaults to the shader's own control defaults. It is
  // never mutated.
  //
  // Pure: no DOM, no clock, no Math.random. The same (def, palette, seed,
  // variation, values) always produces the same object.
  function mapPalette(def, opts) {
    opts = opts || {};
    var palette = opts.palette;
    var seed = opts.seed != null ? opts.seed : 0;
    var values = defaultValues(def);
    if (opts.values) {
      Object.keys(opts.values).forEach(function (k) {
        var v = opts.values[k];
        values[k] = Array.isArray(v) ? v.slice() : v;
      });
    }

    varyParams(def, values, seed, opts.variation != null ? opts.variation : 0);

    var colorMode = chooseColorMode(def);
    if (colorMode != null) values.u_color_mode = colorMode;

    // Size groups ride alongside the slot colors: the shader keeps painting its
    // gradient where grouping is off or unsupported, and overrides per element
    // where it is on. u_group_mode 0 by default, so nothing changes for shaders
    // that never opted in.
    var groups = groupUniforms(palette, seed);
    values.u_group_mode = groups ? 1 : 0;
    if (groups) {
      values.u_group_count   = groups.u_group_count;
      values.u_group_bounds  = groups.u_group_bounds;
      values.u_group_colors  = groups.u_group_colors;
      values.u_group_seed    = groups.u_group_seed;
      values.u_group_density = groups.u_group_density;
    }

    var keys = colorSlots(def, values);
    var slots = [];
    if (!palette || !keys.length) return { values: values, slots: slots, colorMode: colorMode, groups: groups };

    // Shape size is meaningless for a color slot — a gradient stop has no area
    // of its own — so both size-driven rules come out rather than being
    // evaluated at some arbitrary midpoint. Size curves would silently reweight
    // the whole palette; a spark's `maxSize` is worse, because at any fixed size
    // it either always passes or (as with the stock `maxSize: 0.35`) locks the
    // spark out of every design. The editor marks exactly these controls
    // engine-only, so the two agree about what is and isn't driving the preview.
    var forSlots = JSON.parse(JSON.stringify(palette));
    forSlots.geometryEnabled = false;
    (forSlots.colors || []).forEach(function (c) {
      if (!c.conditions) return;
      delete c.conditions.minSize;
      delete c.conditions.maxSize;
      if (!Object.keys(c.conditions).length) delete c.conditions;
    });

    var assigner = PP.createAssigner(forSlots, { seed: seed, totalShapes: keys.length });
    keys.forEach(function (key, i) {
      var a = assigner.assign(slotContext(i, keys.length));
      // Unprinted means the garment, and on a shader the garment is black —
      // a black stop is the shirt showing through the gradient, not black ink.
      var hex = a.printed && a.color ? a.color : '#000000';
      values[key] = Defs.hexToRgb(hex, key);
      slots.push({
        key: key,
        hex: hex,
        printed: !!(a.printed && a.color),
        colorIndex: a.printed ? a.colorIndex : -1,
        inherited: !!a.inherited,
        tier: a.tier
      });
    });

    return { values: values, slots: slots, colorMode: colorMode, groups: groups };
  }

  window.ProbabilisticPaletteShader = {
    FIXED_TIME: FIXED_TIME,
    chooseColorMode: chooseColorMode,
    colorSlots: colorSlots,
    groupUniforms: groupUniforms,
    SIZE_FIELD_SAMPLES: SIZE_FIELD_SAMPLES,
    paletteOwnedKeys: paletteOwnedKeys,
    defaultValues: defaultValues,
    varyParams: varyParams,
    mapPalette: mapPalette
  };
})();
