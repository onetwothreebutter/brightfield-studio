(function () {
  'use strict';

  var canvas = document.getElementById('shader-canvas');
  if (!canvas) return;

  var glOpts = { preserveDrawingBuffer: true, alpha: true, antialias: true };
  var gl = canvas.getContext('webgl', glOpts) || canvas.getContext('experimental-webgl', glOpts);
  if (!gl) { canvas.style.display = 'none'; return; }

  // fwidth requires OES_standard_derivatives in WebGL 1.0
  var extDeriv = gl.getExtension('OES_standard_derivatives');

  var vertSrc = [
    'attribute vec2 a_position;',
    'void main() {',
    '  gl_Position = vec4(a_position, 0.0, 1.0);',
    '}'
  ].join('\n');

  // LineCircle port — faithful to the Three.js TSL original
  var fragSrc = [
    extDeriv ? '#extension GL_OES_standard_derivatives : enable' : '',
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
    'uniform vec3  u_text_color;',
    'uniform float u_use_text_color;',
    'uniform vec3  u_outline_color;',
    'uniform float u_text_x;',
    'uniform float u_text_y;',
    'uniform sampler2D u_text_texture;',
    // Triangle mask
    'uniform float u_tri_enabled;',
    'uniform float u_tri_rotation;',
    'uniform float u_tri_size;',
    'uniform float u_tri_width;',
    // Center circle cutout
    'uniform float u_center_circle_enabled;',
    'uniform float u_center_circle_radius;',
    // Export
    'uniform float u_transparent_bg;',
    '',
    'vec3 cosinePalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {',
    '  return a + b * cos(6.28318 * (c * t + d));',
    '}',
    '',
    'void main() {',
    '  vec2 uv = gl_FragCoord.xy / u_resolution;',
    '  vec2 centeredUV = uv - 0.5;',
    '',
    '  // Aspect-corrected circle SDF',
    '  vec2  correctedUV = vec2(centeredUV.x * u_aspect, centeredUV.y);',
    '  float circleSDF   = length(correctedUV) - u_radius;',
    extDeriv
      ? '  float aaCircle    = fwidth(circleSDF) * 0.5;'
      : '  float aaCircle    = 0.002;',
    '  float circleMask  = 1.0 - smoothstep(-aaCircle, aaCircle, circleSDF);',
    '',
    '  // t: 0 at top of circle, 1 at bottom',
    '  float circleTop = 0.5 + u_radius;',
    '  float t = clamp((circleTop - uv.y) / (u_radius * 2.0), 0.0, 1.0);',
    '',
    '  // Power-warp t so line spacing compresses toward the bottom',
    '  float warped = pow(t, u_power);',
    '',
    '  // Repeating phase [0, 1) within each line cell',
    '  float phase = fract(warped * u_line_count);',
    '',
    '  // Line fill fraction: thin at top, thick at bottom',
    '  float lineWidth = mix(u_width_top, u_width_bot, t);',
    '',
    '  // 1 inside the filled stripe, 0 in the gap',
    extDeriv
      ? '  float aaLine   = fwidth(phase) * 0.5;'
      : '  float aaLine   = 0.008;',
    '  float lineMask = 1.0 - smoothstep(lineWidth - aaLine, lineWidth + aaLine, phase);',
    '',
    '  // Cosine palette driven by vertical position',
    '  vec3 palColor = cosinePalette(t, u_palette_a, u_palette_b, u_palette_c, u_palette_d);',
    '',
    '  // Triangle cutout — rotated in aspect-corrected space, apex at center',
    '  float cosR   = cos(u_tri_rotation);',
    '  float sinR   = sin(u_tri_rotation);',
    '  vec2 triUV   = vec2(',
    '    correctedUV.x * cosR - correctedUV.y * sinR,',
    '    correctedUV.x * sinR + correctedUV.y * cosR',
    '  );',
    '  float cosW     = cos(u_tri_width);',
    '  float sinW     = sin(u_tri_width);',
    '  float triEdgeL = triUV.x * cosW - triUV.y * sinW;',
    '  float triEdgeR = -triUV.x * cosW - triUV.y * sinW;',
    '  float triEdgeB = triUV.y + u_radius * u_tri_size;',
    extDeriv ? [
    '  float aaTriL = fwidth(triEdgeL) * 0.5;',
    '  float aaTriR = fwidth(triEdgeR) * 0.5;',
    '  float aaTriB = fwidth(triEdgeB) * 0.5;',
    ].join('\n') : [
    '  float aaTriL = 0.002;',
    '  float aaTriR = 0.002;',
    '  float aaTriB = 0.002;',
    ].join('\n'),
    '  float triInner = smoothstep(-aaTriL, aaTriL, triEdgeL)',
    '                 * smoothstep(-aaTriR, aaTriR, triEdgeR)',
    '                 * smoothstep(-aaTriB, aaTriB, triEdgeB);',
    '  float triMask  = mix(1.0, 1.0 - triInner, u_tri_enabled);',
    '',
    '  // Center circle cutout',
    '  float centerSDF   = length(correctedUV) - u_center_circle_radius;',
    extDeriv
      ? '  float aaCenter    = fwidth(centerSDF) * 0.5;'
      : '  float aaCenter    = 0.002;',
    '  float centerInner = 1.0 - smoothstep(-aaCenter, aaCenter, centerSDF);',
    '  float centerMask  = mix(1.0, 1.0 - centerInner, u_center_circle_enabled);',
    '',
    '  // Circle + lines + triangle + center circle base color',
    '  vec3 base = palColor * circleMask * lineMask * triMask * centerMask;',
    '',
    '  // Text overlay — aspect-corrected UV so glyphs appear undistorted',
    '  vec2 textAnchor    = vec2(u_text_x, u_text_y);',
    '  vec2 textDelta     = uv - textAnchor;',
    '  vec2 textUV        = vec2(textDelta.x * u_aspect, textDelta.y) + textAnchor;',
    '  vec4 texSample     = texture2D(u_text_texture, textUV);',
    '  // R channel = fill, G channel = outline',
    '  float fillSample    = smoothstep(0.05, 0.6, texSample.r);',
    '  float outlineSample = smoothstep(0.05, 0.6, texSample.g);',
    '  vec3 withOutline   = mix(base, u_outline_color, outlineSample);',
    '  // Text fill uses palette color by default; custom color when u_use_text_color=1',
    '  vec3 textFillColor = mix(palColor, u_text_color, u_use_text_color);',
    '  vec3 finalColor    = mix(withOutline, textFillColor, fillSample);',
    '',
    '  float contentAlpha = max(circleMask * lineMask * triMask * centerMask, max(fillSample, outlineSample));',
    '  float alpha        = mix(1.0, contentAlpha, u_transparent_bg);',
    '  gl_FragColor = vec4(finalColor, alpha);',
    '}'
  ].join('\n');

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
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  var posLoc = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  // Uniform locations
  var uRes                 = gl.getUniformLocation(program, 'u_resolution');
  var uAspect              = gl.getUniformLocation(program, 'u_aspect');
  var uRadius              = gl.getUniformLocation(program, 'u_radius');
  var uLineCount           = gl.getUniformLocation(program, 'u_line_count');
  var uPower               = gl.getUniformLocation(program, 'u_power');
  var uWidthTop            = gl.getUniformLocation(program, 'u_width_top');
  var uWidthBot            = gl.getUniformLocation(program, 'u_width_bot');
  var uPaletteA            = gl.getUniformLocation(program, 'u_palette_a');
  var uPaletteB            = gl.getUniformLocation(program, 'u_palette_b');
  var uPaletteC            = gl.getUniformLocation(program, 'u_palette_c');
  var uPaletteD            = gl.getUniformLocation(program, 'u_palette_d');
  var uTextColor           = gl.getUniformLocation(program, 'u_text_color');
  var uUseTextColor        = gl.getUniformLocation(program, 'u_use_text_color');
  var uOutlineColor        = gl.getUniformLocation(program, 'u_outline_color');
  var uTextX               = gl.getUniformLocation(program, 'u_text_x');
  var uTextY               = gl.getUniformLocation(program, 'u_text_y');
  var uTextTex             = gl.getUniformLocation(program, 'u_text_texture');
  var uTriEnabled          = gl.getUniformLocation(program, 'u_tri_enabled');
  var uTriRotation         = gl.getUniformLocation(program, 'u_tri_rotation');
  var uTriSize             = gl.getUniformLocation(program, 'u_tri_size');
  var uTriWidth            = gl.getUniformLocation(program, 'u_tri_width');
  var uCenterCircleEnabled = gl.getUniformLocation(program, 'u_center_circle_enabled');
  var uCenterCircleRadius  = gl.getUniformLocation(program, 'u_center_circle_radius');
  var uTransparentBg       = gl.getUniformLocation(program, 'u_transparent_bg');

  // ── Text texture ──────────────────────────────────────────────────────────
  // R channel = fill, G channel = outline (allows independent coloring in shader)
  var textCanvas    = document.createElement('canvas');
  textCanvas.width  = 1024;
  textCanvas.height = 1024;
  var textCtx     = textCanvas.getContext('2d');
  var textTex     = gl.createTexture();
  var lastTextKey = null;

  function drawAndUploadText(v) {
    var size = 1024;

    textCtx.fillStyle = '#000000';
    textCtx.fillRect(0, 0, size, size);

    var txt = v.text || '';
    if (txt) {
      var fontFamily = v.textFont ? '"' + v.textFont + '"' : '"IBM Plex Mono"';
      var fontSize   = v.textFontSize || 120;
      var tx         = v.textX != null ? v.textX : 0.5;
      var ty         = v.textY != null ? v.textY : 0.5;
      var cx         = tx * size;
      // Canvas Y=0 is top; UNPACK_FLIP_Y maps it to UV y=1 (top).
      // Drawing at (1-ty)*size means ty=1→canvas top→UV top, ty=0→canvas bottom→UV bottom.
      var cy         = (1 - ty) * size;

      textCtx.font         = fontSize + 'px ' + fontFamily + ', monospace';
      textCtx.textAlign    = 'center';
      textCtx.textBaseline = 'middle';

      // Outline pass — pure green channel
      if (v.outlineEnabled && v.outlineWidth > 0) {
        textCtx.strokeStyle = 'rgb(0,255,0)';
        textCtx.lineWidth   = (v.outlineWidth || 8) * 2;
        textCtx.lineJoin    = 'round';
        textCtx.strokeText(txt, cx, cy);
      }

      // Fill pass — pure red channel
      textCtx.fillStyle = 'rgb(255,0,0)';
      textCtx.fillText(txt, cx, cy);
    }

    gl.bindTexture(gl.TEXTURE_2D, textTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textCanvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  function resize() {
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.offsetWidth;
    var h = canvas.offsetHeight;
    if (!w || !h) return;
    canvas.style.width  = w + 'px';
    canvas.style.height = h + 'px';
    canvas.width  = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  window.addEventListener('resize', resize);
  resize();

  function render() {
    var v = (window._shaderState && window._shaderState.values) || {};
    var w = canvas.width;
    var h = canvas.height;

    if (w && h) {
      // Regenerate text texture when content changes
      var textKey = JSON.stringify([v.text, v.textX, v.textY, v.textFontSize, v.textFont, v.outlineEnabled, v.outlineWidth]);
      var dirty   = window._shaderState && window._shaderState.textDirty;
      if (dirty || textKey !== lastTextKey) {
        drawAndUploadText(v);
        lastTextKey = textKey;
        if (window._shaderState) window._shaderState.textDirty = false;
      }

      gl.uniform2f(uRes,          w, h);
      gl.uniform1f(uAspect,       w / h);
      gl.uniform1f(uRadius,       v.u_radius              != null ? v.u_radius              : 0.4);
      gl.uniform1f(uLineCount,    v.u_line_count           != null ? v.u_line_count           : 20.0);
      gl.uniform1f(uPower,        v.u_power                != null ? v.u_power                : 2.5);
      gl.uniform1f(uWidthTop,     v.u_width_top            != null ? v.u_width_top            : 0.05);
      gl.uniform1f(uWidthBot,     v.u_width_bot            != null ? v.u_width_bot            : 0.75);
      gl.uniform3fv(uPaletteA,    v.u_palette_a  || [0.5, 0.5, 0.5]);
      gl.uniform3fv(uPaletteB,    v.u_palette_b  || [0.5, 0.5, 0.5]);
      gl.uniform3fv(uPaletteC,    v.u_palette_c  || [1.0, 1.0, 1.0]);
      gl.uniform3fv(uPaletteD,    v.u_palette_d  || [0.263, 0.416, 0.557]);
      gl.uniform3fv(uTextColor,   v.u_text_color    || [1.0, 1.0, 1.0]);
      gl.uniform1f(uUseTextColor, v.u_use_text_color       != null ? v.u_use_text_color       : 0.0);
      gl.uniform3fv(uOutlineColor, v.u_outline_color || [0.0, 0.0, 0.0]);
      gl.uniform1f(uTextX,        v.textX                  != null ? v.textX                  : 0.5);
      gl.uniform1f(uTextY,        v.textY                  != null ? v.textY                  : 0.5);
      gl.uniform1f(uTriEnabled,   v.u_tri_enabled          != null ? v.u_tri_enabled          : 1.0);
      gl.uniform1f(uTriRotation,  v.u_tri_rotation         != null ? v.u_tri_rotation         : 0.0);
      gl.uniform1f(uTriSize,      v.u_tri_size             != null ? v.u_tri_size             : 1.0);
      // uTriWidth in radians; default 30° = equilateral half-angle
      gl.uniform1f(uTriWidth,     v.u_tri_width            != null ? v.u_tri_width            : Math.PI / 6);
      gl.uniform1f(uCenterCircleEnabled, v.u_center_circle_enabled != null ? v.u_center_circle_enabled : 0.0);
      gl.uniform1f(uCenterCircleRadius,  v.u_center_circle_radius  != null ? v.u_center_circle_radius  : 0.05);
      gl.uniform1f(uTransparentBg, v.u_transparent_bg      != null ? v.u_transparent_bg      : 0.0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, textTex);
      gl.uniform1i(uTextTex, 0);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    requestAnimationFrame(render);
  }

  render();

  // Export the shader at print resolution and return base64 PNG via callback
  window._shaderExport = function (targetW, targetH, callback) {
    var prevW = canvas.width;
    var prevH = canvas.height;

    canvas.width  = targetW;
    canvas.height = targetH;
    gl.viewport(0, 0, targetW, targetH);

    if (window._shaderState) window._shaderState.values.u_transparent_bg = 1.0;

    render();

    var dataUrl = canvas.toDataURL('image/png');

    canvas.width  = prevW;
    canvas.height = prevH;
    gl.viewport(0, 0, prevW, prevH);
    if (window._shaderState) {
      window._shaderState.values.u_transparent_bg = 0.0;
      window._shaderState.textDirty = true;
    }

    callback(dataUrl.split(',')[1]); // base64 only
  };
}());
