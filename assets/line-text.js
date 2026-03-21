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
    'uniform sampler2D u_text_texture;',
    'uniform float u_vignette;',
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
    '  vec3 col = cosinePalette(uv.x, u_a, u_b, u_c, u_d);',
    '',
    '  // Vignette: fade edges based on radial distance from center',
    '  float vignette = clamp(1.0 - dot(uv - 0.5, uv - 0.5) * u_vignette, 0.0, 1.0);',
    '',
    '  vec3 encoded = pow(max(col, 0.0), vec3(1.0 / 2.2));',
    '  fragColor = vec4(encoded, lineMask * vignette);',
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
        textTex:       gl.getUniformLocation(program, 'u_text_texture'),
        vignette:      gl.getUniformLocation(program, 'u_vignette'),
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
      gl.uniform1f(u.vignette,      v.u_vignette != null ? v.u_vignette : 2.0);

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
      var fontSize   = v.textFontSize != null ? v.textFontSize : 600;
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
      // Center in shader (UV 0.5,0.5) = canvas (size/2, size/2).
      octx.fillText(txt, size / 2, size / 2);

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
      return JSON.stringify([v.text, v.textFont, v.textFontSize, v.textCapRadius]);
    },
  });
}());
