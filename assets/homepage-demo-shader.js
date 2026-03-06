(function () {
  'use strict';

  var CANVAS_SIZE  = 512;
  var FONT_FAMILY  = 'Montserrat';
  var FONT_SIZE    = 300;
  var LETTERS      = ['B', 'F', 'S', 'T'];

  function drawLetter(ctx, letter, font, size) {
    var c = ctx.canvas;
    c.width  = CANVAS_SIZE;
    c.height = CANVAS_SIZE;
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    if (letter) {
      ctx.font         = 'bold ' + size + 'px "' + font + '", monospace';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'alphabetic';
      var m = ctx.measureText(letter);
      var y = CANVAS_SIZE / 2 +
        (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
      ctx.fillStyle = 'rgb(255,0,0)';
      ctx.fillText(letter, CANVAS_SIZE / 2, y);
    }
  }

  function uploadTex(gl, tex, canvas) {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  // Three-square GLSL — same as three-square.js (cosine + 4-stop palette)
  var fragSrc = [
    'precision mediump float;',
    '',
    'uniform vec2      u_resolution;',
    'uniform float     u_aspect;',
    'uniform float     u_square_size;',
    'uniform float     u_offset;',
    'uniform float     u_density;',
    'uniform float     u_col_width;',
    'uniform float     u_col_width_wide;',
    'uniform float     u_global_gradient;',
    'uniform float     u_square_count;',
    'uniform vec3      u_outline_color;',
    'uniform vec3      u_a;',
    'uniform vec3      u_b;',
    'uniform vec3      u_c;',
    'uniform vec3      u_d;',
    'uniform float     u_color_mode;',
    'uniform vec3      u_color0;',
    'uniform vec3      u_color1;',
    'uniform vec3      u_color2;',
    'uniform vec3      u_color3;',
    'uniform sampler2D u_tex1;',
    'uniform sampler2D u_tex2;',
    'uniform sampler2D u_tex3;',
    'uniform sampler2D u_tex4;',
    '',
    'vec3 cosinePalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {',
    '  return a + b * cos(6.28318 * (c * t + d));',
    '}',
    '',
    'float sdBox2d(vec2 p, float s) {',
    '  return max(abs(p.x), abs(p.y)) - s;',
    '}',
    '',
    'void colLayer(',
    '  vec2 p, vec2 center,',
    '  sampler2D letterTex,',
    '  float globalPalT,',
    '  out float outAlpha, out vec3 outCol',
    ') {',
    '  vec2  localUV    = (p - center + u_square_size) / (u_square_size * 2.0);',
    '  float scaledX    = localUV.x * u_density;',
    '  float cellX      = fract(scaledX) - 0.5;',
    '',
    '  float fillSample = smoothstep(0.3, 0.7, texture2D(letterTex, localUV).r);',
    '',
    '  float effWidth  = mix(u_col_width, u_col_width_wide, fillSample);',
    '  float colInside = 1.0 - step(0.0, abs(cellX) - effWidth);',
    '',
    '  float palT = mix(localUV.x, globalPalT, u_global_gradient);',
    '',
    '  vec3 cosineCol = cosinePalette(palT, u_a, u_b, u_c, u_d);',
    '',
    '  float t01 = clamp(palT * 3.0, 0.0, 1.0);',
    '  float t12 = clamp((palT - 1.0 / 3.0) * 3.0, 0.0, 1.0);',
    '  float t23 = clamp((palT - 2.0 / 3.0) * 3.0, 0.0, 1.0);',
    '  vec3 gradCol = mix(',
    '    mix(mix(u_color0, u_color1, t01), mix(u_color1, u_color2, t12), step(1.0 / 3.0, palT)),',
    '    mix(u_color2, u_color3, t23),',
    '    step(2.0 / 3.0, palT)',
    '  );',
    '',
    '  outCol   = mix(cosineCol, gradCol, u_color_mode);',
    '  outAlpha = colInside;',
    '}',
    '',
    'void main() {',
    '  vec2 uv      = gl_FragCoord.xy / u_resolution;',
    '  vec2 centered = uv - 0.5;',
    '  vec2 p        = vec2(centered.x * u_aspect, centered.y);',
    '',
    '  float halfN = (u_square_count - 1.0) * 0.5;',
    '  float c1x   = (0.0 - halfN) * u_offset;',
    '  float c2x   = (1.0 - halfN) * u_offset;',
    '  float c3x   = (2.0 - halfN) * u_offset;',
    '  float c4x   = (3.0 - halfN) * u_offset;',
    '  vec2  c1    = vec2(c1x, -c1x);',
    '  vec2  c2    = vec2(c2x, -c2x);',
    '  vec2  c3    = vec2(c3x, -c3x);',
    '  vec2  c4    = vec2(c4x, -c4x);',
    '',
    '  float sqMask1 = 1.0 - step(0.0, sdBox2d(p - c1, u_square_size));',
    '  float sqMask2 = 1.0 - step(0.0, sdBox2d(p - c2, u_square_size));',
    '  float sqMask3 = (1.0 - step(0.0, sdBox2d(p - c3, u_square_size))) * step(2.5, u_square_count);',
    '  float sqMask4 = (1.0 - step(0.0, sdBox2d(p - c4, u_square_size))) * step(3.5, u_square_count);',
    '',
    '  float outerCX          = halfN * u_offset;',
    '  float gradientHalfWidth = outerCX + u_square_size;',
    '  float globalPalT       = (p.x + gradientHalfWidth) / max(gradientHalfWidth * 2.0, 0.001);',
    '',
    '  float a1; vec3 col1;',
    '  float a2; vec3 col2;',
    '  float a3; vec3 col3;',
    '  float a4; vec3 col4;',
    '  colLayer(p, c1, u_tex1, globalPalT, a1, col1);',
    '  colLayer(p, c2, u_tex2, globalPalT, a2, col2);',
    '  colLayer(p, c3, u_tex3, globalPalT, a3, col3);',
    '  colLayer(p, c4, u_tex4, globalPalT, a4, col4);',
    '',
    '  vec3  finalColor = vec3(0.0);',
    '  float finalAlpha = 0.0;',
    '',
    '  float sq1 = a1 * sqMask1;',
    '  finalColor = mix(finalColor, col1, sq1);',
    '  finalAlpha = mix(finalAlpha, 1.0, sq1);',
    '  float sq2 = a2 * sqMask2;',
    '  finalColor = mix(finalColor, col2, sq2);',
    '  finalAlpha = mix(finalAlpha, 1.0, sq2);',
    '  float sq3 = a3 * sqMask3;',
    '  finalColor = mix(finalColor, col3, sq3);',
    '  finalAlpha = mix(finalAlpha, 1.0, sq3);',
    '  float sq4 = a4 * sqMask4;',
    '  finalColor = mix(finalColor, col4, sq4);',
    '  finalAlpha = mix(finalAlpha, 1.0, sq4);',
    '',
    '  gl_FragColor = vec4(finalColor, finalAlpha);',
    '}'
  ].join('\n');

  var canvas = document.getElementById('demo-shader-canvas');
  if (!canvas) return;

  var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
  if (!gl) { canvas.style.display = 'none'; return; }

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
    res:          loc('u_resolution'),
    aspect:       loc('u_aspect'),
    squareSize:   loc('u_square_size'),
    offset:       loc('u_offset'),
    density:      loc('u_density'),
    colWidth:     loc('u_col_width'),
    colWidthWide: loc('u_col_width_wide'),
    globalGrad:   loc('u_global_gradient'),
    squareCount:  loc('u_square_count'),
    outlineColor: loc('u_outline_color'),
    palA:         loc('u_a'),
    palB:         loc('u_b'),
    palC:         loc('u_c'),
    palD:         loc('u_d'),
    colorMode:    loc('u_color_mode'),
    color0:       loc('u_color0'),
    color1:       loc('u_color1'),
    color2:       loc('u_color2'),
    color3:       loc('u_color3'),
    tex1:         loc('u_tex1'),
    tex2:         loc('u_tex2'),
    tex3:         loc('u_tex3'),
    tex4:         loc('u_tex4'),
  };

  // Letter textures — fixed B F S T
  var texCanvases = [], texCtxs = [], glTextures = [], drawnKeys = [];
  for (var i = 0; i < 4; i++) {
    var tc = document.createElement('canvas');
    tc.width = tc.height = CANVAS_SIZE;
    texCanvases.push(tc);
    var tctx = tc.getContext('2d');
    texCtxs.push(tctx);
    tctx.fillStyle = 'black';
    tctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    var gt = gl.createTexture();
    glTextures.push(gt);
    uploadTex(gl, gt, tc);
    drawnKeys.push(null);
  }

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

  // Invalidate letter cache once Montserrat is confirmed loaded so next frame redraws with correct font
  document.fonts.load('bold ' + FONT_SIZE + 'px "' + FONT_FAMILY + '"').then(function () {
    for (var i = 0; i < 4; i++) drawnKeys[i] = null;
  });

  function render() {
    var state = window._demoState;
    if (!state || !state.dirty) return;
    state.dirty = false;

    var v = state.values;
    var w = canvas.width;
    var h = canvas.height;
    if (!w || !h) return;

    var texUnits    = [gl.TEXTURE0, gl.TEXTURE1, gl.TEXTURE2, gl.TEXTURE3];
    var texUniforms = [u.tex1, u.tex2, u.tex3, u.tex4];
    for (var i = 0; i < 4; i++) {
      var key = LETTERS[i] + '|' + FONT_SIZE;
      if (key !== drawnKeys[i]) {
        drawLetter(texCtxs[i], LETTERS[i], FONT_FAMILY, FONT_SIZE);
        uploadTex(gl, glTextures[i], texCanvases[i]);
        drawnKeys[i] = key;
      }
      gl.activeTexture(texUnits[i]);
      gl.bindTexture(gl.TEXTURE_2D, glTextures[i]);
      gl.uniform1i(texUniforms[i], i);
    }

    var squareCount = v.u_square_count != null ? v.u_square_count : 3;
    var offset      = 0.2;
    var aspect      = w / h;
    var halfWidth   = 0.5 * Math.min(1.0, aspect);
    var outerCenter = ((squareCount - 1) / 2) * offset;
    var squareSize  = Math.max(0.01, halfWidth - outerCenter) * 0.85;

    gl.uniform2f(u.res,          w, h);
    gl.uniform1f(u.aspect,       aspect);
    gl.uniform1f(u.squareSize,   squareSize);
    gl.uniform1f(u.offset,       offset);
    gl.uniform1f(u.density,      v.u_density != null ? v.u_density : 10);
    gl.uniform1f(u.colWidth,     0.35);
    gl.uniform1f(u.colWidthWide, 0.45);
    gl.uniform1f(u.globalGrad,   0.0);
    gl.uniform1f(u.squareCount,  squareCount);
    gl.uniform3fv(u.outlineColor, [0.0, 0.0, 0.0]);
    gl.uniform3fv(u.palA,        v.u_a      || [0.5, 0.5, 0.5]);
    gl.uniform3fv(u.palB,        v.u_b      || [0.5, 0.5, 0.5]);
    gl.uniform3fv(u.palC,        v.u_c      || [1.0, 1.0, 1.0]);
    gl.uniform3fv(u.palD,        v.u_d      || [0.0, 0.33, 0.67]);
    gl.uniform1f(u.colorMode,    v.u_color_mode != null ? v.u_color_mode : 0.0);
    gl.uniform3fv(u.color0,      v.u_color0 || [1.0, 0.2,  0.4]);
    gl.uniform3fv(u.color1,      v.u_color1 || [1.0, 0.8,  0.0]);
    gl.uniform3fv(u.color2,      v.u_color2 || [0.0, 0.8,  1.0]);
    gl.uniform3fv(u.color3,      v.u_color3 || [0.667, 0.0, 1.0]);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function loop() {
    render();
    requestAnimationFrame(loop);
  }
  loop();
}());
