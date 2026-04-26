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
    'uniform float     u_vignette_top;',
    'uniform float     u_vignette_bottom;',
    'uniform float     u_vignette_left;',
    'uniform float     u_vignette_right;',
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
    'void main() {',
    '  vec2 uv = gl_FragCoord.xy / u_resolution;',
    '  uv = (uv - 0.5) / u_scale + 0.5 + vec2(u_pos_x, u_pos_y);',
    '',
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
    '  float aaCircle   = fwidth(circleSdf);',
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
    '  float aaTri     = fwidth(activeTri);',
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
    '  vec3  seg01  = mix(u_color0, u_color1, t01);',
    '  vec3  seg12  = mix(u_color1, u_color2, t12);',
    '  vec3  seg23  = mix(u_color2, u_color3, t23);',
    '  vec3  gradCol = mix(mix(seg01, seg12, step(1.0 / 3.0, palT)), seg23, step(2.0 / 3.0, palT));',
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
    '  // ── Distress + output ───────────────────────────────────────────────────',
    '  vec2  dUV = gl_FragCoord.xy / u_resolution;',
    '  float dm  = applyDistress(1.0, dUV, u_distress, u_distress_scale, u_grain_mode, u_distress_falloff);',
    '',
    '  float baseAlpha  = shapeMask * dm * u_opacity;',
    '  float wordAlpha  = clamp(wordFill + wordStroke, 0.0, 1.0) * dm * u_opacity;',
    '  float alpha      = max(baseAlpha, wordAlpha);',
    '  vec2  vigCoord = dUV - 0.5;',
    '  float vigL = max(0.0, -vigCoord.x);',
    '  float vigR = max(0.0,  vigCoord.x);',
    '  float vigB = max(0.0, -vigCoord.y);',
    '  float vigT = max(0.0,  vigCoord.y);',
    '  float vigVal = vigL*vigL*u_vignette_left + vigR*vigR*u_vignette_right',
    '               + vigB*vigB*u_vignette_bottom + vigT*vigT*u_vignette_top;',
    '  alpha = alpha * (1.0 - smoothstep(0.0, 1.0, vigVal));',
    '  vec3  encoded    = pow(max(finalColor, 0.0), vec3(1.0 / 2.2));',
    '  fragColor = vec4(encoded, alpha);',
    '}',
  ].join('\n');

  window.ShaderBase.create({
    animateValues:  true,
    instantKeys:    ['u_opacity', 'u_distress', 'u_distress_scale', 'u_grain_mode', 'u_distress_falloff', 'u_vignette_top', 'u_vignette_bottom', 'u_vignette_left', 'u_vignette_right'],
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
        posX:            gl.getUniformLocation(program, 'u_pos_x'),
        posY:          gl.getUniformLocation(program, 'u_pos_y'),
        scale:         gl.getUniformLocation(program, 'u_scale'),
        vignetteTop:    gl.getUniformLocation(program, 'u_vignette_top'),
        vignetteBottom: gl.getUniformLocation(program, 'u_vignette_bottom'),
        vignetteLeft:   gl.getUniformLocation(program, 'u_vignette_left'),
        vignetteRight:  gl.getUniformLocation(program, 'u_vignette_right'),
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
      gl.uniform1f(u.distress,         v.u_distress         != null ? v.u_distress         : 0.0);
      gl.uniform1f(u.distressScale,    v.u_distress_scale   != null ? v.u_distress_scale   : 80.0);
      gl.uniform1f(u.grainMode,        v.u_grain_mode       != null ? parseFloat(v.u_grain_mode) : 0.0);
      gl.uniform1f(u.distressFalloff,  v.u_distress_falloff != null ? v.u_distress_falloff : 0.0);
      gl.uniform1f(u.posX,             v.u_pos_x            != null ? v.u_pos_x            : 0.0);
      gl.uniform1f(u.posY,          v.u_pos_y          != null ? v.u_pos_y          : 0.0);
      gl.uniform1f(u.scale,         v.u_scale          != null ? v.u_scale          : 1.0);
      gl.uniform1f(u.vignetteTop,    v.u_vignette_top    != null ? v.u_vignette_top    : 0.0);
      gl.uniform1f(u.vignetteBottom, v.u_vignette_bottom != null ? v.u_vignette_bottom : 0.0);
      gl.uniform1f(u.vignetteLeft,   v.u_vignette_left   != null ? v.u_vignette_left   : 0.0);
      gl.uniform1f(u.vignetteRight,  v.u_vignette_right  != null ? v.u_vignette_right  : 0.0);
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
