(function () {
  'use strict';

  // FourCircles — 2×2 grid of circles with triangular cutouts (pinwheel),
  // cosine/4-stop/per-quadrant palette, word overlay, and per-quadrant rotation.

  var fragSrc = [
    '#version 300 es',
    'precision mediump float;',
    '',
    'uniform vec2      u_resolution;',
    'uniform float     u_aspect;',
    'uniform float     u_circle_size;',
    'uniform float     u_tri_size;',
    'uniform float     u_tri_angle;',
    'uniform float     u_tri_apex;',
    'uniform float     u_offset_x;',
    'uniform float     u_offset_y;',
    'uniform float     u_rot1;',
    'uniform float     u_rot2;',
    'uniform float     u_rot3;',
    'uniform float     u_rot4;',
    'uniform float     u_global_grad;',
    'uniform vec3      u_a;',
    'uniform vec3      u_b;',
    'uniform vec3      u_c;',
    'uniform vec3      u_d;',
    'uniform float     u_color_mode;',
    'uniform vec3      u_color0;',
    'uniform vec3      u_color1;',
    'uniform vec3      u_color2;',
    'uniform vec3      u_color3;',
    'uniform vec3      u_quad0;',
    'uniform vec3      u_quad1;',
    'uniform vec3      u_quad2;',
    'uniform vec3      u_quad3;',
    'uniform sampler2D u_word_texture;',
    'uniform float     u_word_x;',
    'uniform float     u_word_y;',
    'uniform vec3      u_text_color;',
    'uniform float     u_use_text_color;',
    'uniform vec3      u_outline_color;',
    'uniform float     u_opacity;',
    'uniform float     u_distress;',
    'uniform float     u_distress_scale;',
    'uniform float     u_grain_mode;',
    'uniform float     u_distress_falloff;',
    'uniform float     u_pos_x;',
    'uniform float     u_pos_y;',
    'uniform float     u_scale;',
    '',
    'out vec4 fragColor;',
    '',
    'vec2 rotate2d(vec2 p, float a) {',
    '  return vec2(p.x * cos(a) - p.y * sin(a), p.x * sin(a) + p.y * cos(a));',
    '}',
    '',
    '// IQ isosceles triangle SDF: apex at origin, base at y = q.y, half-base-width = q.x.',
    'float sdIsosceles(vec2 p_in, vec2 q) {',
    '  vec2  p = vec2(abs(p_in.x), p_in.y);',
    '  vec2  a = p - q * clamp(dot(p, q) / dot(q, q), 0.0, 1.0);',
    '  vec2  b = p - q * vec2(clamp(p.x / q.x, 0.0, 1.0), 1.0);',
    '  float s = -sign(q.y);',
    '  vec2  d = min(',
    '    vec2(dot(a, a), s * (p.x * q.y - p.y * q.x)),',
    '    vec2(dot(b, b), s * (p.y - q.y))',
    '  );',
    '  return -sqrt(d.x) * sign(d.y);',
    '}',
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
    '// Evaluates the design color + alpha at any uv (post pos/scale transform).',
    '// aaFixed: 0.0 for the per-fragment path (fwidth-based AA); a small fixed',
    '// half-width when sampling at halftone cell positions.',
    'vec4 designEval(vec2 uv, float aaFixed) {',
    '  // Quadrant indices: cellX/Y ∈ {0, 1}',
    '  float cellX   = floor(uv.x * 2.0);',
    '  float cellY   = floor(uv.y * 2.0);',
    '  vec2  localUV = fract(uv * 2.0);',
    '',
    '  float isRight = step(0.5, cellX);   // 1 = right half',
    '  float isTop   = step(0.5, cellY);   // 1 = top half (WebGL y=0 is bottom)',
    '',
    '  // Aspect-corrected local point centred at (0, 0)',
    '  vec2 localP = vec2((localUV.x - 0.5) * u_aspect, localUV.y - 0.5);',
    '',
    '  // Per-quadrant shift toward/away from image centre',
    '  vec2 shiftedP = localP + vec2(',
    '    mix(u_offset_x, -u_offset_x, isRight),',
    '    mix(u_offset_y, -u_offset_y, isTop)',
    '  );',
    '',
    '  // Per-quadrant rotation',
    '  float activeRot = mix(',
    '    mix(u_rot3, u_rot4, isRight),',
    '    mix(u_rot1, u_rot2, isRight),',
    '    isTop',
    '  );',
    '  vec2 rotatedP = rotate2d(shiftedP, activeRot);',
    '',
    '  // ── Circle SDF ──────────────────────────────────────────────────────────',
    '  float circleSdf  = length(rotatedP) - u_circle_size;',
    '  float aaCircle   = max(fwidth(circleSdf), aaFixed);',
    '  float circleMask = 1.0 - smoothstep(-aaCircle, aaCircle, circleSdf);',
    '',
    '  // ── Pinwheel triangle SDFs ──────────────────────────────────────────────',
    '  // Extra per-triangle rotation applied on top of the per-quadrant rotation.',
    '  vec2 triP = rotate2d(rotatedP, u_tri_angle);',
    '',
    '  // Rotating the input point by θ rotates the shape by −θ.',
    '  //   top-left  → pointing right: p\' = (−y,  x)',
    '  //   top-right → pointing down:  p\' = (−x, −y)',
    '  //   bot-left  → pointing up:    p\' = ( x,  y)  (no rotation)',
    '  //   bot-right → pointing left:  p\' = ( y, −x)',
    '  vec2 pForRight = vec2(-triP.y,  triP.x);',
    '  vec2 pForDown  = vec2(-triP.x, -triP.y);',
    '  vec2 pForUp    = triP;',
    '  vec2 pForLeft  = vec2( triP.y, -triP.x);',
    '',
    '  float triHalfWidth = u_tri_size * tan(u_tri_apex * 0.5);',
    '  vec2  triQ         = vec2(triHalfWidth, u_tri_size);',
    '',
    '  float triRight = sdIsosceles(pForRight, triQ);',
    '  float triDown  = sdIsosceles(pForDown,  triQ);',
    '  float triUp    = sdIsosceles(pForUp,    triQ);',
    '  float triLeft  = sdIsosceles(pForLeft,  triQ);',
    '',
    '  // Select by quadrant: top-left=right, top-right=down, bot-left=up, bot-right=left',
    '  float activeTri = mix(',
    '    mix(triUp,    triLeft, isRight),',
    '    mix(triRight, triDown, isRight),',
    '    isTop',
    '  );',
    '',
    '  float aaTri     = max(fwidth(activeTri), aaFixed);',
    '  float triCutout = 1.0 - smoothstep(-aaTri, aaTri, activeTri);',
    '',
    '  float shapeMask = circleMask * (1.0 - triCutout);',
    '',
    '  // ── Colour ──────────────────────────────────────────────────────────────',
    '  float palT      = mix(localUV.x, uv.x, u_global_grad);',
    '  vec3  cosineCol = cosinePalette(palT, u_a, u_b, u_c, u_d);',
    '',
    '  float t01    = clamp(palT * 3.0, 0.0, 1.0);',
    '  float t12    = clamp((palT - 1.0 / 3.0) * 3.0, 0.0, 1.0);',
    '  float t23    = clamp((palT - 2.0 / 3.0) * 3.0, 0.0, 1.0);',
    '  vec3  lch0   = oklab_to_oklch(linear_rgb_to_oklab(u_color0));',
    '  vec3  lch1   = oklab_to_oklch(linear_rgb_to_oklab(u_color1));',
    '  vec3  lch2   = oklab_to_oklch(linear_rgb_to_oklab(u_color2));',
    '  vec3  lch3   = oklab_to_oklch(linear_rgb_to_oklab(u_color3));',
    '  vec3  seg01  = mix_oklch(lch0, lch1, t01);',
    '  vec3  seg12  = mix_oklch(lch1, lch2, t12);',
    '  vec3  seg23  = mix_oklch(lch2, lch3, t23);',
    '  vec3  blendedLch = mix(mix(seg01, seg12, step(1.0 / 3.0, palT)), seg23, step(2.0 / 3.0, palT));',
    '  vec3  gradCol = clamp(oklab_to_linear_rgb(oklch_to_oklab(blendedLch)), 0.0, 1.0);',
    '',
    '  vec3 perQuadCol = mix(mix(u_quad2, u_quad3, isRight), mix(u_quad0, u_quad1, isRight), isTop);',
    '  vec3 col = mix(',
    '    mix(cosineCol, gradCol, step(0.5, u_color_mode)),',
    '    perQuadCol,',
    '    step(1.5, u_color_mode)',
    '  );',
    '  vec3 layerColor = col;',
    '',
    '  // ── Word overlay ─────────────────────────────────────────────────────────',
    '  vec2 wordAnchor  = vec2(u_word_x, u_word_y);',
    '  vec2 wordDelta   = uv - wordAnchor;',
    '  vec2 wordUV      = vec2(wordDelta.x * u_aspect, wordDelta.y) + wordAnchor;',
    '  vec4 wordSample  = texture(u_word_texture, wordUV);',
    '  float wordFill   = smoothstep(0.05, 0.6, wordSample.r);',
    '  float wordStroke = smoothstep(0.05, 0.6, wordSample.g);',
    '  vec3 wordFillCol = mix(col, u_text_color, u_use_text_color);',
    '  vec3 finalColor  = mix(mix(layerColor, u_outline_color, wordStroke), wordFillCol, wordFill);',
    '',
    '  float wordA = clamp(wordFill + wordStroke, 0.0, 1.0);',
    '  return vec4(finalColor, max(shapeMask, wordA));',
    '}',
    '',
    'void main() {',
    '  vec2 uv = gl_FragCoord.xy / u_resolution;',
    '  uv = (uv - 0.5) / u_scale + 0.5 + vec2(u_pos_x, u_pos_y);',
    '  vec4 px = designEval(uv, 0.0);',
    '  vec3 finalColor = px.rgb;',
    '  vec2  dUV = gl_FragCoord.xy / u_resolution;',
    '  float vigMask = computeVigMask(dUV);',
    '  float alpha;',
    '  if (u_grain_mode >= 3.5) {',
    '    // Half-tone: size each dot by design coverage over its cell (3x3',
    '    // supersample) so dots shrink toward circle/triangle/word edges',
    '    // instead of slicing.',
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
    '    float dm = applyDistress(1.0, dUV, u_distress, u_distress_scale, u_grain_mode, u_distress_falloff, dot(finalColor, vec3(0.299, 0.587, 0.114)), vigMask);',
    '    alpha = px.a * dm * u_opacity;',
    '  }',
    '  vec3  encoded    = pow(max(finalColor, 0.0), vec3(1.0 / 2.2));',
    '  fragColor = vec4(encoded * alpha, alpha);',
    '}',
  ].join('\n');

  window.ShaderBase.create({
    animateValues:  true,
    instantKeys:    ['u_opacity', 'u_distress_0', 'u_distress_scale_0', 'u_distress_1', 'u_distress_scale_1', 'u_distress_2', 'u_distress_scale_2', 'u_distress_3', 'u_distress_scale_3', 'u_grain_mode', 'u_distress_falloff', 'u_vignette_top', 'u_vignette_bottom', 'u_vignette_left', 'u_vignette_right', 'u_vignette_anchor_x', 'u_vignette_anchor_y'],
    fragSrc: fragSrc,

    setup: function (gl, program) {
      return {
        res:          gl.getUniformLocation(program, 'u_resolution'),
        aspect:       gl.getUniformLocation(program, 'u_aspect'),
        circleSize:   gl.getUniformLocation(program, 'u_circle_size'),
        triSize:      gl.getUniformLocation(program, 'u_tri_size'),
        triAngle:     gl.getUniformLocation(program, 'u_tri_angle'),
        triApex:      gl.getUniformLocation(program, 'u_tri_apex'),
        offsetX:      gl.getUniformLocation(program, 'u_offset_x'),
        offsetY:      gl.getUniformLocation(program, 'u_offset_y'),
        rot1:         gl.getUniformLocation(program, 'u_rot1'),
        rot2:         gl.getUniformLocation(program, 'u_rot2'),
        rot3:         gl.getUniformLocation(program, 'u_rot3'),
        rot4:         gl.getUniformLocation(program, 'u_rot4'),
        globalGrad:   gl.getUniformLocation(program, 'u_global_grad'),
        palA:         gl.getUniformLocation(program, 'u_a'),
        palB:         gl.getUniformLocation(program, 'u_b'),
        palC:         gl.getUniformLocation(program, 'u_c'),
        palD:         gl.getUniformLocation(program, 'u_d'),
        colorMode:    gl.getUniformLocation(program, 'u_color_mode'),
        color0:       gl.getUniformLocation(program, 'u_color0'),
        color1:       gl.getUniformLocation(program, 'u_color1'),
        color2:       gl.getUniformLocation(program, 'u_color2'),
        color3:       gl.getUniformLocation(program, 'u_color3'),
        quad0:        gl.getUniformLocation(program, 'u_quad0'),
        quad1:        gl.getUniformLocation(program, 'u_quad1'),
        quad2:        gl.getUniformLocation(program, 'u_quad2'),
        quad3:        gl.getUniformLocation(program, 'u_quad3'),
        wordTex:      gl.getUniformLocation(program, 'u_word_texture'),
        wordX:        gl.getUniformLocation(program, 'u_word_x'),
        wordY:        gl.getUniformLocation(program, 'u_word_y'),
        textColor:    gl.getUniformLocation(program, 'u_text_color'),
        useTextColor: gl.getUniformLocation(program, 'u_use_text_color'),
        outlineColor: gl.getUniformLocation(program, 'u_outline_color'),
        opacity:       gl.getUniformLocation(program, 'u_opacity'),
        distress:        gl.getUniformLocation(program, 'u_distress'),
        distressScale:   gl.getUniformLocation(program, 'u_distress_scale'),
        grainMode:       gl.getUniformLocation(program, 'u_grain_mode'),
        distressFalloff: gl.getUniformLocation(program, 'u_distress_falloff'),
        halftoneAngle:   gl.getUniformLocation(program, 'u_halftone_angle'),
        halftoneLuma:    gl.getUniformLocation(program, 'u_halftone_luma'),
        posX:            gl.getUniformLocation(program, 'u_pos_x'),
        posY:          gl.getUniformLocation(program, 'u_pos_y'),
        scale:         gl.getUniformLocation(program, 'u_scale'),
        vignetteTop:    gl.getUniformLocation(program, 'u_vignette_top'),
        vignetteBottom: gl.getUniformLocation(program, 'u_vignette_bottom'),
        vignetteLeft:   gl.getUniformLocation(program, 'u_vignette_left'),
        vignetteRight:  gl.getUniformLocation(program, 'u_vignette_right'),
        vignetteAnchorX:     gl.getUniformLocation(program, 'u_vignette_anchor_x'),
        vignetteAnchorY:     gl.getUniformLocation(program, 'u_vignette_anchor_y'),
      };
    },

    render: function (gl, u, v, w, h, t, textTex) {
      var DEG = Math.PI / 180;

      var circleSize   = v.u_circle_size   != null ? v.u_circle_size   : 0.42;
      var triSize      = v.u_tri_size      != null ? v.u_tri_size      : 0.22;
      var triAngle     = (v.u_tri_angle    != null ? v.u_tri_angle    : 0)    * DEG;
      var triApex      = (v.u_tri_apex     != null ? v.u_tri_apex     : 90)   * DEG;
      var offsetX      = v.u_offset_x      != null ? v.u_offset_x      : 0.0;
      var offsetY      = v.u_offset_y      != null ? v.u_offset_y      : 0.0;
      var rot1         = (v.u_rot1         != null ? v.u_rot1         : 0)    * DEG;
      var rot2         = (v.u_rot2         != null ? v.u_rot2         : 0)    * DEG;
      var rot3         = (v.u_rot3         != null ? v.u_rot3         : 0)    * DEG;
      var rot4         = (v.u_rot4         != null ? v.u_rot4         : 0)    * DEG;
      var globalGrad   = v.u_global_grad   != null ? v.u_global_grad   : 0.0;
      var palA         = v.u_a             || [0.5, 0.5, 0.5];
      var palB         = v.u_b             || [0.5, 0.5, 0.5];
      var palC         = v.u_c             || [1.0, 1.0, 1.0];
      var palD         = v.u_d             || [0.0, 0.33, 0.67];
      var colorMode    = parseFloat(v.u_color_mode != null ? v.u_color_mode : 0);
      var color0       = v.u_color0        || [1.0, 0.2,   0.4];
      var color1       = v.u_color1        || [1.0, 0.8,   0.0];
      var color2       = v.u_color2        || [0.0, 0.8,   1.0];
      var color3       = v.u_color3        || [0.667, 0.0, 1.0];
      var quad0        = v.u_quad0         || [1.0,  0.08, 0.58];
      var quad1        = v.u_quad1         || [0.0,  0.45, 1.0 ];
      var quad2        = v.u_quad2         || [0.0,  0.90, 0.40];
      var quad3        = v.u_quad3         || [1.0,  0.55, 0.0 ];
      var aspect       = h > 0 ? w / h : 1.0;

      gl.uniform2f(u.res,          w, h);
      gl.uniform1f(u.aspect,       aspect);
      gl.uniform1f(u.circleSize,   circleSize);
      gl.uniform1f(u.triSize,      triSize);
      gl.uniform1f(u.triAngle,     triAngle);
      gl.uniform1f(u.triApex,      triApex);
      gl.uniform1f(u.offsetX,      offsetX);
      gl.uniform1f(u.offsetY,      offsetY);
      gl.uniform1f(u.rot1,         rot1);
      gl.uniform1f(u.rot2,         rot2);
      gl.uniform1f(u.rot3,         rot3);
      gl.uniform1f(u.rot4,         rot4);
      gl.uniform1f(u.globalGrad,   globalGrad);
      gl.uniform3fv(u.palA,        palA);
      gl.uniform3fv(u.palB,        palB);
      gl.uniform3fv(u.palC,        palC);
      gl.uniform3fv(u.palD,        palD);
      gl.uniform1f(u.colorMode,    colorMode);
      gl.uniform3fv(u.color0,      color0);
      gl.uniform3fv(u.color1,      color1);
      gl.uniform3fv(u.color2,      color2);
      gl.uniform3fv(u.color3,      color3);
      gl.uniform3fv(u.quad0,       quad0);
      gl.uniform3fv(u.quad1,       quad1);
      gl.uniform3fv(u.quad2,       quad2);
      gl.uniform3fv(u.quad3,       quad3);
      gl.uniform1f(u.wordX,        v.textX          != null ? v.textX          : 0.5);
      gl.uniform1f(u.wordY,        v.textY          != null ? v.textY          : 0.5);
      gl.uniform3fv(u.textColor,   v.u_text_color   || [1.0, 1.0, 1.0]);
      gl.uniform1f(u.useTextColor, v.u_use_text_color != null ? v.u_use_text_color : 0.0);
      gl.uniform3fv(u.outlineColor, v.u_outline_color || [0.0, 0.0, 0.0]);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, textTex);
      gl.uniform1i(u.wordTex, 0);
      gl.uniform1f(u.opacity,       v.u_opacity        != null ? v.u_opacity        : 1.0);
      var _gm = Math.round(v.u_grain_mode != null ? parseFloat(v.u_grain_mode) : 0);
      gl.uniform1f(u.distress,      v['u_distress_' + _gm]       != null ? v['u_distress_' + _gm]       : (v.u_distress       != null ? v.u_distress       : 0.0));
      gl.uniform1f(u.distressScale, v['u_distress_scale_' + _gm] != null ? v['u_distress_scale_' + _gm] : (v.u_distress_scale != null ? v.u_distress_scale : 80.0));
      gl.uniform1f(u.grainMode,        v.u_grain_mode       != null ? parseFloat(v.u_grain_mode) : 0.0);
      gl.uniform1f(u.distressFalloff,  v.u_distress_falloff != null ? v.u_distress_falloff : 0.0);
      gl.uniform1f(u.halftoneAngle, (v.u_halftone_angle != null ? v.u_halftone_angle : 45.0) * Math.PI / 180.0);
      gl.uniform1f(u.halftoneLuma,  v.u_halftone_luma  != null ? v.u_halftone_luma  : 0.0);
      gl.uniform1f(u.posX,             v.u_pos_x            != null ? v.u_pos_x            : 0.0);
      gl.uniform1f(u.posY,          v.u_pos_y          != null ? v.u_pos_y          : 0.0);
      gl.uniform1f(u.scale,         v.u_scale          != null ? v.u_scale          : 1.0);
      gl.uniform1f(u.vignetteTop,    v.u_vignette_top    != null ? v.u_vignette_top    : 0.0);
      gl.uniform1f(u.vignetteBottom, v.u_vignette_bottom != null ? v.u_vignette_bottom : 0.0);
      gl.uniform1f(u.vignetteLeft,   v.u_vignette_left   != null ? v.u_vignette_left   : 0.0);
      gl.uniform1f(u.vignetteRight,  v.u_vignette_right  != null ? v.u_vignette_right  : 0.0);
      gl.uniform1f(u.vignetteAnchorX, v.u_vignette_anchor_x != null ? v.u_vignette_anchor_x : 0.5);
      gl.uniform1f(u.vignetteAnchorY, v.u_vignette_anchor_y != null ? v.u_vignette_anchor_y : 0.5);
    },

    drawText: function (ctx, size, v) {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, size, size);
      var txt = (v.u_text_enabled && v.text) ? v.text : '';
      if (txt) {
        var fontFamily = v.textFont ? '"' + v.textFont + '"' : '"Montserrat"';
        var fontSize   = v.textFontSize || 200;
        var cx         = (v.textX != null ? v.textX : 0.5) * size;
        var cy         = (1 - (v.textY != null ? v.textY : 0.5)) * size;
        ctx.font         = 'bold ' + fontSize + 'px ' + fontFamily + ', monospace';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        if (v.outlineEnabled && v.outlineWidth > 0) {
          ctx.strokeStyle = 'rgb(0,255,0)';
          ctx.lineWidth   = (v.outlineWidth || 8) * 2;
          ctx.lineJoin    = 'round';
          ctx.strokeText(txt, cx, cy);
        }
        ctx.fillStyle = 'rgb(255,0,0)';
        ctx.fillText(txt, cx, cy);
      }
    },

    textKey: function (v) {
      return JSON.stringify([v.u_text_enabled, v.text, v.textX, v.textY, v.textFontSize, v.textFont,
                             v.outlineEnabled, v.outlineWidth, v.u_outline_color]);
    },
  });
}());
