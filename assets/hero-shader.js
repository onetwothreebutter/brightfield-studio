(function () {
  'use strict';

  var canvas = document.getElementById('hero-shader-canvas');
  if (!canvas) return;

  var gl = canvas.getContext('webgl2');
  if (!gl) {
    canvas.style.display = 'none';
    return;
  }

  var vertSrc = [
    '#version 300 es',
    'in vec2 a_position;',
    'void main() {',
    '  gl_Position = vec4(a_position, 0.0, 1.0);',
    '}'
  ].join('\n');

  // Neon plasma — cyan (#00ffff) + magenta (#ff00ff) on dark
  var fragSrc = [
    '#version 300 es',
    'precision mediump float;',
    'uniform float u_time;',
    'uniform vec2  u_resolution;',
    '',
    'out vec4 fragColor;',
    '',
    'void main() {',
    '  vec2 uv = gl_FragCoord.xy / u_resolution;',
    '  vec2 p  = uv * 2.0 - 1.0;',
    '  p.x *= u_resolution.x / u_resolution.y;',
    '',
    '  float t = u_time * 0.22;',
    '',
    '  float v = 0.0;',
    '  v += sin(p.x * 3.8 + t * 1.1);',
    '  v += sin(p.y * 3.4 + t * 0.85);',
    '  v += sin((p.x + p.y) * 2.6 + t * 0.65);',
    '  v += sin(sqrt(p.x * p.x + p.y * p.y + 0.4) * 6.5 - t * 1.4);',
    '',
    '  float c         = sin(v * 0.5) * 0.5 + 0.5;',
    '  float intensity = pow(abs(sin(v * 0.75)), 2.8) * 0.7;',
    '',
    '  float r = mix(0.031, mix(0.0,   1.0, c),   intensity);',
    '  float g = mix(0.031, 0.0,               intensity * 0.9);',
    '  float b = mix(0.031, 1.0,               intensity);',
    '',
    '  float scan = sin(gl_FragCoord.y * 1.8) * 0.012;',
    '  r += scan; g += scan; b += scan;',
    '',
    '  float vign = 1.0 - smoothstep(0.5, 1.4, length(p * 0.6));',
    '  fragColor = vec4(r * vign, g * vign, b * vign, 1.0);',
    '}'
  ].join('\n');

  function compileShader(gl, src, type) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('Hero shader error:', gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  var vert = compileShader(gl, vertSrc, gl.VERTEX_SHADER);
  var frag = compileShader(gl, fragSrc, gl.FRAGMENT_SHADER);
  if (!vert || !frag) return;

  var program = gl.createProgram();
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Hero shader link error:', gl.getProgramInfoLog(program));
    return;
  }

  gl.useProgram(program);

  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1,  1, -1,  -1,  1,  1,  1]),
    gl.STATIC_DRAW
  );

  var posLoc = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  var timeLoc = gl.getUniformLocation(program, 'u_time');
  var resLoc  = gl.getUniformLocation(program, 'u_resolution');

  function resize() {
    canvas.width  = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  window.addEventListener('resize', resize);
  resize();

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var start = performance.now();

  function render() {
    var t = (performance.now() - start) / 1000.0;
    gl.uniform1f(timeLoc, t);
    gl.uniform2f(resLoc, canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    requestAnimationFrame(render);
  }

  render();
}());
