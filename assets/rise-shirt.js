(function () {
  'use strict';

  // RiseShirt dot-halftone port — faithful to the Three.js TSL original
  var fragSrc = [
    '#version 300 es',
    'precision mediump float;',
    'uniform float u_time;',
    'uniform vec2  u_resolution;',
    'uniform float u_rows;',
    'uniform float u_cols;',
    'uniform float u_min_radius;',
    'uniform float u_max_radius;',
    'uniform float u_invert;',
    'uniform vec3  u_bg_color;',
    'uniform float u_top_margin;',
    'uniform float u_ratio;',
    'uniform sampler2D u_text_texture;',
    'uniform float u_text_grid_cols;',
    'uniform float u_text_grid_rows;',
    'uniform float u_text_blend;',
    'uniform float u_text_radius;',
    'uniform float u_text_ratio;',
    'uniform vec3  u_text_bg_color;',
    'uniform vec3  u_a;',
    'uniform vec3  u_b;',
    'uniform vec3  u_c;',
    'uniform vec3  u_d;',
    'uniform float u_color_mode;',
    'uniform float u_invert_text;',
    'uniform float u_opacity;',
    'uniform float u_distress;',
    'uniform float u_distress_scale;',
    'uniform float u_grain_mode;',
    'uniform float u_distress_falloff;',
    'uniform float u_pos_x;',
    'uniform float u_pos_y;',
    'uniform float u_scale;',
    'uniform vec3  u_color0;',
    'uniform vec3  u_color1;',
    'uniform vec3  u_color2;',
    'uniform vec3  u_color3;',
    'uniform vec3  u_oklch_a;',
    'uniform vec3  u_oklch_b;',
    'uniform vec3  u_oklch_c;',
    'uniform vec3  u_oklch_d;',
    '',
    'out vec4 fragColor;',
    '',
    window.ShaderBase.commonGLSL,
    '',
    '// ── OKLCH color space helpers ─────────────────────────────────────────────',
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
    'vec3 oklchPalette(float t) {',
    '  vec3 lch = u_oklch_a + u_oklch_b * cos(6.28318 * (u_oklch_c * t + u_oklch_d));',
    '  lch.x = clamp(lch.x, 0.0, 1.0);',
    '  lch.y = max(lch.y, 0.0);',
    '  return clamp(oklab_to_linear_rgb(oklch_to_oklab(lch)), 0.0, 1.0);',
    '}',
    '',
    '// Evaluate the active palette at t (shared by main and text dot grids).',
    'vec3 paletteAt(float t) {',
    '  float t01 = clamp(t * 3.0, 0.0, 1.0);',
    '  float t12 = clamp((t - 0.33333) * 3.0, 0.0, 1.0);',
    '  float t23 = clamp((t - 0.66667) * 3.0, 0.0, 1.0);',
    '  vec3 lch0 = oklab_to_oklch(linear_rgb_to_oklab(u_color0));',
    '  vec3 lch1 = oklab_to_oklch(linear_rgb_to_oklab(u_color1));',
    '  vec3 lch2 = oklab_to_oklch(linear_rgb_to_oklab(u_color2));',
    '  vec3 lch3 = oklab_to_oklch(linear_rgb_to_oklab(u_color3));',
    '  vec3 seg01   = mix_oklch(lch0, lch1, t01);',
    '  vec3 seg12   = mix_oklch(lch1, lch2, t12);',
    '  vec3 seg23   = mix_oklch(lch2, lch3, t23);',
    '  vec3 blended = mix(mix(seg01, seg12, step(0.33333, t)), seg23, step(0.66667, t));',
    '  vec3 stopCol = oklab_to_linear_rgb(oklch_to_oklab(blended));',
    '  float isStop  = step(0.5, u_color_mode) * (1.0 - step(1.5, u_color_mode));',
    '  float isOklch = step(1.5, u_color_mode);',
    '  vec3 col = cosinePalette(t, u_a, u_b, u_c, u_d);',
    '  col = mix(col, stopCol,        isStop);',
    '  col = mix(col, oklchPalette(t), isOklch);',
    '  return col;',
    '}',
    '',
    'void main() {',
    '  vec2 uv = gl_FragCoord.xy / u_resolution;',
    '  uv = (uv - 0.5) / u_scale + 0.5 + vec2(u_pos_x, u_pos_y);',
    '  float inDesign = step(0.0, uv.x) * (1.0 - step(1.0, uv.x)) * step(0.0, uv.y) * (1.0 - step(1.0, uv.y));',
    '',
    '  // Top margin — area above marginThreshold is collar / text zone',
    '  float marginThreshold = 1.0 - u_top_margin;',
    '  float inMargin        = step(marginThreshold, uv.y);',
    '',
    '  // Remap Y so the full gradient spans only the design area',
    '  float remappedY = clamp(uv.y / max(marginThreshold, 0.001), 0.0, 1.0);',
    '',
    '  // ── Main dot grid ─────────────────────────────────────────────────────',
    '  vec2  gridUv    = vec2(uv.x, remappedY) * vec2(u_cols, u_rows);',
    '  vec2  localUv   = fract(gridUv) - 0.5;',
    '  vec2  corrected = vec2(localUv.x * u_ratio, localUv.y);',
    '  float dist      = length(corrected);',
    '',
    '  float effectiveMax = u_max_radius * u_ratio;',
    '  float mixFactor    = mix(remappedY, 1.0 - remappedY, u_invert);',
    '  float radius       = mix(effectiveMax, u_min_radius, mixFactor);',
    '',
    '  float eps      = 0.005;',
    '  float mainMask = 1.0 - smoothstep(radius - eps, radius + eps, dist);',
    '',
    '  vec3 dotRaw      = paletteAt(mixFactor);',
    '  vec3 invertedPal = 1.0 - dotRaw;',
    '  vec3 activePal   = mix(dotRaw, invertedPal, u_invert_text);',
    '  vec3 mainColor   = mix(u_bg_color, activePal, mainMask);',
    '',
    '  // ── Text dot grid (margin area) ───────────────────────────────────────',
    '  vec2  tGridUv    = uv * vec2(u_text_grid_cols, u_text_grid_rows);',
    '  vec2  tLocalUv   = fract(tGridUv) - 0.5;',
    '  vec2  tCorrected = vec2(tLocalUv.x * u_text_ratio, tLocalUv.y);',
    '  float tDist      = length(tCorrected);',
    '  vec2  tCellIdx   = floor(tGridUv);',
    '  vec2  tCenterUv  = (tCellIdx + 0.5) / vec2(u_text_grid_cols, u_text_grid_rows);',
    '  float tSample    = texture(u_text_texture, tCenterUv).r;',
    '',
    '  float circleMask    = 1.0 - smoothstep(u_text_radius - eps, u_text_radius + eps, tDist);',
    '  float textMask      = circleMask * tSample * u_text_blend;',
    '  float textMixFactor = mix(tCenterUv.y, 1.0 - tCenterUv.y, u_invert);',
    '',
    '  vec3 textRaw         = paletteAt(textMixFactor);',
    '  vec3 invertedTextPal = 1.0 - textRaw;',
    '  vec3 activeTextPal   = mix(textRaw, invertedTextPal, u_invert_text);',
    '  vec3 marginColor     = mix(u_text_bg_color, activeTextPal, textMask);',
    '',
    '  float alpha = mix(mainMask, textMask, inMargin);',
    '  vec3 finalCol  = mix(mainColor, marginColor, inMargin);',
    '  vec2 dUV = gl_FragCoord.xy / u_resolution;',
    '  float vigMask = computeVigMask(dUV);',
    '  alpha = applyDistress(alpha, dUV, u_distress, u_distress_scale, u_grain_mode, u_distress_falloff, dot(finalCol, vec3(0.299, 0.587, 0.114)), vigMask) * u_opacity;',
    '  finalCol = finalCol * vigMask;',
    '  alpha = alpha * vigMask;',
    '  vec3 encoded   = pow(max(finalCol, 0.0), vec3(1.0 / 2.2));',
    '  fragColor      = vec4(encoded * alpha * inDesign, alpha * inDesign);',
    '}'
  ].join('\n');

  window.ShaderBase.create({
    animateValues:  true,
    instantKeys:    ['u_opacity', 'u_distress_0', 'u_distress_scale_0', 'u_distress_1', 'u_distress_scale_1', 'u_distress_2', 'u_distress_scale_2', 'u_distress_3', 'u_distress_scale_3', 'u_grain_mode', 'u_distress_falloff', 'u_vignette_top', 'u_vignette_bottom', 'u_vignette_left', 'u_vignette_right', 'u_vignette_anchor_x', 'u_vignette_anchor_y'],
    fragSrc: fragSrc,

    setup: function (gl, program) {
      return {
        time:         gl.getUniformLocation(program, 'u_time'),
        res:          gl.getUniformLocation(program, 'u_resolution'),
        rows:         gl.getUniformLocation(program, 'u_rows'),
        cols:         gl.getUniformLocation(program, 'u_cols'),
        minRadius:    gl.getUniformLocation(program, 'u_min_radius'),
        maxRadius:    gl.getUniformLocation(program, 'u_max_radius'),
        invert:       gl.getUniformLocation(program, 'u_invert'),
        bgColor:      gl.getUniformLocation(program, 'u_bg_color'),
        topMargin:    gl.getUniformLocation(program, 'u_top_margin'),
        ratio:        gl.getUniformLocation(program, 'u_ratio'),
        textTex:      gl.getUniformLocation(program, 'u_text_texture'),
        textGridCols: gl.getUniformLocation(program, 'u_text_grid_cols'),
        textGridRows: gl.getUniformLocation(program, 'u_text_grid_rows'),
        textBlend:    gl.getUniformLocation(program, 'u_text_blend'),
        textRadius:   gl.getUniformLocation(program, 'u_text_radius'),
        textRatio:    gl.getUniformLocation(program, 'u_text_ratio'),
        textBgColor:  gl.getUniformLocation(program, 'u_text_bg_color'),
        palA:         gl.getUniformLocation(program, 'u_a'),
        palB:         gl.getUniformLocation(program, 'u_b'),
        palC:         gl.getUniformLocation(program, 'u_c'),
        palD:         gl.getUniformLocation(program, 'u_d'),
        colorMode:    gl.getUniformLocation(program, 'u_color_mode'),
        invertText:   gl.getUniformLocation(program, 'u_invert_text'),
        opacity:       gl.getUniformLocation(program, 'u_opacity'),
        distress:        gl.getUniformLocation(program, 'u_distress'),
        distressScale:   gl.getUniformLocation(program, 'u_distress_scale'),
        grainMode:       gl.getUniformLocation(program, 'u_grain_mode'),
        distressFalloff: gl.getUniformLocation(program, 'u_distress_falloff'),
        halftoneAngle:   gl.getUniformLocation(program, 'u_halftone_angle'),
        halftoneLuma:    gl.getUniformLocation(program, 'u_halftone_luma'),
        posX:            gl.getUniformLocation(program, 'u_pos_x'),
        posY:         gl.getUniformLocation(program, 'u_pos_y'),
        scale:        gl.getUniformLocation(program, 'u_scale'),
        vignetteTop:    gl.getUniformLocation(program, 'u_vignette_top'),
        vignetteBottom: gl.getUniformLocation(program, 'u_vignette_bottom'),
        vignetteLeft:   gl.getUniformLocation(program, 'u_vignette_left'),
        vignetteRight:  gl.getUniformLocation(program, 'u_vignette_right'),
        vignetteAnchorX:     gl.getUniformLocation(program, 'u_vignette_anchor_x'),
        vignetteAnchorY:     gl.getUniformLocation(program, 'u_vignette_anchor_y'),
        color0:       gl.getUniformLocation(program, 'u_color0'),
        color1:       gl.getUniformLocation(program, 'u_color1'),
        color2:       gl.getUniformLocation(program, 'u_color2'),
        color3:       gl.getUniformLocation(program, 'u_color3'),
        oklchA:       gl.getUniformLocation(program, 'u_oklch_a'),
        oklchB:       gl.getUniformLocation(program, 'u_oklch_b'),
        oklchC:       gl.getUniformLocation(program, 'u_oklch_c'),
        oklchD:       gl.getUniformLocation(program, 'u_oklch_d'),
      };
    },

    render: function (gl, u, v, w, h, t, textTex) {
      var rows   = v.u_rows       != null ? v.u_rows       : 48;
      var cols   = v.u_cols       != null ? v.u_cols       : 37;
      var margin = v.u_top_margin != null ? v.u_top_margin : 0.0;

      // Ratio = cell pixel width / cell pixel height (keeps dots circular)
      var cellW = w / cols;
      var cellH = (h * (1 - margin)) / rows;
      var ratio = cellH > 0 ? cellW / cellH : 1.0;

      var tGridCols = v.u_text_grid_cols != null ? v.u_text_grid_cols : 47;
      var tGridRows = v.u_text_grid_rows != null ? v.u_text_grid_rows : 31;
      var tRatio    = (w / tGridCols) / (h / tGridRows);

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

      gl.uniform1f(u.time,         t);
      gl.uniform2f(u.res,          w, h);
      gl.uniform1f(u.rows,         rows);
      gl.uniform1f(u.cols,         cols);
      gl.uniform1f(u.minRadius,    v.u_min_radius   != null ? v.u_min_radius   : 0.02);
      gl.uniform1f(u.maxRadius,    v.u_max_radius   != null ? v.u_max_radius   : 0.55);
      gl.uniform1f(u.invert,       v.u_invert       != null ? v.u_invert       : 1);
      gl.uniform3fv(u.bgColor,     [0.0, 0.0, 0.0]);
      gl.uniform1f(u.topMargin,    margin);
      gl.uniform1f(u.ratio,        ratio);
      gl.uniform1f(u.textGridCols, tGridCols);
      gl.uniform1f(u.textGridRows, tGridRows);
      gl.uniform1f(u.textBlend,    v.u_text_blend   != null ? v.u_text_blend   : 1.0);
      gl.uniform1f(u.textRadius,   v.u_text_radius  != null ? v.u_text_radius  : 0.16);
      gl.uniform1f(u.textRatio,    tRatio);
      gl.uniform3fv(u.textBgColor, [0.0, 0.0, 0.0]);
      gl.uniform3fv(u.palA,        v.u_a            || [0.5, 0.5, 0.5]);
      gl.uniform3fv(u.palB,        v.u_b            || [0.5, 0.5, 0.5]);
      gl.uniform3fv(u.palC,        v.u_c            || [1.0, 1.0, 1.0]);
      gl.uniform3fv(u.palD,        v.u_d            || [0.263, 0.416, 0.557]);
      gl.uniform1f(u.colorMode,    parseFloat(v.u_color_mode || '0'));
      gl.uniform1f(u.invertText,   v.u_invert_text  != null ? v.u_invert_text  : 0.0);
      gl.uniform1f(u.opacity,       v.u_opacity        != null ? v.u_opacity        : 1.0);
      var _gm = Math.round(v.u_grain_mode != null ? parseFloat(v.u_grain_mode) : 0);
      gl.uniform1f(u.distress,      v['u_distress_' + _gm]       != null ? v['u_distress_' + _gm]       : (v.u_distress       != null ? v.u_distress       : 0.0));
      gl.uniform1f(u.distressScale, v['u_distress_scale_' + _gm] != null ? v['u_distress_scale_' + _gm] : (v.u_distress_scale != null ? v.u_distress_scale : 80.0));
      gl.uniform1f(u.grainMode,        v.u_grain_mode       != null ? parseFloat(v.u_grain_mode) : 0.0);
      gl.uniform1f(u.distressFalloff,  v.u_distress_falloff != null ? v.u_distress_falloff : 0.0);
      gl.uniform1f(u.halftoneAngle, (v.u_halftone_angle != null ? v.u_halftone_angle : 45.0) * Math.PI / 180.0);
      gl.uniform1f(u.halftoneLuma,  v.u_halftone_luma  != null ? v.u_halftone_luma  : 0.0);
      gl.uniform1f(u.posX,             v.u_pos_x            != null ? v.u_pos_x            : 0.0);
      gl.uniform1f(u.posY,         v.u_pos_y      != null ? v.u_pos_y      : 0.0);
      gl.uniform1f(u.scale,        v.u_scale      != null ? v.u_scale      : 1.0);
      gl.uniform1f(u.vignetteTop,    v.u_vignette_top    != null ? v.u_vignette_top    : 0.0);
      gl.uniform1f(u.vignetteBottom, v.u_vignette_bottom != null ? v.u_vignette_bottom : 0.0);
      gl.uniform1f(u.vignetteLeft,   v.u_vignette_left   != null ? v.u_vignette_left   : 0.0);
      gl.uniform1f(u.vignetteRight,  v.u_vignette_right  != null ? v.u_vignette_right  : 0.0);
      gl.uniform1f(u.vignetteAnchorX, v.u_vignette_anchor_x != null ? v.u_vignette_anchor_x : 0.5);
      gl.uniform1f(u.vignetteAnchorY, v.u_vignette_anchor_y != null ? v.u_vignette_anchor_y : 0.5);
      gl.uniform3fv(u.color0,      v.u_color0       || [1.0, 0.2,  0.4]);
      gl.uniform3fv(u.color1,      v.u_color1       || [1.0, 0.8,  0.0]);
      gl.uniform3fv(u.color2,      v.u_color2       || [0.0, 0.8,  1.0]);
      gl.uniform3fv(u.color3,      v.u_color3       || [0.67, 0.0, 1.0]);
      gl.uniform3fv(u.oklchA,      oklchA);
      gl.uniform3fv(u.oklchB,      oklchB);
      gl.uniform3fv(u.oklchC,      oklchC);
      gl.uniform3fv(u.oklchD,      oklchD);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, textTex);
      gl.uniform1i(u.textTex, 0);
    },

    drawText: function (ctx, size, v, w, h) {
      var aspect = (w > 0 && h > 0) ? w / h : 1;

      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, size, size);

      var txt = v.text || '';
      if (txt) {
        var fontFamily = v.textFont ? '"' + v.textFont + '"' : '"IBM Plex Mono"';
        var tx = v.textX != null ? v.textX : 0.5;
        var ty = v.textY != null ? v.textY : 0.79;
        var textRotDeg = v.u_text_rotation != null ? v.u_text_rotation : 0;
        var cx  = size * tx;
        var cy  = size * (1 - ty);
        var rad = textRotDeg * Math.PI / 180;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rad);
        ctx.scale(1 / aspect, 1);
        ctx.fillStyle    = 'rgb(255,255,255)';
        ctx.font         = 'bold ' + (v.textFontSize || 460) + 'px ' + fontFamily + ', monospace';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(txt, 0, 0);
        ctx.restore();
      }
    },

    textKey: function (v) {
      return JSON.stringify([v.text, v.textX, v.textY, v.textFontSize, v.textFont, v.u_text_rotation]);
    },
  });
}());
