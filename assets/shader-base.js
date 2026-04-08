(function () {
  'use strict';

  function create(opts) {
    var canvasId  = opts.canvasId  || 'shader-canvas';
    var stateKey  = opts.stateKey  || '_shaderState';
    var exportKey = opts.exportKey || '_shaderExport';
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;

    var glOpts = { preserveDrawingBuffer: true, alpha: true, antialias: true, premultipliedAlpha: false };
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

    var start    = performance.now();
    var revealed = false;
    var lastT    = 0;
    var animVals = null;

    function lerpVal(a, b, factor) {
      if (typeof b === 'number' && typeof a === 'number') {
        return a + (b - a) * factor;
      }
      if (Array.isArray(b) && Array.isArray(a)) {
        return b.map(function (bv, i) { return (a[i] || 0) + (bv - (a[i] || 0)) * factor; });
      }
      return b; // instant for strings, booleans, etc.
    }

    function render() {
      var t = (performance.now() - start) / 1000.0;
      var v = (window[stateKey] && window[stateKey].values) || {};
      var w = canvas.width;
      var h = canvas.height;

      if (w && h) {
        // ── Animated value interpolation (opt-in) ───────────
        var renderV = v;
        if (opts.animateValues) {
          var dt = Math.min(t - lastT, 0.1);
          var factor = 1 - Math.exp(-8 * dt);
          // u_transparent_bg must snap instantly — it's toggled only during export
          // and must be exactly 1.0/0.0 or the PNG will have a semi-opaque background
          var instant = (opts.instantKeys || []).concat(['u_transparent_bg']);
          if (!animVals) { animVals = {}; }
          Object.keys(v).forEach(function (k) {
            if (instant.indexOf(k) !== -1) {
              animVals[k] = v[k]; // bypass lerp — instant feedback
            } else if (animVals[k] === undefined) {
              animVals[k] = Array.isArray(v[k]) ? v[k].slice() : v[k];
            } else {
              animVals[k] = lerpVal(animVals[k], v[k], factor);
            }
          });
          renderV = animVals;
        }

        if (opts.drawText) {
          var getKey  = opts.textKey || defaultTextKey;
          var textKey = getKey(v); // always key off real v so text updates instantly
          var dirty   = window[stateKey] && window[stateKey].textDirty;
          if (dirty || textKey !== lastTextKey || w !== lastTexW || h !== lastTexH) {
            opts.drawText(textCtx, 1024, v, w, h);
            uploadTexture();
            lastTextKey = textKey;
            lastTexW    = w;
            lastTexH    = h;
            if (window[stateKey]) window[stateKey].textDirty = false;
          }
        }

        opts.render(gl, uniforms, renderV, w, h, t, textTex || null);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        if (!revealed) {
          canvas.style.opacity = '1';
          revealed = true;
        }
      }

      lastT = t;
      requestAnimationFrame(render);
    }

    render();

    // Export the shader at print resolution and return base64 PNG via callback
    window[exportKey] = function (targetW, targetH, callback) {
      var prevW = canvas.width;
      var prevH = canvas.height;

      canvas.width  = targetW;
      canvas.height = targetH;
      gl.viewport(0, 0, targetW, targetH);

      // Apply per-shader export overrides (e.g. u_transparent_bg=1 for line-text).
      // Opt-in only — avoids the blank-design regression that occurred when this was forced globally.
      var stateValues = window[stateKey] && window[stateKey].values;
      var exportOverrides = opts.exportValues || {};
      var savedOverrides = {};
      if (stateValues) {
        Object.keys(exportOverrides).forEach(function (k) {
          savedOverrides[k] = stateValues[k];
          stateValues[k] = exportOverrides[k];
        });
      }

      render();

      if (stateValues) {
        Object.keys(savedOverrides).forEach(function (k) {
          stateValues[k] = savedOverrides[k];
        });
      }

      // Use gl.readPixels() instead of canvas.toDataURL() — Safari's WebGL toDataURL
      // composites transparent pixels against black before encoding, producing an opaque
      // black background. readPixels() reads raw GPU bytes, bypassing that compositing.
      var pixels = new Uint8Array(targetW * targetH * 4);
      gl.readPixels(0, 0, targetW, targetH, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

      // gl.readPixels returns rows bottom-to-top; flip vertically for canvas (top-to-bottom)
      var flipped = new Uint8Array(targetW * targetH * 4);
      var rowBytes = targetW * 4;
      for (var row = 0; row < targetH; row++) {
        flipped.set(pixels.subarray((targetH - 1 - row) * rowBytes, (targetH - row) * rowBytes), row * rowBytes);
      }

      // Encode via a 2D canvas (avoids the WebGL-specific toDataURL Safari bug)
      var offscreen = document.createElement('canvas');
      offscreen.width  = targetW;
      offscreen.height = targetH;
      var ctx2d = offscreen.getContext('2d');
      var imageData = ctx2d.createImageData(targetW, targetH);
      imageData.data.set(flipped);
      ctx2d.putImageData(imageData, 0, 0);
      var dataUrl = offscreen.toDataURL('image/png');

      canvas.width  = prevW;
      canvas.height = prevH;
      gl.viewport(0, 0, prevW, prevH);
      if (window[stateKey]) {
        window[stateKey].textDirty = true;
      }

      callback(dataUrl.split(',')[1]); // base64 only
    };
  }

  window.ShaderBase = { create: create };
}());
