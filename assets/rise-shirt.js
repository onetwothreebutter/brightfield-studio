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
    'uniform vec3  u_dot_color;',
    'uniform vec3  u_bg_color;',
    'uniform float u_top_margin;',
    'uniform float u_ratio;',
    'uniform sampler2D u_text_texture;',
    'uniform float u_text_grid_cols;',
    'uniform float u_text_grid_rows;',
    'uniform float u_text_blend;',
    'uniform float u_text_radius;',
    'uniform float u_text_ratio;',
    'uniform vec3  u_text_color;',
    'uniform vec3  u_text_bg_color;',
    'uniform vec3  u_a;',
    'uniform vec3  u_b;',
    'uniform vec3  u_c;',
    'uniform vec3  u_d;',
    'uniform float u_color_mode;',
    'uniform float u_invert_text;',
    'uniform float u_transparent_bg;',
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
    'void main() {',
    '  vec2 uv = gl_FragCoord.xy / u_resolution;',
    '',
    '  // Top margin — area above marginThreshold is collar / text zone',
    '  float marginThreshold = 1.0 - u_top_margin;',
    '  float inMargin        = step(marginThreshold, uv.y);',
    '',
    '  // Remap Y so the full gradient spans only the design area',
    '  float remappedY = clamp(uv.y / max(marginThreshold, 0.001), 0.0, 1.0);',
    '',
    '  // ── Main dot grid ─────────────────────────────────────────────────',
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
    '  vec3 paletteColor   = cosinePalette(mixFactor, u_a, u_b, u_c, u_d);',
    '  vec3 invertedPal    = 1.0 - paletteColor;',
    '  vec3 activePal      = mix(paletteColor, invertedPal, u_invert_text);',
    '  // mode=0: cosine palette  mode=1: solid color',
    '  vec3 dotColor       = mix(activePal, u_dot_color, step(0.5, u_color_mode));',
    '  vec3 mainColor      = mix(u_bg_color, dotColor, mainMask);',
    '',
    '  // ── Text dot grid (margin area) ───────────────────────────────────',
    '  vec2  tGridUv    = uv * vec2(u_text_grid_cols, u_text_grid_rows);',
    '  vec2  tLocalUv   = fract(tGridUv) - 0.5;',
    '  vec2  tCorrected = vec2(tLocalUv.x * u_text_ratio, tLocalUv.y);',
    '  float tDist      = length(tCorrected);',
    '  vec2  tCellIdx   = floor(tGridUv);',
    '  vec2  tCenterUv  = (tCellIdx + 0.5) / vec2(u_text_grid_cols, u_text_grid_rows);',
    '  float tSample    = texture(u_text_texture, tCenterUv).r;',
    '',
    '  float circleMask      = 1.0 - smoothstep(u_text_radius - eps, u_text_radius + eps, tDist);',
    '  float textMask        = circleMask * tSample * u_text_blend;',
    '  float textMixFactor   = mix(tCenterUv.y, 1.0 - tCenterUv.y, u_invert);',
    '  vec3  textPalette     = cosinePalette(textMixFactor, u_a, u_b, u_c, u_d);',
    '  vec3  invertedTextPal = 1.0 - textPalette;',
    '  vec3  activeTextPal   = mix(textPalette, invertedTextPal, u_invert_text);',
    '  vec3  textDotColor    = mix(activeTextPal, u_text_color, step(0.5, u_color_mode));',
    '  vec3  marginColor     = mix(u_text_bg_color, textDotColor, textMask);',
    '',
    '  float dotAlpha = mix(mainMask, textMask, inMargin);',
    '  float alpha    = mix(1.0, dotAlpha, u_transparent_bg);',
    '  vec3 finalCol  = mix(mainColor, marginColor, inMargin);',
    '  vec2 dUV = gl_FragCoord.xy / u_resolution;',
    '  float dn = distressNoise(dUV, u_distress_scale) * 0.67',
    '           + distressNoise(dUV, u_distress_scale * 2.73) * 0.33;',
    '  alpha = alpha * step(u_distress, dn) * u_opacity;',
    '  vec3 encoded   = pow(max(finalCol, 0.0), vec3(1.0 / 2.2));',
    '  fragColor   = vec4(encoded, alpha);',
    '}'
  ].join('\n');

  window.ShaderBase.create({
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
        dotColor:     gl.getUniformLocation(program, 'u_dot_color'),
        bgColor:      gl.getUniformLocation(program, 'u_bg_color'),
        topMargin:    gl.getUniformLocation(program, 'u_top_margin'),
        ratio:        gl.getUniformLocation(program, 'u_ratio'),
        textTex:      gl.getUniformLocation(program, 'u_text_texture'),
        textGridCols: gl.getUniformLocation(program, 'u_text_grid_cols'),
        textGridRows: gl.getUniformLocation(program, 'u_text_grid_rows'),
        textBlend:    gl.getUniformLocation(program, 'u_text_blend'),
        textRadius:   gl.getUniformLocation(program, 'u_text_radius'),
        textRatio:    gl.getUniformLocation(program, 'u_text_ratio'),
        textColor:    gl.getUniformLocation(program, 'u_text_color'),
        textBgColor:  gl.getUniformLocation(program, 'u_text_bg_color'),
        palA:         gl.getUniformLocation(program, 'u_a'),
        palB:         gl.getUniformLocation(program, 'u_b'),
        palC:         gl.getUniformLocation(program, 'u_c'),
        palD:         gl.getUniformLocation(program, 'u_d'),
        colorMode:    gl.getUniformLocation(program, 'u_color_mode'),
        invertText:   gl.getUniformLocation(program, 'u_invert_text'),
        transparentBg: gl.getUniformLocation(program, 'u_transparent_bg'),
        opacity:       gl.getUniformLocation(program, 'u_opacity'),
        distress:      gl.getUniformLocation(program, 'u_distress'),
        distressScale: gl.getUniformLocation(program, 'u_distress_scale'),
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

      gl.uniform1f(u.time,         t);
      gl.uniform2f(u.res,          w, h);
      gl.uniform1f(u.rows,         rows);
      gl.uniform1f(u.cols,         cols);
      gl.uniform1f(u.minRadius,    v.u_min_radius   != null ? v.u_min_radius   : 0.02);
      gl.uniform1f(u.maxRadius,    v.u_max_radius   != null ? v.u_max_radius   : 0.55);
      gl.uniform1f(u.invert,       v.u_invert       != null ? v.u_invert       : 1);
      gl.uniform3fv(u.dotColor,    v.u_dot_color    || [1.0, 1.0, 1.0]);
      gl.uniform3fv(u.bgColor,     v.u_bg_color     || [0.0, 0.0, 0.0]);
      gl.uniform1f(u.topMargin,    margin);
      gl.uniform1f(u.ratio,        ratio);
      gl.uniform1f(u.textGridCols, tGridCols);
      gl.uniform1f(u.textGridRows, tGridRows);
      gl.uniform1f(u.textBlend,    v.u_text_blend   != null ? v.u_text_blend   : 1.0);
      gl.uniform1f(u.textRadius,   v.u_text_radius  != null ? v.u_text_radius  : 0.16);
      gl.uniform1f(u.textRatio,    tRatio);
      gl.uniform3fv(u.textColor,   v.u_text_color   || [1.0, 1.0, 1.0]);
      gl.uniform3fv(u.textBgColor, v.u_text_bg_color || [0.0, 0.0, 0.0]);
      gl.uniform3fv(u.palA,        v.u_a            || [0.5, 0.5, 0.5]);
      gl.uniform3fv(u.palB,        v.u_b            || [0.5, 0.5, 0.5]);
      gl.uniform3fv(u.palC,        v.u_c            || [1.0, 1.0, 1.0]);
      gl.uniform3fv(u.palD,        v.u_d            || [0.263, 0.416, 0.557]);
      gl.uniform1f(u.colorMode,    v.u_color_mode   != null ? v.u_color_mode   : 0.0);
      gl.uniform1f(u.invertText,   v.u_invert_text  != null ? v.u_invert_text  : 0.0);
      gl.uniform1f(u.transparentBg, v.u_transparent_bg != null ? v.u_transparent_bg : 0.0);
      gl.uniform1f(u.opacity,       v.u_opacity        != null ? v.u_opacity        : 1.0);
      gl.uniform1f(u.distress,      v.u_distress       != null ? v.u_distress       : 0.0);
      gl.uniform1f(u.distressScale, v.u_distress_scale != null ? v.u_distress_scale : 80.0);

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
