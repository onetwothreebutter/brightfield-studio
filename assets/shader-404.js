(function () {
  var canvas = document.getElementById('shader-404-canvas');
  if (!canvas) return;

  var gl = canvas.getContext('webgl2');
  if (!gl) return;

  var fragSrc = [
    '#version 300 es',
    'precision highp float;',
    '',
    'uniform vec2 u_resolution;',
    'uniform float u_time;',
    '',
    'out vec4 fragColor;',
    '',
    'float hash(vec2 p) {',
    '  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);',
    '}',
    '',
    'void main() {',
    '  vec2 uv = gl_FragCoord.xy / u_resolution;',
    '',
    '  // Pixelate into grid cells for digital look',
    '  float cellSize = 3.0;',
    '  vec2 cell = floor(gl_FragCoord.xy / cellSize);',
    '',
    '  // Step at ~12fps for discrete digital flicker',
    '  float t = floor(u_time * 12.0);',
    '  float noise = hash(cell + t * 0.37);',
    '',
    '  // ~8% of pixels lit at any moment',
    '  float brightness = step(0.92, noise);',
    '',
    '  // Color: cyan with occasional magenta outliers',
    '  float colorNoise = hash(cell + t * 0.71 + 99.0);',
    '  vec3 color = mix(',
    '    vec3(0.0, 1.0, 1.0),',
    '    vec3(1.0, 0.0, 1.0),',
    '    step(0.82, colorNoise)',
    '  );',
    '',
    '  // Glitch bands — horizontal streaks that appear occasionally',
    '  float bandT = floor(u_time * 2.0);',
    '  float bandY = hash(vec2(bandT * 0.13, 0.0));',
    '  float bandWidth = 0.03 + 0.05 * hash(vec2(bandT, 1.0));',
    '  float bandActive = step(0.65, hash(vec2(bandT * 0.3, 2.0)));',
    '  float inBand = step(abs(uv.y - bandY), bandWidth * 0.5) * bandActive;',
    '  float bandNoise = hash(cell + bandT * 1.3);',
    '  float bandBrightness = step(0.25, bandNoise) * 0.6;',
    '',
    '  float finalBrightness = max(brightness, inBand * bandBrightness);',
    '',
    '  vec3 finalColor = color * finalBrightness * 0.85;',
    '',
    '  // Soft vignette',
    '  vec2 v = uv * 2.0 - 1.0;',
    '  float vignette = 1.0 - dot(v * 0.55, v * 0.55);',
    '  finalColor *= max(vignette, 0.0);',
    '',
    '  fragColor = vec4(finalColor, 1.0);',
    '}',
  ].join('\n');

  var vertSrc = [
    '#version 300 es',
    'in vec2 a_position;',
    'void main() {',
    '  gl_Position = vec4(a_position, 0.0, 1.0);',
    '}',
  ].join('\n');

  function compileShader(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  }

  var program = gl.createProgram();
  gl.attachShader(program, compileShader(gl.VERTEX_SHADER, vertSrc));
  gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, fragSrc));
  gl.linkProgram(program);
  gl.useProgram(program);

  // Full-screen quad
  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  var posLoc = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  var uRes = gl.getUniformLocation(program, 'u_resolution');
  var uTime = gl.getUniformLocation(program, 'u_time');

  var dpr = window.devicePixelRatio || 1;
  var start = performance.now();

  function resize() {
    var w = canvas.offsetWidth;
    var h = canvas.offsetHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  window.addEventListener('resize', resize);
  resize();

  function frame() {
    var t = (performance.now() - start) / 1000;
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, t);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    requestAnimationFrame(frame);
  }

  frame();
})();
