(function () {
  'use strict';

  // LineCircle GLSL — stripped for demo (no text overlay, no export flag)
  var fragSrc = [
    '#extension GL_OES_standard_derivatives : enable',
    'precision mediump float;',
    'uniform vec2  u_resolution;',
    'uniform float u_aspect;',
    'uniform float u_radius;',
    'uniform float u_line_count;',
    'uniform float u_power;',
    'uniform float u_width_top;',
    'uniform float u_width_bot;',
    'uniform vec3  u_palette_a;',
    'uniform vec3  u_palette_b;',
    'uniform vec3  u_palette_c;',
    'uniform vec3  u_palette_d;',
    'uniform float u_color_mode;',
    'uniform vec3  u_color0;',
    'uniform vec3  u_color1;',
    'uniform vec3  u_color2;',
    'uniform vec3  u_color3;',
    'uniform float u_tri_enabled;',
    'uniform float u_tri_rotation;',
    'uniform float u_tri_size;',
    'uniform float u_tri_width;',
    'uniform float u_center_circle_enabled;',
    'uniform float u_center_circle_radius;',
    '',
    'vec3 cosinePalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {',
    '  return a + b * cos(6.28318 * (c * t + d));',
    '}',
    '',
    'void main() {',
    '  vec2 uv          = gl_FragCoord.xy / u_resolution;',
    '  vec2 centeredUV  = uv - 0.5;',
    '  vec2 correctedUV = vec2(centeredUV.x * u_aspect, centeredUV.y);',
    '',
    '  float circleSDF  = length(correctedUV) - u_radius;',
    '  float aaCircle   = fwidth(circleSDF) * 0.5;',
    '  float circleMask = 1.0 - smoothstep(-aaCircle, aaCircle, circleSDF);',
    '',
    '  float circleTop = 0.5 + u_radius;',
    '  float t         = clamp((circleTop - uv.y) / (u_radius * 2.0), 0.0, 1.0);',
    '  float warped    = pow(t, u_power);',
    '  float phase     = fract(warped * u_line_count);',
    '  float lineWidth = mix(u_width_top, u_width_bot, t);',
    '  float aaLine    = fwidth(phase) * 0.5;',
    '  float lineMask  = 1.0 - smoothstep(lineWidth - aaLine, lineWidth + aaLine, phase);',
    '',
    '  vec3 palColor = cosinePalette(t, u_palette_a, u_palette_b, u_palette_c, u_palette_d);',
    '',
    '  float t01 = clamp(t * 3.0, 0.0, 1.0);',
    '  float t12 = clamp((t - 1.0 / 3.0) * 3.0, 0.0, 1.0);',
    '  float t23 = clamp((t - 2.0 / 3.0) * 3.0, 0.0, 1.0);',
    '  vec3 gradColor = mix(',
    '    mix(mix(u_color0, u_color1, t01), mix(u_color1, u_color2, t12), step(1.0 / 3.0, t)),',
    '    mix(u_color2, u_color3, t23),',
    '    step(2.0 / 3.0, t)',
    '  );',
    '  vec3 finalPal = mix(palColor, gradColor, u_color_mode);',
    '',
    '  float cosR    = cos(u_tri_rotation);',
    '  float sinR    = sin(u_tri_rotation);',
    '  vec2  triUV   = vec2(',
    '    correctedUV.x * cosR - correctedUV.y * sinR,',
    '    correctedUV.x * sinR + correctedUV.y * cosR',
    '  );',
    '  float cosW     = cos(u_tri_width);',
    '  float sinW     = sin(u_tri_width);',
    '  float triEdgeL = triUV.x * cosW - triUV.y * sinW;',
    '  float triEdgeR = -triUV.x * cosW - triUV.y * sinW;',
    '  float triEdgeB = triUV.y + u_radius * u_tri_size;',
    '  float triInner = smoothstep(-fwidth(triEdgeL) * 0.5, fwidth(triEdgeL) * 0.5, triEdgeL)',
    '                 * smoothstep(-fwidth(triEdgeR) * 0.5, fwidth(triEdgeR) * 0.5, triEdgeR)',
    '                 * smoothstep(-fwidth(triEdgeB) * 0.5, fwidth(triEdgeB) * 0.5, triEdgeB);',
    '  float triMask  = mix(1.0, 1.0 - triInner, u_tri_enabled);',
    '',
    '  float centerSDF   = length(correctedUV) - u_center_circle_radius;',
    '  float centerInner = 1.0 - smoothstep(-fwidth(centerSDF) * 0.5, fwidth(centerSDF) * 0.5, centerSDF);',
    '  float centerMask  = mix(1.0, 1.0 - centerInner, u_center_circle_enabled);',
    '',
    '  float mask = circleMask * lineMask * triMask * centerMask;',
    '  gl_FragColor = vec4(finalPal * mask, mask);',
    '}'
  ].join('\n');

  var canvas = document.getElementById('demo-shader-canvas');
  if (!canvas) return;

  var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
  if (!gl) { canvas.style.display = 'none'; return; }

  gl.getExtension('OES_standard_derivatives');

  function compileShader(src, type) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('[demo-shader]', gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  var vertSrc = [
    'attribute vec2 a_position;',
    'void main() { gl_Position = vec4(a_position, 0.0, 1.0); }'
  ].join('\n');

  var vert = compileShader(vertSrc, gl.VERTEX_SHADER);
  var frag = compileShader(fragSrc, gl.FRAGMENT_SHADER);
  if (!vert || !frag) return;

  var program = gl.createProgram();
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('[demo-shader] link error:', gl.getProgramInfoLog(program));
    return;
  }
  gl.useProgram(program);

  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  var posLoc = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  function loc(name) { return gl.getUniformLocation(program, name); }
  var u = {
    res:                 loc('u_resolution'),
    aspect:              loc('u_aspect'),
    radius:              loc('u_radius'),
    lineCount:           loc('u_line_count'),
    power:               loc('u_power'),
    widthTop:            loc('u_width_top'),
    widthBot:            loc('u_width_bot'),
    paletteA:            loc('u_palette_a'),
    paletteB:            loc('u_palette_b'),
    paletteC:            loc('u_palette_c'),
    paletteD:            loc('u_palette_d'),
    colorMode:           loc('u_color_mode'),
    color0:              loc('u_color0'),
    color1:              loc('u_color1'),
    color2:              loc('u_color2'),
    color3:              loc('u_color3'),
    triEnabled:          loc('u_tri_enabled'),
    triRotation:         loc('u_tri_rotation'),
    triSize:             loc('u_tri_size'),
    triWidth:            loc('u_tri_width'),
    centerCircleEnabled: loc('u_center_circle_enabled'),
    centerCircleRadius:  loc('u_center_circle_radius'),
  };

  function resize() {
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.offsetWidth;
    var h = canvas.offsetHeight;
    if (!w || !h) return;
    canvas.width  = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    if (window._demoState) window._demoState.dirty = true;
  }
  window.addEventListener('resize', resize);
  resize();

  function render() {
    var state = window._demoState;
    if (!state || !state.dirty) return;
    state.dirty = false;

    var v = state.values;
    var w = canvas.width;
    var h = canvas.height;
    if (!w || !h) return;

    var aspect = w / h;
    var radius = 0.414 * Math.min(1.0, aspect); // stays inside canvas on portrait
    gl.uniform2f(u.res,       w, h);
    gl.uniform1f(u.aspect,    aspect);
    gl.uniform1f(u.radius,    radius);
    gl.uniform1f(u.lineCount, v.u_line_count != null ? v.u_line_count : 20);
    gl.uniform1f(u.power,     v.u_power      != null ? v.u_power      : 2.5);
    gl.uniform1f(u.widthTop,  0.05);
    gl.uniform1f(u.widthBot,  0.75);
    gl.uniform3fv(u.paletteA, v.u_palette_a || [0.5, 0.5, 0.5]);
    gl.uniform3fv(u.paletteB, v.u_palette_b || [0.5, 0.5, 0.5]);
    gl.uniform3fv(u.paletteC, v.u_palette_c || [1.0, 1.0, 1.0]);
    gl.uniform3fv(u.paletteD, v.u_palette_d || [0.0, 0.33, 0.67]);
    gl.uniform1f(u.colorMode, v.u_color_mode != null ? v.u_color_mode : 0.0);
    gl.uniform3fv(u.color0,   v.u_color0 || [1.0, 0.2,  0.4]);
    gl.uniform3fv(u.color1,   v.u_color1 || [1.0, 0.8,  0.0]);
    gl.uniform3fv(u.color2,   v.u_color2 || [0.0, 0.8,  1.0]);
    gl.uniform3fv(u.color3,   v.u_color3 || [0.667, 0.0, 1.0]);
    // Fixed triangle + center circle defaults
    gl.uniform1f(u.triEnabled,          1.0);
    gl.uniform1f(u.triRotation,         0.0);
    gl.uniform1f(u.triSize,             1.0);
    gl.uniform1f(u.triWidth,            (45 * Math.PI) / 180);
    gl.uniform1f(u.centerCircleEnabled, 1.0);
    gl.uniform1f(u.centerCircleRadius,  v.u_center_circle_radius != null ? v.u_center_circle_radius : 0.04);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function loop() {
    render();
    requestAnimationFrame(loop);
  }
  loop();
}());
