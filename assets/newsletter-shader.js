(function () {
  var canvas = document.getElementById('newsletter-shader-canvas');
  if (!canvas) { console.warn('[newsletter-shader] canvas element not found'); return; }
  console.log('[newsletter-shader] canvas found, size:', canvas.offsetWidth, 'x', canvas.offsetHeight);

  var gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: false });
  if (!gl) { console.warn('[newsletter-shader] WebGL not available'); return; }
  console.log('[newsletter-shader] WebGL context acquired');

  var VERT_SRC = [
    'attribute vec2 a_pos;',
    'void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }'
  ].join('\n');

  var FRAG_SRC = [
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

    '  vec2 c; float a; vec2 p;',

    '  c = vec2(sin(t * 0.60) * 0.18, cos(t * 0.45) * 0.12);',
    '  a = t * 0.25;',
    '  p = uv - c; p = vec2(cos(a)*p.x - sin(a)*p.y, sin(a)*p.x + cos(a)*p.y);',
    '  g += exp(-abs(sdTriangle(p, 0.22)) * 90.0) * 0.9;',

    '  c = vec2(sin(t * 0.40 + 1.5) * 0.30, cos(t * 0.55 + 0.8) * 0.10);',
    '  a = -t * 0.18 + 1.0;',
    '  p = uv - c; p = vec2(cos(a)*p.x - sin(a)*p.y, sin(a)*p.x + cos(a)*p.y);',
    '  g += exp(-abs(sdTriangle(p, 0.14)) * 90.0) * 0.9;',

    '  c = vec2(sin(t * 0.70 + 3.0) * 0.22, cos(t * 0.35 + 2.1) * 0.14);',
    '  a = t * 0.40 + 2.5;',
    '  p = uv - c; p = vec2(cos(a)*p.x - sin(a)*p.y, sin(a)*p.x + cos(a)*p.y);',
    '  g += exp(-abs(sdTriangle(p, 0.30)) * 90.0) * 0.9;',

    '  c = vec2(sin(t * 0.50 + 5.0) * 0.25, cos(t * 0.65 + 4.2) * 0.08);',
    '  a = -t * 0.32 + 4.0;',
    '  p = uv - c; p = vec2(cos(a)*p.x - sin(a)*p.y, sin(a)*p.x + cos(a)*p.y);',
    '  g += exp(-abs(sdTriangle(p, 0.18)) * 90.0) * 0.9;',

    '  g = clamp(g, 0.0, 0.50);',

    '  vec3 color = vec3(1.0, 0.0, 1.0);',
    '  gl_FragColor = vec4(color * g, g);',
    '}'
  ].join('\n');

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('[newsletter-shader] shader compile error:', gl.getShaderInfoLog(s));
    }
    return s;
  }

  var prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER,   VERT_SRC));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG_SRC));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('[newsletter-shader] program link error:', gl.getProgramInfoLog(prog));
    return;
  }
  gl.useProgram(prog);
  console.log('[newsletter-shader] program linked OK');

  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  var aPos = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  var uTime = gl.getUniformLocation(prog, 'u_time');
  var uRes  = gl.getUniformLocation(prog, 'u_resolution');
  console.log('[newsletter-shader] uniform locations — u_time:', uTime, ' u_resolution:', uRes);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  function resize() {
    canvas.width  = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);
    console.log('[newsletter-shader] resize ->', canvas.width, 'x', canvas.height);
  }

  resize();
  window.addEventListener('resize', resize);

  var start = performance.now();
  var frameCount = 0;
  function frame() {
    var t = (performance.now() - start) / 1000;
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(uTime, t);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    frameCount++;
    if (frameCount === 1 || frameCount === 60) {
      console.log('[newsletter-shader] frame', frameCount, '— t:', t.toFixed(2), 'canvas:', canvas.width, 'x', canvas.height);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}());
