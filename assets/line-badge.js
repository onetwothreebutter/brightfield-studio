(function () {
  'use strict';

  // ── Fragment shader ─────────────────────────────────────────────────────────
  var fragSrc = [
    '#version 300 es',
    'precision mediump float;',
    '',
    'uniform vec2  u_resolution;',
    'uniform float u_aspect;',      // w / h, set per frame in render()
    '',
    '// Line',
    'uniform float u_line_y;',       // 0–1 canvas height
    'uniform float u_line_height;',  // half-thickness in canvas-height units
    '',
    '// Circle',
    'uniform float u_circle_x;',
    'uniform float u_circle_y;',
    'uniform float u_circle_radius;',
    'uniform float u_inner_radius;', // hollow centre (0 = solid, >0 = ring)
    '',
    '// Palette — cosine (mode 0) / 4-stop (mode 1)',
    'uniform vec3  u_a;',
    'uniform vec3  u_b;',
    'uniform vec3  u_c;',
    'uniform vec3  u_d;',
    'uniform vec3  u_color0;',
    'uniform vec3  u_color1;',
    'uniform vec3  u_color2;',
    'uniform vec3  u_color3;',
    'uniform float u_color_mode;',
    '',
    '// Text',
    'uniform sampler2D u_text_texture;',
    'uniform float     u_text_x;',
    'uniform float     u_text_y;',
    'uniform vec3      u_text_color;',
    'uniform float     u_use_text_color;',
    'uniform vec3      u_outline_color;',
    '',
    '// Finish',
    'uniform float u_offset_y;',
    'uniform float u_opacity;',
    'uniform float u_distress;',
    'uniform float u_distress_scale;',
    'uniform float u_grain_mode;',
    'uniform float u_distress_falloff;',
    '',
    'out vec4 fragColor;',
    '',
    window.ShaderBase.commonGLSL,
    '',
    '// 4-stop linear gradient (sRGB, same driver t)',
    'vec3 fourStop(float t) {',
    '  float t01 = clamp(t * 3.0, 0.0, 1.0);',
    '  float t12 = clamp((t - 1.0/3.0) * 3.0, 0.0, 1.0);',
    '  float t23 = clamp((t - 2.0/3.0) * 3.0, 0.0, 1.0);',
    '  vec3 s01  = mix(u_color0, u_color1, t01);',
    '  vec3 s12  = mix(u_color1, u_color2, t12);',
    '  vec3 s23  = mix(u_color2, u_color3, t23);',
    '  return mix(mix(s01, s12, step(1.0/3.0, t)), s23, step(2.0/3.0, t));',
    '}',
    '',
    'vec3 paletteAt(float t) {',
    '  return mix(cosinePalette(t, u_a, u_b, u_c, u_d), fourStop(t), u_color_mode);',
    '}',
    '',
    'void main() {',
    '  vec2 uv = gl_FragCoord.xy / u_resolution;',
    '  uv.y += u_offset_y;',
    '',
    '  // ── Horizontal line ────────────────────────────────────────────────────',
    '  float lineSDF  = abs(uv.y - u_line_y) - u_line_height;',
    '  float aaLine   = fwidth(lineSDF) * 0.5;',
    '  float lineMask = 1.0 - smoothstep(-aaLine, aaLine, lineSDF);',
    '',
    '  // ── Circle (aspect-corrected so it stays round) ────────────────────────',
    '  vec2  circOff    = vec2((uv.x - u_circle_x) * u_aspect, uv.y - u_circle_y);',
    '  float circDist   = length(circOff);',
    '  float circSDF    = circDist - u_circle_radius;',
    '  float aaCirc     = fwidth(circSDF) * 0.5;',
    '  float outerMask  = 1.0 - smoothstep(-aaCirc, aaCirc, circSDF);',
    '',
    '  // Inner cutout (ring mode): positive inner_radius punches a hole',
    '  float innerSDF   = circDist - u_inner_radius;',
    '  float aaInner    = fwidth(innerSDF) * 0.5;',
    '  float innerHole  = step(0.001, u_inner_radius) *',
    '                     (1.0 - smoothstep(-aaInner, aaInner, innerSDF));',
    '  float circleMask = outerMask * (1.0 - innerHole);',
    '',
    '  // ── Colour (horizontal sweep so line & circle share one gradient) ───────',
    '  float palT  = clamp(uv.x, 0.0, 1.0);',
    '  vec3  color = paletteAt(palT);',
    '',
    '  // ── Union: circle sits in front of line ────────────────────────────────',
    '  float geomMask = max(lineMask, circleMask);',
    '',
    '  // ── Text overlay (R=fill, G=outline, same as circle-on-line.js) ──────────',
    '  vec2  textAnchor = vec2(u_text_x, u_text_y);',
    '  vec2  textDelta  = uv - textAnchor;',
    '  vec2  textUV     = vec2(textDelta.x * u_aspect, textDelta.y) + textAnchor;',
    '  vec4  texSample  = texture(u_text_texture, textUV);',
    '  float fillS      = smoothstep(0.05, 0.60, texSample.r);',
    '  float outlineS   = smoothstep(0.05, 0.60, texSample.g);',
    '  vec3  withOutline  = mix(color * geomMask, u_outline_color, outlineS);',
    '  vec3  textFill     = mix(color, u_text_color, u_use_text_color);',
    '  vec3  finalColor   = mix(withOutline, textFill, fillS);',
    '',
    '  float textAlpha  = fillS + outlineS;',
    '  float baseAlpha  = mix(geomMask, 1.0, textAlpha);',
    '  float alpha      = baseAlpha;',
    '',
    '  // ── Distress ───────────────────────────────────────────────────────────',
    '  vec2 dUV = gl_FragCoord.xy / u_resolution;',
    '  float vigMask = computeVigMask(dUV);',
    '  alpha *= applyDistress(1.0, dUV, u_distress, u_distress_scale, u_grain_mode, u_distress_falloff, dot(finalColor, vec3(0.299, 0.587, 0.114)), vigMask) * u_opacity;',
    '',
    '  vec3 encoded = pow(max(finalColor, 0.0), vec3(1.0 / 2.2));',
    '  fragColor    = vec4(encoded, alpha);',
    '}',
  ].join('\n');

  window.ShaderBase.create({
    animateValues:  true,
    instantKeys:    ['u_opacity', 'u_distress_0', 'u_distress_scale_0', 'u_distress_1', 'u_distress_scale_1', 'u_distress_2', 'u_distress_scale_2', 'u_distress_3', 'u_distress_scale_3', 'u_grain_mode', 'u_distress_falloff', 'u_vignette_top', 'u_vignette_bottom', 'u_vignette_left', 'u_vignette_right'],
    fragSrc: fragSrc,

    setup: function (gl, program) {
      return {
        res:          gl.getUniformLocation(program, 'u_resolution'),
        aspect:       gl.getUniformLocation(program, 'u_aspect'),
        lineY:        gl.getUniformLocation(program, 'u_line_y'),
        lineHeight:   gl.getUniformLocation(program, 'u_line_height'),
        circleX:      gl.getUniformLocation(program, 'u_circle_x'),
        circleY:      gl.getUniformLocation(program, 'u_circle_y'),
        circleRadius: gl.getUniformLocation(program, 'u_circle_radius'),
        innerRadius:  gl.getUniformLocation(program, 'u_inner_radius'),
        palA:         gl.getUniformLocation(program, 'u_a'),
        palB:         gl.getUniformLocation(program, 'u_b'),
        palC:         gl.getUniformLocation(program, 'u_c'),
        palD:         gl.getUniformLocation(program, 'u_d'),
        color0:       gl.getUniformLocation(program, 'u_color0'),
        color1:       gl.getUniformLocation(program, 'u_color1'),
        color2:       gl.getUniformLocation(program, 'u_color2'),
        color3:       gl.getUniformLocation(program, 'u_color3'),
        colorMode:    gl.getUniformLocation(program, 'u_color_mode'),
        textTex:      gl.getUniformLocation(program, 'u_text_texture'),
        textX:        gl.getUniformLocation(program, 'u_text_x'),
        textY:        gl.getUniformLocation(program, 'u_text_y'),
        textColor:    gl.getUniformLocation(program, 'u_text_color'),
        useTextColor: gl.getUniformLocation(program, 'u_use_text_color'),
        outlineColor: gl.getUniformLocation(program, 'u_outline_color'),
        offsetY:      gl.getUniformLocation(program, 'u_offset_y'),
        opacity:      gl.getUniformLocation(program, 'u_opacity'),
        distress:        gl.getUniformLocation(program, 'u_distress'),
        distressScale:   gl.getUniformLocation(program, 'u_distress_scale'),
        grainMode:       gl.getUniformLocation(program, 'u_grain_mode'),
        distressFalloff: gl.getUniformLocation(program, 'u_distress_falloff'),
        halftoneAngle:   gl.getUniformLocation(program, 'u_halftone_angle'),
        halftoneLuma:    gl.getUniformLocation(program, 'u_halftone_luma'),
      };
    },

    render: function (gl, u, v, w, h, t, textTex) {
      // Keep circle_y pinned to line_y unless the user has explicitly moved it
      var circleY = v.u_circle_y != null ? v.u_circle_y : (v.u_line_y != null ? v.u_line_y : 0.5);

      gl.uniform2f(u.res,           w, h);
      gl.uniform1f(u.aspect,        w / h);
      gl.uniform1f(u.lineY,         v.u_line_y          != null ? v.u_line_y          : 0.5);
      gl.uniform1f(u.lineHeight,    v.u_line_height      != null ? v.u_line_height      : 0.04);
      gl.uniform1f(u.circleX,       v.u_circle_x        != null ? v.u_circle_x        : 0.5);
      gl.uniform1f(u.circleY,       circleY);
      gl.uniform1f(u.circleRadius,  v.u_circle_radius    != null ? v.u_circle_radius    : 0.18);
      gl.uniform1f(u.innerRadius,   v.u_inner_radius     != null ? v.u_inner_radius     : 0.0);
      gl.uniform3fv(u.palA,         v.u_a               || [0.5, 0.5, 0.5]);
      gl.uniform3fv(u.palB,         v.u_b               || [0.5, 0.5, 0.5]);
      gl.uniform3fv(u.palC,         v.u_c               || [1.0, 1.0, 1.0]);
      gl.uniform3fv(u.palD,         v.u_d               || [0.0, 0.33, 0.67]);
      gl.uniform3fv(u.color0,       v.u_color0          || [1.0, 0.2,  0.4]);
      gl.uniform3fv(u.color1,       v.u_color1          || [1.0, 0.8,  0.0]);
      gl.uniform3fv(u.color2,       v.u_color2          || [0.0, 0.8,  1.0]);
      gl.uniform3fv(u.color3,       v.u_color3          || [0.67, 0.0, 1.0]);
      gl.uniform1f(u.colorMode,     parseFloat(v.u_color_mode || '0'));
      gl.uniform1f(u.textX,         v.textX             != null ? v.textX             : 0.5);
      gl.uniform1f(u.textY,         v.textY             != null ? v.textY             : circleY);
      gl.uniform3fv(u.textColor,    v.u_text_color      || [1.0, 1.0, 1.0]);
      gl.uniform1f(u.useTextColor,  v.u_use_text_color  != null ? v.u_use_text_color  : 0.0);
      gl.uniform3fv(u.outlineColor, v.u_outline_color   || [0.0, 0.0, 0.0]);
      gl.uniform1f(u.offsetY,       v.u_offset_y        != null ? v.u_offset_y        : 0.0);
      gl.uniform1f(u.opacity,       v.u_opacity         != null ? v.u_opacity         : 1.0);
      var _gm = Math.round(v.u_grain_mode != null ? parseFloat(v.u_grain_mode) : 0);
      gl.uniform1f(u.distress,      v['u_distress_' + _gm]       != null ? v['u_distress_' + _gm]       : (v.u_distress       != null ? v.u_distress       : 0.0));
      gl.uniform1f(u.distressScale, v['u_distress_scale_' + _gm] != null ? v['u_distress_scale_' + _gm] : (v.u_distress_scale != null ? v.u_distress_scale : 80.0));
      gl.uniform1f(u.grainMode,        v.u_grain_mode       != null ? parseFloat(v.u_grain_mode) : 0.0);
      gl.uniform1f(u.distressFalloff,  v.u_distress_falloff != null ? v.u_distress_falloff : 0.0);
      gl.uniform1f(u.halftoneAngle, (v.u_halftone_angle != null ? v.u_halftone_angle : 45.0) * Math.PI / 180.0);
      gl.uniform1f(u.halftoneLuma,  v.u_halftone_luma  != null ? v.u_halftone_luma  : 1.0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, textTex);
      gl.uniform1i(u.textTex, 0);
    },

    drawText: function (ctx, size, v, w, h) {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, size, size);

      var txt = v.text || '';
      if (!txt) return;

      var fontFamily = v.textFont ? '"' + v.textFont + '"' : '"Montserrat"';
      var fontSize   = v.textFontSize || 100;
      var tx = v.textX   != null ? v.textX   : 0.5;
      var ty = v.textY   != null ? v.textY   : 0.5;
      var cx = tx * size;
      var cy = (1 - ty) * size;  // flip Y: ty=1 → canvas top → UV top

      ctx.save();
      ctx.translate(cx, cy);

      // Outline pass (green channel)
      if (v.outlineEnabled && v.outlineWidth > 0) {
        ctx.strokeStyle = 'rgb(0,255,0)';
        ctx.lineWidth   = (v.outlineWidth || 8) * 2;
        ctx.lineJoin    = 'round';
        ctx.font         = 'bold ' + fontSize + 'px ' + fontFamily + ', sans-serif';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeText(txt, 0, 0);
      }

      // Fill pass (red channel)
      ctx.fillStyle    = 'rgb(255,0,0)';
      ctx.font         = 'bold ' + fontSize + 'px ' + fontFamily + ', sans-serif';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(txt, 0, 0);
      ctx.restore();
    },

    textKey: function (v) {
      return JSON.stringify([
        v.text, v.textFont, v.textFontSize, v.textX, v.textY,
        v.outlineEnabled, v.outlineWidth, v.u_outline_color,
      ]);
    },
  });
}());
