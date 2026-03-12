(function () {
  'use strict';

  function create(opts) {
    var canvas = document.getElementById('shader-canvas');
    if (!canvas) return;

    var glOpts = { preserveDrawingBuffer: true, alpha: true, antialias: true };
    var gl = canvas.getContext('webgl2', glOpts);
    if (!gl) { canvas.style.display = 'none'; return; }

    var vertSrc = [
      '#version 300 es',
      'in vec2 a_position;',
      'void main() {',
      '  gl_Position = vec4(a_position, 0.0, 1.0);',
      '}'
    ].join('\n');

    function compileShader(src, type) {
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

    var fragSrc = Array.isArray(opts.fragSrc) ? opts.fragSrc.join('\n') : opts.fragSrc;
    var vert = compileShader(vertSrc, gl.VERTEX_SHADER);
    var frag = compileShader(fragSrc, gl.FRAGMENT_SHADER);
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

    var uniforms = opts.setup(gl, program);

    // ── Text texture (only when drawText is provided) ─────────────────────────
    var textCanvas, textCtx, textTex, lastTextKey, lastTexW, lastTexH;
    if (opts.drawText) {
      textCanvas        = document.createElement('canvas');
      textCanvas.width  = 1024;
      textCanvas.height = 1024;
      textCtx      = textCanvas.getContext('2d');
      textTex      = gl.createTexture();
      lastTextKey  = null;
      lastTexW     = 0;
      lastTexH     = 0;
    }

    function defaultTextKey(v) {
      return JSON.stringify([v.text, v.textFont, v.textFontSize, v.textX, v.textY]);
    }

    function uploadTexture() {
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

    var start = performance.now();

    function render() {
      var t = (performance.now() - start) / 1000.0;
      var v = (window._shaderState && window._shaderState.values) || {};
      var w = canvas.width;
      var h = canvas.height;

      if (w && h) {
        if (opts.drawText) {
          var getKey  = opts.textKey || defaultTextKey;
          var textKey = getKey(v);
          var dirty   = window._shaderState && window._shaderState.textDirty;
          if (dirty || textKey !== lastTextKey || w !== lastTexW || h !== lastTexH) {
            opts.drawText(textCtx, 1024, v, w, h);
            uploadTexture();
            lastTextKey = textKey;
            lastTexW    = w;
            lastTexH    = h;
            if (window._shaderState) window._shaderState.textDirty = false;
          }
        }

        opts.render(gl, uniforms, v, w, h, t, textTex || null);
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
  }

  window.ShaderBase = { create: create };
}());
