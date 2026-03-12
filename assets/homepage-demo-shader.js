(function () {
  'use strict';

  var TEX_SIZE = 512;

  // LineCircle GLSL — with text overlay
  var fragSrc = [
    '#version 300 es',
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
    'uniform vec3  u_text_color;',
    'uniform float u_use_text_color;',
    'uniform vec3  u_outline_color;',
    'uniform float u_text_x;',
    'uniform float u_text_y;',
    'uniform sampler2D u_text_texture;',
    '',
    'out vec4 fragColor;',
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
    '  float mask      = circleMask * lineMask * triMask * centerMask;',
    '  vec3 baseColor  = finalPal * mask;',
    '',
    '  // Text overlay',
    '  vec2 textAnchor     = vec2(u_text_x, u_text_y);',
    '  vec2 textDelta      = uv - textAnchor;',
    '  vec2 textUV         = vec2(textDelta.x * u_aspect, textDelta.y) + textAnchor;',
    '  vec4 texSample      = texture(u_text_texture, textUV);',
    '  float fillSample    = smoothstep(0.05, 0.6, texSample.r);',
    '  float outlineSample = smoothstep(0.05, 0.6, texSample.g);',
    '  vec3 withOutline    = mix(baseColor, u_outline_color, outlineSample);',
    '  vec3 textFillColor  = mix(finalPal, u_text_color, u_use_text_color);',
    '  vec3 finalColor     = mix(withOutline, textFillColor, fillSample);',
    '',
    '  float textAlpha  = clamp(fillSample + outlineSample, 0.0, 1.0);',
    '  float finalAlpha = mix(mask, 1.0, textAlpha);',
    '  fragColor = vec4(finalColor, finalAlpha);',
    '}'
  ].join('\n');

  var canvas = document.getElementById('demo-shader-canvas');
  if (!canvas) return;

  var glOpts = { preserveDrawingBuffer: true, alpha: true, antialias: true };
  var gl = canvas.getContext('webgl2', glOpts);
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
    '#version 300 es',
    'in vec2 a_position;',
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
    textColor:           loc('u_text_color'),
    useTextColor:        loc('u_use_text_color'),
    outlineColor:        loc('u_outline_color'),
    textX:               loc('u_text_x'),
    textY:               loc('u_text_y'),
    textTex:             loc('u_text_texture'),
  };

  // ── Text texture ──────────────────────────────────────────────────────────
  var texCanvas = document.createElement('canvas');
  texCanvas.width = texCanvas.height = TEX_SIZE;
  var texCtx = texCanvas.getContext('2d');

  var glTextTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, glTextTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,0]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  var drawnTextKey = null;

  function drawText(v) {
    texCtx.fillStyle = '#000000';
    texCtx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    var txt = v.text || '';
    if (!txt) return;
    var fontFamily = v.textFont ? '"' + v.textFont + '"' : '"Montserrat"';
    var fontSize   = v.textFontSize || 120;
    var cx = (v.textX != null ? v.textX : 0.5) * TEX_SIZE;
    var cy = (1 - (v.textY != null ? v.textY : 0.5)) * TEX_SIZE;
    texCtx.font         = fontSize + 'px ' + fontFamily + ', monospace';
    texCtx.textAlign    = 'center';
    texCtx.textBaseline = 'middle';
    if (v.outlineEnabled && v.outlineWidth > 0) {
      texCtx.strokeStyle = 'rgb(0,255,0)';
      texCtx.lineWidth   = (v.outlineWidth || 8) * 2;
      texCtx.lineJoin    = 'round';
      texCtx.strokeText(txt, cx, cy);
    }
    texCtx.fillStyle = 'rgb(255,0,0)';
    texCtx.fillText(txt, cx, cy);
  }

  function uploadTextTex() {
    gl.bindTexture(gl.TEXTURE_2D, glTextTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, texCanvas);
  }

  function textKey(v) {
    return JSON.stringify([v.text, v.textFont, v.textFontSize, v.textX, v.textY, v.outlineEnabled, v.outlineWidth]);
  }

  // Preload fonts
  ['Oswald', 'Unbounded', 'Bricolage Grotesque', 'DM Mono',
   'Righteous', 'Teko', 'Big Shoulders Display', 'Anton'].forEach(function (f) {
    document.fonts.load('500 48px "' + f + '"');
  });

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

    // Redraw text texture if content changed
    var tk = textKey(v);
    if (tk !== drawnTextKey) {
      drawText(v);
      uploadTextTex();
      drawnTextKey = tk;
    }

    var aspect = w / h;

    gl.uniform2f(u.res,       w, h);
    gl.uniform1f(u.aspect,    aspect);
    gl.uniform1f(u.radius,    v.u_radius     != null ? v.u_radius     : 0.4);
    gl.uniform1f(u.lineCount, v.u_line_count != null ? v.u_line_count : 20);
    gl.uniform1f(u.power,     v.u_power      != null ? v.u_power      : 2.5);
    gl.uniform1f(u.widthTop,  v.u_width_top  != null ? v.u_width_top  : 0.05);
    gl.uniform1f(u.widthBot,  v.u_width_bot  != null ? v.u_width_bot  : 0.75);
    gl.uniform3fv(u.paletteA, v.u_palette_a || [0.5, 0.5, 0.5]);
    gl.uniform3fv(u.paletteB, v.u_palette_b || [0.5, 0.5, 0.5]);
    gl.uniform3fv(u.paletteC, v.u_palette_c || [1.0, 1.0, 1.0]);
    gl.uniform3fv(u.paletteD, v.u_palette_d || [0.0, 0.33, 0.67]);
    gl.uniform1f(u.colorMode, v.u_color_mode != null ? v.u_color_mode : 0.0);
    gl.uniform3fv(u.color0,   v.u_color0 || [1.0, 0.2,  0.4]);
    gl.uniform3fv(u.color1,   v.u_color1 || [1.0, 0.8,  0.0]);
    gl.uniform3fv(u.color2,   v.u_color2 || [0.0, 0.8,  1.0]);
    gl.uniform3fv(u.color3,   v.u_color3 || [0.667, 0.0, 1.0]);
    gl.uniform1f(u.triEnabled,   v.u_tri_enabled  != null ? v.u_tri_enabled  : 1.0);
    gl.uniform1f(u.triRotation,  v.u_tri_rotation != null ? v.u_tri_rotation * Math.PI / 180 : 0.0);
    gl.uniform1f(u.triSize,      v.u_tri_size     != null ? v.u_tri_size     : 1.0);
    gl.uniform1f(u.triWidth,     v.u_tri_width    != null ? v.u_tri_width * Math.PI / 180 : (45 * Math.PI) / 180);
    gl.uniform1f(u.centerCircleEnabled, v.u_center_circle_enabled != null ? v.u_center_circle_enabled : 1.0);
    gl.uniform1f(u.centerCircleRadius,  v.u_center_circle_radius  != null ? v.u_center_circle_radius  : 0.04);
    gl.uniform3fv(u.textColor,   v.u_text_color    || [1.0, 1.0, 1.0]);
    gl.uniform1f(u.useTextColor, v.u_use_text_color != null ? v.u_use_text_color : 0.0);
    gl.uniform3fv(u.outlineColor, v.u_outline_color || [0.0, 0.0, 0.0]);
    gl.uniform1f(u.textX,        v.textX != null ? v.textX : 0.5);
    gl.uniform1f(u.textY,        v.textY != null ? v.textY : 0.5);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, glTextTex);
    gl.uniform1i(u.textTex, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function loop() {
    render();
    requestAnimationFrame(loop);
  }
  loop();

  window._demoExport = function (targetW, targetH, callback) {
    var prevW = canvas.width;
    var prevH = canvas.height;
    canvas.width  = targetW;
    canvas.height = targetH;
    gl.viewport(0, 0, targetW, targetH);
    if (window._demoState) window._demoState.dirty = true;
    render();
    var dataUrl = canvas.toDataURL('image/png');
    canvas.width  = prevW;
    canvas.height = prevH;
    gl.viewport(0, 0, prevW, prevH);
    if (window._demoState) window._demoState.dirty = true;
    callback(dataUrl.split(',')[1]);
  };
}());
