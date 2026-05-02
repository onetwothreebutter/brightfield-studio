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
    if (!vert || !frag) { canvas.dataset.shaderError = 'compile'; return; }

    var program = gl.createProgram();
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(program));
      canvas.dataset.shaderError = 'link';
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

    var start      = performance.now();
    var revealed   = false;
    var lastT      = 0;
    var animVals   = null;
    var exporting      = false; // true while _shaderExport is running; suppresses extra rAF
    var paused         = false; // true when canvas is off-screen (Intersection Observer)
    var idle           = false; // true when animVals have converged; triggers slow polling
    var pendingTimeout = null;

    function scheduleNextFrame() {
      if (exporting || paused) return;
      if (idle) {
        pendingTimeout = setTimeout(function () { pendingTimeout = null; render(); }, 100);
      } else {
        requestAnimationFrame(render);
      }
    }

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
      if (paused) return;
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
          var instant = (opts.instantKeys || []);
          if (!animVals) { animVals = {}; }
          var maxDiff = 0;
          Object.keys(v).forEach(function (k) {
            if (instant.indexOf(k) !== -1) {
              animVals[k] = v[k]; // bypass lerp — instant feedback
            } else if (animVals[k] === undefined) {
              animVals[k] = Array.isArray(v[k]) ? v[k].slice() : v[k];
            } else {
              animVals[k] = lerpVal(animVals[k], v[k], factor);
              var av = animVals[k];
              var tv = v[k];
              if (typeof tv === 'number' && typeof av === 'number') {
                var nd = Math.abs(tv - av);
                if (nd > maxDiff) maxDiff = nd;
              } else if (Array.isArray(tv) && Array.isArray(av)) {
                for (var i = 0; i < tv.length; i++) {
                  nd = Math.abs((tv[i] || 0) - (av[i] || 0));
                  if (nd > maxDiff) maxDiff = nd;
                }
              }
            }
          });
          idle = maxDiff < 0.001;
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
      // Only schedule the next frame when not exporting; prevents an extra rAF
      // chain from accumulating each time _shaderExport calls render() directly.
      if (!exporting) scheduleNextFrame();
    }

    if (window.IntersectionObserver) {
      new IntersectionObserver(function (entries) {
        var visible = entries[0].isIntersecting;
        if (!visible) {
          paused = true;
          if (pendingTimeout) { clearTimeout(pendingTimeout); pendingTimeout = null; }
        } else if (paused) {
          paused = false;
          scheduleNextFrame();
        }
      }, { threshold: 0 }).observe(canvas);
    }

    render();

    // Export the shader at print resolution and return base64 PNG via callback.
    window[exportKey] = function (targetW, targetH, callback) {
      var prevW = canvas.width;
      var prevH = canvas.height;

      canvas.width  = targetW;
      canvas.height = targetH;
      gl.viewport(0, 0, targetW, targetH);

      // Apply per-shader export overrides (opt-in via exportValues on ShaderBase.create).
      var stateValues = window[stateKey] && window[stateKey].values;
      var exportOverrides = opts.exportValues || {};
      var savedOverrides = {};
      if (stateValues) {
        stateValues.textDirty = true; // force texture re-upload at export size
        Object.keys(exportOverrides).forEach(function (k) {
          savedOverrides[k] = stateValues[k];
          stateValues[k] = exportOverrides[k];
        });
      }

      exporting = true;
      render();   // synchronous draw at export size; no extra rAF scheduled
      exporting = false;
      gl.finish(); // block until GPU has flushed so toDataURL sees the new frame

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

      // Detect if readPixels was blocked (returns all zeros) — canvas fingerprinting
      // protection in some browsers/extensions zeroes the buffer rather than throwing.
      // Fall back to canvas.toDataURL() which those same protections typically allow.
      // toDataURL on a WebGL canvas may composite transparent pixels against black in
      // Safari, but a non-blank result is better than a blank one.
      var dataUrl;
      var hasContent = false;
      for (var ci = 0; ci < pixels.length; ci++) {
        if (pixels[ci] !== 0) { hasContent = true; break; }
      }
      if (!hasContent) {
        dataUrl = canvas.toDataURL('image/png');
      } else {
        // Normal path: flip vertically and encode via offscreen canvas
        // (gl.readPixels returns rows bottom-to-top; canvas is top-to-bottom)
        var flipped = new Uint8Array(targetW * targetH * 4);
        var rowBytes = targetW * 4;
        for (var row = 0; row < targetH; row++) {
          flipped.set(pixels.subarray((targetH - 1 - row) * rowBytes, (targetH - row) * rowBytes), row * rowBytes);
        }
        var offscreen = document.createElement('canvas');
        offscreen.width  = targetW;
        offscreen.height = targetH;
        var ctx2d = offscreen.getContext('2d');
        var imageData = ctx2d.createImageData(targetW, targetH);
        imageData.data.set(flipped);
        ctx2d.putImageData(imageData, 0, 0);
        dataUrl = offscreen.toDataURL('image/png');
      }

      canvas.width  = prevW;
      canvas.height = prevH;
      gl.viewport(0, 0, prevW, prevH);
      if (window[stateKey]) {
        window[stateKey].textDirty = true;
      }

      callback(dataUrl.split(',')[1]); // base64 only
    };
  }

  window.ShaderBase = {
    create: create,
    commonGLSL: [
      'uniform float u_halftone_angle;',
      'uniform float u_halftone_luma;',
      'uniform float u_vignette_top;',
      'uniform float u_vignette_bottom;',
      'uniform float u_vignette_left;',
      'uniform float u_vignette_right;',
      'float hash21(vec2 p) {',
      '  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);',
      '}',
      'float distressNoise(vec2 uv, float scale) {',
      '  vec2 p = uv * scale; vec2 i = floor(p); vec2 f = fract(p);',
      '  float a = hash21(i), b = hash21(i + vec2(1,0)),',
      '        c = hash21(i + vec2(0,1)), d = hash21(i + vec2(1,1));',
      '  vec2 u = f * f * (3.0 - 2.0 * f);',
      '  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);',
      '}',
      'float fbm(vec2 p) {',
      '  float v = 0.0; float a = 0.5;',
      '  for (int i = 0; i < 5; i++) {',
      '    v += a * distressNoise(p, 1.0);',
      '    p *= 2.0; a *= 0.5;',
      '  }',
      '  return v;',
      '}',
      'float ign(vec2 p) {',
      '  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));',
      '}',
      'float scratchNoise(vec2 uv, float scale) {',
      '  float density = scale * 0.06;',
      '  float row = floor(uv.y * density);',
      '  float f = fract(uv.y * density);',
      '  float rowBase = hash21(vec2(row, 37.4)) * 0.7;',
      '  float bandDist = abs(f - 0.5) * 2.0;',
      '  float scratchVal = mix(rowBase, 1.0, bandDist * bandDist);',
      '  float xVar = distressNoise(uv, scale * 0.1) * 0.3;',
      '  return min(1.0, scratchVal + xVar);',
      '}',
      'float crosshatchNoise(vec2 uv, float scale) {',
      '  float freq = scale * 0.15;',
      '  float p1 = (uv.x + uv.y) * freq;',
      '  float p2 = (uv.x - uv.y) * freq;',
      '  float lw = 0.12;',
      '  float d1 = clamp(min(fract(p1), 1.0 - fract(p1)) / (0.5 * lw), 0.0, 1.0);',
      '  float d2 = clamp(min(fract(p2), 1.0 - fract(p2)) / (0.5 * lw), 0.0, 1.0);',
      '  float jitter = distressNoise(uv, scale * 0.08) * 0.25;',
      '  return min(d1, d2) + jitter;',
      '}',
      'float computeVigMask(vec2 dUV) {',
      '  vec2 vigCoord = dUV - 0.5;',
      '  float vigL = max(0.0, -vigCoord.x);',
      '  float vigR = max(0.0,  vigCoord.x);',
      '  float vigB = max(0.0, -vigCoord.y);',
      '  float vigT = max(0.0,  vigCoord.y);',
      '  float vigVal = vigL*vigL*u_vignette_left + vigR*vigR*u_vignette_right',
      '               + vigB*vigB*u_vignette_bottom + vigT*vigT*u_vignette_top;',
      '  return 1.0 - smoothstep(0.0, 1.0, vigVal);',
      '}',
      'float halftoneNoise(float scale, float drive) {',
      '  float cellSize = max(2.0, scale / 10.0);',
      '  float c = cos(u_halftone_angle), s = sin(u_halftone_angle);',
      '  vec2 rotPos = vec2(c * gl_FragCoord.x - s * gl_FragCoord.y,',
      '                     s * gl_FragCoord.x + c * gl_FragCoord.y);',
      '  vec2 cellUV = fract(rotPos / cellSize) - 0.5;',
      '  float d = length(cellUV);',
      '  return step(d, drive * 0.5);',
      '}',
      'float applyDistress(float alpha, vec2 dUV, float distress, float scale, float grainMode, float falloff, float luma, float vigMask) {',
      '  float dist = clamp(length(dUV - 0.5) * 2.0, 0.0, 1.0);',
      '  float grainSize = max(1.0, scale / 40.0);',
      '  float dn;',
      '  if (grainMode >= 3.5) {',
      '    float drive = sqrt(clamp(alpha * vigMask, 0.0, 1.0)) * mix(1.0, luma, u_halftone_luma) * clamp(distress / 0.85, 0.0, 1.0);',
      '    return halftoneNoise(scale, drive);',
      '  }',
      '  if (grainMode < 0.5) {',
      '    dn = fbm(dUV * scale);',
      '  } else if (grainMode < 1.5) {',
      '    dn = ign(floor(gl_FragCoord.xy / grainSize));',
      '  } else if (grainMode < 2.5) {',
      '    dn = scratchNoise(dUV, scale);',
      '  } else {',
      '    dn = crosshatchNoise(dUV, scale);',
      '  }',
      '  float edgeFactor = mix(1.0, dist, falloff);',
      '  float threshold = distress * edgeFactor;',
      '  return alpha * step(threshold, dn);',
      '}',
      'vec3 cosinePalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {',
      '  return a + b * cos(6.28318 * (c * t + d));',
      '}',
    ].join('\n'),
  };
}());
