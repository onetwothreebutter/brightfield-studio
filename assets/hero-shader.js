(function () {
  'use strict';

  var canvas = document.getElementById('hero-shader-canvas');
  if (!canvas) return;

  var poster = document.getElementById('hero-poster');
  function showPoster() {
    if (poster) poster.classList.add('is-loaded');
  }

  var gl = canvas.getContext('webgl2');
  if (!gl) {
    canvas.style.display = 'none';
    showPoster();
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
    'uniform float u_mobile_fade;',
    'uniform float u_fade_start;',
    'uniform float u_fade_end;',
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
    '',
    '  float topFade = mix(1.0, 1.0 - smoothstep(u_fade_start, u_fade_end, uv.y), u_mobile_fade);',
    '  fragColor = vec4(r * vign * topFade, g * vign * topFade, b * vign * topFade, topFade);',
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
  if (!vert || !frag) {
    showPoster();
    return;
  }

  var program = gl.createProgram();
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Hero shader link error:', gl.getProgramInfoLog(program));
    showPoster();
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

  var timeLoc        = gl.getUniformLocation(program, 'u_time');
  var resLoc         = gl.getUniformLocation(program, 'u_resolution');
  var mobileFadeLoc  = gl.getUniformLocation(program, 'u_mobile_fade');
  var fadeStartLoc   = gl.getUniformLocation(program, 'u_fade_start');
  var fadeEndLoc     = gl.getUniformLocation(program, 'u_fade_end');

  var mobileQuery = window.matchMedia('(max-width: 768px)');

  var params = {
    forceMobileFade: false,
    fadeStart: 0.19,
    fadeEnd: 0.64
  };

  function currentMobileFade() {
    if (params.forceMobileFade) return 1.0;
    return mobileQuery.matches ? 1.0 : 0.0;
  }

  if (window.location.search.indexOf('heroDebug') !== -1) {
    buildDebugPanel();
  }

  function buildDebugPanel() {
    var panel = document.createElement('div');
    panel.style.cssText = [
      'position:fixed', 'bottom:1rem', 'right:1rem', 'z-index:9999',
      'background:rgba(0,0,0,0.85)', 'color:#0ff', 'font:12px monospace',
      'padding:12px 14px', 'border:1px solid #0ff', 'border-radius:6px',
      'width:220px'
    ].join(';');

    function addRow(labelText, min, max, step, value, onInput) {
      var row = document.createElement('div');
      row.style.cssText = 'margin-bottom:8px;';

      var label = document.createElement('label');
      label.style.cssText = 'display:flex;justify-content:space-between;';
      var valueSpan = document.createElement('span');
      valueSpan.textContent = value;
      label.textContent = labelText + ' ';
      label.appendChild(valueSpan);

      var input = document.createElement('input');
      input.type = 'range';
      input.min = min;
      input.max = max;
      input.step = step;
      input.value = value;
      input.style.cssText = 'width:100%;';
      input.addEventListener('input', function () {
        var v = parseFloat(input.value);
        valueSpan.textContent = v;
        onInput(v);
      });

      row.appendChild(label);
      row.appendChild(input);
      panel.appendChild(row);
    }

    var title = document.createElement('div');
    title.textContent = 'hero-shader debug';
    title.style.cssText = 'margin-bottom:10px;font-weight:bold;';
    panel.appendChild(title);

    var forceRow = document.createElement('label');
    forceRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:10px;';
    var forceCheckbox = document.createElement('input');
    forceCheckbox.type = 'checkbox';
    forceCheckbox.checked = params.forceMobileFade;
    forceCheckbox.addEventListener('change', function () {
      params.forceMobileFade = forceCheckbox.checked;
    });
    forceRow.appendChild(forceCheckbox);
    forceRow.appendChild(document.createTextNode('force mobile fade'));
    panel.appendChild(forceRow);

    addRow('fade start', 0, 1, 0.01, params.fadeStart, function (v) { params.fadeStart = v; });
    addRow('fade end', 0, 1, 0.01, params.fadeEnd, function (v) { params.fadeEnd = v; });

    document.body.appendChild(panel);
  }

  function resize() {
    canvas.width  = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  window.addEventListener('resize', resize);
  resize();

  showPoster();

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var start = performance.now();

  function render() {
    var t = (performance.now() - start) / 1000.0;
    gl.uniform1f(timeLoc, t);
    gl.uniform2f(resLoc, canvas.width, canvas.height);
    gl.uniform1f(mobileFadeLoc, currentMobileFade());
    gl.uniform1f(fadeStartLoc, params.fadeStart);
    gl.uniform1f(fadeEndLoc, params.fadeEnd);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    requestAnimationFrame(render);
  }

  render();
}());
