(function () {
  'use strict';

  // LineText port — faithful to the Three.js TSL original
  var fragSrc = [
    '#version 300 es',
    'precision mediump float;',
    'uniform vec2  u_resolution;',
    'uniform float u_rows;',
    'uniform float u_base_thickness;',
    'uniform float u_text_thickness;',
    'uniform vec3  u_a;',
    'uniform vec3  u_b;',
    'uniform vec3  u_c;',
    'uniform vec3  u_d;',
    'uniform float u_color_mode;',
    'uniform vec3  u_color0;',
    'uniform vec3  u_color1;',
    'uniform vec3  u_color2;',
    'uniform vec3  u_color3;',
    'uniform sampler2D u_text_texture;',
    'uniform float u_vignette_x;',
    'uniform float u_vignette_y;',
    'out vec4 fragColor;',
    '',
    'vec3 cosinePalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {',
    '  return a + b * cos(6.28318 * (c * t + d));',
    '}',
    '',
    'void main() {',
    '  vec2 uv = gl_FragCoord.xy / u_resolution;',
    '',
    '  // R channel = text mask (0..1); blur in drawText creates soft cap falloff',
    '  float textSample = texture(u_text_texture, uv).r;',
    '',
    '  float rowY      = fract(uv.y * u_rows);',
    '  float distCenter = abs(rowY - 0.5);',
    '',
    '  // Thin base line, fattened where text is present',
    '  float halfThick = u_base_thickness + textSample * u_text_thickness;',
    '',
    '  // AA via fwidth (GLSL ES 3.0 built-in)',
    '  float d  = distCenter - halfThick;',
    '  float aa = fwidth(d) * 0.5;',
    '  float lineMask = 1.0 - smoothstep(-aa, aa, d);',
    '',
    '  // Cosine palette along X axis',
    '  vec3 palColor = cosinePalette(uv.x, u_a, u_b, u_c, u_d);',
    '',
    '  // 4-stop linear gradient along X axis',
    '  float t01 = clamp(uv.x * 3.0, 0.0, 1.0);',
    '  float t12 = clamp((uv.x - 1.0 / 3.0) * 3.0, 0.0, 1.0);',
    '  float t23 = clamp((uv.x - 2.0 / 3.0) * 3.0, 0.0, 1.0);',
    '  vec3 seg01 = mix(u_color0, u_color1, t01);',
    '  vec3 seg12 = mix(u_color1, u_color2, t12);',
    '  vec3 seg23 = mix(u_color2, u_color3, t23);',
    '  vec3 gradColor = mix(mix(seg01, seg12, step(1.0 / 3.0, uv.x)), seg23, step(2.0 / 3.0, uv.x));',
    '  vec3 col = mix(palColor, gradColor, u_color_mode);',
    '',
    '  // Vignette: independent falloff per axis',
    '  vec2 vigCoord = uv - 0.5;',
    '  float vigVal  = vigCoord.x * vigCoord.x * u_vignette_x + vigCoord.y * vigCoord.y * u_vignette_y;',
    '  float vignette = clamp(1.0 - vigVal, 0.0, 1.0);',
    '',
    '  vec3 encoded = pow(max(col, 0.0), vec3(1.0 / 2.2));',
    '  fragColor = vec4(encoded * vignette, lineMask);',
    '}',
  ].join('\n');

  window.ShaderBase.create({
    fragSrc: fragSrc,

    setup: function (gl, program) {
      return {
        res:           gl.getUniformLocation(program, 'u_resolution'),
        rows:          gl.getUniformLocation(program, 'u_rows'),
        baseThickness: gl.getUniformLocation(program, 'u_base_thickness'),
        textThickness: gl.getUniformLocation(program, 'u_text_thickness'),
        palA:          gl.getUniformLocation(program, 'u_a'),
        palB:          gl.getUniformLocation(program, 'u_b'),
        palC:          gl.getUniformLocation(program, 'u_c'),
        palD:          gl.getUniformLocation(program, 'u_d'),
        colorMode:     gl.getUniformLocation(program, 'u_color_mode'),
        color0:        gl.getUniformLocation(program, 'u_color0'),
        color1:        gl.getUniformLocation(program, 'u_color1'),
        color2:        gl.getUniformLocation(program, 'u_color2'),
        color3:        gl.getUniformLocation(program, 'u_color3'),
        textTex:       gl.getUniformLocation(program, 'u_text_texture'),
        vignetteX:     gl.getUniformLocation(program, 'u_vignette_x'),
        vignetteY:     gl.getUniformLocation(program, 'u_vignette_y'),
      };
    },

    render: function (gl, u, v, w, h, t, textTex) {
      gl.uniform2f(u.res,           w, h);
      gl.uniform1f(u.rows,          v.u_rows           != null ? v.u_rows           : 80.0);
      gl.uniform1f(u.baseThickness, v.u_base_thickness != null ? v.u_base_thickness : 0.02);
      gl.uniform1f(u.textThickness, v.u_text_thickness != null ? v.u_text_thickness : 0.4);
      gl.uniform3fv(u.palA,         v.u_a || [0.5, 0.5, 0.5]);
      gl.uniform3fv(u.palB,         v.u_b || [0.5, 0.5, 0.5]);
      gl.uniform3fv(u.palC,         v.u_c || [1.0, 1.0, 1.0]);
      gl.uniform3fv(u.palD,         v.u_d || [0.0, 0.33, 0.67]);
      gl.uniform1f(u.colorMode,     v.u_color_mode != null ? v.u_color_mode : 0.0);
      gl.uniform3fv(u.color0,       v.u_color0 || [1.0, 0.2,  0.4]);
      gl.uniform3fv(u.color1,       v.u_color1 || [1.0, 0.8,  0.0]);
      gl.uniform3fv(u.color2,       v.u_color2 || [0.0, 0.8,  1.0]);
      gl.uniform3fv(u.color3,       v.u_color3 || [0.667, 0.0, 1.0]);
      gl.uniform1f(u.vignetteX,     v.u_vignette_x != null ? v.u_vignette_x : 2.0);
      gl.uniform1f(u.vignetteY,     v.u_vignette_y != null ? v.u_vignette_y : 2.0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, textTex);
      gl.uniform1i(u.textTex, 0);
    },

    drawText: function (ctx, size, v) {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, size, size);

      var txt = v.text || '';
      if (!txt) return;

      var fontFamily = v.textFont ? '"' + v.textFont + '"' : '"Montserrat"';
      var fontSize   = v.textFontSize != null ? v.textFontSize : 202;
      var capRadius  = v.textCapRadius != null ? v.textCapRadius : 20;

      // Draw white text on offscreen canvas so blur compositing is clean
      var off = document.createElement('canvas');
      off.width  = size;
      off.height = size;
      var octx = off.getContext('2d');
      octx.font         = 'bold ' + fontSize + 'px ' + fontFamily + ', sans-serif';
      octx.textAlign    = 'center';
      octx.textBaseline = 'middle';
      octx.fillStyle    = 'white';
      // Canvas Y=0 is top; UNPACK_FLIP_Y maps canvas top → UV bottom.
      // textY=0.5 (center) → canvas y = (1-0.5)*size = size/2.
      var ty = v.textY != null ? v.textY : 0.5;
      var cy = (1 - ty) * size;
      octx.fillText(txt, size / 2, cy);

      // Blurred pass first — creates smooth falloff at glyph edges (rounded line caps)
      if (capRadius > 0) {
        ctx.filter = 'blur(' + capRadius + 'px)';
        ctx.drawImage(off, 0, 0);
        ctx.filter = 'none';
      }

      // Hard pass on top — keeps interior fully solid
      ctx.drawImage(off, 0, 0);
    },

    textKey: function (v) {
      return JSON.stringify([v.text, v.textFont, v.textFontSize, v.textCapRadius, v.textY]);
    },
  });
}());
