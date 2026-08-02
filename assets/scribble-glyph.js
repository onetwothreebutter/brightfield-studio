(function () {
  'use strict';

  // ScribbleGlyph — a single glyph rendered as overlapping hand-traced pen
  // strokes (no solid fill underneath). Strokes retrace the near-zero isoline
  // of a signed-ish distance field packed into the text texture: G = distance
  // to the outer silhouette, B = distance to the nearest interior hole (the
  // counters of 8, 6, 9, 0, a, e, o, etc). Each pass jitters the sample UV by
  // a hash-seeded rotation/offset plus fbm wobble, so strokes read as messy
  // near the outer edge and tight near inner holes.

  var fragSrc = [
    '#version 300 es',
    'precision mediump float;',
    '',
    'uniform vec2      u_resolution;',
    'uniform float     u_aspect;',
    'uniform sampler2D u_text_texture;',
    'uniform float     u_text_x;',
    'uniform float     u_text_y;',
    '',
    '// Scribble',
    'uniform float u_stroke_count;',
    'uniform float u_stroke_width;',
    'uniform float u_jitter_outer;',
    'uniform float u_jitter_inner;',
    'uniform float u_wobble_freq;',
    'uniform float u_seed;',
    '',
    '// Palette — cosine (mode 0) or 4-stop (mode 1)',
    'uniform float u_color_mode;',
    'uniform vec3  u_a;',
    'uniform vec3  u_b;',
    'uniform vec3  u_c;',
    'uniform vec3  u_d;',
    'uniform vec3  u_color0;',
    'uniform vec3  u_color1;',
    'uniform vec3  u_color2;',
    'uniform vec3  u_color3;',
    '',
    '// Finish',
    'uniform float u_opacity;',
    'uniform float u_grain_mode;',
    'uniform float u_distress;',
    'uniform float u_distress_scale;',
    'uniform float u_distress_falloff;',
    'uniform float u_pos_x;',
    'uniform float u_pos_y;',
    'uniform float u_scale;',
    '',
    'out vec4 fragColor;',
    '',
    window.ShaderBase.commonGLSL,
    '',
    '// ── OKLCH color space helpers (perceptually-uniform 4-stop blending) ──────',
    'vec3 linear_rgb_to_oklab(vec3 c) {',
    '  float l_ = 0.4122214708*c.r + 0.5363325363*c.g + 0.0514459929*c.b;',
    '  float m_ = 0.2119034982*c.r + 0.6806995451*c.g + 0.1073969566*c.b;',
    '  float s_ = 0.0883024619*c.r + 0.2817188376*c.g + 0.6299787005*c.b;',
    '  float l = pow(max(l_, 0.0), 1.0/3.0);',
    '  float m = pow(max(m_, 0.0), 1.0/3.0);',
    '  float s = pow(max(s_, 0.0), 1.0/3.0);',
    '  return vec3(0.2104542553*l+0.7936177850*m-0.0040720468*s,',
    '              1.9779984951*l-2.4285922050*m+0.4505937099*s,',
    '              0.0259040371*l+0.4072456269*m-0.4631496600*s);',
    '}',
    'vec3 oklab_to_linear_rgb(vec3 lab) {',
    '  float l_ = lab.x+0.3963377774*lab.y+0.2158037573*lab.z;',
    '  float m_ = lab.x-0.1055613458*lab.y-0.0638541728*lab.z;',
    '  float s_ = lab.x-0.0894841775*lab.y-1.2914855480*lab.z;',
    '  float l = l_*l_*l_; float m = m_*m_*m_; float s = s_*s_*s_;',
    '  return vec3( 4.0767416621*l-3.3077115913*m+0.2309699292*s,',
    '              -1.2684380046*l+2.6097574011*m-0.3413193965*s,',
    '              -0.0041960863*l-0.7034186147*m+1.7076147010*s);',
    '}',
    'vec3 oklab_to_oklch(vec3 lab) {',
    '  return vec3(lab.x, sqrt(lab.y*lab.y + lab.z*lab.z), atan(lab.z, lab.y));',
    '}',
    'vec3 oklch_to_oklab(vec3 lch) {',
    '  return vec3(lch.x, lch.y*cos(lch.z), lch.y*sin(lch.z));',
    '}',
    'vec3 mix_oklch(vec3 a, vec3 b, float t) {',
    '  float dh = mod(b.z - a.z + 3.14159265, 6.28318530) - 3.14159265;',
    '  return vec3(mix(a.x, b.x, t), mix(a.y, b.y, t), a.z + t * dh);',
    '}',
    '',
    'const int MAX_STROKES = 48;',
    '',
    '// Evaluates the scribble design color + coverage at any uv (post',
    '// pos/scale transform). aaFixed: 0.0 for the per-fragment path',
    '// (fwidth-based AA); a small fixed half-width when sampling at halftone',
    '// cell positions, where uv is constant across fragments and fwidth is',
    '// meaningless.',
    'vec4 designEval(vec2 uv, float aaFixed) {',
    '  vec2 anchor = vec2(u_text_x, u_text_y);',
    '  vec2 delta  = uv - anchor;',
    '  vec2 uv0    = vec2(delta.x * u_aspect, delta.y) + anchor;',
    '',
    '  // Texture packing: R = fill (unused here — no solid fill), G = distance',
    '  // to the outer silhouette, B = distance to the nearest interior hole,',
    '  // both normalized by 0.5 * textFontSize and clamped to [0,1]. This',
    '  // repurposes G away from the usual "outline coverage" meaning used by',
    '  // other shaders, since scribble-glyph has no separate outline pass.',
    '  vec4  baseSample    = texture(u_text_texture, uv0);',
    '  float distOuterBase = baseSample.g;',
    '  float distInnerBase = baseSample.b;',
    '',
    '  // Broad-phase test so the stroke loop only runs near an edge (outer',
    '  // silhouette or an inner hole) — skips deep-interior/deep-background',
    '  // pixels entirely. Generous band so it never clips a jittered stroke.',
    '  float fillMask = 1.0 - smoothstep(0.0, 0.6, min(distOuterBase, distInnerBase));',
    '',
    '  // 0 near the outer edge, 1 near an inner hole — drives how messy vs.',
    '  // tight each stroke pass\'s jitter is at this position.',
    '  float innerness = smoothstep(-0.03, 0.03, distOuterBase - distInnerBase);',
    '  float jitterAmt  = mix(u_jitter_outer, u_jitter_inner, innerness);',
    '',
    '  float strokeAccum = 0.0;',
    '  if (fillMask >= 0.01) {',
    '    for (int i = 0; i < MAX_STROKES; i++) {',
    '      if (float(i) >= u_stroke_count) break;',
    '',
    '      // Hash-seeded rotation + radial offset for this pass, plus an',
    '      // fbm-driven wobble along the stroke direction — reads as hand-drawn',
    '      // retraces rather than stamped copies of the same offset.',
    '      vec2 hashSeed = vec2(float(i) * 12.9898 + u_seed * 3.271,',
    '                           float(i) * 78.233  - u_seed * 1.531);',
    '      float rotAngle = hash21(hashSeed) * 6.28318530718;',
    '      vec2  dir      = vec2(cos(rotAngle), sin(rotAngle));',
    '      vec2  side     = vec2(-dir.y, dir.x);',
    '',
    '      float along  = dot(uv0, dir)  * u_wobble_freq;',
    '      float across = dot(uv0, side) * u_wobble_freq;',
    '      float wobble = fbm(vec2(along, across) + hashSeed) - 0.5;',
    '      float radial = hash21(hashSeed + 5.21) - 0.5;',
    '',
    '      vec2 jitterOffset = dir * radial * 2.0 * jitterAmt + side * wobble * 2.0 * jitterAmt;',
    '      vec2 sampleUV     = uv0 + jitterOffset;',
    '',
    '      vec4  s   = texture(u_text_texture, sampleUV);',
    '      float iso = min(s.g, s.b);',
    '',
    '      // Re-trace the near-zero isoline of min(distOuter, distInner) at the',
    '      // jittered point; passes accumulate via max() so overlapping noisy',
    '      // retraces build up density instead of averaging it away.',
    '      float aa = max(fwidth(iso) * 0.5, aaFixed) + 0.002;',
    '      float strokeMask = 1.0 - smoothstep(u_stroke_width, u_stroke_width + aa, iso);',
    '      strokeAccum = max(strokeAccum, strokeMask);',
    '    }',
    '  }',
    '',
    '  float t = clamp(uv.y, 0.0, 1.0);',
    '  vec3 palColor = cosinePalette(t, u_a, u_b, u_c, u_d);',
    '',
    '  float t01 = clamp(t * 3.0, 0.0, 1.0);',
    '  float t12 = clamp((t - 1.0 / 3.0) * 3.0, 0.0, 1.0);',
    '  float t23 = clamp((t - 2.0 / 3.0) * 3.0, 0.0, 1.0);',
    '  vec3 lch0 = oklab_to_oklch(linear_rgb_to_oklab(u_color0));',
    '  vec3 lch1 = oklab_to_oklch(linear_rgb_to_oklab(u_color1));',
    '  vec3 lch2 = oklab_to_oklch(linear_rgb_to_oklab(u_color2));',
    '  vec3 lch3 = oklab_to_oklch(linear_rgb_to_oklab(u_color3));',
    '  vec3 seg01 = mix_oklch(lch0, lch1, t01);',
    '  vec3 seg12 = mix_oklch(lch1, lch2, t12);',
    '  vec3 seg23 = mix_oklch(lch2, lch3, t23);',
    '  vec3 blendedLch = mix(mix(seg01, seg12, step(1.0 / 3.0, t)), seg23, step(2.0 / 3.0, t));',
    '  vec3 gradColor = clamp(oklab_to_linear_rgb(oklch_to_oklab(blendedLch)), 0.0, 1.0);',
    '',
    '  vec3 finalColor = mix(palColor, gradColor, u_color_mode);',
    '  return vec4(finalColor, strokeAccum);',
    '}',
    '',
    'void main() {',
    '  vec2 uv = gl_FragCoord.xy / u_resolution;',
    '  uv = (uv - 0.5) / u_scale + 0.5 + vec2(u_pos_x, u_pos_y);',
    '  vec4 px = designEval(uv, 0.0);',
    '  vec3 finalColor = px.rgb;',
    '  vec2 dUV = gl_FragCoord.xy / u_resolution;',
    '  float vigMask = computeVigMask(dUV);',
    '  float alpha;',
    '  if (u_grain_mode >= 3.5) {',
    '    // Half-tone: size each dot by stroke coverage over its cell (3x3',
    '    // supersample) so dots shrink toward stroke edges instead of slicing.',
    '    vec2 cellFrag  = halftoneCellCenter(u_distress_scale);',
    '    float cellSize = max(2.0, u_distress_scale / 10.0);',
    '    float covSum = 0.0;',
    '    vec3  inkSum = vec3(0.0);',
    '    for (int i = -1; i <= 1; i++) {',
    '      for (int j = -1; j <= 1; j++) {',
    '        vec2 sFrag = cellFrag + vec2(float(i), float(j)) * (cellSize / 3.0);',
    '        vec2 sUV   = (sFrag / u_resolution - 0.5) / u_scale + 0.5 + vec2(u_pos_x, u_pos_y);',
    '        vec4 smp   = designEval(sUV, 0.002);',
    '        covSum += smp.a;',
    '        inkSum += smp.rgb * smp.a;',
    '      }',
    '    }',
    '    vec3 dotColor  = covSum > 0.001 ? inkSum / covSum : finalColor;',
    '    float coverage = covSum / 9.0;',
    '    float cellVig  = computeVigMask(cellFrag / u_resolution);',
    '    float dotLuma  = dot(dotColor, vec3(0.299, 0.587, 0.114));',
    '    alpha = halftoneNoise(u_distress_scale, halftoneDrive(coverage, dotLuma, cellVig, u_distress)) * u_opacity;',
    '    finalColor = dotColor;',
    '  } else {',
    '    alpha = applyDistress(px.a, dUV, u_distress, u_distress_scale, u_grain_mode, u_distress_falloff, dot(finalColor, vec3(0.299, 0.587, 0.114)), vigMask) * u_opacity;',
    '    finalColor = finalColor * vigMask;',
    '  }',
    '  vec3 encoded = pow(max(finalColor, 0.0), vec3(1.0 / 2.2));',
    '  fragColor = vec4(encoded * alpha, alpha);',
    '}'
  ].join('\n');

  window.ShaderBase.create({
    animateValues: true,
    instantKeys: [
      'u_opacity', 'u_distress_0', 'u_distress_scale_0', 'u_distress_1', 'u_distress_scale_1',
      'u_distress_2', 'u_distress_scale_2', 'u_distress_3', 'u_distress_scale_3', 'u_grain_mode',
      'u_distress_falloff', 'u_vignette_top', 'u_vignette_bottom', 'u_vignette_left', 'u_vignette_right',
      'u_vignette_anchor_x', 'u_vignette_anchor_y',
      // Integer-step controls: lerping these would cross-fade two unrelated
      // stroke patterns instead of cutting cleanly between them.
      'u_stroke_count', 'u_seed',
    ],
    fragSrc: fragSrc,

    setup: function (gl, program) {
      return {
        res:       gl.getUniformLocation(program, 'u_resolution'),
        aspect:    gl.getUniformLocation(program, 'u_aspect'),
        textTex:   gl.getUniformLocation(program, 'u_text_texture'),
        textX:     gl.getUniformLocation(program, 'u_text_x'),
        textY:     gl.getUniformLocation(program, 'u_text_y'),
        strokeCount: gl.getUniformLocation(program, 'u_stroke_count'),
        strokeWidth: gl.getUniformLocation(program, 'u_stroke_width'),
        jitterOuter: gl.getUniformLocation(program, 'u_jitter_outer'),
        jitterInner: gl.getUniformLocation(program, 'u_jitter_inner'),
        wobbleFreq:  gl.getUniformLocation(program, 'u_wobble_freq'),
        seed:        gl.getUniformLocation(program, 'u_seed'),
        colorMode: gl.getUniformLocation(program, 'u_color_mode'),
        palA:      gl.getUniformLocation(program, 'u_a'),
        palB:      gl.getUniformLocation(program, 'u_b'),
        palC:      gl.getUniformLocation(program, 'u_c'),
        palD:      gl.getUniformLocation(program, 'u_d'),
        color0:    gl.getUniformLocation(program, 'u_color0'),
        color1:    gl.getUniformLocation(program, 'u_color1'),
        color2:    gl.getUniformLocation(program, 'u_color2'),
        color3:    gl.getUniformLocation(program, 'u_color3'),
        opacity:         gl.getUniformLocation(program, 'u_opacity'),
        distress:        gl.getUniformLocation(program, 'u_distress'),
        distressScale:   gl.getUniformLocation(program, 'u_distress_scale'),
        grainMode:       gl.getUniformLocation(program, 'u_grain_mode'),
        distressFalloff: gl.getUniformLocation(program, 'u_distress_falloff'),
        halftoneAngle:   gl.getUniformLocation(program, 'u_halftone_angle'),
        halftoneLuma:    gl.getUniformLocation(program, 'u_halftone_luma'),
        posX:            gl.getUniformLocation(program, 'u_pos_x'),
        posY:            gl.getUniformLocation(program, 'u_pos_y'),
        scale:           gl.getUniformLocation(program, 'u_scale'),
        vignetteTop:     gl.getUniformLocation(program, 'u_vignette_top'),
        vignetteBottom:  gl.getUniformLocation(program, 'u_vignette_bottom'),
        vignetteLeft:    gl.getUniformLocation(program, 'u_vignette_left'),
        vignetteRight:   gl.getUniformLocation(program, 'u_vignette_right'),
        vignetteAnchorX: gl.getUniformLocation(program, 'u_vignette_anchor_x'),
        vignetteAnchorY: gl.getUniformLocation(program, 'u_vignette_anchor_y'),
      };
    },

    render: function (gl, u, v, w, h, t, textTex) {
      gl.uniform2f(u.res,    w, h);
      gl.uniform1f(u.aspect, w / h);
      gl.uniform1f(u.textX,  v.textX != null ? v.textX : 0.5);
      gl.uniform1f(u.textY,  v.textY != null ? v.textY : 0.5);

      gl.uniform1f(u.strokeCount, v.u_stroke_count != null ? v.u_stroke_count : 14);
      gl.uniform1f(u.strokeWidth, v.u_stroke_width != null ? v.u_stroke_width : 0.05);
      gl.uniform1f(u.jitterOuter, v.u_jitter_outer  != null ? v.u_jitter_outer  : 0.018);
      gl.uniform1f(u.jitterInner, v.u_jitter_inner  != null ? v.u_jitter_inner  : 0.006);
      gl.uniform1f(u.wobbleFreq,  v.u_wobble_freq   != null ? v.u_wobble_freq   : 18.0);
      gl.uniform1f(u.seed,        v.u_seed          != null ? v.u_seed          : 7.0);

      gl.uniform1f(u.colorMode, v.u_color_mode != null ? parseFloat(v.u_color_mode) : 0.0);
      gl.uniform3fv(u.palA,   v.u_a      || [0.5, 0.5, 0.5]);
      gl.uniform3fv(u.palB,   v.u_b      || [0.5, 0.5, 0.5]);
      gl.uniform3fv(u.palC,   v.u_c      || [1.0, 1.0, 1.0]);
      gl.uniform3fv(u.palD,   v.u_d      || [0.0, 0.33, 0.67]);
      gl.uniform3fv(u.color0, v.u_color0 || [1.0, 0.2,  0.4]);
      gl.uniform3fv(u.color1, v.u_color1 || [1.0, 0.8,  0.0]);
      gl.uniform3fv(u.color2, v.u_color2 || [0.0, 0.8,  1.0]);
      gl.uniform3fv(u.color3, v.u_color3 || [0.667, 0.0, 1.0]);

      gl.uniform1f(u.opacity, v.u_opacity != null ? v.u_opacity : 1.0);
      var _gm = Math.round(v.u_grain_mode != null ? parseFloat(v.u_grain_mode) : 0);
      gl.uniform1f(u.distress,      v['u_distress_' + _gm]       != null ? v['u_distress_' + _gm]       : (v.u_distress       != null ? v.u_distress       : 0.0));
      gl.uniform1f(u.distressScale, v['u_distress_scale_' + _gm] != null ? v['u_distress_scale_' + _gm] : (v.u_distress_scale != null ? v.u_distress_scale : 80.0));
      gl.uniform1f(u.grainMode,        v.u_grain_mode       != null ? parseFloat(v.u_grain_mode) : 0.0);
      gl.uniform1f(u.distressFalloff,  v.u_distress_falloff != null ? v.u_distress_falloff : 0.0);
      gl.uniform1f(u.halftoneAngle, (v.u_halftone_angle != null ? v.u_halftone_angle : 45.0) * Math.PI / 180.0);
      gl.uniform1f(u.halftoneLuma,  v.u_halftone_luma  != null ? v.u_halftone_luma  : 0.0);
      gl.uniform1f(u.posX,  v.u_pos_x != null ? v.u_pos_x : 0.0);
      gl.uniform1f(u.posY,  v.u_pos_y != null ? v.u_pos_y : 0.0);
      gl.uniform1f(u.scale, v.u_scale != null ? v.u_scale : 1.0);
      gl.uniform1f(u.vignetteTop,    v.u_vignette_top    != null ? v.u_vignette_top    : 0.0);
      gl.uniform1f(u.vignetteBottom, v.u_vignette_bottom != null ? v.u_vignette_bottom : 0.0);
      gl.uniform1f(u.vignetteLeft,   v.u_vignette_left   != null ? v.u_vignette_left   : 0.0);
      gl.uniform1f(u.vignetteRight,  v.u_vignette_right  != null ? v.u_vignette_right  : 0.0);
      gl.uniform1f(u.vignetteAnchorX, v.u_vignette_anchor_x != null ? v.u_vignette_anchor_x : 0.5);
      gl.uniform1f(u.vignetteAnchorY, v.u_vignette_anchor_y != null ? v.u_vignette_anchor_y : 0.5);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, textTex);
      gl.uniform1i(u.textTex, 0);
    },

    // Draws the glyph, then classifies every background pixel in a padded
    // region around it as "exterior" (reachable from the region border) or
    // an enclosed "interior hole", and chamfer-distances each set into the
    // G (outer) and B (inner) channels. See CLAUDE.md's glyph distance-field
    // notes for why this needs its own drawText instead of the plain
    // fill/outline pattern used elsewhere.
    drawText: function (ctx, size, v) {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, size, size);

      var text       = v.text || '';
      var fontFamily = v.textFont ? '"' + v.textFont + '"' : '"Montserrat"';
      var fontSize   = v.textFontSize || 380;
      var tx = v.textX != null ? v.textX : 0.5;
      var ty = v.textY != null ? v.textY : 0.5;
      var cx = tx * size;
      var cy = (1 - ty) * size;

      if (text) {
        ctx.font         = 'bold ' + fontSize + 'px ' + fontFamily + ', monospace';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle    = 'rgb(255,0,0)';
        ctx.fillText(text, cx, cy);
      }

      var img  = ctx.getImageData(0, 0, size, size);
      var data = img.data;
      var INK_THRESHOLD = 128; // R channel doubles as antialiased ink coverage (black bg + opaque red fill)

      // Set every pixel's G/B (distOuter/distInner) to the "far" sentinel as
      // a baseline — only the padded sub-rect around the glyph below gets
      // real chamfer values. This also makes an empty/blank glyph render
      // nothing, since min(G,B) stays maxed everywhere.
      var minX = size, minY = size, maxX = -1, maxY = -1;
      for (var i = 0; i < data.length; i += 4) {
        data[i + 1] = 255;
        data[i + 2] = 255;
        if (data[i] >= INK_THRESHOLD) {
          var p  = i / 4;
          var px = p % size;
          var py = (p / size) | 0;
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
        }
      }

      if (maxX < 0) { ctx.putImageData(img, 0, 0); return; }

      // Pad by more than the largest possible jitter+wobble reach (see the
      // GLSL jitterOffset math) so a jittered sample near the silhouette edge
      // never lands on an unprocessed texel outside this sub-rect.
      var PAD = 130;
      var rx0 = Math.max(0, minX - PAD);
      var ry0 = Math.max(0, minY - PAD);
      var rx1 = Math.min(size - 1, maxX + PAD);
      var ry1 = Math.min(size - 1, maxY + PAD);
      var rw  = rx1 - rx0 + 1;
      var rh  = ry1 - ry0 + 1;

      var isInk = new Uint8Array(rw * rh);
      for (var yy = 0; yy < rh; yy++) {
        for (var xx = 0; xx < rw; xx++) {
          var gi = ((ry0 + yy) * size + (rx0 + xx)) * 4;
          isInk[yy * rw + xx] = data[gi] >= INK_THRESHOLD ? 1 : 0;
        }
      }

      // Flood-fill from the padded rect's border through background pixels
      // (4-connectivity) to label reachable background as "exterior". Any
      // background pixel not reached is an enclosed "interior hole" — this
      // works uniformly for 0, 1, or multiple holes without ever needing to
      // distinguish which hole is which.
      var isExterior = new Uint8Array(rw * rh);
      var stack = [];
      function seed(x, y) {
        if (x < 0 || x >= rw || y < 0 || y >= rh) return;
        var idx = y * rw + x;
        if (isInk[idx] || isExterior[idx]) return;
        isExterior[idx] = 1;
        stack.push(idx);
      }
      for (var bx = 0; bx < rw; bx++) { seed(bx, 0); seed(bx, rh - 1); }
      for (var by = 0; by < rh; by++) { seed(0, by); seed(rw - 1, by); }
      while (stack.length) {
        var ci  = stack.pop();
        var cx2 = ci % rw;
        var cy2 = (ci / rw) | 0;
        seed(cx2 - 1, cy2); seed(cx2 + 1, cy2); seed(cx2, cy2 - 1); seed(cx2, cy2 + 1);
      }

      var isHoleBg = new Uint8Array(rw * rh);
      var hasHole  = false;
      for (var hi = 0; hi < rw * rh; hi++) {
        if (!isInk[hi] && !isExterior[hi]) { isHoleBg[hi] = 1; hasHole = true; }
      }

      // Two-pass chamfer (3-4) distance transform: orthogonal step = 3,
      // diagonal step = 4 (approximates true Euclidean distance * 3).
      function chamfer(seedMask) {
        var dist = new Float32Array(rw * rh);
        for (var di = 0; di < rw * rh; di++) dist[di] = seedMask[di] ? 0 : 1e6;

        for (var y = 0; y < rh; y++) {
          for (var x = 0; x < rw; x++) {
            var i2 = y * rw + x;
            if (dist[i2] === 0) continue;
            var best = dist[i2];
            if (x > 0)               best = Math.min(best, dist[i2 - 1] + 3);
            if (y > 0)               best = Math.min(best, dist[i2 - rw] + 3);
            if (x > 0 && y > 0)      best = Math.min(best, dist[i2 - rw - 1] + 4);
            if (x < rw - 1 && y > 0) best = Math.min(best, dist[i2 - rw + 1] + 4);
            dist[i2] = best;
          }
        }
        for (var y2 = rh - 1; y2 >= 0; y2--) {
          for (var x2 = rw - 1; x2 >= 0; x2--) {
            var i3 = y2 * rw + x2;
            var best2 = dist[i3];
            if (x2 < rw - 1)                best2 = Math.min(best2, dist[i3 + 1] + 3);
            if (y2 < rh - 1)                best2 = Math.min(best2, dist[i3 + rw] + 3);
            if (x2 < rw - 1 && y2 < rh - 1)  best2 = Math.min(best2, dist[i3 + rw + 1] + 4);
            if (x2 > 0 && y2 < rh - 1)       best2 = Math.min(best2, dist[i3 + rw - 1] + 4);
            dist[i3] = best2;
          }
        }
        return dist;
      }

      // Seed the transform from the true ink/background INTERFACE, not from
      // the whole background region — seeding from all of isExterior would
      // give distance 0 to every background pixel trivially (since each is
      // its own nearest "exterior" pixel), collapsing the outer field to 0
      // everywhere in the background instead of growing away from the edge.
      function boundaryMask(inkMask, otherMask) {
        var out = new Uint8Array(rw * rh);
        for (var y = 0; y < rh; y++) {
          for (var x = 0; x < rw; x++) {
            var idx = y * rw + x;
            var isA = inkMask[idx] === 1;
            var isB = otherMask[idx] === 1;
            if (!isA && !isB) continue;
            var opposite = isA ? otherMask : inkMask;
            var touches = false;
            if (x > 0)               touches = touches || !!opposite[idx - 1];
            if (!touches && x < rw - 1) touches = touches || !!opposite[idx + 1];
            if (!touches && y > 0)      touches = touches || !!opposite[idx - rw];
            if (!touches && y < rh - 1) touches = touches || !!opposite[idx + rw];
            if (touches) out[idx] = 1;
          }
        }
        return out;
      }

      var distOuter = chamfer(boundaryMask(isInk, isExterior));
      var distInner = hasHole ? chamfer(boundaryMask(isInk, isHoleBg)) : null;

      // Size-independent normalization: distances are measured in units of
      // half the glyph's own font size, not a fixed pixel constant.
      var norm = 0.5 * fontSize;

      for (var oy = 0; oy < rh; oy++) {
        for (var ox = 0; ox < rw; ox++) {
          var li  = oy * rw + ox;
          var gi2 = ((ry0 + oy) * size + (rx0 + ox)) * 4;
          var gOut = Math.max(0, Math.min(255, Math.round((distOuter[li] / 3 / norm) * 255)));
          var bIn  = hasHole
            ? Math.max(0, Math.min(255, Math.round((distInner[li] / 3 / norm) * 255)))
            : 255; // no holes on this glyph — sentinel "far" everywhere
          data[gi2 + 1] = gOut;
          data[gi2 + 2] = bIn;
        }
      }

      ctx.putImageData(img, 0, 0);
    },

    textKey: function (v) {
      return JSON.stringify([v.text, v.textFont, v.textFontSize, v.textX, v.textY]);
    },
  });
}());
