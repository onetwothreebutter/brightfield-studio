(function () {
  var canvas = document.getElementById('newsletter-shader-canvas');
  if (!canvas) { console.warn('[newsletter-shader] canvas element not found'); return; }

  var gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: false });
  if (!gl) { console.warn('[newsletter-shader] WebGL not available'); return; }

  // ── Shared vertex shader ──────────────────────────────────────────────────
  var VERT = [
    'attribute vec2 a_pos;',
    'varying vec2 v_uv;',
    'void main() {',
    '  v_uv = a_pos * 0.5 + 0.5;',
    '  gl_Position = vec4(a_pos, 0.0, 1.0);',
    '}'
  ].join('\n');

  // ── Pass 1 — scene (linear, no gamma) ────────────────────────────────────
  var SCENE_FRAG = [
    'precision mediump float;',
    'uniform float u_time;',
    'uniform vec2  u_resolution;',

    'float sdTriangle(vec2 p, float r) {',
    '  const float k = 1.7320508;',
    '  p.x = abs(p.x) - r;',
    '  p.y = p.y + r / k;',
    '  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) * 0.5;',
    '  p.x -= clamp(p.x, -2.0 * r, 0.0);',
    '  return -length(p) * sign(p.y);',
    '}',

    'void main() {',
    '  vec2 uv = gl_FragCoord.xy / u_resolution - 0.5;',
    '  uv.x *= u_resolution.x / u_resolution.y;',
    '  float t = u_time * 0.3;',
    '  float g = 0.0;',
    '  float a; vec2 p; float d;',

    '  a = t * 0.15;',
    '  p = uv - vec2(-0.80, 0.0); p = vec2(cos(a)*p.x - sin(a)*p.y, sin(a)*p.x + cos(a)*p.y);',
    '  d = sdTriangle(p, 0.30);',
    '  g += exp(-abs(d) * 550.0) * 2.0 + exp(-abs(d) * 75.0) * 0.8 + step(d, 0.0) * 0.2;',

    '  a = -t * 0.20;',
    '  p = uv - vec2(-0.40, 0.0); p = vec2(cos(a)*p.x - sin(a)*p.y, sin(a)*p.x + cos(a)*p.y);',
    '  d = sdTriangle(p, 0.22);',
    '  g += exp(-abs(d) * 550.0) * 2.0 + exp(-abs(d) * 75.0) * 0.8 + step(d, 0.0) * 0.2;',

    '  a = t * 0.25;',
    '  p = uv - vec2(0.0, 0.0); p = vec2(cos(a)*p.x - sin(a)*p.y, sin(a)*p.x + cos(a)*p.y);',
    '  d = sdTriangle(p, 0.16);',
    '  g += exp(-abs(d) * 550.0) * 2.0 + exp(-abs(d) * 75.0) * 0.8 + step(d, 0.0) * 0.2;',

    '  a = -t * 0.30;',
    '  p = uv - vec2(0.40, 0.0); p = vec2(cos(a)*p.x - sin(a)*p.y, sin(a)*p.x + cos(a)*p.y);',
    '  d = sdTriangle(p, 0.11);',
    '  g += exp(-abs(d) * 550.0) * 2.0 + exp(-abs(d) * 75.0) * 0.8 + step(d, 0.0) * 0.2;',

    '  a = t * 0.35;',
    '  p = uv - vec2(0.80, 0.0); p = vec2(cos(a)*p.x - sin(a)*p.y, sin(a)*p.x + cos(a)*p.y);',
    '  d = sdTriangle(p, 0.07);',
    '  g += exp(-abs(d) * 550.0) * 2.0 + exp(-abs(d) * 75.0) * 0.8 + step(d, 0.0) * 0.2;',

    '  vec3 color = vec3(0.88, 0.08, 1.0);',
    '  float alpha = clamp(g, 0.0, 1.0);',
    '  gl_FragColor = vec4(color * g, alpha);',
    '}'
  ].join('\n');

  // ── Pass 2 — bright-pass / threshold ─────────────────────────────────────
  var THRESH_FRAG = [
    'precision mediump float;',
    'uniform sampler2D u_tex;',
    'varying vec2 v_uv;',
    'void main() {',
    '  vec4 col = texture2D(u_tex, v_uv);',
    '  float lum = dot(col.rgb, vec3(0.2126, 0.7152, 0.0722));',
    '  float threshold = 0.10;',
    '  float knee = 0.15;',
    '  float rq = clamp(lum - (threshold - knee), 0.0, 2.0 * knee);',
    '  rq = 0.5 * rq * rq / (knee + 0.0001);',
    '  float w = max(rq, lum - threshold) / max(lum, 0.0001);',
    '  gl_FragColor = vec4(col.rgb * w, col.a * w);',
    '}'
  ].join('\n');

  // ── Passes 3-6 — separable Gaussian (5-tap bilinear trick ≈ 9-tap) ───────
  var BLUR_FRAG = [
    'precision mediump float;',
    'uniform sampler2D u_tex;',
    'uniform vec2 u_dir;',
    'varying vec2 v_uv;',
    'void main() {',
    '  vec4 s = vec4(0.0);',
    '  s += texture2D(u_tex, v_uv + u_dir * -3.2307692) * 0.0702703;',
    '  s += texture2D(u_tex, v_uv + u_dir * -1.3846154) * 0.3162162;',
    '  s += texture2D(u_tex, v_uv)                       * 0.2270270;',
    '  s += texture2D(u_tex, v_uv + u_dir *  1.3846154) * 0.3162162;',
    '  s += texture2D(u_tex, v_uv + u_dir *  3.2307692) * 0.0702703;',
    '  gl_FragColor = s;',
    '}'
  ].join('\n');

  // ── Pass 7 — composite: scene + bloom, gamma-encode ──────────────────────
  var COMPOSITE_FRAG = [
    'precision mediump float;',
    'uniform sampler2D u_scene;',
    'uniform sampler2D u_bloom;',
    'uniform float u_bloomStrength;',
    'varying vec2 v_uv;',
    'void main() {',
    '  vec4 scene = texture2D(u_scene, v_uv);',
    '  vec4 bloom = texture2D(u_bloom, v_uv);',
    '  vec3 col = scene.rgb + bloom.rgb * u_bloomStrength;',
    '  float a   = clamp(scene.a + bloom.a * u_bloomStrength * 0.5, 0.0, 1.0);',
    '  vec3 enc  = pow(max(col, 0.0), vec3(1.0 / 2.2));',
    '  gl_FragColor = vec4(enc, a);',
    '}'
  ].join('\n');

  // ── Compile / link helpers ────────────────────────────────────────────────
  function compileShader(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('[newsletter-shader] compile error:', gl.getShaderInfoLog(s));
    }
    return s;
  }

  function buildProgram(fragSrc) {
    var p = gl.createProgram();
    gl.attachShader(p, compileShader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, compileShader(gl.FRAGMENT_SHADER, fragSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error('[newsletter-shader] link error:', gl.getProgramInfoLog(p));
    }
    return p;
  }

  var sceneProg     = buildProgram(SCENE_FRAG);
  var threshProg    = buildProgram(THRESH_FRAG);
  var blurProg      = buildProgram(BLUR_FRAG);
  var compositeProg = buildProgram(COMPOSITE_FRAG);

  // ── Fullscreen quad geometry ──────────────────────────────────────────────
  var quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

  function bindQuad(prog) {
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    var loc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  }

  // ── FBO helpers ───────────────────────────────────────────────────────────
  function makeFBO(w, h) {
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return { fbo: fbo, tex: tex, w: w, h: h };
  }

  function deleteFBO(f) {
    gl.deleteFramebuffer(f.fbo);
    gl.deleteTexture(f.tex);
  }

  // ── FBO state (recreated on resize) ──────────────────────────────────────
  var fbos = null;

  function buildFBOs(w, h) {
    var hw = Math.max(1, w >> 1);
    var hh = Math.max(1, h >> 1);
    return {
      scene: makeFBO(w, h),
      ping:  makeFBO(hw, hh),
      pong:  makeFBO(hw, hh)
    };
  }

  function destroyFBOs(f) {
    if (!f) return;
    deleteFBO(f.scene);
    deleteFBO(f.ping);
    deleteFBO(f.pong);
  }

  // ── Uniform locations ─────────────────────────────────────────────────────
  var sceneU = {
    time: gl.getUniformLocation(sceneProg, 'u_time'),
    res:  gl.getUniformLocation(sceneProg, 'u_resolution')
  };
  var threshU = { tex: gl.getUniformLocation(threshProg, 'u_tex') };
  var blurU   = {
    tex: gl.getUniformLocation(blurProg, 'u_tex'),
    dir: gl.getUniformLocation(blurProg, 'u_dir')
  };
  var compU = {
    scene:    gl.getUniformLocation(compositeProg, 'u_scene'),
    bloom:    gl.getUniformLocation(compositeProg, 'u_bloom'),
    strength: gl.getUniformLocation(compositeProg, 'u_bloomStrength')
  };

  // ── Resize ────────────────────────────────────────────────────────────────
  function resize() {
    canvas.width  = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    destroyFBOs(fbos);
    fbos = buildFBOs(canvas.width, canvas.height);
  }

  resize();
  window.addEventListener('resize', resize);

  // ── Render loop ───────────────────────────────────────────────────────────
  var start = performance.now();

  function frame() {
    var t  = (performance.now() - start) / 1000;
    var W  = canvas.width;
    var H  = canvas.height;
    var hw = fbos.ping.w;
    var hh = fbos.ping.h;

    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);

    // Pass 1: scene → sceneFBO (full res, linear)
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbos.scene.fbo);
    gl.viewport(0, 0, W, H);
    gl.useProgram(sceneProg);
    bindQuad(sceneProg);
    gl.uniform1f(sceneU.time, t);
    gl.uniform2f(sceneU.res, W, H);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Pass 2: threshold → pingFBO (half res, downsamples via bilinear)
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbos.ping.fbo);
    gl.viewport(0, 0, hw, hh);
    gl.useProgram(threshProg);
    bindQuad(threshProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fbos.scene.tex);
    gl.uniform1i(threshU.tex, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Passes 3-6: ping-pong Gaussian blur at half res (2 iterations)
    gl.useProgram(blurProg);
    bindQuad(blurProg);

    for (var i = 0; i < 2; i++) {
      // H-blur: ping → pong
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbos.pong.fbo);
      gl.viewport(0, 0, hw, hh);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, fbos.ping.tex);
      gl.uniform1i(blurU.tex, 0);
      gl.uniform2f(blurU.dir, 1.0 / hw, 0.0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // V-blur: pong → ping
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbos.ping.fbo);
      gl.viewport(0, 0, hw, hh);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, fbos.pong.tex);
      gl.uniform1i(blurU.tex, 0);
      gl.uniform2f(blurU.dir, 0.0, 1.0 / hh);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // Pass 7: composite (scene + bloom) → screen, gamma-encode
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(compositeProg);
    bindQuad(compositeProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fbos.scene.tex);
    gl.uniform1i(compU.scene, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, fbos.ping.tex);
    gl.uniform1i(compU.bloom, 1);
    gl.uniform1f(compU.strength, 8.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}());
