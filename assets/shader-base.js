(function () {
  'use strict';

  function create(opts) {
    // Cleared up front so a caller reading ShaderBase.last after loading a
    // shader script sees null when create bailed out, rather than the handle
    // from whichever shader loaded before it.
    window.ShaderBase.last = null;
    var canvasId  = opts.canvasId  || 'shader-canvas';
    var stateKey  = opts.stateKey  || '_shaderState';
    var exportKey = opts.exportKey || '_shaderExport';
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;

    var glOpts = { preserveDrawingBuffer: true, alpha: true, antialias: true, premultipliedAlpha: true };
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

    // ── Palette size groups ───────────────────────────────────────────────────
    // Owned here rather than by each shader's setup/render, so a shader opts in
    // with one GLSL call and no JS wiring. A shader that never calls
    // paletteGroupColor has these optimized out by the compiler, so a null
    // location is a truthful answer to "does this shader support grouping?".
    var groupU = {
      mode:    gl.getUniformLocation(program, 'u_group_mode'),
      count:   gl.getUniformLocation(program, 'u_group_count'),
      bounds:  gl.getUniformLocation(program, 'u_group_bounds[0]'),
      colors:  gl.getUniformLocation(program, 'u_group_colors[0]'),
      // Null on a shader that only calls the two-argument applyPaletteGroups —
      // the per-element branch is then dead code and the compiler drops it. The
      // uploads below no-op on a null location, so that is a supported state,
      // not a broken one.
      seed:    gl.getUniformLocation(program, 'u_group_seed'),
      density: gl.getUniformLocation(program, 'u_group_density'),
      // Null unless the shader draws cohort labels. Diagnostic, off by default.
      debug:   gl.getUniformLocation(program, 'u_group_debug'),
      // Null unless the shader indexes the per-element table.
      element: gl.getUniformLocation(program, 'u_element[0]')
    };
    var supportsGroups = !!groupU.mode;
    // Size-group uniforms are structural, not continuous: bounds are a number
    // list and colors a list of triples, so lerping them would produce NaN as
    // well as meaningless in-between cohorts. The seed is worse — a halfway
    // value between two seeds is a third unrelated stream, so the print pattern
    // would boil while it animated. Hoisted out of render() — it is a constant
    // table and render() runs at the display refresh rate.
    var ALWAYS_INSTANT = {
      u_group_mode: 1, u_group_count: 1, u_group_bounds: 1, u_group_colors: 1,
      u_group_seed: 1, u_group_density: 1, u_group_debug: 1, u_element: 1
    };
    var GROUP_MAX = 8;
    var ELEMENT_MAX = 11;
    // Seeded to a mid size and an average weight, not zeros: an unset weight
    // would clamp to 0.05 in the GLSL and make pow(density, 20) — every element
    // unprinted — for any shader that indexes the table without being sent one.
    var elementBuf = new Float32Array(ELEMENT_MAX * 2);
    for (var e = 0; e < ELEMENT_MAX; e++) { elementBuf[e * 2] = 0.5; elementBuf[e * 2 + 1] = 1; }
    var groupBoundsBuf = new Float32Array(GROUP_MAX - 1);
    var groupColorsBuf = new Float32Array(GROUP_MAX * 3);

    function uploadGroups(v) {
      if (!supportsGroups) return;
      var on = v.u_group_mode ? 1 : 0;
      gl.uniform1f(groupU.mode, on);
      // Uploaded before the early return: otherwise switching labels off while
      // grouping is off would leave a stale 1 to surprise the next time it goes on.
      if (groupU.debug) gl.uniform1f(groupU.debug, v.u_group_debug ? 1 : 0);
      if (!on) return;
      var bounds = v.u_group_bounds || [];
      var colors = v.u_group_colors || [];
      var count = Math.max(1, Math.min(GROUP_MAX, v.u_group_count || 1));
      gl.uniform1f(groupU.count, count);
      groupBoundsBuf.fill(1);          // unreached slots never win a comparison
      for (var i = 0; i < groupBoundsBuf.length; i++) {
        if (i < bounds.length) groupBoundsBuf[i] = bounds[i];
      }
      groupColorsBuf.fill(0);          // unfilled cohorts read as shirt, not garbage
      for (var c = 0; c < GROUP_MAX; c++) {
        var rgb = colors[c];
        if (!rgb) continue;
        groupColorsBuf[c * 3]     = rgb[0];
        groupColorsBuf[c * 3 + 1] = rgb[1];
        groupColorsBuf[c * 3 + 2] = rgb[2];
      }
      if (groupU.bounds) gl.uniform1fv(groupU.bounds, groupBoundsBuf);
      if (groupU.colors) gl.uniform3fv(groupU.colors, groupColorsBuf);
      // Density defaults to 1 — fully inked — so a host that sends bounds and
      // colors but no density gets the old whole-cohort behavior rather than a
      // blank shirt.
      if (groupU.element) {
        var el = v.u_element || [];
        for (var n = 0; n < ELEMENT_MAX; n++) {
          var pair = el[n];
          elementBuf[n * 2]     = pair && typeof pair[0] === 'number' ? pair[0] : 0.5;
          elementBuf[n * 2 + 1] = pair && typeof pair[1] === 'number' ? pair[1] : 1;
        }
        gl.uniform2fv(groupU.element, elementBuf);
      }
      if (groupU.seed)    gl.uniform1ui(groupU.seed, (v.u_group_seed || 0) >>> 0);
      if (groupU.density) gl.uniform1f(groupU.density,
        typeof v.u_group_density === 'number' ? v.u_group_density : 1);
    }

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
    // Manual mode (window.ShaderBase.manual set before this script loads): the
    // caller drives every frame itself, at a clock it supplies. Nothing here
    // schedules work — no rAF chain, no idle poll, no visibility observer — so
    // several shaders can share one WebGL context without fighting over it.
    // Read once at create time so flipping the flag later can't strand a
    // half-started loop. See handle.renderFrame at the bottom of create().
    var manual = !!(window.ShaderBase && window.ShaderBase.manual);

    function scheduleNextFrame() {
      if (exporting || paused || manual) return;
      if (idle) {
        pendingTimeout = setTimeout(function () { pendingTimeout = null; render(); }, 100);
      } else {
        // Wrapped: rAF passes a DOMHighResTimeStamp, which render() would read
        // as a caller-supplied fixed t.
        requestAnimationFrame(function () { render(); });
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

    // fixedT (seconds) overrides the wall clock — the same t always draws the
    // same frame, which is what makes an offline thumbnail reproducible.
    function render(fixedT) {
      if (paused) return;
      var t = fixedT != null ? fixedT : (performance.now() - start) / 1000.0;
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
          var snap = window[stateKey] && window[stateKey].snapValues;
          if (snap) { window[stateKey].snapValues = false; }
          var maxDiff = 0;
          Object.keys(v).forEach(function (k) {
            if (snap || ALWAYS_INSTANT[k] || instant.indexOf(k) !== -1) {
              animVals[k] = Array.isArray(v[k]) ? v[k].slice() : v[k];
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

        uploadGroups(renderV);
        opts.render(gl, uniforms, renderV, w, h, t, textTex || null);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        if (!revealed && !(window[stateKey] && window[stateKey].holdReveal)) {
          canvas.style.opacity = '1';
          revealed = true;
        }
      }

      lastT = t;
      // Only schedule the next frame when not exporting; prevents an extra rAF
      // chain from accumulating each time _shaderExport calls render() directly.
      if (!exporting) scheduleNextFrame();
    }

    if (!manual && window.IntersectionObserver) {
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

    // In manual mode the first frame is the caller's to ask for: values are
    // usually written after the script loads, and drawing here would just burn
    // a frame on the defaults.
    if (!manual) render();

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
      if (window[stateKey]) {
        window[stateKey].textDirty = true; // force texture re-upload at export size
      }
      if (stateValues) {
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
        // readPixels gives premultiplied bytes (premultipliedAlpha: true); putImageData
        // expects straight alpha, so un-premultiply before handing off to Canvas 2D.
        for (var pi = 0; pi < flipped.length; pi += 4) {
          var pa = flipped[pi + 3];
          if (pa > 0 && pa < 255) {
            flipped[pi]     = Math.min(255, Math.round(flipped[pi]     * 255 / pa));
            flipped[pi + 1] = Math.min(255, Math.round(flipped[pi + 1] * 255 / pa));
            flipped[pi + 2] = Math.min(255, Math.round(flipped[pi + 2] * 255 / pa));
          }
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
      exporting = true;
      render(); // redraw at display size immediately so canvas doesn't flash black
      exporting = false;

      callback(dataUrl.split(',')[1]); // base64 only
    };

    // ── Caller-driven frame ───────────────────────────────────────────────────
    // Shader scripts drop create()'s return value, so the handle is also parked
    // on ShaderBase.last — that is what a page loading `assets/<name>.js` by
    // <script src> can actually reach.
    var handle = {
      canvas: canvas,
      gl: gl,
      program: program,
      // True when this shader actually calls paletteGroupColor — see groupU.
      supportsGroups: supportsGroups,
      // Same detection, one step further in: true only when the shader also
      // draws the cohort labels, so a host can offer the toggle on exactly the
      // shaders that answer to it rather than keeping a list that drifts.
      supportsGroupLabels: !!groupU.debug,
      // Draws exactly one frame at t seconds. Animated values are snapped to
      // their targets first, so the frame depends only on _shaderState.values
      // and t — never on how long the page has been open.
      renderFrame: function (t) {
        // Several shaders may share this context; each owns its own program and
        // quad, so rebind before drawing rather than trusting whoever drew last.
        gl.useProgram(program);
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
        if (window[stateKey]) window[stateKey].snapValues = true;
        render(t != null ? t : 0);
      }
    };
    window.ShaderBase.last = handle;
    return handle;
  }

  window.ShaderBase = {
    create: create,
    // Set true before loading a shader script to suppress its animation loop.
    manual: false,
    // Handle from the most recent create() — see handle.renderFrame above.
    last: null,
    commonGLSL: [
      'uniform float u_halftone_angle;',
      'uniform float u_halftone_luma;',
      'uniform float u_halftone_shape;',
      'uniform float u_vignette_top;',
      'uniform float u_vignette_bottom;',
      'uniform float u_vignette_left;',
      'uniform float u_vignette_right;',
      'uniform float u_vignette_anchor_x;',
      'uniform float u_vignette_anchor_y;',
      'float hash21(vec2 p) {',
      '  vec3 p3 = fract(vec3(p.xyx) * 0.1031);',
      '  p3 += dot(p3, p3.yzx + 33.33);',
      '  return fract((p3.x + p3.y) * p3.z);',
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
      '  vec2 vigCoord = dUV - vec2(u_vignette_anchor_x, u_vignette_anchor_y);',
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
      '  float d;',
      '  if (u_halftone_shape < 0.5) {',
      '    d = length(cellUV);',
      '  } else if (u_halftone_shape < 1.5) {',
      '    d = max(abs(cellUV.x), abs(cellUV.y));',
      '  } else {',
      '    d = abs(cellUV.x) + abs(cellUV.y);',
      '  }',
      '  return step(d, drive * 0.5);',
      '}',
      '// Cell geometry stays circle-based regardless of u_halftone_shape, so',
      '// coverage sampling for square/diamond dots is an approximation, not an',
      '// exact match to the rendered shape.',
      '// Center of the halftone cell containing this fragment, in gl_FragCoord px.',
      '// Lets shaders re-evaluate their design at the cell center (and around it)',
      '// so dot size can follow per-cell coverage instead of per-pixel alpha.',
      'vec2 halftoneCellCenter(float scale) {',
      '  float cellSize = max(2.0, scale / 10.0);',
      '  float c = cos(u_halftone_angle), s = sin(u_halftone_angle);',
      '  vec2 rotPos = vec2(c * gl_FragCoord.x - s * gl_FragCoord.y,',
      '                     s * gl_FragCoord.x + c * gl_FragCoord.y);',
      '  vec2 cellRot = (floor(rotPos / cellSize) + 0.5) * cellSize;',
      '  return vec2(c * cellRot.x + s * cellRot.y,',
      '              -s * cellRot.x + c * cellRot.y);',
      '}',
      '// Dot-radius drive shared by applyDistress and shaders that supersample',
      '// per-cell coverage (see line-circle).',
      'float halftoneDrive(float coverage, float luma, float vigMask, float distress) {',
      '  return sqrt(clamp(coverage * vigMask, 0.0, 1.0)) * mix(1.0, luma, u_halftone_luma) * clamp(distress / 0.85, 0.0, 1.0);',
      '}',
      '// applyDistress owns the vignette alpha fade: callers must NOT multiply the',
      '// returned alpha by vigMask again. Half-tone expresses the vignette as dot',
      '// size only, so dots stay solid ink; the other grain modes fade alpha.',
      'float applyDistress(float alpha, vec2 dUV, float distress, float scale, float grainMode, float falloff, float luma, float vigMask) {',
      '  float dist = clamp(length(dUV - 0.5) * 2.0, 0.0, 1.0);',
      '  float grainSize = max(1.0, scale / 40.0);',
      '  float dn;',
      '  if (grainMode >= 3.5) {',
      '    return halftoneNoise(scale, halftoneDrive(alpha, luma, vigMask, distress));',
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
      '  return alpha * step(threshold, dn) * vigMask;',
      '}',
      'vec3 cosinePalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {',
      '  return a + b * cos(6.28318 * (c * t + d));',
      '}',
      '// ── Palette size groups ─────────────────────────────────────────────────',
      '// The probabilistic palette groups shapes by scale and paints each cohort',
      '// one color. A fragment shader has no shape list — but it does already',
      '// know how big the element under this fragment is, because it computed it.',
      '// So the CPU sends only what it alone can decide (where the cohort',
      '// boundaries fall, and which color each one drew) and the shader does the',
      '// lookup. No readback, no ID buffer, no second pass.',
      '//',
      '// A shader opts in by calling paletteGroupColor() with its own normalized',
      '// element size (0 = smallest element in the design, 1 = largest) and',
      '// blending on u_group_mode. Shaders that never call it get these uniforms',
      '// optimized out, which is exactly how the host detects support.',
      'uniform float u_group_mode;    // 0 = off, the shader keeps its own palette',
      'uniform float u_group_count;',
      'uniform float u_group_bounds[7];',
      'uniform vec3  u_group_colors[8];',
      // highp is not decoration. A GLSL ES 3.00 fragment shader defaults int and
      // uint to *mediump* — 16 bits guaranteed — and every shader here declares
      // only `precision mediump float`. Left implicit, the 32-bit arithmetic
      // below would be exact on desktop (where mediump is fp32 anyway) and
      // quietly wrong on the phones most of these shirts get viewed on. Declared
      // here rather than as a `precision highp int` statement each shader has to
      // remember, so opting in stays one line of GLSL.
      'uniform highp uint  u_group_seed;    // base stream for the per-element roll',
      'uniform highp float u_group_density; // print density, rolled per element below',
      '// ── Per-element table ───────────────────────────────────────────────────',
      '// A shader with discrete elements whose sizes only the CPU knows (a word',
      '// drawn as letters at author-set point sizes) gets them here, indexed by',
      '// the same id it passes to applyPaletteGroups. .x is the size, 0-1 within',
      '// this design; .y is how much ink the element carries relative to an',
      '// average one, which is what keeps print density from deleting the big',
      '// ones on a single roll. Optimized out — and so never uploaded — for the',
      '// shaders whose size field is continuous and has no element to index.',
      'uniform vec2 u_element[11];',
      'vec2 paletteElement(float id) {',
      '  return u_element[int(clamp(id, 0.0, 10.0))];',
      '}',
      'vec3 paletteGroupColor(float size) {',
      '  int g = 0;',
      '  for (int i = 0; i < 7; i++) {',
      '    if (float(i) < u_group_count - 1.0 && size >= u_group_bounds[i]) g = i + 1;',
      '  }',
      '  return u_group_colors[g];',
      '}',
      '',
      '// ── Per-element print density ───────────────────────────────────────────',
      '// A transcription of makeRng/elementRoll in probabilistic-palette.js, not a',
      '// second generator: mulberry32 is pure uint32 arithmetic, and WebGL2 uint',
      '// math wraps mod 2^32 exactly as Math.imul and `>>>` do on the CPU. That is',
      '// what lets the print/skip roll happen per element without a readback and',
      '// still land in the same place on every GPU. Integer ops only — a float',
      '// hash would drift between drivers and break same-seed-same-pixels.',
      'highp uint paletteRoll32(highp uint a) {',
      '  a += 0x6D2B79F5u;',
      '  highp uint t = a;',
      '  t = (t ^ (t >> 15u)) * (t | 1u);',
      '  t ^= t + (t ^ (t >> 7u)) * (t | 61u);',
      '  return t ^ (t >> 14u);',
      '}',
      '// 1 = this element takes ink, 0 = it is left as shirt. Matches the CPU rule',
      '// exactly, including the boundary: printed when roll < the chance.',
      '//',
      '// `weight` is how much of the design this element carries, relative to an',
      '// average one. At 1 the chance is just u_group_density, so density means',
      '// "this fraction of elements" — right when elements are interchangeable',
      '// (a halftone dot grid), wrong when they are not: circle-on-line\'s power',
      '// warp makes its first line ~6x the average cell, and a flat roll lets one',
      '// coin flip delete a third of the artwork. The exponent form is what makes',
      '// the correction affordable here — it needs only this element\'s weight, no',
      '// total and no second pass — and pow() fixes both endpoints, so density 0',
      '// still prints nothing and 1 still prints everything. See elementPrintChance',
      '// in probabilistic-palette.js, which this mirrors.',
      'float paletteElementPrinted(highp float elementId, float weight) {',
      '  highp uint id   = uint(max(elementId, 0.0));',
      '  highp uint seed = u_group_seed ^ (id * 0x9E3779B1u);',
      '  // The top 24 bits, not all 32: a float carries a 24-bit mantissa at',
      '  // best, so a full-width roll cannot survive the conversion. elementRoll',
      '  // on the CPU drops the same 8 bits — that is what makes the two sides',
      '  // the same decision rather than nearly the same one.',
      '  highp float roll = float(paletteRoll32(seed) >> 8u) / 16777216.0;',
      '  float chance = pow(u_group_density, 1.0 / clamp(weight, 0.05, 20.0));',
      '  return 1.0 - step(chance, roll);',
      '}',
      '// Unweighted: every element carries the same share.',
      'float paletteElementPrinted(highp float elementId) {',
      '  return paletteElementPrinted(elementId, 1.0);',
      '}',
      '',
      '',
      '// ── Cohort labels (diagnostic) ──────────────────────────────────────────',
      '// Draws the cohort number over each size band so the tiering can be read',
      '// off the artwork while tuning, instead of inferred from the colors — which',
      '// is exactly the thing that is hard when two cohorts draw the same color.',
      '// Purely additive: it never touches the color assignment, and u_group_debug',
      '// is 0 everywhere except when a host explicitly turns it on, so a product',
      '// render can never carry a label.',
      '//',
      '// A 3x5 bitmap font for 1-8 (GROUP_MAX cohorts), one uint of row bits each,',
      '// MSB = top-left. Cheaper and sharper than a text texture, and it needs no',
      '// JS wiring at all — which matters for something meant to be switched on',
      '// mid-tune and off again.',
      'uniform float u_group_debug;',
      'highp uint paletteDigitBits(int d) {',
      '  if (d == 1) return 0x2C97u;',
      '  if (d == 2) return 0x73E7u;',
      '  if (d == 3) return 0x73CFu;',
      '  if (d == 4) return 0x5BC9u;',
      '  if (d == 5) return 0x79CFu;',
      '  if (d == 6) return 0x79EFu;',
      '  if (d == 7) return 0x7249u;',
      '  return 0x7BEFu;',
      '}',
      '// p is the digit-local coordinate, (0,0) bottom-left to (1,1) top-right.',
      'float paletteDigitMask(int d, vec2 p) {',
      '  if (p.x < 0.0 || p.x >= 1.0 || p.y < 0.0 || p.y >= 1.0) return 0.0;',
      '  int col = int(p.x * 3.0);',
      '  int row = int((1.0 - p.y) * 5.0);',
      '  int bit = 14 - (row * 3 + col);',
      '  return float((paletteDigitBits(d) >> uint(bit)) & 1u);',
      '}',
      '// One label per cohort, placed along whatever axis the shader maps size to:',
      '// size 0 sits at uv.y = y0 and size 1 at y1, so an inverted field just swaps',
      '// them. x is the left edge in uv, h the digit height in uv, and pxAspect',
      '// (u_resolution.y / u_resolution.x) keeps the glyph square on a portrait',
      '// canvas. Returns a 0/1 mask for the caller to composite however it likes.',
      'float paletteGroupLabelMask(vec2 uv, float x, float y0, float y1, float h, float pxAspect) {',
      '  if (u_group_debug < 0.5 || u_group_mode < 0.5) return 0.0;',
      '  float w = h * 0.6 * pxAspect;',
      '  float m = 0.0;',
      '  float prevY = -999.0;',
      '  float lane  = 0.0;',
      '  for (int g = 0; g < 8; g++) {',
      '    if (float(g) >= u_group_count) break;',
      '    // The band this cohort owns, then its midpoint — the label belongs where',
      '    // the cohort actually is, not at a fixed stride.',
      '    float lo = g == 0 ? 0.0 : u_group_bounds[max(g - 1, 0)];',
      '    // min(g, 6): u_group_bounds is float[7]. The ternary already avoids',
      '    // reading index 7 on the last cohort, but relying on short-circuiting',
      '    // to keep an out-of-bounds index unevaluated is not something the',
      '    // spec guarantees a compiler will honour.',
      '    float hi = float(g) >= u_group_count - 1.0 ? 1.0 : u_group_bounds[min(g, 6)];',
      '    float yc = mix(y0, y1, (lo + hi) * 0.5);',
      '    // Cohorts crammed into a narrow slice of the range would stack their',
      '    // labels into an unreadable pile — and that is the case where the count',
      '    // matters most, since bunched cuts are what a too-small minGap produces.',
      '    // Step sideways instead: the staircase still shows the crowding.',
      '    lane = abs(yc - prevY) < h * 1.05 ? lane + 1.0 : 0.0;',
      '    prevY = yc;',
      '    vec2 p = (uv - vec2(x + lane * w * 1.5, yc - h * 0.5)) / vec2(w, h);',
      '    m = max(m, paletteDigitMask(g + 1, p));',
      '  }',
      '  return m;',
      '}',
      '',
      '// Convenience: leaves `col` untouched when grouping is off.',
      '//',
      '// The three-argument form is the one to use wherever the shader can name',
      '// the element under this fragment (a grid cell, a line, a column). Each',
      '// element then rolls its own print/skip, so density reads as texture inside',
      '// a cohort rather than deleting whole tiers. An unprinted element goes',
      '// black, the same rule everywhere: black is the shirt, never an ink.',
      '// The four-argument form adds the element\'s ink weight (1 = average), for',
      '// shaders whose elements differ enough in area that "fraction of elements"',
      '// and "fraction of ink" are not the same number.',
      'vec3 applyPaletteGroups(vec3 col, float size, highp float elementId, float weight) {',
      '  vec3 grouped = paletteGroupColor(size) * paletteElementPrinted(elementId, weight);',
      '  return mix(col, grouped, step(0.5, u_group_mode));',
      '}',
      'vec3 applyPaletteGroups(vec3 col, float size, highp float elementId) {',
      '  return applyPaletteGroups(col, size, elementId, 1.0);',
      '}',
      '// Cohort colour with NO print mask applied. For a shader that post-processes',
      '// the ink colour before deciding whether any ink lands: rise-shirt inverts',
      '// its dots, and inverting an already-masked colour turns vec3(0) — "this',
      '// element is unprinted" — into pure white ink. Mask last, with',
      '// paletteElementPrinted, so black stays the shirt either way.',
      'vec3 paletteGroupedColor(vec3 col, float size) {',
      '  return mix(col, paletteGroupColor(size), step(0.5, u_group_mode));',
      '}',
      '// Two-argument form: no element to name, so the whole cohort takes ink.',
      'vec3 applyPaletteGroups(vec3 col, float size) {',
      '  return mix(col, paletteGroupColor(size), step(0.5, u_group_mode));',
      '}',
    ].join('\n'),
  };
}());
