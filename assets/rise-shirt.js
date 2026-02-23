(function () {
  'use strict';

  var canvas = document.getElementById('shader-canvas');
  if (!canvas) return;

  var glOpts = { preserveDrawingBuffer: true };
  var gl = canvas.getContext('webgl', glOpts) || canvas.getContext('experimental-webgl', glOpts);
  if (!gl) { canvas.style.display = 'none'; return; }

  var vertSrc = [
    'attribute vec2 a_position;',
    'void main() {',
    '  gl_Position = vec4(a_position, 0.0, 1.0);',
    '}'
  ].join('\n');

  // RiseShirt dot-halftone port — faithful to the Three.js TSL original
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
    'uniform vec3  u_bg_color;',
    'uniform float u_top_margin;',
    'uniform float u_ratio;',
    'uniform sampler2D u_text_texture;',
    'uniform float u_text_grid_cols;',
    'uniform float u_text_grid_rows;',
    'uniform float u_text_blend;',
    'uniform float u_text_radius;',
    'uniform float u_text_ratio;',
    'uniform vec3  u_text_color;',
    'uniform vec3  u_text_bg_color;',
    'uniform vec3  u_palette_a;',
    'uniform vec3  u_palette_b;',
    'uniform vec3  u_palette_c;',
    'uniform vec3  u_palette_d;',
    'uniform float u_color_mode;',
    '',
    'vec3 cosinePalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {',
    '  return a + b * cos(6.28318 * (c * t + d));',
    '}',
    '',
    'void main() {',
    '  vec2 uv = gl_FragCoord.xy / u_resolution;',
    '',
    '  // Top margin — area above marginThreshold is collar / text zone',
    '  float marginThreshold = 1.0 - u_top_margin;',
    '  float inMargin        = step(marginThreshold, uv.y);',
    '',
    '  // Remap Y so the full gradient spans only the design area',
    '  float remappedY = clamp(uv.y / max(marginThreshold, 0.001), 0.0, 1.0);',
    '',
    '  // ── Main dot grid ─────────────────────────────────────────────────',
    '  vec2  gridUv    = vec2(uv.x, remappedY) * vec2(u_cols, u_rows);',
    '  vec2  localUv   = fract(gridUv) - 0.5;',
    '  vec2  corrected = vec2(localUv.x * u_ratio, localUv.y);',
    '  float dist      = length(corrected);',
    '',
    '  float effectiveMax = u_max_radius * u_ratio;',
    '  float mixFactor    = mix(remappedY, 1.0 - remappedY, u_invert);',
    '  float radius       = mix(effectiveMax, u_min_radius, mixFactor);',
    '',
    '  float eps      = 0.005;',
    '  float mainMask = 1.0 - smoothstep(radius - eps, radius + eps, dist);',
    '',
    '  vec3 paletteColor = cosinePalette(mixFactor, u_palette_a, u_palette_b, u_palette_c, u_palette_d);',
    '  vec3 dotColor     = mix(u_dot_color, paletteColor, step(0.5, u_color_mode));',
    '  vec3 mainColor    = mix(u_bg_color, dotColor, mainMask);',
    '',
    '  // ── Text dot grid (margin area) ───────────────────────────────────',
    '  vec2  tGridUv    = uv * vec2(u_text_grid_cols, u_text_grid_rows);',
    '  vec2  tLocalUv   = fract(tGridUv) - 0.5;',
    '  vec2  tCorrected = vec2(tLocalUv.x * u_text_ratio, tLocalUv.y);',
    '  float tDist      = length(tCorrected);',
    '  vec2  tCellIdx   = floor(tGridUv);',
    '  vec2  tCenterUv  = (tCellIdx + 0.5) / vec2(u_text_grid_cols, u_text_grid_rows);',
    '  float tSample    = texture2D(u_text_texture, tCenterUv).r;',
    '',
    '  float circleMask      = 1.0 - smoothstep(u_text_radius - eps, u_text_radius + eps, tDist);',
    '  float textMask        = circleMask * tSample * u_text_blend;',
    '  float textMixFactor   = mix(tCenterUv.y, 1.0 - tCenterUv.y, u_invert);',
    '  vec3  textPalette     = cosinePalette(textMixFactor, u_palette_a, u_palette_b, u_palette_c, u_palette_d);',
    '  vec3  textDotColor    = mix(u_text_color, textPalette, step(0.5, u_color_mode));',
    '  vec3  marginColor     = mix(u_text_bg_color, textDotColor, textMask);',
    '',
    '  gl_FragColor = vec4(mix(mainColor, marginColor, inMargin), 1.0);',
    '}'
  ].join('\n');

  // Per-product shader override via metafield
  var fragSrcEl = document.getElementById('shader-frag-src');
  if (fragSrcEl) {
    try {
      var parsed = JSON.parse(fragSrcEl.textContent);
      if (typeof parsed === 'string' && parsed.length > 0) {
        fragSrc = parsed;
      } else if (Array.isArray(parsed) && parsed.length > 0) {
        fragSrc = parsed.join('\n');
      }
    } catch (e) {}
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
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  var posLoc = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  // Uniform locations
  var uTime         = gl.getUniformLocation(program, 'u_time');
  var uRes          = gl.getUniformLocation(program, 'u_resolution');
  var uRows         = gl.getUniformLocation(program, 'u_rows');
  var uCols         = gl.getUniformLocation(program, 'u_cols');
  var uMinRadius    = gl.getUniformLocation(program, 'u_min_radius');
  var uMaxRadius    = gl.getUniformLocation(program, 'u_max_radius');
  var uInvert       = gl.getUniformLocation(program, 'u_invert');
  var uDotColor     = gl.getUniformLocation(program, 'u_dot_color');
  var uBgColor      = gl.getUniformLocation(program, 'u_bg_color');
  var uTopMargin    = gl.getUniformLocation(program, 'u_top_margin');
  var uRatio        = gl.getUniformLocation(program, 'u_ratio');
  var uTextTex      = gl.getUniformLocation(program, 'u_text_texture');
  var uTextGridCols = gl.getUniformLocation(program, 'u_text_grid_cols');
  var uTextGridRows = gl.getUniformLocation(program, 'u_text_grid_rows');
  var uTextBlend    = gl.getUniformLocation(program, 'u_text_blend');
  var uTextRadius   = gl.getUniformLocation(program, 'u_text_radius');
  var uTextRatio    = gl.getUniformLocation(program, 'u_text_ratio');
  var uTextColor    = gl.getUniformLocation(program, 'u_text_color');
  var uTextBgColor  = gl.getUniformLocation(program, 'u_text_bg_color');
  var uPaletteA     = gl.getUniformLocation(program, 'u_palette_a');
  var uPaletteB     = gl.getUniformLocation(program, 'u_palette_b');
  var uPaletteC     = gl.getUniformLocation(program, 'u_palette_c');
  var uPaletteD     = gl.getUniformLocation(program, 'u_palette_d');
  var uColorMode    = gl.getUniformLocation(program, 'u_color_mode');

  // ── Text texture ──────────────────────────────────────────────────────────
  var textCanvas    = document.createElement('canvas');
  textCanvas.width  = 1024;
  textCanvas.height = 1024;
  var textCtx    = textCanvas.getContext('2d');
  var textTex    = gl.createTexture();
  var lastTextKey = null;
  var lastTexW    = 0;
  var lastTexH    = 0;

  function drawAndUploadText(v, w, h) {
    var size   = 1024;
    var aspect = (w > 0 && h > 0) ? w / h : 1;

    textCtx.fillStyle = '#000000';
    textCtx.fillRect(0, 0, size, size);

    var txt = v.text || '';
    if (txt) {
      textCtx.save();
      textCtx.scale(1 / aspect, 1);
      textCtx.fillStyle    = '#ffffff';
      textCtx.font         = (v.textFontSize || 460) + 'px "IBM Plex Mono", monospace';
      textCtx.textAlign    = 'center';
      textCtx.textBaseline = 'middle';
      var tx = v.textX != null ? v.textX : 0.5;
      var ty = v.textY != null ? v.textY : 0.79;
      textCtx.fillText(txt, size * tx * aspect, size * (1 - ty));
      textCtx.restore();
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
    var w = canvas.offsetWidth;
    var h = canvas.offsetHeight;
    if (!w || !h) return;
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
    var w = canvas.width;
    var h = canvas.height;

    if (w && h) {
      // Regenerate text texture when content or canvas size changes
      var textKey = JSON.stringify([v.text, v.textX, v.textY, v.textFontSize]);
      var dirty   = window._shaderState && window._shaderState.textDirty;
      if (dirty || textKey !== lastTextKey || w !== lastTexW || h !== lastTexH) {
        drawAndUploadText(v, w, h);
        lastTextKey = textKey;
        lastTexW    = w;
        lastTexH    = h;
        if (window._shaderState) window._shaderState.textDirty = false;
      }

      var rows   = v.u_rows       != null ? v.u_rows       : 48;
      var cols   = v.u_cols       != null ? v.u_cols       : 37;
      var margin = v.u_top_margin != null ? v.u_top_margin : 0.0;

      // Ratio = cell pixel width / cell pixel height (keeps dots circular)
      var cellW = w / cols;
      var cellH = (h * (1 - margin)) / rows;
      var ratio = cellH > 0 ? cellW / cellH : 1.0;

      var tGridCols = v.u_text_grid_cols != null ? v.u_text_grid_cols : 47;
      var tGridRows = v.u_text_grid_rows != null ? v.u_text_grid_rows : 31;
      var tRatio    = (w / tGridCols) / (h / tGridRows);

      gl.uniform1f(uTime,         t);
      gl.uniform2f(uRes,          w, h);
      gl.uniform1f(uRows,         rows);
      gl.uniform1f(uCols,         cols);
      gl.uniform1f(uMinRadius,    v.u_min_radius   != null ? v.u_min_radius   : 0.02);
      gl.uniform1f(uMaxRadius,    v.u_max_radius   != null ? v.u_max_radius   : 0.55);
      gl.uniform1f(uInvert,       v.u_invert       != null ? v.u_invert       : 1);
      gl.uniform3fv(uDotColor,    v.u_dot_color    || [1.0, 1.0, 1.0]);
      gl.uniform3fv(uBgColor,     v.u_bg_color     || [0.0, 0.0, 0.0]);
      gl.uniform1f(uTopMargin,    margin);
      gl.uniform1f(uRatio,        ratio);
      gl.uniform1f(uTextGridCols, tGridCols);
      gl.uniform1f(uTextGridRows, tGridRows);
      gl.uniform1f(uTextBlend,    v.u_text_blend   != null ? v.u_text_blend   : 1.0);
      gl.uniform1f(uTextRadius,   v.u_text_radius  != null ? v.u_text_radius  : 0.16);
      gl.uniform1f(uTextRatio,    tRatio);
      gl.uniform3fv(uTextColor,   v.u_text_color   || [1.0, 1.0, 1.0]);
      gl.uniform3fv(uTextBgColor, v.u_text_bg_color || [0.0, 0.0, 0.0]);
      gl.uniform3fv(uPaletteA,    v.u_palette_a    || [0.5, 0.5, 0.5]);
      gl.uniform3fv(uPaletteB,    v.u_palette_b    || [0.5, 0.5, 0.5]);
      gl.uniform3fv(uPaletteC,    v.u_palette_c    || [1.0, 1.0, 1.0]);
      gl.uniform3fv(uPaletteD,    v.u_palette_d    || [0.263, 0.416, 0.557]);
      gl.uniform1f(uColorMode,    v.u_color_mode   != null ? v.u_color_mode   : 0.0);

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

    // render() reads canvas.width/height and recalculates all uniforms (uRes, uRatio,
    // uTextRatio, etc.) for the new size, then draws one frame.
    render();

    var dataUrl = canvas.toDataURL('image/png');

    // Restore
    canvas.width  = prevW;
    canvas.height = prevH;
    gl.viewport(0, 0, prevW, prevH);
    if (window._shaderState) window._shaderState.textDirty = true;

    callback(dataUrl.split(',')[1]); // base64 only
  };
}());
