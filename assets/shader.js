(function () {
  'use strict';

  var canvas = document.getElementById('shader-canvas');
  if (!canvas) return;

  var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
  if (!gl) {
    canvas.style.display = 'none';
    return;
  }

  var vertSrc = [
    'attribute vec2 a_position;',
    'void main() {',
    '  gl_Position = vec4(a_position, 0.0, 1.0);',
    '}'
  ].join('\n');

  // Default: dot halftone driven by uniforms so the GUI can control it
  var fragSrc = [
    'precision mediump float;',
    'uniform float u_time;',
    'uniform vec2  u_resolution;',
    'uniform float u_rows;',
    'uniform float u_cols;',
    'uniform float u_min_radius;',
    'uniform float u_max_radius;',
    'uniform float u_invert;',
    'uniform vec3  u_dot_color;',
    '',
    'void main() {',
    '  vec2 uv = gl_FragCoord.xy / u_resolution;',
    '',
    '  // Cell aspect ratio — keeps dots circular',
    '  float ratio = (u_resolution.x / u_cols) / (u_resolution.y / u_rows);',
    '',
    '  vec2 gridUv   = uv * vec2(u_cols, u_rows);',
    '  vec2 localUv  = fract(gridUv) - 0.5;',
    '  vec2 corrected = vec2(localUv.x * ratio, localUv.y);',
    '  float dist = length(corrected);',
    '',
    '  float mixFactor  = mix(uv.y, 1.0 - uv.y, u_invert);',
    '  float effectiveMax = u_max_radius * ratio;',
    '  float radius = mix(effectiveMax, u_min_radius, mixFactor);',
    '',
    '  float eps    = 0.008;',
    '  float circle = 1.0 - smoothstep(radius - eps, radius + eps, dist);',
    '',
    '  vec3 bg    = vec3(0.031);',
    '  vec3 color = mix(bg, u_dot_color, circle);',
    '  gl_FragColor = vec4(color, 1.0);',
    '}'
  ].join('\n');

  // Per-product shader override via metafield
  var fragSrcEl = document.getElementById('shader-frag-src');
  if (fragSrcEl) {
    try { fragSrc = JSON.parse(fragSrcEl.textContent) || fragSrc; } catch (e) {}
  }

  function compileShader(gl, src, type) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('Shader error:', gl.getShaderInfoLog(s));
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
    console.error('Program link error:', gl.getProgramInfoLog(program));
    return;
  }

  gl.useProgram(program);

  // Full-screen quad
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

  // Uniform locations
  var uTime      = gl.getUniformLocation(program, 'u_time');
  var uRes       = gl.getUniformLocation(program, 'u_resolution');
  var uRows      = gl.getUniformLocation(program, 'u_rows');
  var uCols      = gl.getUniformLocation(program, 'u_cols');
  var uMinRadius = gl.getUniformLocation(program, 'u_min_radius');
  var uMaxRadius = gl.getUniformLocation(program, 'u_max_radius');
  var uInvert    = gl.getUniformLocation(program, 'u_invert');
  var uDotColor  = gl.getUniformLocation(program, 'u_dot_color');

  function resize() {
    var w = canvas.offsetWidth;
    var h = canvas.offsetHeight;
    if (!w || !h) return; // hidden tab — skip until visible
    canvas.width  = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
  }
  window.addEventListener('resize', resize);
  resize();

  var start = performance.now();

  function render() {
    var t = (performance.now() - start) / 1000.0;
    var v = (window._shaderState && window._shaderState.values) || {};

    gl.uniform1f(uTime, t);
    gl.uniform2f(uRes,  canvas.width, canvas.height);
    gl.uniform1f(uRows,      v.u_rows       != null ? v.u_rows       : 48);
    gl.uniform1f(uCols,      v.u_cols       != null ? v.u_cols       : 37);
    gl.uniform1f(uMinRadius, v.u_min_radius != null ? v.u_min_radius : 0.04);
    gl.uniform1f(uMaxRadius, v.u_max_radius != null ? v.u_max_radius : 0.48);
    gl.uniform1f(uInvert,    v.u_invert     != null ? v.u_invert     : 0);
    gl.uniform3fv(uDotColor, v.u_dot_color  || [0.0, 1.0, 1.0]);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    requestAnimationFrame(render);
  }

  render();
}());
