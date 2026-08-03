(function () {
  'use strict';

  // DotsAndLines — a sparse grid of hand-drawn dots (three discrete sizes,
  // roughly half the cells filled) with up to six axis-aligned strokes
  // connecting pairs of them.
  //
  // Split of responsibilities: the line segments are chosen on the CPU (see
  // generateLines below) because picking valid ones needs rejection sampling,
  // which is trivial in JS and awkward per-fragment. Dot visibility stays in
  // GLSL and deliberately never has to agree with the CPU on any hash —
  // endpoints are FORCED visible and interior cells are FORCED hidden, so the
  // generator can pick any pair of cells without knowing whether the density
  // hash would have drawn a dot there.

  var MAX_LINES = 6;

  var fragSrc = [
    '#version 300 es',
    'precision mediump float;',
    '',
    'uniform vec2  u_resolution;',
    '// Cell pixel width / cell pixel height. Every distance below is measured in',
    '// the corrected space vec2(g.x * u_ratio, g.y) so dots stay round and line',
    '// width stays even on the 3:4 portrait canvas.',
    'uniform float u_ratio;',
    '',
    '// Grid',
    'uniform float u_rows;',
    'uniform float u_cols;',
    'uniform float u_dot_density;',
    'uniform float u_seed;',
    '',
    '// Dots — radii are fractions of half a cell height',
    'uniform float u_dot_large;',
    'uniform float u_dot_medium;',
    'uniform float u_dot_small;',
    'uniform float u_dot_jitter;',
    'uniform float u_dot_wobble;',
    '',
    '// Lines — (x0, y0, x1, y1) in integer cell coordinates, CPU-generated',
    'uniform vec4  u_lines[6];',
    'uniform float u_line_count;',
    'uniform float u_line_width;',
    'uniform float u_line_wobble;',
    'uniform float u_line_overshoot;',
    '',
    '// Palette — cosine (mode 0) or 4-stop (mode 1)',
    'uniform float u_color_mode;',
    'uniform vec3  u_a;',
    'uniform vec3  u_b;',
    'uniform vec3  u_c;',
    'uniform vec3  u_d;',
    'uniform vec3  u_color0;',
    'uniform vec3  u_color1;',
    'uniform vec3  u_color2;',
    'uniform vec3  u_color3;',
    '',
    '// Finish',
    'uniform float u_opacity;',
    'uniform float u_grain_mode;',
    'uniform float u_distress;',
    'uniform float u_distress_scale;',
    'uniform float u_distress_falloff;',
    'uniform float u_pos_x;',
    'uniform float u_pos_y;',
    'uniform float u_scale;',
    '',
    'out vec4 fragColor;',
    '',
    window.ShaderBase.commonGLSL,
    '',
    '// ── OKLCH color space helpers (perceptually-uniform 4-stop blending) ──────',
    'vec3 linear_rgb_to_oklab(vec3 c) {',
    '  float l_ = 0.4122214708*c.r + 0.5363325363*c.g + 0.0514459929*c.b;',
    '  float m_ = 0.2119034982*c.r + 0.6806995451*c.g + 0.1073969566*c.b;',
    '  float s_ = 0.0883024619*c.r + 0.2817188376*c.g + 0.6299787005*c.b;',
    '  float l = pow(max(l_, 0.0), 1.0/3.0);',
    '  float m = pow(max(m_, 0.0), 1.0/3.0);',
    '  float s = pow(max(s_, 0.0), 1.0/3.0);',
    '  return vec3(0.2104542553*l+0.7936177850*m-0.0040720468*s,',
    '              1.9779984951*l-2.4285922050*m+0.4505937099*s,',
    '              0.0259040371*l+0.4072456269*m-0.4631496600*s);',
    '}',
    'vec3 oklab_to_linear_rgb(vec3 lab) {',
    '  float l_ = lab.x+0.3963377774*lab.y+0.2158037573*lab.z;',
    '  float m_ = lab.x-0.1055613458*lab.y-0.0638541728*lab.z;',
    '  float s_ = lab.x-0.0894841775*lab.y-1.2914855480*lab.z;',
    '  float l = l_*l_*l_; float m = m_*m_*m_; float s = s_*s_*s_;',
    '  return vec3( 4.0767416621*l-3.3077115913*m+0.2309699292*s,',
    '              -1.2684380046*l+2.6097574011*m-0.3413193965*s,',
    '              -0.0041960863*l-0.7034186147*m+1.7076147010*s);',
    '}',
    'vec3 oklab_to_oklch(vec3 lab) {',
    '  return vec3(lab.x, sqrt(lab.y*lab.y + lab.z*lab.z), atan(lab.z, lab.y));',
    '}',
    'vec3 oklch_to_oklab(vec3 lch) {',
    '  return vec3(lch.x, lch.y*cos(lch.z), lch.y*sin(lch.z));',
    '}',
    'vec3 mix_oklch(vec3 a, vec3 b, float t) {',
    '  float dh = mod(b.z - a.z + 3.14159265, 6.28318530) - 3.14159265;',
    '  return vec3(mix(a.x, b.x, t), mix(a.y, b.y, t), a.z + t * dh);',
    '}',
    '',
    '// GLSL ES 3.00 needs a compile-time loop bound even though the real count',
    '// arrives as a uniform — hence the constant plus the runtime break.',
    'const int MAX_LINES = 6;',
    '',
    '// Not in commonGLSL — local to this shader.',
    'float sdSegment(vec2 p, vec2 a, vec2 b) {',
    '  vec2 pa = p - a;',
    '  vec2 ba = b - a;',
    '  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);',
    '  return length(pa - ba * h);',
    '}',
    '',
    '// Does this cell hold a dot? Base answer is the density hash; the lines',
    '// then override it. Suppression is applied AFTER the endpoint force, so',
    '// hidden beats visible — that keeps crossings deterministic (an endpoint of',
    '// one line landing on the interior of another disappears, which is the',
    '// correct reading of "no dots anywhere along a line").',
    'float dotVisible(vec2 cell) {',
    '  if (cell.x < 0.0 || cell.y < 0.0 || cell.x >= u_cols || cell.y >= u_rows) return 0.0;',
    '  float vis = step(hash21(cell + u_seed), u_dot_density);',
    '  if (u_line_count < 0.5) return vis;',
    '',
    '  float forceOn  = 0.0;',
    '  float suppress = 0.0;',
    '  for (int i = 0; i < MAX_LINES; i++) {',
    '    if (float(i) >= u_line_count) break;',
    '    vec4 L  = u_lines[i];',
    '    vec2 lo = min(L.xy, L.zw);',
    '    vec2 hi = max(L.xy, L.zw);',
    '    if (all(equal(cell, L.xy)) || all(equal(cell, L.zw))) forceOn = 1.0;',
    '    bool onRow = L.y == L.w && cell.y == L.y && cell.x > lo.x && cell.x < hi.x;',
    '    bool onCol = L.x == L.z && cell.x == L.x && cell.y > lo.y && cell.y < hi.y;',
    '    if (onRow || onCol) suppress = 1.0;',
    '  }',
    '  return min(max(vis, forceOn), 1.0 - suppress);',
    '}',
    '',
    '// Ink never sits exactly on the cell center.',
    'vec2 cellCenter(vec2 cell) {',
    '  vec2 jit = vec2(hash21(cell + 13.7) - 0.5, hash21(cell + 91.2) - 0.5) * u_dot_jitter;',
    '  return cell + 0.5 + jit;',
    '}',
    '',
    'vec2 toCorrected(vec2 g) {',
    '  return vec2(g.x * u_ratio, g.y);',
    '}',
    '',
    '// Three discrete sizes in equal thirds. Line endpoints run through this same',
    '// hash so a connected dot is indistinguishable from any other grid dot.',
    'float dotRadius(vec2 cell) {',
    '  float h = hash21(cell + 71.3 + u_seed);',
    '  float frac = h < 0.33333 ? u_dot_large : (h < 0.66667 ? u_dot_medium : u_dot_small);',
    '  return frac * 0.5;',
    '}',
    '',
    'float dotAt(vec2 cell, vec2 pc, float aa) {',
    '  vec2 q = pc - toCorrected(cellCenter(cell));',
    '  float dq = length(q);',
    '  float radius = dotRadius(cell);',
    '  // Cheapest test first: this runs 9x per designEval (3x3 neighborhood) and',
    '  // all but one or two of those cells are always out of reach, so bail before',
    '  // paying for the line loop inside dotVisible or — much worse — the fbm.',
    '  if (dq > radius * (1.0 + u_dot_wobble * 0.5) + aa) return 0.0;',
    '  if (dotVisible(cell) < 0.5) return 0.0;',
    '  float ang = atan(q.y, q.x);',
    '  float r = radius * (1.0 + u_dot_wobble * (fbm(vec2(cos(ang), sin(ang)) * 2.0 + cell * 7.3) - 0.5));',
    '  return 1.0 - smoothstep(r - aa, r + aa, dq);',
    '}',
    '',
    '// g: raw grid coords, pc: the same point in corrected (isotropic) space.',
    'float lineAt(vec2 g, vec2 pc, float aa) {',
    '  if (u_line_count < 0.5) return 0.0;',
    '  float m = 0.0;',
    '  for (int i = 0; i < MAX_LINES; i++) {',
    '    if (float(i) >= u_line_count) break;',
    '    vec4 L = u_lines[i];',
    '    // Hash-free bounding-box reject in cell space, before any of the jitter/',
    '    // overshoot hashes below. Margin covers jitter + overshoot + half width.',
    '    vec2 lo = min(L.xy, L.zw) - 1.5;',
    '    vec2 hi = max(L.xy, L.zw) + 2.5;',
    '    if (g.x < lo.x || g.x > hi.x || g.y < lo.y || g.y > hi.y) continue;',
    '    // Endpoints use the same jittered centers as the dots, so a stroke lands',
    '    // on its two dots instead of near them.',
    '    vec2 a = toCorrected(cellCenter(L.xy));',
    '    vec2 b = toCorrected(cellCenter(L.zw));',
    '    vec2 dir = normalize(b - a);',
    '    // Biased so most ends run past the dot and a few stop short.',
    '    float o0 = (hash21(vec2(float(i) + 3.1, u_seed + 5.7)) - 0.3) * u_line_overshoot;',
    '    float o1 = (hash21(vec2(float(i) + 8.4, u_seed + 1.3)) - 0.3) * u_line_overshoot;',
    '    vec2 a2 = a - dir * o0;',
    '    vec2 b2 = b + dir * o1;',
    '    vec2 ba = b2 - a2;',
    '    // Wobble can only move the measured distance by half its amplitude, so',
    '    // fragments this far out can be rejected before paying for the fbm.',
    '    float maxW = u_line_width * 0.5 + aa;',
    '    if (sdSegment(pc, a2, b2) > maxW + u_line_wobble * 0.5) continue;',
    '    float t = clamp(dot(pc - a2, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);',
    '    // Push the sample point sideways by an along-stroke fbm wobble — the',
    '    // stroke itself stays a straight sdSegment, the sampling bends.',
    '    vec2 perp = vec2(-dir.y, dir.x);',
    '    float wob = (fbm(vec2(t * 5.0 + float(i) * 3.7, float(i) * 17.3 + u_seed)) - 0.5) * u_line_wobble;',
    '    float d = sdSegment(pc - perp * wob, a2, b2);',
    '    float w = u_line_width * 0.5 * mix(0.55, 1.0, sin(3.14159265 * t));',
    '    m = max(m, 1.0 - smoothstep(w - aa, w + aa, d));',
    '  }',
    '  return m;',
    '}',
    '',
    '// Evaluates the design color + coverage at any uv (post pos/scale',
    '// transform). aaFixed: the per-fragment path passes 0.0 and gets the',
    '// analytic one-pixel width; halftone sampling passes a small constant',
    '// because uv is constant across the fragments of a cell there.',
    'vec4 designEval(vec2 uv, float aaFixed) {',
    '  vec2 g    = uv * vec2(u_cols, u_rows);',
    '  vec2 base = floor(g);',
    '  vec2 pc   = toCorrected(g);',
    '',
    '  // One screen pixel expressed in cell-height units. Derivative-free so it',
    '  // stays valid inside the early-outs above (fwidth in non-uniform control',
    '  // flow is undefined).',
    '  float aa = max(u_rows / max(u_resolution.y * u_scale, 1.0), aaFixed);',
    '',
    '  // Jitter plus radius can carry a dot across its own cell edge, so test the',
    '  // 3x3 neighborhood rather than just the cell under the fragment.',
    '  float dots = 0.0;',
    '  for (int j = -1; j <= 1; j++) {',
    '    for (int i = -1; i <= 1; i++) {',
    '      dots = max(dots, dotAt(base + vec2(float(i), float(j)), pc, aa));',
    '    }',
    '  }',
    '',
    '  float mask = max(dots, lineAt(g, pc, aa));',
    '',
    '  // Background fragments skip the palette entirely — the OKLCH chain below',
    '  // is a dozen pow() calls and this runs 9x per fragment in half-tone mode.',
    '  // Safe because every consumer weights the color by this same alpha.',
    '  if (mask < 0.001) return vec4(0.0);',
    '',
    '  // uv.y is 0 at the bottom of the canvas, so invert it to keep the',
    '  // "Color 1 (Top)" / "Color 4 (Bottom)" labels honest.',
    '  float t = clamp(1.0 - uv.y, 0.0, 1.0);',
    '  vec3 palColor = cosinePalette(t, u_a, u_b, u_c, u_d);',
    '',
    '  float t01 = clamp(t * 3.0, 0.0, 1.0);',
    '  float t12 = clamp((t - 1.0 / 3.0) * 3.0, 0.0, 1.0);',
    '  float t23 = clamp((t - 2.0 / 3.0) * 3.0, 0.0, 1.0);',
    '  vec3 lch0 = oklab_to_oklch(linear_rgb_to_oklab(u_color0));',
    '  vec3 lch1 = oklab_to_oklch(linear_rgb_to_oklab(u_color1));',
    '  vec3 lch2 = oklab_to_oklch(linear_rgb_to_oklab(u_color2));',
    '  vec3 lch3 = oklab_to_oklch(linear_rgb_to_oklab(u_color3));',
    '  vec3 seg01 = mix_oklch(lch0, lch1, t01);',
    '  vec3 seg12 = mix_oklch(lch1, lch2, t12);',
    '  vec3 seg23 = mix_oklch(lch2, lch3, t23);',
    '  vec3 blendedLch = mix(mix(seg01, seg12, step(1.0 / 3.0, t)), seg23, step(2.0 / 3.0, t));',
    '  vec3 gradColor = clamp(oklab_to_linear_rgb(oklch_to_oklab(blendedLch)), 0.0, 1.0);',
    '',
    '  vec3 finalColor = mix(palColor, gradColor, u_color_mode);',
    '  return vec4(finalColor, mask);',
    '}',
    '',
    'void main() {',
    '  vec2 uv = gl_FragCoord.xy / u_resolution;',
    '  uv = (uv - 0.5) / u_scale + 0.5 + vec2(u_pos_x, u_pos_y);',
    '  vec2 dUV = gl_FragCoord.xy / u_resolution;',
    '  vec4 px = designEval(uv, 0.0);',
    '  vec3 finalColor = px.rgb;',
    '  float vigMask = computeVigMask(dUV);',
    '  float alpha;',
    '  if (u_grain_mode >= 3.5) {',
    '    // Half-tone: size each dot by design coverage over its cell (3x3',
    '    // supersample) so dots shrink toward ink edges instead of slicing.',
    '    vec2 cellFrag  = halftoneCellCenter(u_distress_scale);',
    '    float cellSize = max(2.0, u_distress_scale / 10.0);',
    '    float covSum = 0.0;',
    '    vec3  inkSum = vec3(0.0);',
    '    for (int i = -1; i <= 1; i++) {',
    '      for (int j = -1; j <= 1; j++) {',
    '        vec2 sFrag = cellFrag + vec2(float(i), float(j)) * (cellSize / 3.0);',
    '        vec2 sUV   = (sFrag / u_resolution - 0.5) / u_scale + 0.5 + vec2(u_pos_x, u_pos_y);',
    '        vec4 smp   = designEval(sUV, 0.002);',
    '        covSum += smp.a;',
    '        inkSum += smp.rgb * smp.a;',
    '      }',
    '    }',
    '    vec3 dotColor  = covSum > 0.001 ? inkSum / covSum : finalColor;',
    '    float coverage = covSum / 9.0;',
    '    float cellVig  = computeVigMask(cellFrag / u_resolution);',
    '    float dotLuma  = dot(dotColor, vec3(0.299, 0.587, 0.114));',
    '    alpha = halftoneNoise(u_distress_scale, halftoneDrive(coverage, dotLuma, cellVig, u_distress)) * u_opacity;',
    '    finalColor = dotColor;',
    '  } else {',
    '    alpha = applyDistress(px.a, dUV, u_distress, u_distress_scale, u_grain_mode, u_distress_falloff, dot(finalColor, vec3(0.299, 0.587, 0.114)), vigMask);',
    '    alpha *= u_opacity;',
    '    finalColor *= vigMask;',
    '  }',
    '',
    '  vec3 encoded = pow(max(finalColor, 0.0), vec3(1.0 / 2.2));',
    '  fragColor = vec4(encoded * alpha, alpha);',
    '}'
  ].join('\n');

  // ── CPU line generation ─────────────────────────────────────────────────────

  // Seeded PRNG so a given Seed always produces the same set of lines.
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Rejection-samples up to `count` axis-aligned segments that each span at
  // least `minSpan` cells and share no cell with an already-placed segment.
  // A tight grid may not fit them all (6 lines at min span 5 in an 8x6 grid,
  // say) — in that case we emit fewer rather than shortening a span or
  // spinning forever.
  function generateLines(seed, cols, rows, count, minSpan) {
    var rand   = mulberry32(seed);
    var data   = new Float32Array(MAX_LINES * 4);
    var used   = {};
    var placed = 0;

    for (var n = 0; n < count && n < MAX_LINES; n++) {
      var settled = false;
      for (var attempt = 0; attempt < 200 && !settled; attempt++) {
        var horizontal = rand() < 0.5;
        var along      = horizontal ? cols : rows;  // axis the segment runs along
        var across     = horizontal ? rows : cols;  // axis picking the row/column
        var maxSpan    = along - 1;
        if (maxSpan < minSpan) continue;            // grid too narrow this way

        var span  = minSpan + Math.floor(rand() * (maxSpan - minSpan + 1));
        var start = Math.floor(rand() * (along - span));
        var lane  = Math.floor(rand() * across);

        var cells = [];
        var clash = false;
        for (var k = 0; k <= span; k++) {
          var cx  = horizontal ? start + k : lane;
          var cy  = horizontal ? lane : start + k;
          var key = cx + ',' + cy;
          if (used[key]) { clash = true; break; }
          cells.push(key);
        }
        if (clash) continue;

        for (var c = 0; c < cells.length; c++) used[cells[c]] = 1;
        var o = placed * 4;
        data[o]     = horizontal ? start : lane;
        data[o + 1] = horizontal ? lane : start;
        data[o + 2] = horizontal ? start + span : lane;
        data[o + 3] = horizontal ? lane : start + span;
        placed++;
        settled = true;
      }
      if (!settled) break; // no room left for another line under these settings
    }

    return { data: data, count: placed };
  }

  // render() runs every frame; the PRNG must not. Same caching idea as the
  // textKey check in shader-base.js.
  var cachedKey   = null;
  var cachedLines = { data: new Float32Array(MAX_LINES * 4), count: 0 };

  function linesFor(seed, cols, rows, count, minSpan) {
    var key = [seed, cols, rows, count, minSpan].join('|');
    if (key !== cachedKey) {
      cachedLines = generateLines(seed, cols, rows, count, minSpan);
      cachedKey   = key;
    }
    return cachedLines;
  }

  window.ShaderBase.create({
    animateValues: true,
    instantKeys: [
      'u_opacity', 'u_distress_0', 'u_distress_scale_0', 'u_distress_1', 'u_distress_scale_1',
      'u_distress_2', 'u_distress_scale_2', 'u_distress_3', 'u_distress_scale_3', 'u_grain_mode',
      'u_distress_falloff', 'u_vignette_top', 'u_vignette_bottom', 'u_vignette_left', 'u_vignette_right',
      'u_vignette_anchor_x', 'u_vignette_anchor_y',
      // Integer-step controls: lerping these would cross-fade two unrelated
      // grids or line sets instead of cutting cleanly between them.
      'u_rows', 'u_cols', 'u_line_count', 'u_line_min_span', 'u_seed',
    ],
    fragSrc: fragSrc,

    setup: function (gl, program) {
      return {
        res:   gl.getUniformLocation(program, 'u_resolution'),
        ratio: gl.getUniformLocation(program, 'u_ratio'),
        rows:       gl.getUniformLocation(program, 'u_rows'),
        cols:       gl.getUniformLocation(program, 'u_cols'),
        dotDensity: gl.getUniformLocation(program, 'u_dot_density'),
        seed:       gl.getUniformLocation(program, 'u_seed'),
        dotLarge:   gl.getUniformLocation(program, 'u_dot_large'),
        dotMedium:  gl.getUniformLocation(program, 'u_dot_medium'),
        dotSmall:   gl.getUniformLocation(program, 'u_dot_small'),
        dotJitter:  gl.getUniformLocation(program, 'u_dot_jitter'),
        dotWobble:  gl.getUniformLocation(program, 'u_dot_wobble'),
        // WebGL2 accepts the bare array name for element 0 of a uniform array.
        lines:         gl.getUniformLocation(program, 'u_lines'),
        lineCount:     gl.getUniformLocation(program, 'u_line_count'),
        lineWidth:     gl.getUniformLocation(program, 'u_line_width'),
        lineWobble:    gl.getUniformLocation(program, 'u_line_wobble'),
        lineOvershoot: gl.getUniformLocation(program, 'u_line_overshoot'),
        colorMode: gl.getUniformLocation(program, 'u_color_mode'),
        palA:      gl.getUniformLocation(program, 'u_a'),
        palB:      gl.getUniformLocation(program, 'u_b'),
        palC:      gl.getUniformLocation(program, 'u_c'),
        palD:      gl.getUniformLocation(program, 'u_d'),
        color0:    gl.getUniformLocation(program, 'u_color0'),
        color1:    gl.getUniformLocation(program, 'u_color1'),
        color2:    gl.getUniformLocation(program, 'u_color2'),
        color3:    gl.getUniformLocation(program, 'u_color3'),
        opacity:         gl.getUniformLocation(program, 'u_opacity'),
        distress:        gl.getUniformLocation(program, 'u_distress'),
        distressScale:   gl.getUniformLocation(program, 'u_distress_scale'),
        grainMode:       gl.getUniformLocation(program, 'u_grain_mode'),
        distressFalloff: gl.getUniformLocation(program, 'u_distress_falloff'),
        halftoneAngle:   gl.getUniformLocation(program, 'u_halftone_angle'),
        halftoneLuma:    gl.getUniformLocation(program, 'u_halftone_luma'),
        halftoneShape:   gl.getUniformLocation(program, 'u_halftone_shape'),
        vignetteTop:     gl.getUniformLocation(program, 'u_vignette_top'),
        vignetteBottom:  gl.getUniformLocation(program, 'u_vignette_bottom'),
        vignetteLeft:    gl.getUniformLocation(program, 'u_vignette_left'),
        vignetteRight:   gl.getUniformLocation(program, 'u_vignette_right'),
        vignetteAnchorX: gl.getUniformLocation(program, 'u_vignette_anchor_x'),
        vignetteAnchorY: gl.getUniformLocation(program, 'u_vignette_anchor_y'),
        posX:            gl.getUniformLocation(program, 'u_pos_x'),
        posY:            gl.getUniformLocation(program, 'u_pos_y'),
        scale:           gl.getUniformLocation(program, 'u_scale'),
      };
    },

    render: function (gl, u, v, w, h) {
      // Rounded: a fractional grid dimension tears the pattern, and the line
      // generator works in whole cells.
      var rows    = Math.max(2, Math.round(v.u_rows != null ? v.u_rows : 16));
      var cols    = Math.max(2, Math.round(v.u_cols != null ? v.u_cols : 12));
      var seed    = Math.round(v.u_seed != null ? v.u_seed : 3);
      var count   = Math.round(v.u_line_count != null ? v.u_line_count : 4);
      var minSpan = Math.max(2, Math.round(v.u_line_min_span != null ? v.u_line_min_span : 3));

      var lines = linesFor(seed, cols, rows, count, minSpan);

      gl.uniform2f(u.res, w, h);
      gl.uniform1f(u.ratio, (w / cols) / (h / rows));
      gl.uniform1f(u.rows, rows);
      gl.uniform1f(u.cols, cols);
      gl.uniform1f(u.dotDensity, v.u_dot_density != null ? v.u_dot_density : 0.5);
      gl.uniform1f(u.seed, seed);
      gl.uniform1f(u.dotLarge,  v.u_dot_large  != null ? v.u_dot_large  : 0.34);
      gl.uniform1f(u.dotMedium, v.u_dot_medium != null ? v.u_dot_medium : 0.20);
      gl.uniform1f(u.dotSmall,  v.u_dot_small  != null ? v.u_dot_small  : 0.10);
      gl.uniform1f(u.dotJitter, v.u_dot_jitter != null ? v.u_dot_jitter : 0.18);
      gl.uniform1f(u.dotWobble, v.u_dot_wobble != null ? v.u_dot_wobble : 0.35);

      gl.uniform4fv(u.lines, lines.data);
      gl.uniform1f(u.lineCount, lines.count);
      gl.uniform1f(u.lineWidth,     v.u_line_width     != null ? v.u_line_width     : 0.09);
      gl.uniform1f(u.lineWobble,    v.u_line_wobble    != null ? v.u_line_wobble    : 0.06);
      gl.uniform1f(u.lineOvershoot, v.u_line_overshoot != null ? v.u_line_overshoot : 0.25);

      gl.uniform1f(u.colorMode, v.u_color_mode != null ? parseFloat(v.u_color_mode) : 0.0);
      gl.uniform3fv(u.palA,   v.u_a      || [0.5, 0.5, 0.5]);
      gl.uniform3fv(u.palB,   v.u_b      || [0.5, 0.5, 0.5]);
      gl.uniform3fv(u.palC,   v.u_c      || [1.0, 1.0, 1.0]);
      gl.uniform3fv(u.palD,   v.u_d      || [0.0, 0.33, 0.67]);
      gl.uniform3fv(u.color0, v.u_color0 || [1.0, 0.2,  0.4]);
      gl.uniform3fv(u.color1, v.u_color1 || [1.0, 0.8,  0.0]);
      gl.uniform3fv(u.color2, v.u_color2 || [0.0, 0.8,  1.0]);
      gl.uniform3fv(u.color3, v.u_color3 || [0.667, 0.0, 1.0]);

      gl.uniform1f(u.opacity, v.u_opacity != null ? v.u_opacity : 1.0);
      var _gm = Math.round(v.u_grain_mode != null ? parseFloat(v.u_grain_mode) : 0);
      gl.uniform1f(u.distress,      v['u_distress_' + _gm]       != null ? v['u_distress_' + _gm]       : (v.u_distress       != null ? v.u_distress       : 0.0));
      gl.uniform1f(u.distressScale, v['u_distress_scale_' + _gm] != null ? v['u_distress_scale_' + _gm] : (v.u_distress_scale != null ? v.u_distress_scale : 80.0));
      gl.uniform1f(u.grainMode,       v.u_grain_mode       != null ? parseFloat(v.u_grain_mode) : 0.0);
      gl.uniform1f(u.distressFalloff, v.u_distress_falloff != null ? v.u_distress_falloff : 0.0);
      gl.uniform1f(u.halftoneAngle, (v.u_halftone_angle != null ? v.u_halftone_angle : 45.0) * Math.PI / 180.0);
      gl.uniform1f(u.halftoneLuma,  v.u_halftone_luma  != null ? v.u_halftone_luma  : 0.0);
      gl.uniform1f(u.halftoneShape, v.u_halftone_shape != null ? parseFloat(v.u_halftone_shape) : 0.0);
      gl.uniform1f(u.vignetteTop,    v.u_vignette_top    != null ? v.u_vignette_top    : 0.0);
      gl.uniform1f(u.vignetteBottom, v.u_vignette_bottom != null ? v.u_vignette_bottom : 0.0);
      gl.uniform1f(u.vignetteLeft,   v.u_vignette_left   != null ? v.u_vignette_left   : 0.0);
      gl.uniform1f(u.vignetteRight,  v.u_vignette_right  != null ? v.u_vignette_right  : 0.0);
      gl.uniform1f(u.vignetteAnchorX, v.u_vignette_anchor_x != null ? v.u_vignette_anchor_x : 0.5);
      gl.uniform1f(u.vignetteAnchorY, v.u_vignette_anchor_y != null ? v.u_vignette_anchor_y : 0.5);
      gl.uniform1f(u.posX,  v.u_pos_x != null ? v.u_pos_x : 0.0);
      gl.uniform1f(u.posY,  v.u_pos_y != null ? v.u_pos_y : 0.0);
      gl.uniform1f(u.scale, v.u_scale != null ? v.u_scale : 1.0);
    },
  });
}());
