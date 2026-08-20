// GENERATED FILE — do not edit by hand.
//
// Source: snippets/shader-controls-*.liquid (the same arrays the product page
// renders). Regenerate with `npm run build:shader-defs`; test/shader-defs.test.js
// fails if this file and the snippets disagree.
//
// Consumed by test-shaders.html and palette-lab.html, neither of which can
// render Liquid. `ShaderDefs.SHADERS[name].controls` is the control array;
// `.build(container)` re-runs the snippet against a real panel element, which
// is how a snippet that appends its own DOM (chladni's pattern randomizer) gets
// somewhere to put it.
(function () {
  'use strict';

    // Several snippets warm the web fonts they offer. Real browsers have the
    // Font Loading API; jsdom (where the tests evaluate this file) does not, and
    // a missing font is not a reason for a definitions file to throw.
    if (!document.fonts) {
      document.fonts = { load: function () {}, ready: Promise.resolve() };
    }


    var SHADER_FONTS = [
      'Space Mono', 'Roboto Mono', 'Source Code Pro', 'JetBrains Mono',
      'IBM Plex Mono', 'Fira Code', 'Inconsolata', 'Courier Prime',
      'Share Tech Mono', 'Cutive Mono', 'DM Mono', 'Fragment Mono',
      'Azeret Mono', 'Spline Sans Mono', 'Geist Mono', 'Syne',
      'Unbounded', 'Bricolage Grotesque', 'Epilogue', 'DM Sans',
      'Oswald', 'Montserrat',
      'Bebas Neue', 'Barlow Condensed', 'Anton', 'Fjalla One',
    ];

    var COSINE_PRESETS = {
      'Rainbow':   { a: [0.5,  0.5,  0.5 ], b: [0.5, 0.5, 0.5], c: [1.0, 1.0, 1.0], d: [0.0,   0.33,  0.67]  },
      'Cool Blue': { a: [0.5,  0.5,  0.5 ], b: [0.5, 0.5, 0.5], c: [1.0, 1.0, 1.0], d: [0.263, 0.416, 0.557] },
      'Neon Heat': { a: [0.5,  0.5,  0.5 ], b: [0.5, 0.5, 0.5], c: [1.0, 1.0, 1.0], d: [0.3,   0.2,   0.2  ] },
      'Cyberpunk': { a: [0.5,  0.5,  0.5 ], b: [0.5, 0.5, 0.5], c: [2.0, 1.0, 0.0], d: [0.5,   0.2,   0.25 ] },
      'Golden':    { a: [0.5,  0.5,  0.5 ], b: [0.5, 0.5, 0.5], c: [1.0, 1.0, 0.5], d: [0.8,   0.9,   0.3  ] },
      'Synthwave': { a: [0.5,  0.2,  0.7 ], b: [0.5, 0.4, 0.3], c: [0.8, 1.0, 1.2], d: [0.5,   0.25,  0.65 ] },
      'Pastel':    { a: [0.75, 0.65, 0.75], b: [0.2, 0.2, 0.2], c: [1.0, 1.0, 1.0], d: [0.0,   0.33,  0.67 ] },
      'Arctic':    { a: [0.5,  0.6,  0.7 ], b: [0.3, 0.3, 0.3], c: [1.0, 0.8, 0.5], d: [0.0,   0.1,   0.3  ] },
      'Mexican':   { a: [0.70, 0.25, 0.55], b: [0.5, 0.35, 0.3], c: [1.0, 1.0, 0.8], d: [0.0,   0.25,  0.60 ] },
      'Inferno':   { a: [0.8,  0.3,  0.1 ], b: [0.5, 0.4,  0.2], c: [1.0, 1.0, 2.0], d: [0.0,   0.1,   0.25 ] },
      'Ocean':     { a: [0.2,  0.5,  0.6 ], b: [0.2, 0.3,  0.4], c: [1.0, 1.0, 1.0], d: [0.0,   0.15,  0.3  ] },
      'Vaporwave': { a: [0.6,  0.3,  0.7 ], b: [0.4, 0.3,  0.3], c: [1.0, 2.0, 1.0], d: [0.0,   0.5,   0.25 ] },
      'Acid':      { a: [0.5,  0.6,  0.0 ], b: [0.5, 0.4,  0.2], c: [2.0, 1.0, 1.0], d: [0.0,   0.25,  0.0  ] },
      'Warm Earth':{ a: [0.8,  0.5,  0.4 ], b: [0.2, 0.4,  0.2], c: [2.0, 1.0, 1.0], d: [0.0,   0.25,  0.25 ] },
      'Violet':    { a: [0.4,  0.3,  0.6 ], b: [0.3, 0.2,  0.4], c: [1.0, 1.0, 1.0], d: [0.0,   0.1,   0.0  ] },
      'Coral Reef':      { a: [0.500, 0.650, 0.575], b: [0.500,  -0.150, -0.175], c: [1.0, 1.0, 1.0], d: [0.0, 0.0, 0.0] },
      'Sakura':          { a: [0.540, 0.500, 0.485], b: [0.440,   0.250,  0.335], c: [1.0, 1.0, 1.0], d: [0.0, 0.0, 0.0] },
      'Terracotta':      { a: [0.825, 0.575, 0.420], b: [-0.105, -0.225, -0.180], c: [1.0, 1.0, 1.0], d: [0.0, 0.0, 0.0] },
      'Lavender Field':  { a: [0.775, 0.660, 0.635], b: [-0.155, -0.140,  0.185], c: [1.0, 1.0, 1.0], d: [0.0, 0.0, 0.0] },
      'Bioluminescent':  { a: [0.090, 0.500, 0.435], b: [-0.060, -0.450, -0.315], c: [1.0, 1.0, 1.0], d: [0.0, 0.0, 0.0] },
      'Holographic':     { a: [0.5,   0.5,   0.5  ], b: [0.5,     0.5,    0.5  ], c: [3.0, 2.0, 1.0], d: [0.0, 0.1, 0.2] },
    };

    var FOUR_STOP_PRESETS = {
      'Neon':     { c0: [1.0,  0.2,   0.4  ], c1: [1.0,  0.8,   0.0  ], c2: [0.0,  0.8,   1.0  ], c3: [0.667, 0.0,   1.0  ] },
      'Retro':    { c0: [0.91, 0.286, 0.114], c1: [0.788, 0.627, 0.188], c2: [0.176, 0.541, 0.369], c3: [0.102, 0.153, 0.267] },
      'Sunset':   { c0: [1.0,  0.318, 0.184], c1: [0.867, 0.141, 0.463], c2: [0.541, 0.169, 0.886], c3: [0.098, 0.098, 0.439] },
      'Aurora':   { c0: [0.0,  1.0,   0.533], c1: [0.0,   0.898, 1.0  ], c2: [0.486, 0.302, 1.0  ], c3: [0.878, 0.251, 0.984] },
      'Dusk':     { c0: [1.0,  0.6,   0.4  ], c1: [1.0,   0.369, 0.384], c2: [0.8,   0.169, 0.369], c3: [0.459, 0.227, 0.533] },
      'Midnight': { c0: [0.04, 0.12,  0.30 ], c1: [0.02,  0.22,  0.32 ], c2: [0.14,  0.06,  0.32 ], c3: [0.06,  0.04,  0.16 ] },
      'Ember':    { c0: [0.58, 0.14,  0.02 ], c1: [0.35,  0.06,  0.04 ], c2: [0.16,  0.04,  0.06 ], c3: [0.05,  0.03,  0.02 ] },
      'Obsidian': { c0: [0.06, 0.04,  0.04 ], c1: [0.22,  0.04,  0.28 ], c2: [0.04,  0.16,  0.22 ], c3: [0.08,  0.04,  0.14 ] },
      'Velvet':   { c0: [0.30, 0.04,  0.08 ], c1: [0.45,  0.06,  0.14 ], c2: [0.22,  0.04,  0.22 ], c3: [0.08,  0.04,  0.08 ] },
      'Mexican':  { c0: [0.894, 0.0,  0.486], c1: [1.0,   0.420, 0.0  ], c2: [0.0,   0.773, 0.804], c3: [0.545, 0.102, 0.545] },
      'Viridis':       { c0: [0.267, 0.005, 0.329], c1: [0.192, 0.406, 0.556], c2: [0.208, 0.718, 0.475], c3: [0.992, 0.906, 0.144] },
      'Teal & Orange': { c0: [0.039, 0.239, 0.227], c1: [0.122, 0.714, 0.651], c2: [1.0,   0.569, 0.259], c3: [0.761, 0.255, 0.047] },
      'Ice Cream':     { c0: [1.0,   0.702, 0.776], c1: [1.0,   0.953, 0.769], c2: [0.710, 0.918, 0.843], c3: [0.780, 0.702, 1.0  ] },
      'Jamaica':       { c0: [0.0,   0.608, 0.227], c1: [0.996, 0.820, 0.0  ], c2: [0.102, 0.102, 0.102], c3: [0.0,   0.608, 0.227] },
      // Trending, from coolors.co/palettes/trending (pulled 2026-07-30). Source
      // palettes have 5-10 stops; resampled to 4 by interpolating along the
      // piecewise gradient (not nearest-4 snapping, which silently drops colors).
      'Olive Garden Feast':         { c0: [0.117, 0.151, 0.036], c1: [0.342, 0.341, 0.254], c2: [0.817, 0.562, 0.325], c3: [0.511, 0.151, 0.014] },
      'Pastel Dreamland Adventure': { c0: [0.619, 0.465, 0.715], c1: [1.0,   0.536, 0.691], c2: [0.678, 0.647, 0.865], c3: [0.369, 0.652, 1.0  ] },
      'Fiery Ocean':                { c0: [0.19,  0.0,   0.0  ], c1: [0.689, 0.294, 0.231], c2: [0.328, 0.309, 0.267], c3: [0.133, 0.334, 0.511] },
      'Ocean Blue Serenity':        { c0: [0.0,   0.0,   0.111], c1: [0.0,   0.27,  0.545], c2: [0.136, 0.65,  0.81 ], c3: [0.599, 0.875, 0.941] },
      'Ocean Sunset':               { c0: [0.0,   0.003, 0.006], c1: [0.302, 0.652, 0.517], c2: [0.599, 0.136, 0.0  ], c3: [0.334, 0.012, 0.015] },
      'Refreshing Summer Fun':      { c0: [0.276, 0.599, 0.797], c1: [0.007, 0.241, 0.361], c2: [0.667, 0.33,  0.02 ], c3: [0.966, 0.239, 0.0  ] },
      'Sunny Beach Day':            { c0: [0.015, 0.058, 0.085], c1: [0.286, 0.416, 0.235], c2: [0.878, 0.433, 0.128], c3: [0.805, 0.16,  0.08 ] },
      'Soft Lavender':              { c0: [0.012, 0.012, 0.04 ], c1: [0.154, 0.138, 0.201], c2: [0.505, 0.373, 0.37 ], c3: [0.891, 0.82,  0.782] },
      'Fresh Greens':               { c0: [0.036, 0.133, 0.049], c1: [0.228, 0.414, 0.081], c2: [0.726, 0.739, 0.453], c3: [0.511, 0.06,  0.064] },
      'Golden Summer Fields':       { c0: [0.612, 0.673, 0.431], c1: [0.877, 0.887, 0.646], c2: [0.969, 0.887, 0.663], c3: [0.666, 0.374, 0.173] },
    };

    // Shaders gamma-encode finalColor with pow(x, 1/2.2) before output, so literal
    // color uniforms (u_color0-3, u_outline_color, u_text_color, ...) must be
    // supplied pre-linearized (pow(x, 2.2)) for the picker's sRGB hex to
    // round-trip correctly. These are exact inverses of one another.
    function srgbToLinear(c) { return Math.pow(c, 2.2); }
    function linearToSrgb(c) { return Math.pow(c, 1 / 2.2); }

    // u_a/u_b/u_c/u_d (and u_palette_a-d) are cosine-palette curve coefficients —
    // cosinePalette(t,a,b,c,d) = a + b*cos(2π(c*t+d)) — not literal colors. c/d
    // routinely exceed [0,1] or go negative (e.g. Cyberpunk's c:[2,1,0], Coral
    // Reef's b:[.5,-.15,-.175]), and the sRGB<->linear transform below is only
    // valid for values that represent a real linear-space color, so these keys
    // must bypass it and pass straight through (as they did pre-gamma-fix).
    var PALETTE_COEFF_KEYS = {
      u_a: true, u_b: true, u_c: true, u_d: true,
      u_palette_a: true, u_palette_b: true, u_palette_c: true, u_palette_d: true
    };

    // hex is a '#rrggbb' string from a color picker; returns a [r,g,b] uniform
    // value (linear-space, unless key is a palette coefficient).
    function hexToRgb(hex, key) {
      var vals = [
        parseInt(hex.slice(1, 3), 16) / 255,
        parseInt(hex.slice(3, 5), 16) / 255,
        parseInt(hex.slice(5, 7), 16) / 255
      ];
      return PALETTE_COEFF_KEYS[key] ? vals : vals.map(srgbToLinear);
    }

    // v is a [r,g,b] uniform value (linear-space, unless key is a palette
    // coefficient); returns the sRGB hex a user would see in the color picker.
    function toHex(v, key) {
      var raw = PALETTE_COEFF_KEYS[key];
      return '#' + v.map(function (x) {
        // Clamp before linearToSrgb, not just after: Math.pow(negative, 1/2.2) is
        // NaN (fractional exponent of a negative base), so a negative x would
        // otherwise produce a NaN hex digit instead of clamping to 0.
        var enc = raw ? x : linearToSrgb(Math.max(0, x));
        var b = Math.round(Math.max(0, Math.min(1, enc)) * 255).toString(16);
        return b.length === 1 ? '0' + b : b;
      }).join('');
    }


    // Vivid hex color at a given hue (0–1), fixed high saturation + brightness —
    // avoids the muddy/dull tones a fully uniform-random hex can land on.
    function vividHex(hue) {
      var s = 0.85, v = 0.95;
      var i = Math.floor(hue * 6), f = hue * 6 - i;
      var p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
      var r, g, b;
      switch (i % 6) {
        case 0: r = v; g = t; b = p; break;
        case 1: r = q; g = v; b = p; break;
        case 2: r = p; g = v; b = t; break;
        case 3: r = p; g = q; b = v; break;
        case 4: r = t; g = p; b = v; break;
        case 5: r = v; g = p; b = q; break;
      }
      return '#' + [r, g, b].map(function (c) {
        return Math.round(c * 255).toString(16).padStart(2, '0');
      }).join('');
    }

    function cosinePalette(t, a, b, c, d) {
      return [0, 1, 2].map(function (i) {
        return a[i] + b[i] * Math.cos(6.28318 * (c[i] * t + d[i]));
      });
    }

    // Preview-only: preset curve/stop values are already display-space (not
    // stored linear uniforms), so hex-ify directly with no gamma step — unlike
    // toHex(), which assumes its input is linear and gamma-encodes it back.
    function previewHex(v) {
      return '#' + v.map(function (x) {
        var b = Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16);
        return b.length === 1 ? '0' + b : b;
      }).join('');
    }

    // Preview gradients for the tappable swatch pickers — 6-stop sample of the
    // cosine curve for palette presets, direct 4 stops for 4-stop presets.
    function cosinePresetGradient(p) {
      var stops = [0, 0.2, 0.4, 0.6, 0.8, 1.0].map(function (t) {
        return previewHex(cosinePalette(t, p.a, p.b, p.c, p.d));
      });
      return 'linear-gradient(135deg, ' + stops.join(', ') + ')';
    }

    function fourStopPresetGradient(p) {
      return 'linear-gradient(135deg, ' + [p.c0, p.c1, p.c2, p.c3].map(previewHex).join(', ') + ')';
    }

    // keyValPairs values are sRGB-intent [r,g,b] arrays (same convention as a hex
    // swatch, e.g. preset color entries) for literal color keys — linearize
    // before storing so they match what the picker's own input handler would
    // have produced for the same color. Palette-coefficient keys (see
    // PALETTE_COEFF_KEYS) pass through unchanged since they're formula inputs,
    // not colors.
    function applyColors(keyValPairs) {
      keyValPairs.forEach(function (pair) {
        var key = pair[0];
        var stored = PALETTE_COEFF_KEYS[key] ? pair[1] : pair[1].map(srgbToLinear);
        window._shaderState.values[key] = stored;
        var inp = document.querySelector('[data-param-key="' + key + '"]');
        if (inp) {
          inp.value = toHex(stored, key);
          inp.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
    }

    SHADER_FONTS.forEach(function (f) {
      document.fonts.load('700 48px "' + f + '"');
    });

    var FINISH_CONTROLS_PRE = [
      { type: 'header', label: 'Finish' },
      { key: 'u_opacity', label: 'Opacity', type: 'range', min: 0, max: 1, step: 0.01, value: 1.0, noRandomize: true,
        tip: 'Fades the entire design from fully visible to invisible.' },
      { key: 'u_grain_mode', label: 'Grain Type', type: 'select', value: '0', noRandomize: true,
        options: [
          { label: 'Organic',    value: '0' },
          { label: 'Blue Noise', value: '1' },
          { label: 'Scratches',  value: '2' },
          { label: 'Crosshatch', value: '3' },
          { label: 'Half-tone',  value: '4' }
        ],
        tip: 'Organic = smooth blobs. Blue Noise = fine uniform stipple. Scratches = ink drag streaks. Crosshatch = diagonal etched lines. Half-tone = regular dot grid.' },
      { key: 'u_distress_0',       label: 'Amount',       type: 'range', min: 0, max: 0.85, step: 0.01, value: 0.0, noRandomize: true, grainDependent: 0 },
      { key: 'u_distress_scale_0', label: 'Blob Size',    type: 'range', min: 10, max: 600, step: 1,    value: 80,  noRandomize: true, grainDependent: 0 },
      { key: 'u_distress_1',       label: 'Amount',       type: 'range', min: 0, max: 0.85, step: 0.01, value: 0.85, noRandomize: true, grainDependent: 1 },
      { key: 'u_distress_scale_1', label: 'Dot Size',     type: 'range', min: 10, max: 600, step: 1,    value: 248,  noRandomize: true, grainDependent: 1 },
      { key: 'u_distress_2',       label: 'Amount',       type: 'range', min: 0, max: 1, step: 0.01, value: 0.55, noRandomize: true, grainDependent: 2 },
      { key: 'u_distress_scale_2', label: 'Line Density', type: 'range', min: 10, max: 4000, step: 1,    value: 2000, noRandomize: true, grainDependent: 2 },
      { key: 'u_distress_3',       label: 'Amount',       type: 'range', min: 0, max: 0.85, step: 0.01, value: 0.43, noRandomize: true, grainDependent: 3 },
      { key: 'u_distress_scale_3', label: 'Line Density', type: 'range', min: 10, max: 800, step: 1,    value: 331, noRandomize: true, grainDependent: 3 },
      { key: 'u_distress_4',       label: 'Fill Amount',  type: 'range', min: 0, max: 0.85, step: 0.01, value: 0.79, noRandomize: true, grainDependent: 4 },
      { key: 'u_distress_scale_4', label: 'Spacing',      type: 'range', min: 10, max: 600, step: 1,    value: 287,  noRandomize: true, grainDependent: 4 },
      { key: 'u_halftone_angle',   label: 'Angle',        type: 'range', min: 0, max: 180,  step: 1,    value: 45,  noRandomize: true, grainDependent: 4 },
      { key: 'u_halftone_luma',   label: 'Luma Drive',   type: 'range', min: 0, max: 1,    step: 0.01, value: 0.0, noRandomize: true, grainDependent: 4,
        tip: 'At 1, dot size follows brightness — brighter areas get bigger dots. At 0, all dots are the same size.' },
      { key: 'u_halftone_shape', label: 'Dot Shape',   type: 'select', value: '0', noRandomize: true, grainDependent: 4,
        options: [
          { label: 'Circle',  value: '0' },
          { label: 'Square',  value: '1' },
          { label: 'Diamond', value: '2' }
        ] },
      { key: 'u_distress_falloff', label: 'Edge Falloff', type: 'range', min: 0, max: 1, step: 0.05, value: 0.0, noRandomize: true,
        tip: 'At 0, distress is uniform. At 1, distress concentrates at edges and corners.' },
    ];
    var FINISH_CONTROLS_POST = [
      { key: 'u_vignette_top',      label: 'Vignette Top',      type: 'range', min: 0,   max: 20,  step: 0.05, value: 0,   noRandomize: true },
      { key: 'u_vignette_bottom',   label: 'Vignette Bottom',   type: 'range', min: 0,   max: 20,  step: 0.05, value: 0,   noRandomize: true },
      { key: 'u_vignette_left',     label: 'Vignette Left',     type: 'range', min: 0,   max: 20,  step: 0.05, value: 0,   noRandomize: true },
      { key: 'u_vignette_right',    label: 'Vignette Right',    type: 'range', min: 0,   max: 20,  step: 0.05, value: 0,   noRandomize: true },
      { key: 'u_vignette_anchor_x', label: 'Vignette Anchor X', type: 'range', min: 0,   max: 1,   step: 0.01, value: 0.5, noRandomize: true },
      { key: 'u_vignette_anchor_y', label: 'Vignette Anchor Y', type: 'range', min: 0,   max: 1,   step: 0.01, value: 0.5, noRandomize: true },
      { key: 'u_pos_x', label: 'Position X', type: 'range', min: -0.5, max: 0.5, step: 0.01, value: 0.0, noRandomize: true },
      { key: 'u_pos_y', label: 'Position Y', type: 'range', min: -0.5, max: 0.5, step: 0.01, value: 0.0, noRandomize: true },
      { key: 'u_scale', label: 'Scale',      type: 'range', min: 0.2,  max: 3.0,  step: 0.05, value: 1.0, noRandomize: true },
    ];
    var FINISH_CONTROLS = FINISH_CONTROLS_PRE.concat(FINISH_CONTROLS_POST);


    var SHADERS = {};

    // Each snippet is re-run per call so its `controls` array and its
    // `customAfterBuild` closure belong to the panel being built. `controls`
    // is a lazy getter over a throwaway container, for callers that only want
    // the array (defaults, palette mapping, tests).
    function register(name, build) {
      var cached = null;
      function ensure() {
        if (!cached) cached = build(document.createElement('div'));
        return cached;
      }
      SHADERS[name] = {
        build: build,
        fonts: SHADER_FONTS,
        get controls() { return ensure().controls; },
        get customAfterBuild() { return ensure().customAfterBuild; }
      };
    }


    // ── chladni ───────────────────────────────────────────────────────────
    register('chladni', function (body) {
        var controls = [
          // ── Pattern ───────────────────────────────────────────────────────────────
          { type: 'header', label: 'Pattern' },
          { key: 'u_n',         label: 'N Frequency', type: 'range', min: 1,    max: 12,   step: 0.5,   value: 3     },
          { key: 'u_m',         label: 'M Frequency', type: 'range', min: 1,    max: 12,   step: 0.5,   value: 4     },
          { key: 'u_a',         label: 'Coeff A',     type: 'range', min: -3,   max: 3,    step: 0.05,  value: -1    },
          { key: 'u_b',         label: 'Coeff B',     type: 'range', min: -3,   max: 3,    step: 0.05,  value: 2.5   },
          { key: 'u_threshold', label: 'Threshold',   type: 'range', min: 0.01, max: 0.35, step: 0.005, value: 0.105 },
          { key: 'u_glow',      label: 'Glow',        type: 'range', min: 0,    max: 1.0,  step: 0.01,  value: 0.57  },
          { key: 'u_rotation',  label: 'Rotation',    type: 'range', min: 0,    max: 360,  step: 1,     value: 335,  toRadians: true },
          // ── Color ─────────────────────────────────────────────────────────────────
          { type: 'header', label: 'Color' },
          { key: 'u_grad_mode', label: 'Gradient Mode', type: 'select', value: 1,
            options: [
              { label: 'Flat',    value: 0 },
              { label: 'Radial',  value: 1 },
              { label: 'Linear',  value: 2 },
              { label: 'Angular', value: 3 },
            ]
          },
          { key: 'u_color1', label: 'Color 1',     type: 'color', value: '#24c5f2' },
          { key: 'u_color2', label: 'Color 2',     type: 'color', value: '#f2249a' },
          { key: 'u_chroma', label: 'Chroma Shift', type: 'range', min: 0, max: 6.0, step: 0.1, value: 1.5 },
          // ── Text Overlay ───────────────────────────────────────────────────────────
          { type: 'header', label: 'Text Overlay' },
          { key: 'text',           label: 'Text',      type: 'text',   value: '',            textDirty: true, noRandomize: true },
          { key: 'textFont',       label: 'Font',      type: 'select', value: 'Montserrat',  textDirty: true, noRandomize: true,
            options: SHADER_FONTS.map(function (f) { return { label: f, value: f }; })
          },
          { key: 'textFontSize', label: 'Font Size', type: 'range', min: 8, max: 300, step: 1,    value: 120, textDirty: true, noRandomize: true },
          { key: 'textX',        label: 'Text X',    type: 'range', min: 0, max: 1.0, step: 0.01, value: 0.5, textDirty: true, noRandomize: true },
          { key: 'textY',        label: 'Text Y',    type: 'range', min: 0, max: 1.0, step: 0.01, value: 0.5, textDirty: true, noRandomize: true },
          { key: 'u_use_text_color', label: 'Custom Color', type: 'toggle', value: 0, noRandomize: true },
          { key: 'u_text_color',    label: 'Text Color',    type: 'color',  value: '#ffffff', textColorDependent: true, noRandomize: true },
          { key: 'outlineEnabled',  label: 'Outline',       type: 'toggle', value: 0, textDirty: true, noRandomize: true },
          { key: 'outlineWidth',    label: 'Outline Width', type: 'range',  min: 1, max: 60, step: 1, value: 8, textDirty: true, outlineDependent: true, noRandomize: true },
          { key: 'u_outline_color', label: 'Outline Color', type: 'color',  value: '#000000', outlineDependent: true, noRandomize: true },
        ].concat(FINISH_CONTROLS_PRE).concat([
          { key: 'u_vignette_top',    label: 'Vignette Top',    type: 'range', min: 0, max: 20, step: 0.05, value: 3.6,  noRandomize: true },
          { key: 'u_vignette_bottom', label: 'Vignette Bottom', type: 'range', min: 0, max: 20, step: 0.05, value: 3.55, noRandomize: true },
          { key: 'u_vignette_left',   label: 'Vignette Left',   type: 'range', min: 0, max: 20, step: 0.05, value: 3.35, noRandomize: true },
          { key: 'u_vignette_right',    label: 'Vignette Right',    type: 'range', min: 0,   max: 20,  step: 0.05, value: 3.2,  noRandomize: true },
          { key: 'u_vignette_anchor_x', label: 'Vignette Anchor X', type: 'range', min: 0,   max: 1,   step: 0.01, value: 0.5,  noRandomize: true },
          { key: 'u_vignette_anchor_y', label: 'Vignette Anchor Y', type: 'range', min: 0,   max: 1,   step: 0.01, value: 0.5,  noRandomize: true },
          { key: 'u_pos_x', label: 'Position X', type: 'range', min: -0.5, max: 0.5, step: 0.01, value: 0.0, noRandomize: true },
          { key: 'u_pos_y', label: 'Position Y', type: 'range', min: -0.5, max: 0.5, step: 0.01, value: 0.0, noRandomize: true },
          { key: 'u_scale', label: 'Scale',      type: 'range', min: 0.2,  max: 3.0,  step: 0.05, value: 1.0, noRandomize: true },
        ]);

        // ── Randomize button ─────────────────────────────────────────────────────────
        (function () {
          function rnd(min, max, step) {
            var steps = Math.floor((max - min) / step);
            return +(Math.min(max, min + Math.round(Math.random() * steps) * step).toFixed(10));
          }

          // stateValue lets callers store a converted value (e.g. radians) while
          // showing the raw slider value (e.g. degrees) in the UI.
          // vividHex(hue) comes from shader-controls-base.liquid.

          function setColor(key, hex) {
            var inp = body.querySelector('[data-param-key="' + key + '"]');
            if (!inp) return;
            inp.value = hex;
            // Fire input so Coloris swatch updates and the existing handler sets state
            inp.dispatchEvent(new Event('input', { bubbles: true }));
          }

          function setSlider(key, value, stateValue) {
            var inp  = body.querySelector('[data-param-key="' + key + '"]');
            if (!inp) return;
            var disp = inp.parentElement.querySelector('.shader-control__value');
            inp.value = value;
            if (disp) disp.textContent = parseFloat(value);
            window._shaderState.values[key] = stateValue !== undefined ? stateValue : value;
          }

          var randRow = document.createElement('div');
          randRow.className = 'shader-control';
          var randBtn = document.createElement('button');
          randBtn.type        = 'button';
          randBtn.className   = 'shader-control__action';
          randBtn.textContent = 'Randomize Pattern';

          randBtn.addEventListener('click', function () {
            var pool = [2, 3, 4, 5, 6, 7, 8, 9, 10];
            var ni = pool[Math.floor(Math.random() * pool.length)];
            var mi = pool[Math.floor(Math.random() * pool.length)];
            if (ni === mi)
              mi = pool[(pool.indexOf(mi) + 1 + Math.floor(Math.random() * (pool.length - 1))) % pool.length];

            var a = rnd(-2.5, 2.5, 0.05);
            var b = rnd(-2.5, 2.5, 0.05);
            if (Math.abs(a) < 0.2 && Math.abs(b) < 0.2)
              a = (Math.random() > 0.5 ? 1 : -1) * rnd(0.5, 2.0, 0.05);

            var rot   = rnd(0, 360, 1);
            var hue1  = Math.random();
            var hue2  = (hue1 + 0.33 + Math.random() * 0.34) % 1;

            setSlider('u_n',         ni);
            setSlider('u_m',         mi);
            setSlider('u_a',         +a.toFixed(2));
            setSlider('u_b',         +b.toFixed(2));
            setSlider('u_threshold', +rnd(0.04, 0.18, 0.005).toFixed(3));
            setSlider('u_glow',      +rnd(0.1, 1.0, 0.01).toFixed(2));
            setSlider('u_rotation',  rot, rot * Math.PI / 180);
            setColor('u_color1', vividHex(hue1));
            setColor('u_color2', vividHex(hue2));
          });

          randRow.appendChild(randBtn);
          body.appendChild(randRow);
        }());

      return {
        controls: controls,
        customAfterBuild: typeof customAfterBuild === 'function' ? customAfterBuild : null
      };
    });


    // ── circle-on-line ────────────────────────────────────────────────────
    register('circle-on-line', function (body) {
        var controls = [
          // ── Shape ─────────────────────────────────────────────────────────────────
          { type: 'header', label: 'Shape' },
          { key: 'u_radius',     label: 'Radius',       type: 'range', min: 0.05, max: 0.5,  step: 0.01, value: 0.4, noRandomize: true  },
          { key: 'u_line_count', label: 'Lines',         type: 'range', min: 2,    max: 80,   step: 1,    value: 20   },
          { key: 'u_power',      label: 'Power',         type: 'range', min: 0.5,  max: 6.0,  step: 0.1,  value: 2.5  },
          { key: 'u_width_top',  label: 'Width Top',     type: 'range', min: 0,    max: 1.0,  step: 0.01, value: 0.05, noRandomize: true },
          { key: 'u_width_bot',  label: 'Width Bottom',  type: 'range', min: 0,    max: 1.0,  step: 0.01, value: 0.75, noRandomize: true },
          // ── Color Palette ──────────────────────────────────────────────────────────
          { type: 'header', label: 'Color Palette' },
          { key: 'u_color_mode', label: '4-Color Mode', type: 'toggle', value: 0,
            tip: 'Off = cosine palette. On = 4-stop linear gradient from top to bottom.' },
          { key: '_lc_palette_preset', label: 'Preset', type: 'select', paletteDependent: true, value: 'Rainbow', swatchPreview: 'cosine',
            options: Object.keys(COSINE_PRESETS).map(function (k) { return { label: k, value: k }; })
          },
          { key: 'u_a', label: 'Palette A', type: 'color', paletteDependent: true, value: '#808080',
            tip: 'Offset — base brightness per channel. Sets the center point colors oscillate around.' },
          { key: 'u_b', label: 'Palette B', type: 'color', paletteDependent: true, value: '#808080',
            tip: 'Amplitude — color swing range per channel. Higher = more vivid, saturated output.' },
          { key: 'u_c', label: 'Palette C', type: 'color', paletteDependent: true, value: '#ffffff',
            tip: 'Frequency — how many times the palette cycles per channel.' },
          { key: 'u_d', label: 'Palette D', type: 'color', paletteDependent: true, value: '#0054ab',
            tip: 'Phase — shifts the starting hue of the color cycle.' },
          { key: '_lc_4color_preset', label: 'Preset', type: 'select', stopDependent: true, value: 'Neon', swatchPreview: 'fourstop',
            options: Object.keys(FOUR_STOP_PRESETS).map(function (k) { return { label: k, value: k }; })
          },
          { key: 'u_color0', label: 'Color 1 (Top)',    type: 'color', stopDependent: true, value: '#ff3366' },
          { key: 'u_color1', label: 'Color 2',          type: 'color', stopDependent: true, value: '#ffcc00' },
          { key: 'u_color2', label: 'Color 3',          type: 'color', stopDependent: true, value: '#00ccff' },
          { key: 'u_color3', label: 'Color 4 (Bottom)', type: 'color', stopDependent: true, value: '#aa00ff' },
          // ── Triangle Mask ──────────────────────────────────────────────────────────
          { type: 'header', label: 'Triangle Mask' },
          { key: 'u_tri_enabled',  label: 'Enabled',    type: 'toggle', value: 1, noRandomize: true },
          { key: 'u_tri_rotation', label: 'Rotation',   type: 'range', min: 0,   max: 360, step: 1,    value: 0,  toRadians: true, noRandomize: true },
          { key: 'u_tri_size',     label: 'Size',       type: 'range', min: 0.1, max: 2.0, step: 0.01, value: 1.0, noRandomize: true },
          { key: 'u_tri_width',    label: 'Base Width', type: 'range', min: 5,   max: 89,  step: 1,    value: 45, toRadians: true, noRandomize: true },
          // ── Center Circle ──────────────────────────────────────────────────────────
          { type: 'header', label: 'Center Circle' },
          { key: 'u_center_circle_enabled', label: 'Enabled', type: 'toggle', value: 1, noRandomize: true },
          { key: 'u_center_circle_radius',  label: 'Radius',  type: 'range', min: 0.01, max: 0.45, step: 0.005, value: 0.04 },
          // ── Text Overlay ───────────────────────────────────────────────────────────
          { type: 'header', label: 'Text Overlay' },
          { key: 'u_text_enabled', label: 'Text Overlay', type: 'toggle', value: 0, textDirty: true, noRandomize: true },
          { key: 'text',           label: 'Text',      type: 'text',   value: '2001',         textDirty: true, noRandomize: true },
          { key: 'textFont',       label: 'Font',      type: 'select', value: 'Oswald', textDirty: true, noRandomize: true,
            options: SHADER_FONTS.map(function (f) { return { label: f, value: f }; })
          },
          { key: 'textFontSize', label: 'Font Size', type: 'range', min: 8, max: 300, step: 1,    value: 69,  textDirty: true, noRandomize: true },
          { key: 'textX',        label: 'Text X',    type: 'range', min: 0, max: 1.0, step: 0.01, value: 0.3,  textDirty: true, noRandomize: true },
          { key: 'textY',        label: 'Text Y',    type: 'range', min: 0, max: 1.0, step: 0.01, value: 0.2, textDirty: true, noRandomize: true },
          { key: 'u_use_text_color', label: 'Custom Color', type: 'toggle', value: 0, noRandomize: true },
          { key: 'u_text_color',    label: 'Text Color',    type: 'color',  value: '#ffffff', textColorDependent: true, noRandomize: true },
          { key: 'outlineEnabled',  label: 'Outline',       type: 'toggle', value: 0, textDirty: true, noRandomize: true },
          { key: 'outlineWidth',    label: 'Outline Width', type: 'range',  min: 1, max: 60, step: 1, value: 8, textDirty: true, outlineDependent: true, noRandomize: true },
          { key: 'u_outline_color', label: 'Outline Color', type: 'color',  value: '#000000', outlineDependent: true, noRandomize: true },
        ].concat(FINISH_CONTROLS);

        var customAfterBuild = function () {
          var cosineKeys = ['u_a', 'u_b', 'u_c', 'u_d'];

          function applyCosinePreset(p) {
            applyColors(cosineKeys.map(function (k, i) {
              return [k, [p.a, p.b, p.c, p.d][i]];
            }));
          }

          function apply4ColorPreset(p) {
            applyColors([
              ['u_color0', p.c0],
              ['u_color1', p.c1],
              ['u_color2', p.c2],
              ['u_color3', p.c3],
            ]);
          }

          // Apply default on load so shader matches pickers.
          applyCosinePreset(COSINE_PRESETS['Rainbow']);

          var cosinePresetSel = document.querySelector('[data-param-key="_lc_palette_preset"]');
          if (cosinePresetSel) {
            cosinePresetSel.addEventListener('change', function () {
              var p = COSINE_PRESETS[this.value];
              if (p) applyCosinePreset(p);
            });
          }

          var fourColorPresetSel = document.querySelector('[data-param-key="_lc_4color_preset"]');
          if (fourColorPresetSel) {
            fourColorPresetSel.addEventListener('change', function () {
              var p = FOUR_STOP_PRESETS[this.value];
              if (p) apply4ColorPreset(p);
            });
          }

          // Text Overlay enable toggle — hide all text controls when off
          var body = document.getElementById('shader-gui-body');
          var textEnabledRow = Array.from(body.children).find(function (el) {
            var lbl = el.querySelector && el.querySelector('.shader-control__label');
            return lbl && lbl.textContent.trim() === 'Text Overlay' && el.querySelector('.shader-control__toggle');
          });
          var textEnabledBtn = textEnabledRow && textEnabledRow.querySelector('.shader-control__toggle');

          var textDependentRows = [];
          var found = false;
          Array.from(body.children).forEach(function (el) {
            if (el === textEnabledRow) { found = true; return; }
            if (!found) return;
            if (el.classList.contains('shader-control__section-header')) { found = false; return; }
            if (el.classList.contains('shader-control')) textDependentRows.push(el);
          });

          function applyTextEnabledVis() {
            var on = textEnabledBtn && textEnabledBtn.dataset.on === '1';
            textDependentRows.forEach(function (r) { r.style.display = on ? '' : 'none'; });
          }
          if (textEnabledBtn) textEnabledBtn.addEventListener('click', applyTextEnabledVis);
          applyTextEnabledVis();
        };


      return {
        controls: controls,
        customAfterBuild: typeof customAfterBuild === 'function' ? customAfterBuild : null
      };
    });


    // ── contour-pareidolia ────────────────────────────────────────────────
    register('contour-pareidolia', function (body) {
        var controls = [
          // ── Terrain ───────────────────────────────────────────────────────────────
          { type: 'header', label: 'Terrain — Hill 1' },
          { key: 'u_hill1_x', label: 'X', type: 'range', min: -1, max: 1, step: 0.01, value: -0.3 },
          { key: 'u_hill1_y', label: 'Y', type: 'range', min: -1, max: 1, step: 0.01, value: 0.2 },
          { key: 'u_hill1_radius', label: 'Radius', type: 'range', min: 0.05, max: 0.8, step: 0.01, value: 0.4 },
          { key: 'u_hill1_height', label: 'Height', type: 'range', min: -1.5, max: 1.5, step: 0.01, value: 1.0,
            tip: 'Positive = peak. Negative = valley/basin.' },
          { type: 'header', label: 'Terrain — Hill 2' },
          { key: 'u_hill2_x', label: 'X', type: 'range', min: -1, max: 1, step: 0.01, value: 0.28 },
          { key: 'u_hill2_y', label: 'Y', type: 'range', min: -1, max: 1, step: 0.01, value: -0.1 },
          { key: 'u_hill2_radius', label: 'Radius', type: 'range', min: 0.05, max: 0.8, step: 0.01, value: 0.35 },
          { key: 'u_hill2_height', label: 'Height', type: 'range', min: -1.5, max: 1.5, step: 0.01, value: 0.8 },
          { type: 'header', label: 'Terrain — Hill 3' },
          { key: 'u_hill3_x', label: 'X', type: 'range', min: -1, max: 1, step: 0.01, value: 0.0 },
          { key: 'u_hill3_y', label: 'Y', type: 'range', min: -1, max: 1, step: 0.01, value: -0.32 },
          { key: 'u_hill3_radius', label: 'Radius', type: 'range', min: 0.05, max: 0.8, step: 0.01, value: 0.3 },
          { key: 'u_hill3_height', label: 'Height', type: 'range', min: -1.5, max: 1.5, step: 0.01, value: -0.6 },
          // ── Contour Lines ────────────────────────────────────────────────────────────
          { type: 'header', label: 'Contour Lines' },
          { key: 'u_contour_spacing', label: 'Spacing', type: 'range', min: 0.005, max: 0.4, step: 0.005, value: 0.12,
            tip: 'Elevation interval between contour lines.' },
          { key: 'u_contour_width', label: 'Line Width', type: 'range', min: 0.001, max: 0.03, step: 0.001, value: 0.025 },
          { key: 'u_outline_width', label: 'Border Width', type: 'range', min: 0.001, max: 0.03, step: 0.001, value: 0.025,
            tip: 'Thickness of the outer footprint border, independent of interior contour lines.' },
          // ── Color Palette ──────────────────────────────────────────────────────────
          { type: 'header', label: 'Color Palette' },
          { key: 'u_color_mode', label: '4-Color Mode', type: 'toggle', value: 0,
            tip: 'Off = cosine palette. On = 4-stop linear gradient by elevation.' },
          { key: '_cp_palette_preset', label: 'Preset', type: 'select', paletteDependent: true, value: 'Rainbow', swatchPreview: 'cosine',
            options: Object.keys(COSINE_PRESETS).map(function (k) { return { label: k, value: k }; })
          },
          { key: 'u_a', label: 'Palette A', type: 'color', paletteDependent: true, value: '#808080',
            tip: 'Offset — base brightness per channel. Sets the center point colors oscillate around.' },
          { key: 'u_b', label: 'Palette B', type: 'color', paletteDependent: true, value: '#808080',
            tip: 'Amplitude — color swing range per channel. Higher = more vivid, saturated output.' },
          { key: 'u_c', label: 'Palette C', type: 'color', paletteDependent: true, value: '#ffffff',
            tip: 'Frequency — how many times the palette cycles per channel.' },
          { key: 'u_d', label: 'Palette D', type: 'color', paletteDependent: true, value: '#0054ab',
            tip: 'Phase — shifts the starting hue of the color cycle.' },
          { key: '_cp_4color_preset', label: 'Preset', type: 'select', stopDependent: true, value: 'Neon', swatchPreview: 'fourstop',
            options: Object.keys(FOUR_STOP_PRESETS).map(function (k) { return { label: k, value: k }; })
          },
          { key: 'u_color0', label: 'Color 1 (Low)',  type: 'color', stopDependent: true, value: '#ff3366' },
          { key: 'u_color1', label: 'Color 2',        type: 'color', stopDependent: true, value: '#ffcc00' },
          { key: 'u_color2', label: 'Color 3',        type: 'color', stopDependent: true, value: '#00ccff' },
          { key: 'u_color3', label: 'Color 4 (High)', type: 'color', stopDependent: true, value: '#aa00ff' },
        ].concat(FINISH_CONTROLS);

        var customAfterBuild = function () {
          var cosineKeys = ['u_a', 'u_b', 'u_c', 'u_d'];
          function applyCosinePreset(p) {
            applyColors(cosineKeys.map(function (k, i) {
              return [k, [p.a, p.b, p.c, p.d][i]];
            }));
          }

          function apply4ColorPreset(p) {
            applyColors([
              ['u_color0', p.c0],
              ['u_color1', p.c1],
              ['u_color2', p.c2],
              ['u_color3', p.c3],
            ]);
          }

          applyCosinePreset(COSINE_PRESETS['Rainbow']);

          var cosinePresetSel = document.querySelector('[data-param-key="_cp_palette_preset"]');
          if (cosinePresetSel) {
            cosinePresetSel.addEventListener('change', function () {
              var p = COSINE_PRESETS[this.value];
              if (p) applyCosinePreset(p);
            });
          }

          var fourColorPresetSel = document.querySelector('[data-param-key="_cp_4color_preset"]');
          if (fourColorPresetSel) {
            fourColorPresetSel.addEventListener('change', function () {
              var p = FOUR_STOP_PRESETS[this.value];
              if (p) apply4ColorPreset(p);
            });
          }
        };

      return {
        controls: controls,
        customAfterBuild: typeof customAfterBuild === 'function' ? customAfterBuild : null
      };
    });


    // ── echo-text ─────────────────────────────────────────────────────────
    register('echo-text', function (body) {
        var controls = [
          // ── Text ──────────────────────────────────────────────────────────────────
          { type: 'header', label: 'Text' },
          { key: 'text',         label: 'Text',      type: 'text',   textDirty: true, value: 'VIBES' },
          { key: 'textFont',     label: 'Font',      type: 'select', textDirty: true, value: 'Montserrat',
            options: [
              { label: 'Montserrat',          value: 'Montserrat'          },
              { label: 'Oswald',              value: 'Oswald'              },
              { label: 'Unbounded',           value: 'Unbounded'           },
              { label: 'Syne',                value: 'Syne'                },
              { label: 'Bricolage Grotesque', value: 'Bricolage Grotesque' },
              { label: 'Epilogue',            value: 'Epilogue'            },
              { label: 'DM Sans',             value: 'DM Sans'             },
              { label: 'IBM Plex Mono',       value: 'IBM Plex Mono'       },
              { label: 'Space Mono',          value: 'Space Mono'          },
              { label: 'Roboto Mono',         value: 'Roboto Mono'         },
              { label: 'Fira Code',           value: 'Fira Code'           },
              { label: 'Inconsolata',         value: 'Inconsolata'         },
              { label: 'Courier Prime',       value: 'Courier Prime'       },
              { label: 'Fragment Mono',       value: 'Fragment Mono'       },
              { label: 'Azeret Mono',         value: 'Azeret Mono'         },
              { label: 'Geist Mono',          value: 'Geist Mono'          },
            ]
          },
          { key: 'textFontSize', label: 'Font Size', type: 'range', textDirty: true, noRandomize: true, min: 50,   max: 800, step: 10, value: 180 },
        { key: 'textX',        label: 'Text X',    type: 'range', textDirty: true, noRandomize: true, min: 0,    max: 1.0, step: 0.01, value: 0.5 },
          { key: 'textY',        label: 'Text Y',    type: 'range', textDirty: true, noRandomize: true, min: 0,    max: 1.0, step: 0.01, value: 0.32 },
          { key: 'u_text_color', label: 'Text Color', type: 'color', value: '#ffffff' },
          // ── Palette ───────────────────────────────────────────────────────────────
          { type: 'header', label: 'Palette' },
          { key: 'u_color_mode', label: 'Color Mode', type: 'select', value: '1',
            options: [
              { label: 'Flat',   value: '0' },
              { label: '4-Stop', value: '1' },
              { label: 'Cosine', value: '2' },
            ]
          },
          // Cosine palette controls (shown/hidden by customAfterBuild)
          { key: '_et_palette_preset', label: 'Preset', type: 'select', value: 'Rainbow', swatchPreview: 'cosine',
            options: Object.keys(COSINE_PRESETS).map(function (k) { return { label: k, value: k }; })
          },
          { key: 'u_a', label: 'Palette A', type: 'color', value: '#ad6da7',
            tip: 'Offset — base brightness per channel.' },
          { key: 'u_b', label: 'Palette B', type: 'color', value: '#808080',
            tip: 'Amplitude — color swing range per channel.' },
          { key: 'u_c', label: 'Palette C', type: 'color', value: '#ffffff',
            tip: 'Frequency — how many times the palette cycles per channel.' },
          { key: 'u_d', label: 'Palette D', type: 'color', value: '#0054ab',
            tip: 'Phase — shifts the starting hue of the color cycle.' },
          // 4-stop colors (shown/hidden by customAfterBuild)
          { key: '_et_4color_preset', label: 'Preset', type: 'select', value: 'Neon', swatchPreview: 'fourstop',
            options: Object.keys(FOUR_STOP_PRESETS).map(function (k) { return { label: k, value: k }; })
          },
          { key: 'u_color0', label: 'Color 1 (Top)',    type: 'color', value: '#ff3366' },
          { key: 'u_color1', label: 'Color 2',          type: 'color', value: '#ffcc00' },
          { key: 'u_color2', label: 'Color 3',          type: 'color', value: '#00ccff' },
          { key: 'u_color3', label: 'Color 4 (Bottom)', type: 'color', value: '#aa00ff' },
          // Snap strips (shown when not Flat mode)
          { key: 'u_snap_strips', label: 'Flat Per Strip', type: 'toggle', value: 0,
            tip: 'Snap the palette so each echo strip shows a single flat color.' },
          // ── Echo ──────────────────────────────────────────────────────────────────
          { type: 'header', label: 'Echo' },
          { key: 'u_repeat_strip',   label: 'Echo Repeat',    type: 'toggle', textDirty: true, noRandomize: true, value: 1 },
          { key: 'u_strip_fraction', label: 'Strip Height',   type: 'range',  textDirty: true, min: 0.05, max: 0.5,  step: 0.01, value: 0.2,  gaussian: true, randomMin: 0.08, randomMax: 0.35 },
          { key: 'u_strip_sample',   label: 'Strip Sample %', type: 'range',  textDirty: true, min: 0.0,  max: 1.0,  step: 0.01, value: 0.0  },
          { key: 'u_repeat_count',   label: 'Repeat Count',   type: 'range',  textDirty: true, min: 1,    max: 30,   step: 1,    value: 10,   gaussian: true, randomMin: 5,    randomMax: 20   },
          { key: 'u_strip_gap',      label: 'Strip Gap (px)', type: 'range',  textDirty: true, min: 0,    max: 500,  step: 1,    value: 0,    gaussian: true, randomMin: 0,    randomMax: 80   },
          { key: 'u_solid_enabled',  label: 'Solid Columns',  type: 'toggle', textDirty: true, value: 0 },
          { key: 'u_solid_height',   label: 'Solid Height (px)', type: 'range', textDirty: true, min: 0,    max: 600,  step: 1,    value: 200  },
          { key: 'u_solid_sample',   label: 'Solid Sample %', type: 'range',  textDirty: true, min: 0.0,  max: 1.0,  step: 0.01, value: 0.2  },
          { key: 'u_section_gap',    label: 'Section Gap (px)', type: 'range', textDirty: true, min: -200, max: 500, step: 1,    value: 0    },
          // ── Stamps ────────────────────────────────────────────────────────────────
          { type: 'header', label: 'Stamps' },
          { key: 'u_drag_enabled',  label: 'Enable Stamps',   type: 'toggle', textDirty: true, value: 0, noRandomize: true    },
          { key: 'u_drag_angle',    label: 'Angle (°)',        type: 'range',  textDirty: true, min: 0, max: 360, step: 1, value: 180 },
          { key: 'u_drag_distance', label: 'Distance (px)',    type: 'range',  textDirty: true, min: 0, max: 800, step: 1,    value: 120, gaussian: true, randomMin: 30,  randomMax: 300 },
          { key: 'u_drag_steps',    label: 'Stamp Count',      type: 'range',  textDirty: true, min: 1, max: 30,  step: 1,    value: 8,   gaussian: true, randomMin: 3,   randomMax: 18  },
          { key: 'u_drag_decay',    label: 'Stamp Decay',      type: 'range',  textDirty: true, min: 0.1, max: 1.0, step: 0.01, value: 0.7, gaussian: true, randomMin: 0.4, randomMax: 0.9 },
          // ── Blur ──────────────────────────────────────────────────────────────────
          { type: 'header', label: 'Blur' },
          { key: 'u_blur_enabled', label: 'Enable Blur',   type: 'toggle', value: 0, noRandomize: true },
          { key: 'u_blur_angle',   label: 'Blur Angle (°)', type: 'range', toRadians: true, min: 0, max: 360, step: 1,     value: 180  },
          { key: 'u_blur_length',  label: 'Blur Length',   type: 'range', min: 0.0, max: 0.5, step: 0.005, value: 0.08, gaussian: true, randomMin: 0.01, randomMax: 0.25 },
          { key: 'u_blur_falloff', label: 'Blur Falloff',  type: 'range', min: 0.0, max: 1.0, step: 0.01,  value: 0.6,  gaussian: true, randomMin: 0.3,  randomMax: 0.9  },
          // ── Outline ───────────────────────────────────────────────────────────────
          { type: 'header', label: 'Outline' },
          { key: 'u_outline_enabled', label: 'Outline',       type: 'toggle', textDirty: true, value: 0, noRandomize: true },
          { key: 'u_outline_width',   label: 'Outline Width', type: 'range',  textDirty: true, min: 1, max: 60, step: 1, value: 8, noRandomize: true },
          { key: 'u_outline_color',   label: 'Outline Color', type: 'color',  value: '#000000', noRandomize: true },
        ].concat(FINISH_CONTROLS).map(function (c) {
          if (c.key === 'u_pos_y') return Object.assign({}, c, { value: -0.17 });
          return c;
        });

        var customAfterBuild = function () {
          var presets = COSINE_PRESETS;

          // Keys for each visibility group
          var cosineKeys = ['_et_palette_preset', 'u_a', 'u_b', 'u_c', 'u_d'];
          var stopKeys   = ['_et_4color_preset', 'u_color0', 'u_color1', 'u_color2', 'u_color3'];

          function rowFor(key) {
            var el = document.querySelector('[data-param-key="' + key + '"]');
            return el ? el.closest('.shader-control') : null;
          }

          function applyVisibility() {
            var modeEl = document.querySelector('[data-param-key="u_color_mode"]');
            var mode   = modeEl ? modeEl.value : '0';

            cosineKeys.forEach(function (key) {
              var row = rowFor(key);
              if (row) row.style.display = mode === '2' ? '' : 'none';
            });
            stopKeys.forEach(function (key) {
              var row = rowFor(key);
              if (row) row.style.display = mode === '1' ? '' : 'none';
            });
            var snapRow = rowFor('u_snap_strips');
            if (snapRow) snapRow.style.display = mode !== '0' ? '' : 'none';
          }

          var modeEl = document.querySelector('[data-param-key="u_color_mode"]');
          if (modeEl) modeEl.addEventListener('change', applyVisibility);
          applyVisibility();

          // 4-stop preset handler
          function apply4ColorPreset(p) {
            applyColors([['u_color0',p.c0],['u_color1',p.c1],['u_color2',p.c2],['u_color3',p.c3]]);
          }

          var fourColorPresetSel = document.querySelector('[data-param-key="_et_4color_preset"]');
          if (fourColorPresetSel) fourColorPresetSel.addEventListener('change', function () {
            var p = FOUR_STOP_PRESETS[this.value]; if (p) apply4ColorPreset(p);
          });

          // Cosine palette preset handler
          var presetSel = document.querySelector('[data-param-key="_et_palette_preset"]');
          if (presetSel) {
            presetSel.addEventListener('change', function () {
              var p = presets[this.value];
              if (!p) return;
              applyColors([['u_a', p.a], ['u_b', p.b], ['u_c', p.c], ['u_d', p.d]]);
            });
          }
        };

        ['Montserrat', 'Oswald', 'Unbounded', 'Syne', 'Bricolage Grotesque', 'Epilogue', 'DM Sans',
         'IBM Plex Mono', 'Space Mono', 'Roboto Mono', 'Fira Code', 'Inconsolata', 'Courier Prime',
         'Fragment Mono', 'Azeret Mono', 'Geist Mono',
        ].forEach(function (f) {
          document.fonts.load('700 48px "' + f + '"');
        });

      return {
        controls: controls,
        customAfterBuild: typeof customAfterBuild === 'function' ? customAfterBuild : null
      };
    });


    // ── four-circles ──────────────────────────────────────────────────────
    register('four-circles', function (body) {
        var controls = [
          // ── Circles ───────────────────────────────────────────────────────────────
          { type: 'header', label: 'Circles' },
          { key: 'u_circle_size', label: 'Circle Size',      type: 'range', min: 0.05, max: 0.49,  step: 0.01, value: 0.33,
            tip: 'Radius of each circle in local quadrant space.' },
          { key: 'u_tri_size',    label: 'Triangle Size',    type: 'range', min: 0.01, max: 1.0,   step: 0.01, value: 0.46,
            tip: 'Height of the triangular cutout.' },
          { key: 'u_tri_angle',   label: 'Triangle Angle',   type: 'range', min: -180, max: 180,   step: 1,    value: 45,
            tip: 'Extra rotation applied to all triangles (degrees).' },
          { key: 'u_tri_apex',    label: 'Triangle Width',   type: 'range', min: 5,    max: 175,   step: 1,    value: 90,
            tip: 'Apex angle of the triangle — wider angle = wider cutout (degrees).' },
          { key: 'u_offset_x',    label: 'X Spacing',        type: 'range', min: -1.0, max: 0.4,   step: 0.01, value: 0.04,  noRandomize: true,
            tip: 'Horizontal shift of each circle away from the image centre.' },
          { key: 'u_offset_y',    label: 'Y Spacing',        type: 'range', min: -1.0, max: 0.4,   step: 0.01, value: -0.14, noRandomize: true,
            tip: 'Vertical shift of each circle away from the image centre.' },
          // ── Rotation ──────────────────────────────────────────────────────────────
          { type: 'header', label: 'Rotation' },
          { key: 'u_rot1', label: 'Top Left',     type: 'range', min: -180, max: 180, step: 1, value: -180,
            tip: 'Individual rotation for the top-left circle (degrees).' },
          { key: 'u_rot2', label: 'Top Right',    type: 'range', min: -180, max: 180, step: 1, value: 0,
            tip: 'Individual rotation for the top-right circle (degrees).' },
          { key: 'u_rot3', label: 'Bottom Left',  type: 'range', min: -180, max: 180, step: 1, value: 0,
            tip: 'Individual rotation for the bottom-left circle (degrees).' },
          { key: 'u_rot4', label: 'Bottom Right', type: 'range', min: -180, max: 180, step: 1, value: 0,
            tip: 'Individual rotation for the bottom-right circle (degrees).' },
          // ── Palette ───────────────────────────────────────────────────────────────
          { type: 'header', label: 'Palette' },
          { key: 'u_color_mode', label: 'Color Mode', type: 'select', value: '2',
            options: [
              { label: 'Cosine',       value: '0' },
              { label: '4-Stop',       value: '1' },
              { label: 'Per-Quadrant', value: '2' },
            ]
          },
          { key: 'u_global_grad', label: 'Global Gradient', type: 'toggle', value: 0,
            tip: 'Off = each quadrant has its own gradient. On = gradient spans the full image.' },
          // Cosine palette controls (hidden when 4-Stop mode is on)
          { key: '_palette_preset', label: 'Preset', type: 'select', paletteDependent: true, value: 'Rainbow', swatchPreview: 'cosine',
            options: Object.keys(COSINE_PRESETS).map(function (k) { return { label: k, value: k }; })
          },
          { key: 'u_a', label: 'Palette A', type: 'color', paletteDependent: true, value: '#808080',
            tip: 'Offset — base brightness per channel.' },
          { key: 'u_b', label: 'Palette B', type: 'color', paletteDependent: true, value: '#808080',
            tip: 'Amplitude — colour swing range per channel.' },
          { key: 'u_c', label: 'Palette C', type: 'color', paletteDependent: true, value: '#ffffff',
            tip: 'Frequency — how many times the palette cycles per channel.' },
          { key: 'u_d', label: 'Palette D', type: 'color', paletteDependent: true, value: '#0054ab',
            tip: 'Phase — shifts the starting hue of the colour cycle.' },
          // 4-stop colour controls (hidden when cosine mode is on)
          { key: '_fc_4color_preset', label: 'Preset', type: 'select', stopDependent: true, value: 'Neon', swatchPreview: 'fourstop',
            options: Object.keys(FOUR_STOP_PRESETS).map(function (k) { return { label: k, value: k }; })
          },
          { key: 'u_color0', label: 'Color 1', type: 'color', stopDependent: true, value: '#ff3366' },
          { key: 'u_color1', label: 'Color 2', type: 'color', stopDependent: true, value: '#ffcc00' },
          { key: 'u_color2', label: 'Color 3', type: 'color', stopDependent: true, value: '#00ccff' },
          { key: 'u_color3', label: 'Color 4', type: 'color', stopDependent: true, value: '#aa00ff' },
          // Per-quadrant colour controls (hidden unless Per-Quadrant mode is active)
          // Reuses FOUR_STOP_PRESETS (c0-c3 map onto the four quadrants) since a
          // per-quadrant combo is just 4 colours, same shape as a 4-stop gradient.
          // Default value '' ('Custom') means none of the named presets match the
          // hand-picked default quadrant colours below, so no swatch shows selected.
          { key: '_fc_quad_preset', label: 'Preset', type: 'select', quadDependent: true, value: '', swatchPreview: 'fourstop',
            options: [{ label: 'Custom', value: '' }].concat(
              Object.keys(FOUR_STOP_PRESETS).map(function (k) { return { label: k, value: k }; })
            )
          },
          { key: 'u_quad0', label: 'Top Left',     type: 'color', quadDependent: true, value: '#d10000' },
          { key: 'u_quad1', label: 'Top Right',    type: 'color', quadDependent: true, value: '#003087' },
          { key: 'u_quad2', label: 'Bottom Left',  type: 'color', quadDependent: true, value: '#ffd700' },
          { key: 'u_quad3', label: 'Bottom Right', type: 'color', quadDependent: true, value: '#f5f5f5' },
          // ── Word Overlay ──────────────────────────────────────────────────────────
          { type: 'header', label: 'Word Overlay' },
          { key: 'u_text_enabled',  label: 'Enabled',   type: 'toggle', value: 0, textDirty: true, noRandomize: true },
          { key: 'text',         label: 'Word',      type: 'text',   value: 'GLOW',        textDirty: true, noRandomize: true, wordDependent: true },
          { key: 'textFont',     label: 'Font',      type: 'select', value: 'Montserrat',  textDirty: true, noRandomize: true, wordDependent: true,
            options: SHADER_FONTS.map(function (f) { return { label: f, value: f }; })
          },
          { key: 'textFontSize', label: 'Size',      type: 'range', min: 8, max: 400, step: 1, value: 200, textDirty: true, noRandomize: true, wordDependent: true },
          { key: 'textX',        label: 'X',         type: 'range', min: 0, max: 1.0, step: 0.01, value: 0.5, textDirty: true, noRandomize: true, wordDependent: true },
          { key: 'textY',        label: 'Y',         type: 'range', min: 0, max: 1.0, step: 0.01, value: 0.5, textDirty: true, noRandomize: true, wordDependent: true },
          { key: 'u_use_text_color',   label: 'Custom Color',   type: 'toggle', value: 0, noRandomize: true, wordDependent: true },
          { key: 'u_text_color',       label: 'Word Color',     type: 'color',  value: '#ffffff', noRandomize: true, wordDependent: true },
          { key: 'outlineEnabled',     label: 'Outline',        type: 'toggle', value: 0, textDirty: true, noRandomize: true, wordDependent: true },
          { key: 'outlineWidth',       label: 'Outline Width',  type: 'range',  min: 1, max: 60, step: 1, value: 8, textDirty: true, noRandomize: true, wordDependent: true },
          { key: 'u_outline_color',    label: 'Outline Color',  type: 'color',  value: '#000000', noRandomize: true, wordDependent: true },
        ].concat(FINISH_CONTROLS);

        var customAfterBuild = function () {
          var cosineKeys = ['u_a', 'u_b', 'u_c', 'u_d'];

          function applyCosinePreset(p) {
            applyColors(cosineKeys.map(function (k, i) {
              return [k, [p.a, p.b, p.c, p.d][i]];
            }));
          }

          function apply4ColorPreset(p) {
            applyColors([
              ['u_color0', p.c0],
              ['u_color1', p.c1],
              ['u_color2', p.c2],
              ['u_color3', p.c3],
            ]);
          }

          function applyQuadPreset(p) {
            applyColors([
              ['u_quad0', p.c0],
              ['u_quad1', p.c1],
              ['u_quad2', p.c2],
              ['u_quad3', p.c3],
            ]);
          }

          // Apply default on load so shader matches pickers.
          applyCosinePreset(COSINE_PRESETS['Rainbow']);

          var presetSel = document.querySelector('[data-param-key="_palette_preset"]');
          if (presetSel) {
            presetSel.addEventListener('change', function () {
              var p = COSINE_PRESETS[this.value];
              if (p) applyCosinePreset(p);
            });
          }

          var fourColorPresetSel = document.querySelector('[data-param-key="_fc_4color_preset"]');
          if (fourColorPresetSel) {
            fourColorPresetSel.addEventListener('change', function () {
              var p = FOUR_STOP_PRESETS[this.value];
              if (p) apply4ColorPreset(p);
            });
          }

          var quadPresetSel = document.querySelector('[data-param-key="_fc_quad_preset"]');
          if (quadPresetSel) {
            quadPresetSel.addEventListener('change', function () {
              var p = FOUR_STOP_PRESETS[this.value];
              if (p) applyQuadPreset(p);
            });
          }

        };

      return {
        controls: controls,
        customAfterBuild: typeof customAfterBuild === 'function' ? customAfterBuild : null
      };
    });


    // ── line-circle ───────────────────────────────────────────────────────
    register('line-circle', function (body) {
        var controls = [
          // ── Shape ─────────────────────────────────────────────────────────────────
          { type: 'header', label: 'Shape' },
          { key: 'u_radius',     label: 'Radius',       type: 'range', min: 0.05, max: 0.5,  step: 0.01, value: 0.34, noRandomize: true  },
          { key: 'u_line_count', label: 'Lines',         type: 'range', min: 2,    max: 80,   step: 1,    value: 23   },
          { key: 'u_power',      label: 'Power',         type: 'range', min: 0.5,  max: 6.0,  step: 0.1,  value: 4.4  },
          { key: 'u_width_top',  label: 'Width Top',     type: 'range', min: 0,    max: 1.0,  step: 0.01, value: 0.4, noRandomize: true },
          { key: 'u_width_bot',  label: 'Width Bottom',  type: 'range', min: 0,    max: 1.0,  step: 0.01, value: 0.67, noRandomize: true },
          // ── Color Palette ──────────────────────────────────────────────────────────
          { type: 'header', label: 'Color Palette' },
          { key: 'u_color_mode', label: '4-Color Mode', type: 'toggle', value: 1,
            tip: 'Off = cosine palette. On = 4-stop linear gradient from top to bottom.' },
          { key: '_lc_palette_preset', label: 'Preset', type: 'select', paletteDependent: true, value: 'Rainbow', swatchPreview: 'cosine',
            options: Object.keys(COSINE_PRESETS).map(function (k) { return { label: k, value: k }; })
          },
          { key: 'u_a', label: 'Palette A', type: 'color', paletteDependent: true, value: '#808080',
            tip: 'Offset — base brightness per channel. Sets the center point colors oscillate around.' },
          { key: 'u_b', label: 'Palette B', type: 'color', paletteDependent: true, value: '#808080',
            tip: 'Amplitude — color swing range per channel. Higher = more vivid, saturated output.' },
          { key: 'u_c', label: 'Palette C', type: 'color', paletteDependent: true, value: '#ffffff',
            tip: 'Frequency — how many times the palette cycles per channel.' },
          { key: 'u_d', label: 'Palette D', type: 'color', paletteDependent: true, value: '#0054ab',
            tip: 'Phase — shifts the starting hue of the color cycle.' },
          { key: '_lc_4color_preset', label: 'Preset', type: 'select', stopDependent: true, value: 'Neon', swatchPreview: 'fourstop',
            options: Object.keys(FOUR_STOP_PRESETS).map(function (k) { return { label: k, value: k }; })
          },
          { key: 'u_color0', label: 'Color 1 (Top)',    type: 'color', stopDependent: true, value: '#ff3366' },
          { key: 'u_color1', label: 'Color 2',          type: 'color', stopDependent: true, value: '#ffcc00' },
          { key: 'u_color2', label: 'Color 3',          type: 'color', stopDependent: true, value: '#00ccff' },
          { key: 'u_color3', label: 'Color 4 (Bottom)', type: 'color', stopDependent: true, value: '#aa00ff' },
          // ── Triangle Mask ──────────────────────────────────────────────────────────
          { type: 'header', label: 'Triangle Mask' },
          { key: 'u_tri_enabled',  label: 'Enabled',    type: 'toggle', value: 1, noRandomize: true },
          { key: 'u_tri_rotation', label: 'Rotation',   type: 'range', min: 0,   max: 360, step: 1,    value: 0,  toRadians: true, noRandomize: true },
          { key: 'u_tri_size',     label: 'Size',       type: 'range', min: 0.1, max: 2.0, step: 0.01, value: 1.0, noRandomize: true },
          { key: 'u_tri_width',    label: 'Base Width', type: 'range', min: 5,   max: 89,  step: 1,    value: 45, toRadians: true, noRandomize: true },
          // ── Center Circle ──────────────────────────────────────────────────────────
          { type: 'header', label: 'Center Circle' },
          { key: 'u_center_circle_enabled', label: 'Enabled', type: 'toggle', value: 1, noRandomize: true },
          { key: 'u_center_circle_radius',  label: 'Radius',  type: 'range', min: 0.01, max: 0.45, step: 0.005, value: 0.27 },
          // ── Text Overlay ───────────────────────────────────────────────────────────
          { type: 'header', label: 'Text Overlay' },
          { key: 'u_text_enabled', label: 'Text Overlay', type: 'toggle', value: 0, textDirty: true, noRandomize: true },
          { key: 'text',           label: 'Text',      type: 'text',   value: '2001',         textDirty: true, noRandomize: true },
          { key: 'textFont',       label: 'Font',      type: 'select', value: 'Oswald', textDirty: true, noRandomize: true,
            options: SHADER_FONTS.map(function (f) { return { label: f, value: f }; })
          },
          { key: 'textFontSize', label: 'Font Size', type: 'range', min: 8, max: 300, step: 1,    value: 69,  textDirty: true, noRandomize: true },
          { key: 'textX',        label: 'Text X',    type: 'range', min: 0, max: 1.0, step: 0.01, value: 0.3,  textDirty: true, noRandomize: true },
          { key: 'textY',        label: 'Text Y',    type: 'range', min: 0, max: 1.0, step: 0.01, value: 0.2, textDirty: true, noRandomize: true },
          { key: 'u_use_text_color', label: 'Custom Color', type: 'toggle', value: 0, noRandomize: true },
          { key: 'u_text_color',    label: 'Text Color',    type: 'color',  value: '#ffffff', textColorDependent: true, noRandomize: true },
          { key: 'outlineEnabled',  label: 'Outline',       type: 'toggle', value: 0, textDirty: true, noRandomize: true },
          { key: 'outlineWidth',    label: 'Outline Width', type: 'range',  min: 1, max: 60, step: 1, value: 8, textDirty: true, outlineDependent: true, noRandomize: true },
          { key: 'u_outline_color', label: 'Outline Color', type: 'color',  value: '#000000', outlineDependent: true, noRandomize: true },
        ].concat(FINISH_CONTROLS);

        var customAfterBuild = function () {
          var cosineKeys = ['u_a', 'u_b', 'u_c', 'u_d'];

          function applyCosinePreset(p) {
            applyColors(cosineKeys.map(function (k, i) {
              return [k, [p.a, p.b, p.c, p.d][i]];
            }));
          }

          function apply4ColorPreset(p) {
            applyColors([
              ['u_color0', p.c0],
              ['u_color1', p.c1],
              ['u_color2', p.c2],
              ['u_color3', p.c3],
            ]);
          }

          // Apply default on load so shader matches pickers.
          applyCosinePreset(COSINE_PRESETS['Rainbow']);

          var cosinePresetSel = document.querySelector('[data-param-key="_lc_palette_preset"]');
          if (cosinePresetSel) {
            cosinePresetSel.addEventListener('change', function () {
              var p = COSINE_PRESETS[this.value];
              if (p) applyCosinePreset(p);
            });
          }

          var fourColorPresetSel = document.querySelector('[data-param-key="_lc_4color_preset"]');
          if (fourColorPresetSel) {
            fourColorPresetSel.addEventListener('change', function () {
              var p = FOUR_STOP_PRESETS[this.value];
              if (p) apply4ColorPreset(p);
            });
          }

          // Text Overlay enable toggle — hide all text controls when off
          var body = document.getElementById('shader-gui-body');
          var textEnabledRow = Array.from(body.children).find(function (el) {
            var lbl = el.querySelector && el.querySelector('.shader-control__label');
            return lbl && lbl.textContent.trim() === 'Text Overlay' && el.querySelector('.shader-control__toggle');
          });
          var textEnabledBtn = textEnabledRow && textEnabledRow.querySelector('.shader-control__toggle');

          var textDependentRows = [];
          var found = false;
          Array.from(body.children).forEach(function (el) {
            if (el === textEnabledRow) { found = true; return; }
            if (!found) return;
            if (el.classList.contains('shader-control__section-header')) { found = false; return; }
            if (el.classList.contains('shader-control')) textDependentRows.push(el);
          });

          function applyTextEnabledVis() {
            var on = textEnabledBtn && textEnabledBtn.dataset.on === '1';
            textDependentRows.forEach(function (r) { r.style.display = on ? '' : 'none'; });
          }
          if (textEnabledBtn) textEnabledBtn.addEventListener('click', applyTextEnabledVis);
          applyTextEnabledVis();
        };


      return {
        controls: controls,
        customAfterBuild: typeof customAfterBuild === 'function' ? customAfterBuild : null
      };
    });


    // ── line-text ─────────────────────────────────────────────────────────
    register('line-text', function (body) {
        var controls = [
          // ── Lines ─────────────────────────────────────────────────────────────────
          { type: 'header', label: 'Lines' },
          { key: 'u_rows',           label: 'Row Count',       type: 'range', min: 5,     max: 150,  step: 1,     value: 62    },
          { key: 'u_base_thickness', label: 'Base Thickness',  type: 'range', min: 0.001, max: 0.2,  step: 0.001, value: 0.033 },
          { key: 'u_text_thickness', label: 'Text Thickness',  type: 'range', min: 0,     max: 0.5,  step: 0.01,  value: 0.24  },
          { key: 'textCapRadius', label: 'Cap Radius', type: 'range', min: 0,  max: 100, step: 1,  value: 10,  textDirty: true,
            tip: 'Blur radius applied to line ends — higher values give softer, more rounded caps.' },
          // ── Text ──────────────────────────────────────────────────────────────────
          { type: 'header', label: 'Text' },
          { key: 'text',         label: 'Text',       type: 'text',   value: 'GLOW',        textDirty: true,
            randomOptions: ['HELLO', 'PIZZA', 'FRESH', 'ALMOST', 'LOVE', 'VIBE'] },
          { key: 'textFont',     label: 'Font',       type: 'select', value: 'Montserrat',  textDirty: true,
            options: SHADER_FONTS.map(function (f) { return { label: f, value: f }; })
          },
          { key: 'textFontSize', label: 'Font Size',  type: 'range', min: 50,  max: 950, step: 1,    value: 268, textDirty: true, noRandomize: true },
          { key: 'textY',        label: 'Text Y',     type: 'range', min: 0,   max: 1,   step: 0.01, value: 0.74, textDirty: true, noRandomize: true },
          // ── Color Palette ──────────────────────────────────────────────────────────
          { type: 'header', label: 'Color Palette' },
          { key: 'u_color_mode', label: '4-Color Mode', type: 'toggle', value: 1,
            tip: 'Off = cosine palette. On = 4-stop linear gradient from left to right.' },
          { key: '_lt_palette_preset', label: 'Preset', type: 'select', paletteDependent: true, noRandomize: true, value: 'Cyberpunk', swatchPreview: 'cosine',
            options: Object.keys(COSINE_PRESETS).map(function (k) { return { label: k, value: k }; })
          },
          { key: 'u_a', label: 'Palette A', type: 'color', paletteDependent: true, value: '#808080',
            tip: 'Offset — base brightness per channel. Sets the center point colors oscillate around.' },
          { key: 'u_b', label: 'Palette B', type: 'color', paletteDependent: true, value: '#808080',
            tip: 'Amplitude — color swing range per channel. Higher = more vivid, saturated output.' },
          { key: 'u_c', label: 'Palette C', type: 'color', paletteDependent: true, value: '#ffff00',
            tip: 'Frequency — how many times the palette cycles per channel.' },
          { key: 'u_d', label: 'Palette D', type: 'color', paletteDependent: true, value: '#803340',
            tip: 'Phase — shifts the starting hue of the color cycle.' },
          { key: '_lt_4color_preset', label: 'Preset', type: 'select', stopDependent: true, value: 'Mexican', swatchPreview: 'fourstop',
            options: Object.keys(FOUR_STOP_PRESETS).map(function (k) { return { label: k, value: k }; })
          },
          { key: 'u_color0', label: 'Color 1 (Left)',  type: 'color', stopDependent: true, value: '#e4007c' },
          { key: 'u_color1', label: 'Color 2',         type: 'color', stopDependent: true, value: '#ff6b00' },
          { key: 'u_color2', label: 'Color 3',         type: 'color', stopDependent: true, value: '#00c5cd' },
          { key: 'u_color3', label: 'Color 4 (Right)', type: 'color', stopDependent: true, value: '#8b1a8b' },
        ].concat(FINISH_CONTROLS_PRE).concat([
          { key: 'u_vignette_top',    label: 'Vignette Top',    type: 'range', min: 0, max: 20, step: 0.05, value: 18.15, randomMin: 0, randomMax: 8 },
          { key: 'u_vignette_bottom', label: 'Vignette Bottom', type: 'range', min: 0, max: 20, step: 0.05, value: 20,    randomMin: 0, randomMax: 8 },
          { key: 'u_vignette_left',   label: 'Vignette Left',   type: 'range', min: 0, max: 20, step: 0.05, value: 2.55,  randomMin: 0, randomMax: 4 },
          { key: 'u_vignette_right',    label: 'Vignette Right',    type: 'range', min: 0,   max: 20,  step: 0.05, value: 2.55, randomMin: 0, randomMax: 4 },
          { key: 'u_vignette_anchor_x', label: 'Vignette Anchor X', type: 'range', min: 0,   max: 1,   step: 0.01, value: 0.5,  noRandomize: true },
          { key: 'u_vignette_anchor_y', label: 'Vignette Anchor Y', type: 'range', min: 0,   max: 1,   step: 0.01, value: 0.75, noRandomize: true },
          { key: 'u_pos_x', label: 'Position X', type: 'range', min: -0.5, max: 0.5, step: 0.01, value: 0.0, noRandomize: true },
          { key: 'u_pos_y', label: 'Position Y', type: 'range', min: -0.5, max: 0.5, step: 0.01, value: 0.0, noRandomize: true },
          { key: 'u_scale', label: 'Scale',      type: 'range', min: 0.2,  max: 3.0,  step: 0.05, value: 1.0, noRandomize: true },
        ]);

        var customAfterBuild = function () {
          var textCtrl = null;
          controls.forEach(function (c) { if (c.key === 'text') textCtrl = c; });
          var textInput = document.querySelector('[data-param-key="text"]');
          if (textInput && textCtrl) {
            textInput.addEventListener('input', function () {
              textCtrl.noRandomize = true;
            });
          }

          var cosineKeys = ['u_a', 'u_b', 'u_c', 'u_d'];

          function applyCosinePreset(p) {
            applyColors(cosineKeys.map(function (k, i) {
              return [k, [p.a, p.b, p.c, p.d][i]];
            }));
          }

          // Sync pickers to default preset on load
          applyCosinePreset(COSINE_PRESETS['Cyberpunk']);

          var cosinePresetSel = document.querySelector('[data-param-key="_lt_palette_preset"]');
          if (cosinePresetSel) {
            cosinePresetSel.addEventListener('change', function () {
              var p = COSINE_PRESETS[this.value];
              if (p) applyCosinePreset(p);
            });
          }

          function apply4ColorPreset(p) {
            applyColors([
              ['u_color0', p.c0],
              ['u_color1', p.c1],
              ['u_color2', p.c2],
              ['u_color3', p.c3],
            ]);
          }

          var fourColorPresetSel = document.querySelector('[data-param-key="_lt_4color_preset"]');
          if (fourColorPresetSel) {
            fourColorPresetSel.addEventListener('change', function () {
              var p = FOUR_STOP_PRESETS[this.value];
              if (p) apply4ColorPreset(p);
            });
          }
        };

      return {
        controls: controls,
        customAfterBuild: typeof customAfterBuild === 'function' ? customAfterBuild : null
      };
    });


    // ── outline-pulse ─────────────────────────────────────────────────────
    register('outline-pulse', function (body) {
        var controls = [
          // ── Palette ───────────────────────────────────────────────────────────────
          { type: 'header', label: 'Color Palette' },
          { key: 'u_color_mode', label: 'Color Mode', type: 'select', value: '0',
            options: [
              { label: 'Cosine', value: '0' },
              { label: '4-Stop', value: '1' },
            ]
          },
          // Cosine palette
          { key: '_op_palette_preset', label: 'Preset', type: 'select', paletteDependent: true, noRandomize: true, value: 'Rainbow', swatchPreview: 'cosine',
            options: [
              { label: 'Rainbow',   value: 'Rainbow'   },
              { label: 'Cool Blue', value: 'Cool Blue' },
              { label: 'Neon Heat', value: 'Neon Heat' },
              { label: 'Cyberpunk', value: 'Cyberpunk' },
              { label: 'Golden',    value: 'Golden'    },
              { label: 'Synthwave', value: 'Synthwave' },
              { label: 'Pastel',    value: 'Pastel'    },
              { label: 'Arctic',    value: 'Arctic'    },
            ]
          },
          { key: 'u_a', label: 'Palette A', type: 'color', paletteDependent: true, value: '#808080',
            tip: 'Offset — base brightness per channel.' },
          { key: 'u_b', label: 'Palette B', type: 'color', paletteDependent: true, value: '#808080',
            tip: 'Amplitude — color swing range per channel.' },
          { key: 'u_c', label: 'Palette C', type: 'color', paletteDependent: true, value: '#ffffff',
            tip: 'Frequency — how many times the palette cycles.' },
          { key: 'u_d', label: 'Palette D', type: 'color', paletteDependent: true, value: '#00547f',
            tip: 'Phase — shifts the starting hue.' },
          // 4-stop
          { key: 'u_color0', label: 'Color 1', type: 'color', stopDependent: true, value: '#ff3366' },
          { key: 'u_color1', label: 'Color 2', type: 'color', stopDependent: true, value: '#ffcc00' },
          { key: 'u_color2', label: 'Color 3', type: 'color', stopDependent: true, value: '#00ccff' },
          { key: 'u_color3', label: 'Color 4', type: 'color', stopDependent: true, value: '#aa00ff' },
          { key: '_op_stop_preset', label: 'Preset', type: 'select', stopDependent: true, noRandomize: true, value: 'Neon', swatchPreview: 'fourstop',
            options: [
              { label: 'Neon',     value: 'Neon'     },
              { label: 'Retro',    value: 'Retro'    },
              { label: 'Sunset',   value: 'Sunset'   },
              { label: 'Aurora',   value: 'Aurora'   },
              { label: 'Dusk',     value: 'Dusk'     },
              { label: 'Midnight', value: 'Midnight' },
              { label: 'Ember',    value: 'Ember'    },
            ]
          },

          // ── Rings ─────────────────────────────────────────────────────────────────
          { type: 'header', label: 'Rings' },
          { key: 'u_ring_freq',      label: 'Ring Count',      type: 'range', min: 1,   max: 30,  step: 0.5,  value: 7.0,
            tip: 'Number of concentric rings from the shirt boundary to the center.' },
          { key: 'u_speed',          label: 'Speed',           type: 'range', min: -3,  max: 3,   step: 0.05, value: 0.5,
            tip: 'Animation speed. Positive = rings pulse inward. Negative = outward. Zero = frozen.' },
          { key: 'u_palette_offset', label: 'Palette Offset',  type: 'range', min: 0,   max: 1,   step: 0.01, value: 0.0,
            tip: 'Rotates the starting position in the color palette.' },

          // ── Edge Glow ─────────────────────────────────────────────────────────────
          { type: 'header', label: 'Edge Glow' },
          { key: 'u_glow_strength',  label: 'Glow Strength',   type: 'range', min: 0,   max: 6,   step: 0.1,  value: 2.5,
            tip: 'Brightness of the halo right at the shirt outline.' },
          { key: 'u_glow_sharpness', label: 'Glow Tightness',  type: 'range', min: 1,   max: 50,  step: 0.5,  value: 12.0,
            tip: 'Higher = a fine crisp line. Lower = a broad diffuse halo.' },

          // ── Noise Warp ────────────────────────────────────────────────────────────
          { type: 'header', label: 'Noise Warp' },
          { key: 'u_noise_warp',  label: 'Warp Amount', type: 'range', min: 0,   max: 0.5,  step: 0.01, value: 0.08,
            tip: 'Pushes the rings off-round for an organic, hand-drawn feel. 0 = perfect circles.' },
          { key: 'u_noise_scale', label: 'Warp Scale',  type: 'range', min: 1,   max: 20,   step: 0.5,  value: 5.0,
            tip: 'Spatial frequency of the noise warp. Higher = finer detail.' },

        ].concat([
          { type: 'header', label: 'Finish' },
          { key: 'u_transparent_bg', label: 'Transparent BG', type: 'toggle', value: 0,
            tip: 'On = ring troughs are transparent (ink-on-fabric look). Off = solid fill inside the shirt shape.' },
        ]).concat(FINISH_CONTROLS_PRE.slice(1)).concat(FINISH_CONTROLS_POST);

        var customAfterBuild = function () {
          // Cosine preset wiring
          var cosineKeys = ['u_a', 'u_b', 'u_c', 'u_d'];
          function applyCosinePreset(p) {
            applyColors(cosineKeys.map(function (k, i) {
              return [k, [p.a, p.b, p.c, p.d][i]];
            }));
          }
          applyCosinePreset(COSINE_PRESETS['Rainbow']);
          var presetSel = document.querySelector('[data-param-key="_op_palette_preset"]');
          if (presetSel) {
            presetSel.addEventListener('change', function () {
              var p = COSINE_PRESETS[this.value];
              if (p) applyCosinePreset(p);
            });
          }

          // 4-stop preset wiring
          function apply4StopPreset(p) {
            applyColors([
              ['u_color0', p.c0], ['u_color1', p.c1],
              ['u_color2', p.c2], ['u_color3', p.c3],
            ]);
          }
          apply4StopPreset(FOUR_STOP_PRESETS['Neon']);
          var stopPresetSel = document.querySelector('[data-param-key="_op_stop_preset"]');
          if (stopPresetSel) {
            stopPresetSel.addEventListener('change', function () {
              var p = FOUR_STOP_PRESETS[this.value];
              if (p) apply4StopPreset(p);
            });
          }
        };

      return {
        controls: controls,
        customAfterBuild: typeof customAfterBuild === 'function' ? customAfterBuild : null
      };
    });


    // ── rise-shirt ────────────────────────────────────────────────────────
    register('rise-shirt', function (body) {
        var controls = [
          // ── Palette ───────────────────────────────────────────────────────────────
          { type: 'header', label: 'Color Palette' },
          { key: 'u_color_mode', label: 'Color Mode', type: 'select', value: '0',
            options: [
              { label: 'Cosine', value: '0' },
              { label: '4-Stop', value: '1' },
              { label: 'OKLCH',  value: '2' },
            ]
          },
          // Cosine palette controls
          { key: '_rs_palette_preset', label: 'Preset', type: 'select', paletteDependent: true, noRandomize: true, value: 'Rainbow', swatchPreview: 'cosine',
            options: Object.keys(COSINE_PRESETS).map(function (k) { return { label: k, value: k }; })
          },
          { key: 'u_a', label: 'Palette A', type: 'color', paletteDependent: true, value: '#808080',
            tip: 'Offset — base brightness per channel. Sets the center point colors oscillate around.' },
          { key: 'u_b', label: 'Palette B', type: 'color', paletteDependent: true, value: '#808080',
            tip: 'Amplitude — color swing range per channel. Higher = more vivid, saturated output.' },
          { key: 'u_c', label: 'Palette C', type: 'color', paletteDependent: true, value: '#ffffff',
            tip: 'Frequency — how many times the palette cycles across the gradient per channel.' },
          { key: 'u_d', label: 'Palette D', type: 'color', paletteDependent: true, value: '#0054ab',
            tip: 'Phase — shifts the starting hue of the color cycle. Rotates the overall color mood.' },
          // 4-stop color controls
          { key: 'u_color0', label: 'Color 1', type: 'color', stopDependent: true, value: '#ff3366' },
          { key: 'u_color1', label: 'Color 2', type: 'color', stopDependent: true, value: '#ffcc00' },
          { key: 'u_color2', label: 'Color 3', type: 'color', stopDependent: true, value: '#00ccff' },
          { key: 'u_color3', label: 'Color 4', type: 'color', stopDependent: true, value: '#aa00ff' },
          // OKLCH palette controls
          { key: '_rs_oklch_preset', label: 'Preset', type: 'select', oklchDependent: true, noRandomize: true, value: 'Vivid Rainbow',
            options: [
              { label: 'Vivid Rainbow', value: 'Vivid Rainbow' },
              { label: 'Pastel',        value: 'Pastel'        },
              { label: 'Neon',          value: 'Neon'          },
              { label: 'Warm',          value: 'Warm'          },
              { label: 'Monochrome',    value: 'Monochrome'    },
            ]
          },
          { key: 'u_oklch_aL', label: 'L Center',    type: 'range', min: 0,    max: 1,    step: 0.01, value: 0.70, oklchDependent: true,
            tip: 'Base lightness (0 = black, 1 = white). OKLCH L is perceptually uniform.' },
          { key: 'u_oklch_bL', label: 'L Amplitude', type: 'range', min: 0,    max: 0.5,  step: 0.01, value: 0.00, oklchDependent: true,
            tip: 'How much lightness oscillates around the center.' },
          { key: 'u_oklch_cL', label: 'L Frequency', type: 'range', min: 0,    max: 5,    step: 0.1,  value: 0.5,  oklchDependent: true },
          { key: 'u_oklch_dL', label: 'L Phase',      type: 'range', min: 0,    max: 1,    step: 0.01, value: 0.0,  oklchDependent: true },
          { key: 'u_oklch_aC', label: 'C Center',     type: 'range', min: 0,    max: 0.37, step: 0.01, value: 0.25, oklchDependent: true,
            tip: 'Base chroma — higher values are more vibrant. 0.37 is the sRGB gamut boundary.' },
          { key: 'u_oklch_bC', label: 'C Amplitude',  type: 'range', min: 0,    max: 0.2,  step: 0.01, value: 0.00, oklchDependent: true,
            tip: 'How much chroma oscillates (vivid ↔ muted).' },
          { key: 'u_oklch_cC', label: 'C Frequency',  type: 'range', min: 0,    max: 5,    step: 0.1,  value: 0.5,  oklchDependent: true },
          { key: 'u_oklch_dC', label: 'C Phase',       type: 'range', min: 0,    max: 1,    step: 0.01, value: 0.0,  oklchDependent: true },
          { key: 'u_oklch_aH', label: 'H Center (°)',  type: 'range', min: 0,    max: 360,  step: 1,    value: 180,  oklchDependent: true,
            tip: 'Center hue in degrees. OKLCH: 0°=red, 120°=green, 240°=blue.' },
          { key: 'u_oklch_bH', label: 'H Range (°)',   type: 'range', min: 0,    max: 360,  step: 1,    value: 180,  oklchDependent: true,
            tip: 'How far the hue swings in either direction. 180° covers the full color wheel.' },
          { key: 'u_oklch_cH', label: 'H Frequency',   type: 'range', min: 0,    max: 5,    step: 0.1,  value: 0.5,  oklchDependent: true },
          { key: 'u_oklch_dH', label: 'H Phase',        type: 'range', min: 0,    max: 1,    step: 0.01, value: 0.0,  oklchDependent: true },
          // ── Dots ──────────────────────────────────────────────────────────────────
          { type: 'header', label: 'Dots' },
          { key: 'u_rows',           label: 'Rows',          type: 'range',  min: 10,   max: 200,  step: 1,    value: 33,  noRandomize: true },
          { key: 'u_cols',           label: 'Cols',          type: 'range',  min: 1,    max: 50,   step: 1,    value: 34,  noRandomize: true },
          { key: 'u_min_radius',     label: 'Min Radius',    type: 'range',  min: 0,    max: 0.5,  step: 0.01, value: 0.08 },
          { key: 'u_max_radius',     label: 'Max Radius',    type: 'range',  min: 0.1,  max: 0.5,  step: 0.01, value: 0.38 },
          { key: 'u_invert',         label: 'Invert',        type: 'toggle',                                   value: 1,   noRandomize: true },
          { key: 'u_top_margin',     label: 'Top Margin',    type: 'range',  min: 0,    max: 1.0,  step: 0.01, value: 0.31, noRandomize: true },
          // ── Text overlay ──────────────────────────────────────────────────────────
          { type: 'header', label: 'Text Overlay' },
          { key: 'text',             label: 'Text',          type: 'text',                           value: '',     textDirty: true },
          { key: 'textFont',         label: 'Font',          type: 'select', textDirty: true, value: 'IBM Plex Mono',
            options: SHADER_FONTS.map(function (f) { return { label: f, value: f }; })
          },
          { key: 'textFontSize',     label: 'Font Size',     type: 'range',  min: 50,   max: 800,  step: 10,   value: 320,  textDirty: true, noRandomize: true },
          { key: 'u_text_rotation',  label: 'Rotation (°)',  type: 'range',  min: -180, max: 180,  step: 1,    value: 0,    textDirty: true,
            tip: '90° = vertical text. 0° = horizontal.', noRandomize: true },
          { key: 'u_text_grid_cols', label: 'Text Cols',     type: 'range',  min: 1,    max: 50,   step: 1,    value: 28,  noRandomize: true },
          { key: 'u_text_grid_rows', label: 'Text Rows',     type: 'range',  min: 1,    max: 100,  step: 1,    value: 39,  noRandomize: true },
          { key: 'textX',            label: 'Text X',        type: 'range',  min: 0,    max: 1.0,  step: 0.01, value: 0.5,  textDirty: true, noRandomize: true },
          { key: 'textY',            label: 'Text Y',        type: 'range',  min: 0,    max: 1.0,  step: 0.01, value: 0.79, textDirty: true, noRandomize: true },
          { key: 'u_invert_text',    label: 'Invert Color',  type: 'toggle', value: 0,
            tip: 'On = text shows inverted palette color. Off = text matches the palette.' },
          { key: 'u_text_radius',    label: 'Text Dot Size', type: 'range',  min: 0.01, max: 1.5,  step: 0.01, value: 0.33 },
          { key: 'u_text_blend',     label: 'Text Blend',    type: 'range',  min: 0,    max: 1.0,  step: 0.01, value: 1.0  },
        ].concat(FINISH_CONTROLS_PRE).concat([
          { key: 'u_vignette_top',    label: 'Vignette Top',    type: 'range', min: 0, max: 20, step: 0.05, value: 0,    noRandomize: true },
          { key: 'u_vignette_bottom', label: 'Vignette Bottom', type: 'range', min: 0, max: 20, step: 0.05, value: 2.65, noRandomize: true },
          { key: 'u_vignette_left',   label: 'Vignette Left',   type: 'range', min: 0, max: 20, step: 0.05, value: 3.6,  noRandomize: true },
          { key: 'u_vignette_right',    label: 'Vignette Right',    type: 'range', min: 0,   max: 20,  step: 0.05, value: 2.9,  noRandomize: true },
          { key: 'u_vignette_anchor_x', label: 'Vignette Anchor X', type: 'range', min: 0,   max: 1,   step: 0.01, value: 0.5,  noRandomize: true },
          { key: 'u_vignette_anchor_y', label: 'Vignette Anchor Y', type: 'range', min: 0,   max: 1,   step: 0.01, value: 0.5,  noRandomize: true },
          { key: 'u_pos_x', label: 'Position X', type: 'range', min: -0.5, max: 0.5, step: 0.01, value: 0.0,   noRandomize: true },
          { key: 'u_pos_y', label: 'Position Y', type: 'range', min: -0.5, max: 0.5, step: 0.01, value: -0.21, noRandomize: true },
          { key: 'u_scale', label: 'Scale',      type: 'range', min: 0.2,  max: 3.0,  step: 0.05, value: 1.0,  noRandomize: true },
        ]);

        var customAfterBuild = function () {
          // Cosine preset wiring
          var cosineKeys = ['u_a', 'u_b', 'u_c', 'u_d'];
          function applyCosinePreset(p) {
            applyColors(cosineKeys.map(function (k, i) {
              return [k, [p.a, p.b, p.c, p.d][i]];
            }));
          }
          applyCosinePreset(COSINE_PRESETS['Rainbow']);
          var presetSel = document.querySelector('[data-param-key="_rs_palette_preset"]');
          if (presetSel) {
            presetSel.addEventListener('change', function () {
              var p = COSINE_PRESETS[this.value];
              if (p) applyCosinePreset(p);
            });
          }

          // OKLCH preset wiring
          var oklchPresets = {
            'Vivid Rainbow': { aL:0.70, bL:0.00, cL:0.5, dL:0.0, aC:0.25, bC:0.00, cC:0.5, dC:0.0, aH:180, bH:180, cH:0.5, dH:0.0 },
            'Pastel':        { aL:0.88, bL:0.06, cL:0.5, dL:0.0, aC:0.12, bC:0.04, cC:0.5, dC:0.0, aH:180, bH:180, cH:0.5, dH:0.0 },
            'Neon':          { aL:0.65, bL:0.15, cL:0.5, dL:0.0, aC:0.30, bC:0.08, cC:0.5, dC:0.0, aH:200, bH:120, cH:0.5, dH:0.0 },
            'Warm':          { aL:0.72, bL:0.10, cL:0.5, dL:0.0, aC:0.22, bC:0.06, cC:0.5, dC:0.0, aH: 60, bH: 60, cH:0.5, dH:0.0 },
            'Monochrome':    { aL:0.70, bL:0.25, cL:1.0, dL:0.0, aC:0.05, bC:0.00, cC:1.0, dC:0.0, aH:230, bH:  0, cH:1.0, dH:0.0 },
          };
          var oklchKeys = [
            'u_oklch_aL', 'u_oklch_bL', 'u_oklch_cL', 'u_oklch_dL',
            'u_oklch_aC', 'u_oklch_bC', 'u_oklch_cC', 'u_oklch_dC',
            'u_oklch_aH', 'u_oklch_bH', 'u_oklch_cH', 'u_oklch_dH',
          ];
          function applyOklchPreset(p) {
            var vals = [p.aL, p.bL, p.cL, p.dL, p.aC, p.bC, p.cC, p.dC, p.aH, p.bH, p.cH, p.dH];
            oklchKeys.forEach(function (k, i) {
              var val = vals[i];
              window._shaderState.values[k] = val;
              var inp = document.querySelector('[data-param-key="' + k + '"]');
              if (inp) {
                inp.value = val;
                var disp = inp.nextElementSibling;
                if (disp && disp.classList.contains('shader-control__value')) disp.textContent = val;
              }
            });
          }
          applyOklchPreset(oklchPresets['Vivid Rainbow']);
          var oklchPresetSel = document.querySelector('[data-param-key="_rs_oklch_preset"]');
          if (oklchPresetSel) {
            oklchPresetSel.addEventListener('change', function () {
              var p = oklchPresets[this.value];
              if (p) applyOklchPreset(p);
            });
          }
        };

      return {
        controls: controls,
        customAfterBuild: typeof customAfterBuild === 'function' ? customAfterBuild : null
      };
    });


    // ── scaling-letters ───────────────────────────────────────────────────
    register('scaling-letters', function (body) {
        var controls = [
          // ── Text ──────────────────────────────────────────────────────────────────
          { type: 'header', label: 'Text' },
          { key: 'u_word',         label: 'Word',          type: 'text',   value: 'PIZZA', textDirty: true,
            randomOptions: ['PIZZA','NACHOS','WAFFLES','CORNDOGS','DOUGHNUTS','ONIONRINGS','CHEESESTEAK'],
            tip: 'Up to 11 characters. Word length determines the grid layout.' },
          { key: 'u_font_family',  label: 'Font',          type: 'select', value: 'Barlow Condensed',
            options: SHADER_FONTS.map(function (f) { return { label: f, value: f }; }) },
          { key: 'u_font_size',    label: 'Font Size',     type: 'range',  min: 50, max: 500, step: 10, value: 300 },
          { key: 'perLetterSizeEnabled', label: 'Per-Letter Size', type: 'toggle', value: 0,
            tip: 'Override font size individually for each letter.' },
          { key: 'u_font_size_1', label: 'Size 1', type: 'range', min: 50, max: 500, step: 10, value: 300, perLetterSizeDependent: true },
          { key: 'u_font_size_2', label: 'Size 2', type: 'range', min: 50, max: 500, step: 10, value: 300, perLetterSizeDependent: true },
          { key: 'u_font_size_3', label: 'Size 3', type: 'range', min: 50, max: 500, step: 10, value: 300, perLetterSizeDependent: true },
          { key: 'u_font_size_4', label: 'Size 4', type: 'range', min: 50, max: 500, step: 10, value: 300, perLetterSizeDependent: true },
          { key: 'u_font_size_5', label: 'Size 5', type: 'range', min: 50, max: 500, step: 10, value: 300, perLetterSizeDependent: true },
          { key: 'u_font_size_6',  label: 'Size 6',  type: 'range', min: 50, max: 500, step: 10, value: 300, perLetterSizeDependent: true },
          { key: 'u_font_size_7',  label: 'Size 7',  type: 'range', min: 50, max: 500, step: 10, value: 300, perLetterSizeDependent: true },
          { key: 'u_font_size_8',  label: 'Size 8',  type: 'range', min: 50, max: 500, step: 10, value: 300, perLetterSizeDependent: true },
          { key: 'u_font_size_9',  label: 'Size 9',  type: 'range', min: 50, max: 500, step: 10, value: 300, perLetterSizeDependent: true },
          { key: 'u_font_size_10', label: 'Size 10', type: 'range', min: 50, max: 500, step: 10, value: 300, perLetterSizeDependent: true },
          { key: 'u_font_size_11', label: 'Size 11', type: 'range', min: 50, max: 500, step: 10, value: 300, perLetterSizeDependent: true },
          { key: 'centerLetters', label: 'Center in Cell', type: 'toggle', value: 1, textDirty: true,
            tip: 'Centers each letter using its actual glyph bounding box instead of the typographic em-box.' },
          { key: 'u_text_color',   label: 'Text Color',    type: 'color',  value: '#ffffff' },
          { key: 'u_invert',       label: 'Invert Colors', type: 'toggle', value: 1,
            tip: 'Colors the cell background instead of the letter (text becomes a cutout).' },
          { key: 'outlineEnabled', label: 'Outline',       type: 'toggle', value: 0, noRandomize: true },
          { key: 'outlineWidth',   label: 'Outline Width', type: 'range',  min: 1, max: 60, step: 1, value: 12, noRandomize: true },
          { key: 'u_outline_color', label: 'Outline Color', type: 'color', value: '#000000', noRandomize: true },
          // ── Border ────────────────────────────────────────────────────────────────
          { type: 'header', label: 'Border' },
          { key: 'u_border_width', label: 'Border Width', type: 'range',  min: 2, max: 50, step: 1, value: 4, noRandomize: true,
            tip: 'Thickness of the dividing lines between letter cells.' },
          { key: 'u_border_color',   label: 'Border Color',   type: 'color',  value: '#ffffff', noRandomize: true },
          { key: 'u_corner_radius', label: 'Corner Radius',  type: 'range',  min: 0, max: 0.5, step: 0.01, value: 0, noRandomize: true },
          { key: 'u_outer_border', label: 'Outer Border', type: 'toggle', value: 1,
            tip: 'Adds a border around the entire canvas edge.' },
          { key: 'u_grid_aspect',  label: 'Grid Ratio',   type: 'range',  min: 0.4, max: 2.0, step: 0.01, value: 0.8,
            tip: 'Width-to-height ratio of the letter grid (e.g. 0.8 = 4:5 portrait, 1.0 = square).' },
          // ── Palette ───────────────────────────────────────────────────────────────
          { type: 'header', label: 'Palette' },
          { key: 'u_color_mode', label: 'Color Mode', type: 'select', value: '1',
            options: [
              { label: 'Flat',   value: '0' },
              { label: '4-Stop', value: '1' },
            ]
          },
          // 4-stop colors (shown/hidden by customAfterBuild)
          { key: '_sl_4color_preset', label: 'Preset', type: 'select', value: 'Aurora', swatchPreview: 'fourstop',
            options: Object.keys(FOUR_STOP_PRESETS).map(function (k) { return { label: k, value: k }; })
          },
          { key: 'u_color0', label: 'Color 1 (Left)',  type: 'color', value: '#00ff88' },
          { key: 'u_color1', label: 'Color 2',         type: 'color', value: '#00e5ff' },
          { key: 'u_color2', label: 'Color 3',         type: 'color', value: '#7c4dff' },
          { key: 'u_color3', label: 'Color 4 (Right)', type: 'color', value: '#e040fb' },
        ].concat(FINISH_CONTROLS);

        var customAfterBuild = function () {
          var stopKeys = ['_sl_4color_preset', 'u_color0', 'u_color1', 'u_color2', 'u_color3'];

          function rowFor(key) {
            var el = document.querySelector('[data-param-key="' + key + '"]');
            return el ? el.closest('.shader-control') : null;
          }

          function applyVisibility() {
            var modeEl = document.querySelector('[data-param-key="u_color_mode"]');
            var mode   = modeEl ? modeEl.value : '0';
            stopKeys.forEach(function (key) {
              var row = rowFor(key); if (row) row.style.display = mode === '1' ? '' : 'none';
            });
          }

          var modeEl = document.querySelector('[data-param-key="u_color_mode"]');
          if (modeEl) modeEl.addEventListener('change', applyVisibility);
          applyVisibility();

          function apply4ColorPreset(p) {
            applyColors([['u_color0',p.c0],['u_color1',p.c1],['u_color2',p.c2],['u_color3',p.c3]]);
          }

          var fourColorPresetSel = document.querySelector('[data-param-key="_sl_4color_preset"]');
          if (fourColorPresetSel) fourColorPresetSel.addEventListener('change', function () {
            var p = FOUR_STOP_PRESETS[this.value]; if (p) apply4ColorPreset(p);
          });
        };

      return {
        controls: controls,
        customAfterBuild: typeof customAfterBuild === 'function' ? customAfterBuild : null
      };
    });


    // ── scribble-glyph ────────────────────────────────────────────────────
    register('scribble-glyph', function (body) {
        var controls = [
          // ── Glyph ─────────────────────────────────────────────────────────────────
          { type: 'header', label: 'Glyph' },
          { key: 'text', label: 'Character', type: 'text', value: '8', textDirty: true, noRandomize: true },
          { key: 'textFont', label: 'Font', type: 'select', value: 'Montserrat', textDirty: true,
            options: SHADER_FONTS.map(function (f) { return { label: f, value: f }; })
          },
          { key: 'textFontSize', label: 'Size', type: 'range', min: 150, max: 700, step: 1, value: 380, textDirty: true, noRandomize: true,
            tip: 'Kept high enough that antialiasing never bridges a counter\'s gap (e.g. the hole in an "o").' },
          { key: 'textX', label: 'Position X', type: 'range', min: 0, max: 1.0, step: 0.01, value: 0.5, textDirty: true, noRandomize: true },
          { key: 'textY', label: 'Position Y', type: 'range', min: 0, max: 1.0, step: 0.01, value: 0.5, textDirty: true, noRandomize: true },
          // ── Scribble ──────────────────────────────────────────────────────────────
          { type: 'header', label: 'Scribble' },
          { key: 'u_stroke_count', label: 'Stroke Count', type: 'range', min: 1, max: 48, step: 1, value: 14,
            tip: 'How many overlapping hand-traced passes build up the scribble. Higher = denser, more capped for performance.' },
          { key: 'u_stroke_width', label: 'Stroke Width', type: 'range', min: 0.001, max: 0.15, step: 0.001, value: 0.05 },
          { key: 'u_jitter_outer', label: 'Outer Messiness', type: 'range', min: 0, max: 0.06, step: 0.001, value: 0.018,
            tip: 'How far each pass wanders near the glyph\'s outer silhouette.' },
          { key: 'u_jitter_inner', label: 'Inner Tightness', type: 'range', min: 0, max: 0.06, step: 0.001, value: 0.006,
            tip: 'How far each pass wanders near an interior hole (the counter of an 8, 6, 9, 0, a, e, o, etc). Keep lower than Outer Messiness for a cleaner inner trace.' },
          { key: 'u_wobble_freq', label: 'Wobble Frequency', type: 'range', min: 1, max: 60, step: 0.5, value: 18,
            tip: 'Spatial frequency of the along-stroke wobble. Higher = more waviness per stroke.' },
          { key: 'u_seed', label: 'Seed', type: 'range', min: 0, max: 999, step: 1, value: 7,
            tip: 'Changes which random strokes are drawn without changing how many.' },
          // ── Color Palette ──────────────────────────────────────────────────────────
          { type: 'header', label: 'Color Palette' },
          { key: 'u_color_mode', label: '4-Color Mode', type: 'toggle', value: 0,
            tip: 'Off = cosine palette. On = 4-stop linear gradient from top to bottom.' },
          { key: '_sg_palette_preset', label: 'Preset', type: 'select', paletteDependent: true, value: 'Rainbow',
            options: Object.keys(COSINE_PRESETS).map(function (k) { return { label: k, value: k }; })
          },
          { key: 'u_a', label: 'Palette A', type: 'color', paletteDependent: true, value: '#808080',
            tip: 'Offset — base brightness per channel. Sets the center point colors oscillate around.' },
          { key: 'u_b', label: 'Palette B', type: 'color', paletteDependent: true, value: '#808080',
            tip: 'Amplitude — color swing range per channel. Higher = more vivid, saturated output.' },
          { key: 'u_c', label: 'Palette C', type: 'color', paletteDependent: true, value: '#ffffff',
            tip: 'Frequency — how many times the palette cycles per channel.' },
          { key: 'u_d', label: 'Palette D', type: 'color', paletteDependent: true, value: '#0054ab',
            tip: 'Phase — shifts the starting hue of the color cycle.' },
          { key: '_sg_4color_preset', label: 'Preset', type: 'select', stopDependent: true, value: 'Neon',
            options: Object.keys(FOUR_STOP_PRESETS).map(function (k) { return { label: k, value: k }; })
          },
          { key: 'u_color0', label: 'Color 1 (Top)',    type: 'color', stopDependent: true, value: '#ff3366' },
          { key: 'u_color1', label: 'Color 2',          type: 'color', stopDependent: true, value: '#ffcc00' },
          { key: 'u_color2', label: 'Color 3',          type: 'color', stopDependent: true, value: '#00ccff' },
          { key: 'u_color3', label: 'Color 4 (Bottom)', type: 'color', stopDependent: true, value: '#aa00ff' },
        ].concat(FINISH_CONTROLS);

        var customAfterBuild = function () {
          var cosineKeys = ['u_a', 'u_b', 'u_c', 'u_d'];

          function applyCosinePreset(p) {
            applyColors(cosineKeys.map(function (k, i) {
              return [k, [p.a, p.b, p.c, p.d][i]];
            }));
          }

          function apply4ColorPreset(p) {
            applyColors([
              ['u_color0', p.c0],
              ['u_color1', p.c1],
              ['u_color2', p.c2],
              ['u_color3', p.c3],
            ]);
          }

          // Apply default on load so shader matches pickers.
          applyCosinePreset(COSINE_PRESETS['Rainbow']);

          var cosinePresetSel = document.querySelector('[data-param-key="_sg_palette_preset"]');
          if (cosinePresetSel) {
            cosinePresetSel.addEventListener('change', function () {
              var p = COSINE_PRESETS[this.value];
              if (p) applyCosinePreset(p);
            });
          }

          var fourColorPresetSel = document.querySelector('[data-param-key="_sg_4color_preset"]');
          if (fourColorPresetSel) {
            fourColorPresetSel.addEventListener('change', function () {
              var p = FOUR_STOP_PRESETS[this.value];
              if (p) apply4ColorPreset(p);
            });
          }
        };

      return {
        controls: controls,
        customAfterBuild: typeof customAfterBuild === 'function' ? customAfterBuild : null
      };
    });


    // ── stacked-gradient ──────────────────────────────────────────────────
    register('stacked-gradient', function (body) {
        var controls = [
          // ── Rows ──────────────────────────────────────────────────────────────────
          { type: 'header', label: 'Rows' },
          { key: 'u_row_count',   label: 'Row Count',   type: 'range',  min: 2, max: 7, step: 1, value: 7 },
          { key: 'u_height_mode', label: 'Height Mode', type: 'select', value: 'Golden Ratio',
            options: [
              { label: 'Golden Ratio',      value: 'Golden Ratio'      },
              { label: 'Fibonacci',         value: 'Fibonacci'         },
              { label: 'Equal Temperament', value: 'Equal Temperament' },
              { label: 'Sine',              value: 'Sine'              },
              { label: 'Noise',             value: 'Noise'             },
            ]
          },
          { key: 'u_noise_seed',  label: 'Noise Seed',  type: 'range',  min: 0, max: 99, step: 1, value: 0,
            tip: 'Randomizes row heights. Only applies in Noise height mode.' },
          { key: 'u_stagger',    label: 'Stagger',      type: 'range',  min: 0,    max: 0.5,  step: 0.01,  value: 0.25,  gaussian: true, randomMin: 0.05, randomMax: 0.4,
            tip: 'Offsets each row horizontally using a golden-ratio distribution.' },
          { key: 'u_fade_width', label: 'Fade Width',   type: 'range',  min: 0,    max: 0.3,  step: 0.005, value: 0.08,  gaussian: true, randomMin: 0.02, randomMax: 0.2,
            tip: 'Width of the soft fade at each strip edge.' },
          { key: 'u_tilt',       label: 'Tilt (°)',     type: 'range',  min: -45,  max: 45,   step: 1,     value: -5,  noRandomize: true,
            tip: 'Angle of the gradient strips.' },
          { key: 'u_width',      label: 'Strip Width',  type: 'range',  min: 0.05, max: 1.5,  step: 0.01,  value: 0.33,  gaussian: true, randomMin: 0.3,  randomMax: 1.1,
            tip: 'Width of each gradient strip relative to its available span.' },
          { key: 'u_offset_x',  label: 'Shift X',      type: 'range',  min: -0.5, max: 0.5,  step: 0.01,  value: 0.1,   gaussian: true,
            tip: 'Horizontal offset applied to all strips.' },
          { key: 'u_offset_y',  label: 'Shift Y',      type: 'range',  min: -0.5, max: 0.5,  step: 0.01,  value: 0.0,   gaussian: true,
            tip: 'Vertical offset applied to all strips. Wraps seamlessly.' },
          // ── Palette ───────────────────────────────────────────────────────────────
          { type: 'header', label: 'Palette' },
          { key: 'u_color_mode', label: 'Color Mode', type: 'select', value: '0',
            options: [
              { label: 'Cosine', value: '0' },
              { label: '4-Stop', value: '1' },
              { label: 'OKLCH',  value: '2' },
            ]
          },
          { key: 'u_row_offset', label: 'Row Offset', type: 'range', min: 0, max: 1, step: 0.01, value: 1.0,
            tip: '0 = every row shows the same gradient section. 1 = rows are evenly spread across the full palette.' },
          // Cosine palette controls (hidden when not in Cosine mode)
          { key: '_sg_palette_preset', label: 'Preset', type: 'select', paletteDependent: true, value: 'Rainbow', swatchPreview: 'cosine',
            options: Object.keys(COSINE_PRESETS).map(function (k) { return { label: k, value: k }; })
          },
          { key: 'u_a', label: 'Palette A', type: 'color', paletteDependent: true, value: '#808080', noRandomize: true,
            tip: 'Offset — base brightness per channel. Sets the center point colors oscillate around.' },
          { key: 'u_b', label: 'Palette B', type: 'color', paletteDependent: true, value: '#808080', noRandomize: true,
            tip: 'Amplitude — color swing range per channel. Higher = more vivid, saturated output.' },
          { key: 'u_c', label: 'Palette C', type: 'color', paletteDependent: true, value: '#ffffff', noRandomize: true,
            tip: 'Frequency — how many times the palette cycles per channel.' },
          { key: 'u_d', label: 'Palette D', type: 'color', paletteDependent: true, value: '#0054ab', noRandomize: true,
            tip: 'Phase — shifts the starting hue of the color cycle.' },
          // 4-stop color controls (hidden when not in 4-Stop mode)
          { key: '_sg_4color_preset', label: 'Preset', type: 'select', stopDependent: true, value: 'Neon', swatchPreview: 'fourstop',
            options: Object.keys(FOUR_STOP_PRESETS).map(function (k) { return { label: k, value: k }; })
          },
          { key: 'u_color0', label: 'Color 1', type: 'color', stopDependent: true, value: '#ff3366', noRandomize: true },
          { key: 'u_color1', label: 'Color 2', type: 'color', stopDependent: true, value: '#ffcc00', noRandomize: true },
          { key: 'u_color2', label: 'Color 3', type: 'color', stopDependent: true, value: '#00ccff', noRandomize: true },
          { key: 'u_color3', label: 'Color 4', type: 'color', stopDependent: true, value: '#aa00ff', noRandomize: true },
          { key: 'u_stop1', label: 'Stop 2 Position', type: 'range', min: 0.0, max: 1.0, step: 0.01, value: 0.333, stopDependent: true,
            tip: 'Where Color 2 begins (0 = far left, 1 = far right).' },
          { key: 'u_stop2', label: 'Stop 3 Position', type: 'range', min: 0.0, max: 1.0, step: 0.01, value: 0.667, stopDependent: true,
            tip: 'Where Color 3 begins (0 = far left, 1 = far right).' },
          // OKLCH palette controls (hidden when not in OKLCH mode)
          { key: '_sg_oklch_preset', label: 'Preset', type: 'select', oklchDependent: true, value: 'Vivid Rainbow',
            options: [
              { label: 'Vivid Rainbow', value: 'Vivid Rainbow' },
              { label: 'Pastel',        value: 'Pastel'        },
              { label: 'Neon',          value: 'Neon'          },
              { label: 'Warm',          value: 'Warm'          },
              { label: 'Monochrome',    value: 'Monochrome'    },
            ]
          },
          { key: 'u_oklch_aL', label: 'L Center',     type: 'range', min: 0,    max: 1,    step: 0.01, value: 0.70, oklchDependent: true, noRandomize: true,
            tip: 'Base lightness (0 = black, 1 = white). OKLCH L is perceptually uniform.' },
          { key: 'u_oklch_bL', label: 'L Amplitude',  type: 'range', min: 0,    max: 0.5,  step: 0.01, value: 0.00, oklchDependent: true, noRandomize: true,
            tip: 'How much lightness oscillates around the center.' },
          { key: 'u_oklch_cL', label: 'L Frequency',  type: 'range', min: 0,    max: 5,    step: 0.1,  value: 0.5,  oklchDependent: true, noRandomize: true },
          { key: 'u_oklch_dL', label: 'L Phase',       type: 'range', min: 0,    max: 1,    step: 0.01, value: 0.0,  oklchDependent: true, noRandomize: true },
          { key: 'u_oklch_aC', label: 'C Center',      type: 'range', min: 0,    max: 0.37, step: 0.01, value: 0.25, oklchDependent: true, noRandomize: true,
            tip: 'Base chroma — higher values are more vibrant. 0.37 is the sRGB gamut boundary.' },
          { key: 'u_oklch_bC', label: 'C Amplitude',   type: 'range', min: 0,    max: 0.2,  step: 0.01, value: 0.00, oklchDependent: true, noRandomize: true,
            tip: 'How much chroma oscillates (vivid ↔ muted).' },
          { key: 'u_oklch_cC', label: 'C Frequency',   type: 'range', min: 0,    max: 5,    step: 0.1,  value: 0.5,  oklchDependent: true, noRandomize: true },
          { key: 'u_oklch_dC', label: 'C Phase',        type: 'range', min: 0,    max: 1,    step: 0.01, value: 0.0,  oklchDependent: true, noRandomize: true },
          { key: 'u_oklch_aH', label: 'H Center (°)',   type: 'range', min: 0,    max: 360,  step: 1,    value: 180,  oklchDependent: true, noRandomize: true,
            tip: 'Center hue in degrees. OKLCH: 0°=red, 120°=green, 240°=blue.' },
          { key: 'u_oklch_bH', label: 'H Range (°)',    type: 'range', min: 0,    max: 360,  step: 1,    value: 180,  oklchDependent: true, noRandomize: true,
            tip: 'How far the hue swings in either direction. 180° covers the full color wheel.' },
          { key: 'u_oklch_cH', label: 'H Frequency',    type: 'range', min: 0,    max: 5,    step: 0.1,  value: 0.5,  oklchDependent: true, noRandomize: true },
          { key: 'u_oklch_dH', label: 'H Phase',         type: 'range', min: 0,    max: 1,    step: 0.01, value: 0.0,  oklchDependent: true, noRandomize: true },
          // ── Text Overlay ───────────────────────────────────────────────────────────
          { type: 'header', label: 'Text Overlay' },
          { key: 'u_text_enabled',   label: 'Text Overlay',      type: 'toggle', value: 1,             textDirty: true, noRandomize: true },
          { key: 'text',             label: 'Text',              type: 'text',   value: 'PEACE',       textDirty: true },
          { key: 'textFont',         label: 'Font',              type: 'select', value: 'Montserrat',  textDirty: true,
            options: SHADER_FONTS.map(function (f) { return { label: f, value: f }; })
          },
          { key: 'textFontSize',     label: 'Font Size',         type: 'range',  min: 8, max: 750, step: 1,    value: 293,  textDirty: true, noRandomize: true },
          { key: 'u_text_rotation',  label: 'Rotation (°)',      type: 'range',  min: -180, max: 180, step: 1, value: -90,  textDirty: true, noRandomize: true,
            tip: '90° = vertical text. 0° = horizontal.' },
          { key: 'textX',            label: 'Text X',            type: 'range',  min: 0, max: 1.0, step: 0.01, value: 0.5,  textDirty: true },
          { key: 'textY',            label: 'Text Y',            type: 'range',  min: 0, max: 1.0, step: 0.01, value: 0.5,  textDirty: true },
          { key: 'u_invert_text',    label: 'Invert Color', type: 'toggle', value: 1,
            tip: 'On = text shows inverted gradient color. Off = text matches the gradient.' },
          { key: 'u_use_text_color', label: 'Custom Color', type: 'toggle', value: 0, noRandomize: true },
          { key: 'u_text_color',     label: 'Text Color',        type: 'color',  value: '#ffffff', textColorDependent: true },
          { key: 'outlineEnabled',   label: 'Outline',           type: 'toggle', value: 0,            textDirty: true, noRandomize: true },
          { key: 'outlineWidth',     label: 'Outline Width',     type: 'range',  min: 1, max: 60, step: 1, value: 8, textDirty: true, outlineDependent: true, noRandomize: true },
          { key: 'u_outline_color',  label: 'Outline Color',     type: 'color',  value: '#000000', outlineDependent: true, noRandomize: true },
        ].concat(FINISH_CONTROLS_PRE).concat([
          { key: 'u_vignette_top',      label: 'Vignette Top',      type: 'range', min: 0,   max: 20,  step: 0.05, value: 0,    noRandomize: true },
          { key: 'u_vignette_bottom',   label: 'Vignette Bottom',   type: 'range', min: 0,   max: 20,  step: 0.05, value: 0,    noRandomize: true },
          { key: 'u_vignette_left',     label: 'Vignette Left',     type: 'range', min: 0,   max: 20,  step: 0.05, value: 0,    noRandomize: true },
          { key: 'u_vignette_right',    label: 'Vignette Right',    type: 'range', min: 0,   max: 20,  step: 0.05, value: 0,    noRandomize: true },
          { key: 'u_vignette_anchor_x', label: 'Vignette Anchor X', type: 'range', min: 0,   max: 1,   step: 0.01, value: 0.5,  noRandomize: true },
          { key: 'u_vignette_anchor_y', label: 'Vignette Anchor Y', type: 'range', min: 0,   max: 1,   step: 0.01, value: 0.5,  noRandomize: true },
          { key: 'u_pos_x', label: 'Position X', type: 'range', min: -0.5, max: 0.5, step: 0.01, value: -0.13, noRandomize: true },
          { key: 'u_pos_y', label: 'Position Y', type: 'range', min: -0.5, max: 0.5, step: 0.01, value:  0.0,  noRandomize: true },
          { key: 'u_scale', label: 'Scale',      type: 'range', min: 0.2,  max: 3.0,  step: 0.05, value:  0.8,  noRandomize: true },
        ]);

        var customAfterBuild = function () {
          var cosineKeys = ['u_a', 'u_b', 'u_c', 'u_d'];

          function applyCosinePreset(p) {
            applyColors(cosineKeys.map(function (k, i) {
              return [k, [p.a, p.b, p.c, p.d][i]];
            }));
          }

          // OKLCH preset handling
          var oklchPresets = {
            'Vivid Rainbow': { aL:0.70, bL:0.00, cL:0.5, dL:0.0, aC:0.25, bC:0.00, cC:0.5, dC:0.0, aH:180, bH:180, cH:0.5, dH:0.0 },
            'Pastel':        { aL:0.88, bL:0.06, cL:0.5, dL:0.0, aC:0.12, bC:0.04, cC:0.5, dC:0.0, aH:180, bH:180, cH:0.5, dH:0.0 },
            'Neon':          { aL:0.65, bL:0.15, cL:0.5, dL:0.0, aC:0.30, bC:0.08, cC:0.5, dC:0.0, aH:200, bH:120, cH:0.5, dH:0.0 },
            'Warm':          { aL:0.72, bL:0.10, cL:0.5, dL:0.0, aC:0.22, bC:0.06, cC:0.5, dC:0.0, aH: 60, bH: 60, cH:0.5, dH:0.0 },
            'Monochrome':    { aL:0.70, bL:0.25, cL:1.0, dL:0.0, aC:0.05, bC:0.00, cC:1.0, dC:0.0, aH:230, bH:  0, cH:1.0, dH:0.0 },
          };
          var oklchKeys = [
            'u_oklch_aL', 'u_oklch_bL', 'u_oklch_cL', 'u_oklch_dL',
            'u_oklch_aC', 'u_oklch_bC', 'u_oklch_cC', 'u_oklch_dC',
            'u_oklch_aH', 'u_oklch_bH', 'u_oklch_cH', 'u_oklch_dH',
          ];

          function applyOklchPreset(p) {
            var vals = [p.aL, p.bL, p.cL, p.dL, p.aC, p.bC, p.cC, p.dC, p.aH, p.bH, p.cH, p.dH];
            oklchKeys.forEach(function (k, i) {
              var val = vals[i];
              window._shaderState.values[k] = val;
              var inp = document.querySelector('[data-param-key="' + k + '"]');
              if (inp) {
                inp.value = val;
                var disp = inp.nextElementSibling;
                if (disp && disp.classList.contains('shader-control__value')) disp.textContent = val;
              }
            });
          }

          applyOklchPreset(oklchPresets['Vivid Rainbow']);

          var oklchPresetSel = document.querySelector('[data-param-key="_sg_oklch_preset"]');
          if (oklchPresetSel) {
            oklchPresetSel.addEventListener('change', function () {
              var p = oklchPresets[this.value];
              if (p) applyOklchPreset(p);
            });
          }

          // Hide Noise Seed unless Height Mode = Noise
          var body = document.getElementById('shader-gui-body');
          var heightModeSel = document.querySelector('[data-param-key="u_height_mode"]');
          var noiseSeedRow = (function () {
            var el = document.querySelector('[data-param-key="u_noise_seed"]');
            return el ? el.closest('.shader-control') : null;
          }());
          function applyNoiseSeedVis() {
            if (!noiseSeedRow) return;
            noiseSeedRow.style.display = heightModeSel && heightModeSel.value === 'Noise' ? '' : 'none';
          }
          if (heightModeSel) heightModeSel.addEventListener('change', applyNoiseSeedVis);
          applyNoiseSeedVis();

          function apply4ColorPreset(p) {
            applyColors([['u_color0',p.c0],['u_color1',p.c1],['u_color2',p.c2],['u_color3',p.c3]]);
          }

          var fourColorPresetSel = document.querySelector('[data-param-key="_sg_4color_preset"]');
          if (fourColorPresetSel) fourColorPresetSel.addEventListener('change', function () {
            var p = FOUR_STOP_PRESETS[this.value]; if (p) apply4ColorPreset(p);
          });

          // Apply default on load so shader matches pickers.
          applyCosinePreset(COSINE_PRESETS['Rainbow']);

          var presetSel = document.querySelector('[data-param-key="_sg_palette_preset"]');
          if (presetSel) {
            presetSel.addEventListener('change', function () {
              var p = COSINE_PRESETS[this.value];
              if (p) applyCosinePreset(p);
            });
          }

          // Text Overlay enable toggle — hide all text controls when off
          var body = document.getElementById('shader-gui-body');
          var textEnabledRow = Array.from(body.children).find(function (el) {
            var lbl = el.querySelector && el.querySelector('.shader-control__label');
            return lbl && lbl.textContent.trim() === 'Text Overlay' && el.querySelector('.shader-control__toggle');
          });
          var textEnabledBtn = textEnabledRow && textEnabledRow.querySelector('.shader-control__toggle');

          var textDependentRows = [];
          var found = false;
          Array.from(body.children).forEach(function (el) {
            if (el === textEnabledRow) { found = true; return; }
            if (!found) return;
            if (el.classList.contains('shader-control__section-header')) { found = false; return; }
            if (el.classList.contains('shader-control')) textDependentRows.push(el);
          });

          function applyTextEnabledVis() {
            var on = textEnabledBtn && textEnabledBtn.dataset.on === '1';
            textDependentRows.forEach(function (r) { r.style.display = on ? '' : 'none'; });
          }
          if (textEnabledBtn) textEnabledBtn.addEventListener('click', applyTextEnabledVis);
          applyTextEnabledVis();
        };


      return {
        controls: controls,
        customAfterBuild: typeof customAfterBuild === 'function' ? customAfterBuild : null
      };
    });


    // ── three-square ──────────────────────────────────────────────────────
    register('three-square', function (body) {
        var controls = [
          // ── Squares ───────────────────────────────────────────────────────────────
          { type: 'header', label: 'Squares' },
          { key: 'u_square_count', label: 'Count',           type: 'range', min: 2,    max: 4,    step: 1,    value: 4,
            tip: 'Number of squares arranged diagonally.' },
          { key: 'u_fill',         label: 'Fill',            type: 'range', min: 0.1,  max: 1.0,  step: 0.01, value: 1.0,
            tip: 'How much of the available space each square occupies.' },
          { key: 'u_offset',       label: 'Diagonal Offset', type: 'range', min: 0.0,  max: 0.23, step: 0.01, value: 0.13,
            tip: 'Distance between square centers along the diagonal.' },
          { key: 'u_density',      label: 'Column Density',  type: 'range', min: 2,    max: 40,   step: 1,    value: 26,
            tip: 'Number of vertical columns across each square.' },
          { key: 'u_col_width',    label: 'Column Width',    type: 'range', min: 0.05, max: 0.49, step: 0.01, value: 0.1,
            tip: 'Half-width of each column in background areas.' },
          // ── Palette ───────────────────────────────────────────────────────────────
          { type: 'header', label: 'Palette' },
          { key: 'u_color_mode',     label: '4-Stop Mode',     type: 'toggle', value: 1,
            tip: 'Off = cosine palette. On = 4-stop linear gradient.' },
          { key: 'u_global_gradient', label: 'Global Gradient', type: 'toggle', value: 0,
            tip: 'Off = each square has its own gradient. On = gradient spans all squares.' },
          // Cosine palette controls (hidden when 4-Stop mode is on)
          { key: '_palette_preset', label: 'Preset', type: 'select', paletteDependent: true, value: 'Rainbow', swatchPreview: 'cosine',
            options: Object.keys(COSINE_PRESETS).map(function (k) { return { label: k, value: k }; })
          },
          { key: 'u_a', label: 'Palette A', type: 'color', paletteDependent: true, value: '#808080',
            tip: 'Offset — base brightness per channel.' },
          { key: 'u_b', label: 'Palette B', type: 'color', paletteDependent: true, value: '#808080',
            tip: 'Amplitude — color swing range per channel.' },
          { key: 'u_c', label: 'Palette C', type: 'color', paletteDependent: true, value: '#ffffff',
            tip: 'Frequency — how many times the palette cycles per channel.' },
          { key: 'u_d', label: 'Palette D', type: 'color', paletteDependent: true, value: '#0054ab',
            tip: 'Phase — shifts the starting hue of the color cycle.' },
          // 4-stop color controls (hidden when cosine/palette mode is on)
          { key: '_ts_4color_preset', label: 'Preset', type: 'select', stopDependent: true, value: 'Retro', swatchPreview: 'fourstop',
            options: Object.keys(FOUR_STOP_PRESETS).map(function (k) { return { label: k, value: k }; })
          },
          { key: 'u_color0', label: 'Color 1', type: 'color', stopDependent: true, value: '#e8491d' },
          { key: 'u_color1', label: 'Color 2', type: 'color', stopDependent: true, value: '#c9a030' },
          { key: 'u_color2', label: 'Color 3', type: 'color', stopDependent: true, value: '#2d8a5e' },
          { key: 'u_color3', label: 'Color 4', type: 'color', stopDependent: true, value: '#1a2744' },
          // ── Letters ───────────────────────────────────────────────────────────────
          { type: 'header', label: 'Letters' },
          { key: 'u_letters_enabled', label: 'Show Letters', type: 'toggle', value: 1 },
          { key: 'u_letter1', label: 'Letter 1', type: 'text', value: '1' },
          { key: 'u_letter2', label: 'Letter 2', type: 'text', value: '9' },
          { key: 'u_letter3', label: 'Letter 3', type: 'text', value: '8' },
          { key: 'u_letter4', label: 'Letter 4', type: 'text', value: '1',
            tip: 'Only visible when Square Count is 4.' },
          { key: 'u_font_family', label: 'Font', type: 'select', value: 'Oswald',
            options: SHADER_FONTS.map(function (f) { return { label: f, value: f }; })
          },
          { key: 'u_font_size',      label: 'Font Size',             type: 'range',  min: 50, max: 500, step: 10, value: 300 },
          { key: 'u_col_width_wide', label: 'Column Width (Letter)', type: 'range',  min: 0.05, max: 0.49, step: 0.01, value: 0.45,
            tip: 'Column half-width inside letter-filled areas.' },
          { key: 'outlineEnabled', label: 'Outline',       type: 'toggle', value: 0, noRandomize: true },
          { key: 'outlineWidth',   label: 'Outline Width', type: 'range',  min: 1, max: 60, step: 1, value: 12, noRandomize: true },
          { key: 'u_outline_color', label: 'Outline Color', type: 'color',  value: '#000000', noRandomize: true },
        ].concat(FINISH_CONTROLS_PRE).concat([
          { key: 'u_vignette_top',      label: 'Vignette Top',      type: 'range', min: 0,   max: 20,  step: 0.05, value: 0,    noRandomize: true },
          { key: 'u_vignette_bottom',   label: 'Vignette Bottom',   type: 'range', min: 0,   max: 20,  step: 0.05, value: 0,    noRandomize: true },
          { key: 'u_vignette_left',     label: 'Vignette Left',     type: 'range', min: 0,   max: 20,  step: 0.05, value: 0,    noRandomize: true },
          { key: 'u_vignette_right',    label: 'Vignette Right',    type: 'range', min: 0,   max: 20,  step: 0.05, value: 0,    noRandomize: true },
          { key: 'u_vignette_anchor_x', label: 'Vignette Anchor X', type: 'range', min: 0,   max: 1,   step: 0.01, value: 0.5,  noRandomize: true },
          { key: 'u_vignette_anchor_y', label: 'Vignette Anchor Y', type: 'range', min: 0,   max: 1,   step: 0.01, value: 0.5,  noRandomize: true },
          { key: 'u_pos_x', label: 'Position X', type: 'range', min: -0.5, max: 0.5, step: 0.01, value:  0.0,  noRandomize: true },
          { key: 'u_pos_y', label: 'Position Y', type: 'range', min: -0.5, max: 0.5, step: 0.01, value: -0.07, noRandomize: true },
          { key: 'u_scale', label: 'Scale',      type: 'range', min: 0.2,  max: 3.0,  step: 0.05, value:  0.95, noRandomize: true },
        ]);

        var customAfterBuild = function () {
          var cosineKeys = ['u_a', 'u_b', 'u_c', 'u_d'];

          function applyCosinePreset(p) {
            applyColors(cosineKeys.map(function (k, i) {
              return [k, [p.a, p.b, p.c, p.d][i]];
            }));
          }

          function apply4ColorPreset(p) {
            applyColors([
              ['u_color0', p.c0],
              ['u_color1', p.c1],
              ['u_color2', p.c2],
              ['u_color3', p.c3],
            ]);
          }

          // Apply default on load so shader matches pickers.
          applyCosinePreset(COSINE_PRESETS['Rainbow']);
          apply4ColorPreset(FOUR_STOP_PRESETS['Retro']);

          var presetSel = document.querySelector('[data-param-key="_palette_preset"]');
          if (presetSel) {
            presetSel.addEventListener('change', function () {
              var p = COSINE_PRESETS[this.value];
              if (p) applyCosinePreset(p);
            });
          }

          var fourColorPresetSel = document.querySelector('[data-param-key="_ts_4color_preset"]');
          if (fourColorPresetSel) {
            fourColorPresetSel.addEventListener('change', function () {
              var p = FOUR_STOP_PRESETS[this.value];
              if (p) apply4ColorPreset(p);
            });
          }

          var offsetMaxByCount = { 2: 0.33, 3: 0.23, 4: 0.17 };
          var countInput  = document.querySelector('[data-param-key="u_square_count"]');
          var offsetInput = document.querySelector('[data-param-key="u_offset"]');

          function updateOffsetMax(count) {
            var newMax = offsetMaxByCount[count] || 0.33;
            offsetInput.max = newMax;
            var current = parseFloat(offsetInput.value);
            if (current > newMax) {
              offsetInput.value = newMax;
              offsetInput.nextElementSibling.textContent = newMax;
              window._shaderState.values['u_offset'] = newMax;
            }
          }

          if (countInput && offsetInput) {
            updateOffsetMax(parseInt(countInput.value, 10));
            countInput.addEventListener('input', function () {
              updateOffsetMax(parseInt(this.value, 10));
            });
          }
        };


      return {
        controls: controls,
        customAfterBuild: typeof customAfterBuild === 'function' ? customAfterBuild : null
      };
    });


    window.ShaderDefs = {
      SHADERS: SHADERS,
      SHADER_FONTS: SHADER_FONTS,
      COSINE_PRESETS: COSINE_PRESETS,
      FOUR_STOP_PRESETS: FOUR_STOP_PRESETS,
      FINISH_CONTROLS: FINISH_CONTROLS,
      FINISH_CONTROLS_PRE: FINISH_CONTROLS_PRE,
      FINISH_CONTROLS_POST: FINISH_CONTROLS_POST,
      PALETTE_COEFF_KEYS: PALETTE_COEFF_KEYS,
      srgbToLinear: srgbToLinear,
      linearToSrgb: linearToSrgb,
      hexToRgb: hexToRgb,
      toHex: toHex,
      vividHex: vividHex
    };
}());
