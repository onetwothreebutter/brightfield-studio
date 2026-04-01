(function () {
  'use strict';

  // StackedGradient port — faithful to the Three.js TSL original
  // Stacked horizontal rows with configurable heights, per-row horizontal
  // gradient strips, cosine/4-stop palette, and text overlay.

  var PHI = 1.6180339887498948;
  var TALL_FRAC = PHI / (PHI + 1); // ≈ 0.618033988

  // ── Threshold computation helpers ─────────────────────────────────────────

  function computeThresholds(weights) {
    var total = weights.reduce(function (a, b) { return a + b; }, 0);
    var out = new Array(19).fill(1.0);
    var cumSum = 0;
    for (var i = 0; i < weights.length - 1; i++) {
      cumSum += weights[i] / total;
      out[i] = cumSum;
    }
    return out;
  }

  function computeFibThresholds(rowCount) {
    var fibs = [1, 1];
    for (var i = 2; i < rowCount; i++) fibs.push(fibs[i - 1] + fibs[i - 2]);
    return computeThresholds(fibs.slice(0, rowCount));
  }

  function computeEqTempThresholds(rowCount) {
    var weights = [];
    for (var i = 0; i < rowCount; i++) weights.push(Math.pow(2, i / 12));
    return computeThresholds(weights);
  }

  function computeSineThresholds(rowCount) {
    var weights = [];
    for (var i = 0; i < rowCount; i++) {
      weights.push(Math.sin(((i + 0.5) * Math.PI) / rowCount));
    }
    return computeThresholds(weights);
  }

  function computeNoiseThresholds(rowCount, seed) {
    function hash(n) {
      var x = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
      return x - Math.floor(x);
    }
    function smoothstepJS(t) { return t * t * (3 - 2 * t); }
    var scale = 2.5;
    var weights = [];
    for (var i = 0; i < rowCount; i++) {
      var p  = (i / Math.max(rowCount - 1, 1)) * scale;
      var i0 = Math.floor(p);
      var f  = p - i0;
      weights.push((hash(i0) + (hash(i0 + 1) - hash(i0)) * smoothstepJS(f)) * 0.8 + 0.2);
    }
    return computeThresholds(weights);
  }

  // ── Fragment shader ────────────────────────────────────────────────────────
  // Thresholds are passed as 5 vec4 uniforms (19 values, no array indexing).
  // thresh0.xyzw = boundaries 0-3
  // thresh1.xyzw = boundaries 4-7
  // thresh2.xyzw = boundaries 8-11
  // thresh3.xyzw = boundaries 12-15
  // thresh4.xyz  = boundaries 16-18  (thresh4.w is padding, always 1.0)

  var fragSrc = [
    '#version 300 es',
    'precision mediump float;',
    '',
    'uniform vec2  u_resolution;',
    'uniform float u_aspect;',
    'uniform float u_row_count;',
    'uniform float u_stagger;',
    'uniform float u_fade_width;',
    'uniform float u_tilt_tan;',
    'uniform float u_width;',
    'uniform float u_offset_x;',
    'uniform float u_offset_y;',
    'uniform float u_row_offset;',
    'uniform float u_use_thresholds;',
    'uniform vec4  u_thresh0;',
    'uniform vec4  u_thresh1;',
    'uniform vec4  u_thresh2;',
    'uniform vec4  u_thresh3;',
    'uniform vec4  u_thresh4;',
    'uniform vec3  u_a;',
    'uniform vec3  u_b;',
    'uniform vec3  u_c;',
    'uniform vec3  u_d;',
    'uniform float u_color_mode;',
    'uniform vec3  u_oklch_a;',
    'uniform vec3  u_oklch_b;',
    'uniform vec3  u_oklch_c;',
    'uniform vec3  u_oklch_d;',
    'uniform vec3  u_color0;',
    'uniform vec3  u_color1;',
    'uniform vec3  u_color2;',
    'uniform vec3  u_color3;',
    'uniform sampler2D u_text_tex;',
    'uniform float u_text_x;',
    'uniform float u_text_y;',
    'uniform vec3  u_text_color;',
    'uniform float u_use_text_color;',
    'uniform float u_invert_text;',
    'uniform vec3  u_outline_color;',
    'uniform float u_opacity;',
    'uniform float u_distress;',
    'uniform float u_distress_scale;',
    '',
    'out vec4 fragColor;',
    '',
    'float hash21(vec2 p) {',
    '  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);',
    '}',
    'float distressNoise(vec2 uv, float scale) {',
    '  vec2 p = uv * scale; vec2 i = floor(p); vec2 f = fract(p);',
    '  float a = hash21(i), b = hash21(i + vec2(1,0)),',
    '        c = hash21(i + vec2(0,1)), d = hash21(i + vec2(1,1));',
    '  vec2 u = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);',
    '}',
    '',
    'vec3 cosinePalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {',
    '  return a + b * cos(6.28318 * (c * t + d));',
    '}',
    '',
    '// ── OKLCH color space helpers ──────────────────────────────────────────────',
    'vec3 linear_rgb_to_oklab(vec3 c) {',
    '  float l_ = 0.4122214708*c.r + 0.5363325363*c.g + 0.0514459929*c.b;',
    '  float m_ = 0.2119034982*c.r + 0.6806995451*c.g + 0.1073969566*c.b;',
    '  float s_ = 0.0883024619*c.r + 0.2817188376*c.g + 0.6299787005*c.b;',
    '  float l = pow(max(l_, 0.0), 1.0/3.0);',
    '  float m = pow(max(m_, 0.0), 1.0/3.0);',
    '  float s = pow(max(s_, 0.0), 1.0/3.0);',
    '  return vec3(',
    '    0.2104542553*l + 0.7936177850*m - 0.0040720468*s,',
    '    1.9779984951*l - 2.4285922050*m + 0.4505937099*s,',
    '    0.0259040371*l + 0.4072456269*m - 0.4631496600*s',
    '  );',
    '}',
    '',
    'vec3 oklab_to_linear_rgb(vec3 lab) {',
    '  float l_ = lab.x + 0.3963377774*lab.y + 0.2158037573*lab.z;',
    '  float m_ = lab.x - 0.1055613458*lab.y - 0.0638541728*lab.z;',
    '  float s_ = lab.x - 0.0894841775*lab.y - 1.2914855480*lab.z;',
    '  float l = l_*l_*l_; float m = m_*m_*m_; float s = s_*s_*s_;',
    '  return vec3(',
    '     4.0767416621*l - 3.3077115913*m + 0.2309699292*s,',
    '    -1.2684380046*l + 2.6097574011*m - 0.3413193965*s,',
    '    -0.0041960863*l - 0.7034186147*m + 1.7076147010*s',
    '  );',
    '}',
    '',
    'vec3 oklab_to_oklch(vec3 lab) {',
    '  return vec3(lab.x, sqrt(lab.y*lab.y + lab.z*lab.z), atan(lab.z, lab.y));',
    '}',
    '',
    'vec3 oklch_to_oklab(vec3 lch) {',
    '  return vec3(lch.x, lch.y*cos(lch.z), lch.y*sin(lch.z));',
    '}',
    '',
    '// Interpolate two OKLCH colors with shortest-path hue wrapping.',
    'vec3 mix_oklch(vec3 a, vec3 b, float t) {',
    '  float dh = mod(b.z - a.z + 3.14159265, 6.28318530) - 3.14159265;',
    '  return vec3(mix(a.x, b.x, t), mix(a.y, b.y, t), a.z + t * dh);',
    '}',
    '',
    '// OKLCH cosine palette — a/b/c/d operate on [L, C, H_radians].',
    'vec3 oklchPalette(float t) {',
    '  vec3 lch = u_oklch_a + u_oklch_b * cos(6.28318 * (u_oklch_c * t + u_oklch_d));',
    '  lch.x = clamp(lch.x, 0.0, 1.0);',
    '  lch.y = max(lch.y, 0.0);',
    '  return clamp(oklab_to_linear_rgb(oklch_to_oklab(lch)), 0.0, 1.0);',
    '}',
    '',
    'void main() {',
    '  vec2  uv = gl_FragCoord.xy / u_resolution;',
    '  float x  = uv.x;',
    '  float y  = uv.y;',
    '  float yOff = fract(y + u_offset_y);',
    '',
    '  // --- Golden ratio row layout ---',
    '  float numPairs    = u_row_count * 0.5;',
    '  float pairID      = floor(yOff * numPairs);',
    '  float pairY       = fract(yOff * numPairs);',
    '  float inTall      = 1.0 - step(0.618034, pairY);',
    '  float goldenRowID = pairID * 2.0 + (1.0 - inTall);',
    '',
    '  // --- Threshold-based row layout (Fibonacci / EqTemp / Sine / Noise) ---',
    '  // 19 boundaries unrolled across 5 vec4 uniforms; no array indexing needed.',
    '  float threshRowID =',
    '    step(u_thresh0.x, yOff) + step(u_thresh0.y, yOff) +',
    '    step(u_thresh0.z, yOff) + step(u_thresh0.w, yOff) +',
    '    step(u_thresh1.x, yOff) + step(u_thresh1.y, yOff) +',
    '    step(u_thresh1.z, yOff) + step(u_thresh1.w, yOff) +',
    '    step(u_thresh2.x, yOff) + step(u_thresh2.y, yOff) +',
    '    step(u_thresh2.z, yOff) + step(u_thresh2.w, yOff) +',
    '    step(u_thresh3.x, yOff) + step(u_thresh3.y, yOff) +',
    '    step(u_thresh3.z, yOff) + step(u_thresh3.w, yOff) +',
    '    step(u_thresh4.x, yOff) + step(u_thresh4.y, yOff) +',
    '    step(u_thresh4.z, yOff);',
    '',
    '  float rowID = mix(goldenRowID, threshRowID, u_use_thresholds);',
    '',
    '  // --- Per-row stagger via golden-ratio fractional distribution ---',
    '  float phaseA    = fract(rowID * 0.618034);',
    '  float phaseB    = fract(rowID * 0.618034 + 0.5);',
    '  float leftEdge  = phaseA * u_stagger * 0.15 + abs(u_tilt_tan) * 0.5;',
    '  float origRight = 1.0 - phaseB * u_stagger;',
    '  float rightEdge = leftEdge + (origRight - leftEdge) * u_width;',
    '',
    '  // Tilt + horizontal shift',
    '  float xTilted = x + (y - 0.5) * u_tilt_tan - u_offset_x;',
    '',
    '  // --- Gradient color ---',
    '  float normalizedX = clamp((xTilted - leftEdge) / (rightEdge - leftEdge), 0.0, 1.0);',
    '  float rowOffset   = rowID / u_row_count * u_row_offset;',
    '  float palT        = normalizedX + rowOffset;',
    '',
    '  vec3 cosineCol = cosinePalette(palT, u_a, u_b, u_c, u_d);',
    '',
    '  // 4-stop gradient interpolated in OKLCH for vivid midpoints.',
    '  float t01 = clamp(palT * 3.0, 0.0, 1.0);',
    '  float t12 = clamp((palT - 0.33333) * 3.0, 0.0, 1.0);',
    '  float t23 = clamp((palT - 0.66667) * 3.0, 0.0, 1.0);',
    '  vec3 lch0 = oklab_to_oklch(linear_rgb_to_oklab(u_color0));',
    '  vec3 lch1 = oklab_to_oklch(linear_rgb_to_oklab(u_color1));',
    '  vec3 lch2 = oklab_to_oklch(linear_rgb_to_oklab(u_color2));',
    '  vec3 lch3 = oklab_to_oklch(linear_rgb_to_oklab(u_color3));',
    '  vec3 seg01 = mix_oklch(lch0, lch1, t01);',
    '  vec3 seg12 = mix_oklch(lch1, lch2, t12);',
    '  vec3 seg23 = mix_oklch(lch2, lch3, t23);',
    '  vec3 blendedLch = mix(mix(seg01, seg12, step(0.33333, palT)), seg23, step(0.66667, palT));',
    '  vec3 gradCol = clamp(oklab_to_linear_rgb(oklch_to_oklab(blendedLch)), 0.0, 1.0);',
    '',
    '  vec3 oklchCol = oklchPalette(palT);',
    '  float isStop  = step(0.5, u_color_mode) * (1.0 - step(1.5, u_color_mode));',
    '  float isOklch = step(1.5, u_color_mode);',
    '  vec3 col = cosineCol;',
    '  col = mix(col, gradCol,   isStop);',
    '  col = mix(col, oklchCol,  isOklch);',
    '',
    '  // --- Edge fade to transparent ---',
    '  float fadeLeft  = smoothstep(leftEdge, leftEdge + u_fade_width, xTilted);',
    '  float fadeRight = 1.0 - smoothstep(rightEdge - u_fade_width, rightEdge, xTilted);',
    '  float baseAlpha = fadeLeft * fadeRight;',
    '',
    '  // --- Text overlay ---',
    '  // Aspect-correct the UV so glyphs appear undistorted on non-square canvases.',
    '  vec2  textAnchor    = vec2(u_text_x, u_text_y);',
    '  vec2  textDelta     = uv - textAnchor;',
    '  vec2  textUV        = vec2(textDelta.x * u_aspect, textDelta.y) + textAnchor;',
    '  vec4  texSample     = texture(u_text_tex, textUV);',
    '  float fillSample    = smoothstep(0.05, 0.6, texSample.r);',
    '  float outlineSample = smoothstep(0.05, 0.6, texSample.g);',
    '',
    '  vec3 invertedCol   = 1.0 - col;',
    '  vec3 baseTextColor = mix(col, invertedCol, u_invert_text);',
    '  vec3 textFillColor = mix(baseTextColor, u_text_color, u_use_text_color);',
    '',
    '  vec4 base        = vec4(col, baseAlpha);',
    '  vec4 withOutline = mix(base, vec4(u_outline_color, 1.0), outlineSample);',
    '  vec4 finalColor  = mix(withOutline, vec4(textFillColor, 1.0), fillSample);',
    '',
    '  float textAlpha  = min(fillSample + outlineSample, 1.0);',
    '  float finalAlpha = mix(baseAlpha, 1.0, textAlpha);',
    '  vec2 dUV = gl_FragCoord.xy / u_resolution;',
    '  float dist = clamp(length(dUV - 0.5) * 2.0, 0.0, 1.0);',
    '  float dn = distressNoise(dUV, u_distress_scale) * 0.67',
    '           + distressNoise(dUV, u_distress_scale * 2.73) * 0.33;',
    '  finalAlpha = finalAlpha * step(u_distress * dist, dn) * u_opacity;',
    '  // Linear -> sRGB to match Three.js renderer output',
    '  vec3 encoded = pow(finalColor.xyz, vec3(1.0 / 2.2));',
    '  fragColor = vec4(encoded * finalAlpha, finalAlpha);',
    '}'
  ].join('\n');

  window.ShaderBase.create({
    animateValues:  true,
    instantKeys:    ['u_opacity', 'u_distress', 'u_distress_scale'],
    fragSrc: fragSrc,

    setup: function (gl, program) {
      return {
        res:           gl.getUniformLocation(program, 'u_resolution'),
        aspect:        gl.getUniformLocation(program, 'u_aspect'),
        rowCount:      gl.getUniformLocation(program, 'u_row_count'),
        stagger:       gl.getUniformLocation(program, 'u_stagger'),
        fadeWidth:     gl.getUniformLocation(program, 'u_fade_width'),
        tiltTan:       gl.getUniformLocation(program, 'u_tilt_tan'),
        width:         gl.getUniformLocation(program, 'u_width'),
        offsetX:       gl.getUniformLocation(program, 'u_offset_x'),
        offsetY:       gl.getUniformLocation(program, 'u_offset_y'),
        rowOffset:     gl.getUniformLocation(program, 'u_row_offset'),
        useThresholds: gl.getUniformLocation(program, 'u_use_thresholds'),
        thresh0:       gl.getUniformLocation(program, 'u_thresh0'),
        thresh1:       gl.getUniformLocation(program, 'u_thresh1'),
        thresh2:       gl.getUniformLocation(program, 'u_thresh2'),
        thresh3:       gl.getUniformLocation(program, 'u_thresh3'),
        thresh4:       gl.getUniformLocation(program, 'u_thresh4'),
        palA:          gl.getUniformLocation(program, 'u_a'),
        palB:          gl.getUniformLocation(program, 'u_b'),
        palC:          gl.getUniformLocation(program, 'u_c'),
        palD:          gl.getUniformLocation(program, 'u_d'),
        colorMode:     gl.getUniformLocation(program, 'u_color_mode'),
        oklchA:        gl.getUniformLocation(program, 'u_oklch_a'),
        oklchB:        gl.getUniformLocation(program, 'u_oklch_b'),
        oklchC:        gl.getUniformLocation(program, 'u_oklch_c'),
        oklchD:        gl.getUniformLocation(program, 'u_oklch_d'),
        color0:        gl.getUniformLocation(program, 'u_color0'),
        color1:        gl.getUniformLocation(program, 'u_color1'),
        color2:        gl.getUniformLocation(program, 'u_color2'),
        color3:        gl.getUniformLocation(program, 'u_color3'),
        textTex:       gl.getUniformLocation(program, 'u_text_tex'),
        textX:         gl.getUniformLocation(program, 'u_text_x'),
        textY:         gl.getUniformLocation(program, 'u_text_y'),
        textColor:     gl.getUniformLocation(program, 'u_text_color'),
        useTextColor:  gl.getUniformLocation(program, 'u_use_text_color'),
        invertText:    gl.getUniformLocation(program, 'u_invert_text'),
        outlineColor:  gl.getUniformLocation(program, 'u_outline_color'),
        opacity:       gl.getUniformLocation(program, 'u_opacity'),
        distress:      gl.getUniformLocation(program, 'u_distress'),
        distressScale: gl.getUniformLocation(program, 'u_distress_scale'),
        // Internal threshold cache (not uniform locations)
        _thresholdData: new Float32Array(19).fill(1.0),
        _lastThreshKey: null,
      };
    },

    render: function (gl, u, v, w, h, t, textTex) {
      var rowCount     = v.u_row_count      != null ? v.u_row_count      : 8;
      var stagger      = v.u_stagger        != null ? v.u_stagger        : 0.25;
      var fadeWidth    = v.u_fade_width     != null ? v.u_fade_width     : 0.08;
      var tiltDeg      = v.u_tilt           != null ? v.u_tilt           : -5;
      var width        = v.u_width          != null ? v.u_width          : 0.5;
      var offsetX      = v.u_offset_x       != null ? v.u_offset_x       : 0.0;
      var offsetY      = v.u_offset_y       != null ? v.u_offset_y       : 0.0;
      var rowOffset    = v.u_row_offset     != null ? v.u_row_offset     : 1.0;
      var heightMode   = v.u_height_mode    || 'Golden Ratio';
      var noiseSeed    = v.u_noise_seed     != null ? v.u_noise_seed     : 0;
      var palA         = v.u_a              || [0.5, 0.5, 0.5];
      var palB         = v.u_b              || [0.5, 0.5, 0.5];
      var palC         = v.u_c              || [1.0, 1.0, 1.0];
      var palD         = v.u_d              || [0.0, 0.33, 0.67];
      var colorMode    = v.u_color_mode     != null ? parseFloat(v.u_color_mode) : 0.0;
      var DEG = Math.PI / 180;
      var oklchA = [
        v.u_oklch_aL != null ? v.u_oklch_aL : 0.70,
        v.u_oklch_aC != null ? v.u_oklch_aC : 0.25,
        (v.u_oklch_aH != null ? v.u_oklch_aH : 180) * DEG,
      ];
      var oklchB = [
        v.u_oklch_bL != null ? v.u_oklch_bL : 0.00,
        v.u_oklch_bC != null ? v.u_oklch_bC : 0.00,
        (v.u_oklch_bH != null ? v.u_oklch_bH : 180) * DEG,
      ];
      var oklchC = [
        v.u_oklch_cL != null ? v.u_oklch_cL : 0.5,
        v.u_oklch_cC != null ? v.u_oklch_cC : 0.5,
        v.u_oklch_cH != null ? v.u_oklch_cH : 0.5,
      ];
      var oklchD = [
        v.u_oklch_dL != null ? v.u_oklch_dL : 0.0,
        v.u_oklch_dC != null ? v.u_oklch_dC : 0.0,
        v.u_oklch_dH != null ? v.u_oklch_dH : 0.0,
      ];
      var color0       = v.u_color0         || [1.0, 0.2,  0.4];
      var color1       = v.u_color1         || [1.0, 0.8,  0.0];
      var color2       = v.u_color2         || [0.0, 0.8,  1.0];
      var color3       = v.u_color3         || [0.667, 0.0, 1.0];
      var textX        = v.textX            != null ? v.textX            : 0.5;
      var textY        = v.textY            != null ? v.textY            : 0.5;
      var textColor    = v.u_text_color     || [1.0, 1.0, 1.0];
      var useTextColor = v.u_use_text_color != null ? v.u_use_text_color : 0.0;
      var invertText   = v.u_invert_text    != null ? v.u_invert_text    : 1.0;
      var outlineColor = v.u_outline_color  || [0.0, 0.0, 0.0];

      var tiltTan       = Math.tan(tiltDeg * Math.PI / 180);
      var useThresholds = heightMode === 'Golden Ratio' ? 0.0 : 1.0;

      // Recompute threshold boundaries when mode, rowCount, or seed changes.
      var threshKey = rowCount + '|' + heightMode + '|' + noiseSeed;
      if (threshKey !== u._lastThreshKey) {
        var thresholds;
        if (heightMode === 'Fibonacci')           thresholds = computeFibThresholds(rowCount);
        else if (heightMode === 'Equal Temperament') thresholds = computeEqTempThresholds(rowCount);
        else if (heightMode === 'Sine')           thresholds = computeSineThresholds(rowCount);
        else if (heightMode === 'Noise')          thresholds = computeNoiseThresholds(rowCount, noiseSeed);
        else                                      thresholds = new Array(19).fill(1.0);
        for (var i = 0; i < 19; i++) u._thresholdData[i] = thresholds[i];
        u._lastThreshKey = threshKey;
      }

      var td = u._thresholdData;

      gl.uniform2f(u.res,           w, h);
      gl.uniform1f(u.aspect,        w / h);
      gl.uniform1f(u.rowCount,      rowCount);
      gl.uniform1f(u.stagger,       stagger);
      gl.uniform1f(u.fadeWidth,     fadeWidth);
      gl.uniform1f(u.tiltTan,       tiltTan);
      gl.uniform1f(u.width,         width);
      gl.uniform1f(u.offsetX,       offsetX);
      gl.uniform1f(u.offsetY,       offsetY);
      gl.uniform1f(u.rowOffset,     rowOffset);
      gl.uniform1f(u.useThresholds, useThresholds);
      gl.uniform4f(u.thresh0,       td[0],  td[1],  td[2],  td[3]);
      gl.uniform4f(u.thresh1,       td[4],  td[5],  td[6],  td[7]);
      gl.uniform4f(u.thresh2,       td[8],  td[9],  td[10], td[11]);
      gl.uniform4f(u.thresh3,       td[12], td[13], td[14], td[15]);
      gl.uniform4f(u.thresh4,       td[16], td[17], td[18], 1.0);
      gl.uniform3fv(u.palA,         palA);
      gl.uniform3fv(u.palB,         palB);
      gl.uniform3fv(u.palC,         palC);
      gl.uniform3fv(u.palD,         palD);
      gl.uniform1f(u.colorMode,     colorMode);
      gl.uniform3fv(u.oklchA,       oklchA);
      gl.uniform3fv(u.oklchB,       oklchB);
      gl.uniform3fv(u.oklchC,       oklchC);
      gl.uniform3fv(u.oklchD,       oklchD);
      gl.uniform3fv(u.color0,       color0);
      gl.uniform3fv(u.color1,       color1);
      gl.uniform3fv(u.color2,       color2);
      gl.uniform3fv(u.color3,       color3);
      gl.uniform1f(u.textX,         textX);
      gl.uniform1f(u.textY,         textY);
      gl.uniform3fv(u.textColor,    textColor);
      gl.uniform1f(u.useTextColor,  useTextColor);
      gl.uniform1f(u.invertText,    invertText);
      gl.uniform3fv(u.outlineColor, outlineColor);
      gl.uniform1f(u.opacity,       v.u_opacity        != null ? v.u_opacity        : 1.0);
      gl.uniform1f(u.distress,      v.u_distress       != null ? v.u_distress       : 0.0);
      gl.uniform1f(u.distressScale, v.u_distress_scale != null ? v.u_distress_scale : 80.0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, textTex);
      gl.uniform1i(u.textTex, 0);
    },

    drawText: function (ctx, size, v) {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, size, size);

      var txt = v.u_text_enabled ? (v.text || '') : '';
      if (txt) {
        var fontFamily = v.textFont ? '"' + v.textFont + '"' : '"Montserrat"';
        var fontSize   = v.textFontSize != null ? v.textFontSize : 180;
        var tx         = v.textX        != null ? v.textX        : 0.5;
        var ty         = v.textY        != null ? v.textY        : 0.5;
        var textRotDeg = v.u_text_rotation != null ? v.u_text_rotation : -90;
        var cx         = tx * size;
        var cy         = (1 - ty) * size;
        var rad        = textRotDeg * Math.PI / 180;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rad);
        ctx.font         = '700 ' + fontSize + 'px ' + fontFamily + ', monospace';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';

        if (v.outlineEnabled && v.outlineWidth > 0) {
          ctx.strokeStyle = 'rgb(0,255,0)';
          ctx.lineWidth   = (v.outlineWidth || 8) * 2;
          ctx.lineJoin    = 'round';
          ctx.strokeText(txt, 0, 0);
        }

        ctx.fillStyle = 'rgb(255,0,0)';
        ctx.fillText(txt, 0, 0);
        ctx.restore();
      }
    },

    textKey: function (v) {
      return JSON.stringify([
        v.u_text_enabled, v.text, v.textX, v.textY, v.textFontSize, v.textFont,
        v.u_text_rotation, v.outlineEnabled, v.outlineWidth,
      ]);
    },
  });
}());
