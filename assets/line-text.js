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
    'uniform float u_text_y;',
    'uniform float u_vignette_x;',
    'uniform float u_vignette_y;',
    'uniform float u_transparent_bg;',
    'out vec4 fragColor;',
    '',
    'vec3 cosinePalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {',
    '  return a + b * cos(6.28318 * (c * t + d));',
    '}',
    '',
    'void main() {',
    '  vec2 uv = gl_FragCoord.xy / u_resolution;',
    '',
    '  // R channel = text mask (0..1); blur pre-applied via WebGL framebuffer passes',
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
    '  // Vignette: centered on text Y position',
    '  vec2 vigCoord = uv - vec2(0.5, u_text_y);',
    '  float vigVal  = vigCoord.x * vigCoord.x * u_vignette_x + vigCoord.y * vigCoord.y * u_vignette_y;',
    '  float vignette = clamp(1.0 - vigVal, 0.0, 1.0);',
    '',
    '  vec3 encoded = pow(max(col, 0.0), vec3(1.0 / 2.2));',
    '  // Display mode (u_transparent_bg=0): opaque black between lines — avoids Safari alpha compositing bug',
    '  // Export mode  (u_transparent_bg=1): transparent between lines — product image shows through PNG',
    '  float alpha = mix(1.0, lineMask, u_transparent_bg);',
    '  fragColor = vec4(encoded * vignette * mix(lineMask, 1.0, u_transparent_bg), alpha);',
    '}',
  ].join('\n');

  // ── Two-pass separable Gaussian blur (WebGL framebuffer) ───────────────────
  // Blur is done entirely in WebGL to avoid Safari's missing ctx.filter and
  // its GLSL bug where texture() inside for-loops silently returns NaN.

  var blurVertSrc = [
    '#version 300 es',
    'in vec2 a_position;',
    'out vec2 v_uv;',
    'void main() {',
    '  v_uv = a_position * 0.5 + 0.5;',
    '  gl_Position = vec4(a_position, 0.0, 1.0);',
    '}',
  ].join('\n');

  // 9-tap 1D Gaussian — no loops (avoids Safari GLSL loop+texture bug).
  // Weights are for σ≈1-step kernel (c0..c4 are the half-kernel, normalized).
  var blurFragSrc = [
    '#version 300 es',
    'precision mediump float;',
    'in vec2 v_uv;',
    'uniform sampler2D u_src;',
    'uniform vec2 u_dir;',
    'out vec4 fragColor;',
    'void main() {',
    '  vec2 s = u_dir;',
    '  float c0 = 0.39905;',
    '  float c1 = 0.24173;',
    '  float c2 = 0.05399;',
    '  float c3 = 0.00443;',
    '  float c4 = 0.00013;',
    '  float r =',
    '    texture(u_src, v_uv - s*4.0).r * c4 +',
    '    texture(u_src, v_uv - s*3.0).r * c3 +',
    '    texture(u_src, v_uv - s*2.0).r * c2 +',
    '    texture(u_src, v_uv - s*1.0).r * c1 +',
    '    texture(u_src, v_uv        ).r * c0 +',
    '    texture(u_src, v_uv + s*1.0).r * c1 +',
    '    texture(u_src, v_uv + s*2.0).r * c2 +',
    '    texture(u_src, v_uv + s*3.0).r * c3 +',
    '    texture(u_src, v_uv + s*4.0).r * c4;',
    '  fragColor = vec4(r, r, r, 1.0);',
    '}',
  ].join('\n');

  function compileShader(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  }

  function makeBlurFbo(gl, size) {
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return { fbo: fbo, tex: tex };
  }

  function compileBlurResources(gl) {
    var vert = compileShader(gl, gl.VERTEX_SHADER, blurVertSrc);
    var frag = compileShader(gl, gl.FRAGMENT_SHADER, blurFragSrc);
    var prog = gl.createProgram();
    gl.attachShader(prog, vert);
    gl.attachShader(prog, frag);
    gl.linkProgram(prog);

    var TEX_SIZE = 1024;
    return {
      prog:       prog,
      posLoc:     gl.getAttribLocation(prog, 'a_position'),
      srcLoc:     gl.getUniformLocation(prog, 'u_src'),
      dirLoc:     gl.getUniformLocation(prog, 'u_dir'),
      hPass:      makeBlurFbo(gl, TEX_SIZE),
      vPass:      makeBlurFbo(gl, TEX_SIZE),
      texSize:    TEX_SIZE,
      lastKey:    null,
      blurredTex: null,
    };
  }

  window.ShaderBase.create({
    fragSrc: fragSrc,

    setup: function (gl, program) {
      return {
        _mainProg:     program,
        _mainPosLoc:   gl.getAttribLocation(program, 'a_position'),
        _blur:         compileBlurResources(gl),
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
        textY:         gl.getUniformLocation(program, 'u_text_y'),
        vignetteX:     gl.getUniformLocation(program, 'u_vignette_x'),
        vignetteY:     gl.getUniformLocation(program, 'u_vignette_y'),
        transparentBg: gl.getUniformLocation(program, 'u_transparent_bg'),
      };
    },

    render: function (gl, u, v, w, h, t, textTex) {
      var capRadius = v.textCapRadius != null ? v.textCapRadius : 20.0;
      var blur      = u._blur;
      var blurKey   = JSON.stringify([v.text, v.textFont, v.textFontSize, v.textY, capRadius]);

      // ── Two-pass Gaussian blur (H then V) into framebuffer textures ────────
      if (capRadius > 0 && blurKey !== blur.lastKey) {
        var step = capRadius / blur.texSize;

        gl.useProgram(blur.prog);
        gl.enableVertexAttribArray(blur.posLoc);
        gl.vertexAttribPointer(blur.posLoc, 2, gl.FLOAT, false, 0, 0);
        gl.viewport(0, 0, blur.texSize, blur.texSize);

        // H pass: raw text texture → hPass FBO
        gl.bindFramebuffer(gl.FRAMEBUFFER, blur.hPass.fbo);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, textTex);
        gl.uniform1i(blur.srcLoc, 0);
        gl.uniform2f(blur.dirLoc, step, 0.0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        // V pass: hPass texture → vPass FBO
        gl.bindFramebuffer(gl.FRAMEBUFFER, blur.vPass.fbo);
        gl.bindTexture(gl.TEXTURE_2D, blur.hPass.tex);
        gl.uniform2f(blur.dirLoc, 0.0, step);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        // Restore main program + state for the draw call that follows render()
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, w, h);
        gl.useProgram(u._mainProg);
        gl.enableVertexAttribArray(u._mainPosLoc);
        gl.vertexAttribPointer(u._mainPosLoc, 2, gl.FLOAT, false, 0, 0);

        blur.lastKey    = blurKey;
        blur.blurredTex = blur.vPass.tex;
      }

      // ── Main shader uniforms ───────────────────────────────────────────────
      var activeTex = (capRadius > 0 && blur.blurredTex) ? blur.blurredTex : textTex;

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
      gl.uniform1f(u.textY,         v.textY != null ? v.textY : 0.5);
      gl.uniform1f(u.vignetteX,     v.u_vignette_x != null ? v.u_vignette_x : 2.0);
      gl.uniform1f(u.vignetteY,     v.u_vignette_y != null ? v.u_vignette_y : 2.0);
      gl.uniform1f(u.transparentBg, v.u_transparent_bg != null ? v.u_transparent_bg : 0.0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, activeTex);
      gl.uniform1i(u.textTex, 0);
    },

    drawText: function (ctx, size, v) {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, size, size);

      var txt = v.text || '';
      if (!txt) return;

      var fontFamily = v.textFont ? '"' + v.textFont + '"' : '"Montserrat"';
      var fontSize   = v.textFontSize != null ? v.textFontSize : 202;

      // Hard white text on black — blur is applied via WebGL framebuffer passes
      ctx.font         = 'bold ' + fontSize + 'px ' + fontFamily + ', sans-serif';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle    = 'white';
      // Canvas Y=0 is top; UNPACK_FLIP_Y maps canvas top → UV bottom.
      // textY=0.5 (center) → canvas y = (1-0.5)*size = size/2.
      var ty = v.textY != null ? v.textY : 0.5;
      ctx.fillText(txt, size / 2, (1 - ty) * size);
    },

    textKey: function (v) {
      return JSON.stringify([v.text, v.textFont, v.textFontSize, v.textY]);
    },
  });
}());
