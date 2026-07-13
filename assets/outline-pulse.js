(function () {
  'use strict';

  // ── Fragment shader ─────────────────────────────────────────────────────────
  var fragSrc = [
    '#version 300 es',
    'precision mediump float;',
    '',
    'uniform float      u_time;',
    'uniform vec2       u_resolution;',
    'uniform sampler2D  u_sdf_texture;',
    '',
    '// Ring controls',
    'uniform float u_ring_freq;',
    'uniform float u_speed;',
    'uniform float u_palette_offset;',
    '',
    '// Edge glow',
    'uniform float u_glow_strength;',
    'uniform float u_glow_sharpness;',
    '',
    '// Noise warp',
    'uniform float u_noise_warp;',
    'uniform float u_noise_scale;',
    '',
    '// Palette — cosine (mode 0), 4-stop (mode 1), OKLCH (mode 2)',
    'uniform vec3  u_a;',
    'uniform vec3  u_b;',
    'uniform vec3  u_c;',
    'uniform vec3  u_d;',
    'uniform vec3  u_color0;',
    'uniform vec3  u_color1;',
    'uniform vec3  u_color2;',
    'uniform vec3  u_color3;',
    'uniform float u_color_mode;',
    'uniform vec3  u_oklch_a;',
    'uniform vec3  u_oklch_b;',
    'uniform vec3  u_oklch_c;',
    'uniform vec3  u_oklch_d;',
    '',
    '// Finish',
    'uniform float u_opacity;',
    'uniform float u_distress;',
    'uniform float u_distress_scale;',
    'uniform float u_grain_mode;',
    'uniform float u_distress_falloff;',
    'uniform float u_pos_x;',
    'uniform float u_pos_y;',
    'uniform float u_scale;',
    '',
    'out vec4 fragColor;',
    '',
    window.ShaderBase.commonGLSL,
    '',
    'float smoothNoise(vec2 p) {',
    '  vec2 i = floor(p);',
    '  vec2 f = fract(p);',
    '  vec2 u = f * f * (3.0 - 2.0 * f);',
    '  return mix(',
    '    mix(hash21(i),              hash21(i + vec2(1.0, 0.0)), u.x),',
    '    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),',
    '    u.y',
    '  );',
    '}',
    '',
    '// OKLCH helpers (needed for perceptual 4-stop interpolation)',
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
    '  return vec3(lab.x, sqrt(lab.y*lab.y+lab.z*lab.z), atan(lab.z, lab.y));',
    '}',
    'vec3 oklch_to_oklab(vec3 lch) {',
    '  return vec3(lch.x, lch.y*cos(lch.z), lch.y*sin(lch.z));',
    '}',
    'vec3 mix_oklch(vec3 a, vec3 b, float t) {',
    '  float dh = mod(b.z - a.z + 3.14159265, 6.28318530) - 3.14159265;',
    '  return vec3(mix(a.x, b.x, t), mix(a.y, b.y, t), a.z + t * dh);',
    '}',
    'vec3 oklchPalette(float t) {',
    '  vec3 lch = u_oklch_a + u_oklch_b * cos(6.28318 * (u_oklch_c * t + u_oklch_d));',
    '  lch.x = clamp(lch.x, 0.0, 1.0);',
    '  lch.y = max(lch.y, 0.0);',
    '  return clamp(oklab_to_linear_rgb(oklch_to_oklab(lch)), 0.0, 1.0);',
    '}',
    '',
    'vec3 paletteAt(float t) {',
    '  // 4-stop: perceptual OKLCH interpolation across the 4 stops',
    '  float t01 = clamp(t * 3.0, 0.0, 1.0);',
    '  float t12 = clamp((t - 0.33333) * 3.0, 0.0, 1.0);',
    '  float t23 = clamp((t - 0.66667) * 3.0, 0.0, 1.0);',
    '  vec3 lch0 = oklab_to_oklch(linear_rgb_to_oklab(u_color0));',
    '  vec3 lch1 = oklab_to_oklch(linear_rgb_to_oklab(u_color1));',
    '  vec3 lch2 = oklab_to_oklch(linear_rgb_to_oklab(u_color2));',
    '  vec3 lch3 = oklab_to_oklch(linear_rgb_to_oklab(u_color3));',
    '  vec3 seg01   = mix_oklch(lch0, lch1, t01);',
    '  vec3 seg12   = mix_oklch(lch1, lch2, t12);',
    '  vec3 seg23   = mix_oklch(lch2, lch3, t23);',
    '  vec3 blended = mix(mix(seg01, seg12, step(0.33333, t)), seg23, step(0.66667, t));',
    '  vec3 stopCol = oklab_to_linear_rgb(oklch_to_oklab(blended));',
    '  float isStop  = step(0.5, u_color_mode) * (1.0 - step(1.5, u_color_mode));',
    '  float isOklch = step(1.5, u_color_mode);',
    '  vec3 col = cosinePalette(t, u_a, u_b, u_c, u_d);',
    '  col = mix(col, stopCol,         isStop);',
    '  col = mix(col, oklchPalette(t), isOklch);',
    '  return col;',
    '}',
    '',
    '// ── Main ───────────────────────────────────────────────────────────────────',
    'void main() {',
    '  vec2 uv = gl_FragCoord.xy / u_resolution;',
    '  uv = (uv - 0.5) / u_scale + 0.5 + vec2(u_pos_x, u_pos_y);',
    '  vec2 dUV = gl_FragCoord.xy / u_resolution;',
    '',
    '  // SDF: 0 = far outside, 0.5 = shirt boundary, 1 = deepest interior',
    '  float raw = texture(u_sdf_texture, uv).r;',
    '  float sd  = raw * 2.0 - 1.0;  // −1 = outside  0 = edge  +1 = inside',
    '',
    '  // Feathered boundary mask',
    '  float inside = smoothstep(-0.06, 0.02, sd);',
    '',
    '  // Two-octave noise warp — drifts slowly so the rings breathe',
    '  float n1 = smoothNoise(uv * u_noise_scale + vec2(u_time * 0.04, u_time * 0.02));',
    '  float n2 = smoothNoise(uv * u_noise_scale * 1.73 + vec2(-u_time * 0.03, u_time * 0.05));',
    '  float warpedSd = sd + (n1 * 0.67 + n2 * 0.33 - 0.5) * u_noise_warp;',
    '',
    '  // Concentric rings: cos() starts bright at the boundary (sd=0) and',
    '  // propagates inward as time advances.',
    '  float phase = warpedSd * u_ring_freq * 6.28318 - u_time * u_speed;',
    '  float rings = cos(phase) * 0.5 + 0.5;',
    '',
    '  // Bright halo exactly at the shirt outline',
    '  float edgeDist = abs(sd);',
    '  float edgeGlow = exp(-edgeDist * u_glow_sharpness) * u_glow_strength;',
    '',
    '  // Palette lookup at ring value (+ user offset to shift starting hue)',
    '  float palT  = fract(rings + u_palette_offset);',
    '  vec3  color = paletteAt(palT);',
    '',
    '  // Additive edge glow blended into the color (slight over-brightening is OK)',
    '  color = color + vec3(edgeGlow * 0.55);',
    '',
    '  float vigMask = computeVigMask(dUV);',
    '  float distressMask = applyDistress(1.0, dUV, u_distress, u_distress_scale, u_grain_mode, u_distress_falloff, dot(color, vec3(0.299, 0.587, 0.114)), vigMask);',
    '',
    '  // Alpha:',
    '  //   solid BG  → full shirt silhouette (good for preview)',
    '  //   transparent → ring bands only (ring troughs are transparent, great for print)',
    '  float glowA   = min(edgeGlow, 1.0) * inside;',
    '  float ringA   = max(rings * inside, glowA);',
    '  float alpha   = ringA;',
    '  alpha *= u_opacity * distressMask;',
    '',
    '  vec3 encoded = pow(max(color, 0.0), vec3(1.0 / 2.2));',
    '  fragColor    = vec4(encoded * alpha, alpha);',
    '}',
  ].join('\n');

  // ── SDF texture ─────────────────────────────────────────────────────────────
  // Loaded async in setup; placeholder = full white (fully inside) until ready.
  var sdfTex = null;

  window.ShaderBase.create({
    instantKeys:    ['u_opacity', 'u_distress_0', 'u_distress_scale_0', 'u_distress_1', 'u_distress_scale_1', 'u_distress_2', 'u_distress_scale_2', 'u_distress_3', 'u_distress_scale_3', 'u_grain_mode', 'u_distress_falloff', 'u_vignette_top', 'u_vignette_bottom', 'u_vignette_left', 'u_vignette_right', 'u_vignette_anchor_x', 'u_vignette_anchor_y'],
    fragSrc: fragSrc,

    setup: function (gl, program) {
      // Create placeholder: 1×1 fully-inside pixel so the design is visible
      // while the real SDF image is loading.
      sdfTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, sdfTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([255]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      // Load the real SDF from the URL stashed on the preview button
      var sdfUrl = (document.getElementById('shader-preview-btn') || {}).dataset.shirtSdf;
      if (sdfUrl) {
        var img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = function () {
          gl.bindTexture(gl.TEXTURE_2D, sdfTex);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, img);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.generateMipmap(gl.TEXTURE_2D);
        };
        img.src = sdfUrl;
      }

      return {
        time:          gl.getUniformLocation(program, 'u_time'),
        res:           gl.getUniformLocation(program, 'u_resolution'),
        sdfTex:        gl.getUniformLocation(program, 'u_sdf_texture'),
        ringFreq:      gl.getUniformLocation(program, 'u_ring_freq'),
        speed:         gl.getUniformLocation(program, 'u_speed'),
        palOffset:     gl.getUniformLocation(program, 'u_palette_offset'),
        glowStrength:  gl.getUniformLocation(program, 'u_glow_strength'),
        glowSharpness: gl.getUniformLocation(program, 'u_glow_sharpness'),
        noiseWarp:     gl.getUniformLocation(program, 'u_noise_warp'),
        noiseScale:    gl.getUniformLocation(program, 'u_noise_scale'),
        palA:          gl.getUniformLocation(program, 'u_a'),
        palB:          gl.getUniformLocation(program, 'u_b'),
        palC:          gl.getUniformLocation(program, 'u_c'),
        palD:          gl.getUniformLocation(program, 'u_d'),
        color0:        gl.getUniformLocation(program, 'u_color0'),
        color1:        gl.getUniformLocation(program, 'u_color1'),
        color2:        gl.getUniformLocation(program, 'u_color2'),
        color3:        gl.getUniformLocation(program, 'u_color3'),
        colorMode:     gl.getUniformLocation(program, 'u_color_mode'),
        oklchA:        gl.getUniformLocation(program, 'u_oklch_a'),
        oklchB:        gl.getUniformLocation(program, 'u_oklch_b'),
        oklchC:        gl.getUniformLocation(program, 'u_oklch_c'),
        oklchD:        gl.getUniformLocation(program, 'u_oklch_d'),
        opacity:       gl.getUniformLocation(program, 'u_opacity'),
        distress:        gl.getUniformLocation(program, 'u_distress'),
        distressScale:   gl.getUniformLocation(program, 'u_distress_scale'),
        grainMode:       gl.getUniformLocation(program, 'u_grain_mode'),
        distressFalloff: gl.getUniformLocation(program, 'u_distress_falloff'),
        halftoneAngle:   gl.getUniformLocation(program, 'u_halftone_angle'),
        halftoneLuma:    gl.getUniformLocation(program, 'u_halftone_luma'),
        vignetteTop:    gl.getUniformLocation(program, 'u_vignette_top'),
        vignetteBottom: gl.getUniformLocation(program, 'u_vignette_bottom'),
        vignetteLeft:   gl.getUniformLocation(program, 'u_vignette_left'),
        vignetteRight:  gl.getUniformLocation(program, 'u_vignette_right'),
        vignetteAnchorX:     gl.getUniformLocation(program, 'u_vignette_anchor_x'),
        vignetteAnchorY:     gl.getUniformLocation(program, 'u_vignette_anchor_y'),
        posX:          gl.getUniformLocation(program, 'u_pos_x'),
        posY:          gl.getUniformLocation(program, 'u_pos_y'),
        scale:         gl.getUniformLocation(program, 'u_scale'),
      };
    },

    render: function (gl, u, v, w, h, t) {
      var DEG = Math.PI / 180;
      var oklchA = [
        v.u_oklch_aL != null ? v.u_oklch_aL : 0.70,
        v.u_oklch_aC != null ? v.u_oklch_aC : 0.25,
        (v.u_oklch_aH != null ? v.u_oklch_aH : 180) * DEG,
      ];
      var oklchB = [
        v.u_oklch_bL != null ? v.u_oklch_bL : 0.00,
        v.u_oklch_bC != null ? v.u_oklch_bC : 0.00,
        (v.u_oklch_bH != null ? v.u_oklch_bH : 180) * DEG,
      ];
      var oklchC = [
        v.u_oklch_cL != null ? v.u_oklch_cL : 0.5,
        v.u_oklch_cC != null ? v.u_oklch_cC : 0.5,
        v.u_oklch_cH != null ? v.u_oklch_cH : 0.5,
      ];
      var oklchD = [
        v.u_oklch_dL != null ? v.u_oklch_dL : 0.0,
        v.u_oklch_dC != null ? v.u_oklch_dC : 0.0,
        v.u_oklch_dH != null ? v.u_oklch_dH : 0.0,
      ];

      gl.uniform1f(u.time,          t);
      gl.uniform2f(u.res,           w, h);
      gl.uniform1f(u.ringFreq,      v.u_ring_freq      != null ? v.u_ring_freq      : 7.0);
      gl.uniform1f(u.speed,         v.u_speed          != null ? v.u_speed          : 0.5);
      gl.uniform1f(u.palOffset,     v.u_palette_offset != null ? v.u_palette_offset : 0.0);
      gl.uniform1f(u.glowStrength,  v.u_glow_strength  != null ? v.u_glow_strength  : 2.5);
      gl.uniform1f(u.glowSharpness, v.u_glow_sharpness != null ? v.u_glow_sharpness : 12.0);
      gl.uniform1f(u.noiseWarp,     v.u_noise_warp     != null ? v.u_noise_warp     : 0.08);
      gl.uniform1f(u.noiseScale,    v.u_noise_scale    != null ? v.u_noise_scale    : 5.0);
      gl.uniform3fv(u.palA,         v.u_a              || [0.5, 0.5, 0.5]);
      gl.uniform3fv(u.palB,         v.u_b              || [0.5, 0.5, 0.5]);
      gl.uniform3fv(u.palC,         v.u_c              || [1.0, 1.0, 1.0]);
      gl.uniform3fv(u.palD,         v.u_d              || [0.0, 0.33, 0.67]);
      gl.uniform3fv(u.color0,       v.u_color0         || [1.0, 0.2,  0.4]);
      gl.uniform3fv(u.color1,       v.u_color1         || [1.0, 0.8,  0.0]);
      gl.uniform3fv(u.color2,       v.u_color2         || [0.0, 0.8,  1.0]);
      gl.uniform3fv(u.color3,       v.u_color3         || [0.67, 0.0, 1.0]);
      gl.uniform1f(u.colorMode,     parseFloat(v.u_color_mode || '0'));
      gl.uniform3fv(u.oklchA,       oklchA);
      gl.uniform3fv(u.oklchB,       oklchB);
      gl.uniform3fv(u.oklchC,       oklchC);
      gl.uniform3fv(u.oklchD,       oklchD);
      gl.uniform1f(u.opacity,       v.u_opacity        != null ? v.u_opacity        : 1.0);
      var _gm = Math.round(v.u_grain_mode != null ? parseFloat(v.u_grain_mode) : 0);
      gl.uniform1f(u.distress,      v['u_distress_' + _gm]       != null ? v['u_distress_' + _gm]       : (v.u_distress       != null ? v.u_distress       : 0.0));
      gl.uniform1f(u.distressScale, v['u_distress_scale_' + _gm] != null ? v['u_distress_scale_' + _gm] : (v.u_distress_scale != null ? v.u_distress_scale : 80.0));
      gl.uniform1f(u.grainMode,        v.u_grain_mode       != null ? parseFloat(v.u_grain_mode) : 0.0);
      gl.uniform1f(u.distressFalloff,  v.u_distress_falloff != null ? v.u_distress_falloff : 0.0);
      gl.uniform1f(u.halftoneAngle, (v.u_halftone_angle != null ? v.u_halftone_angle : 45.0) * Math.PI / 180.0);
      gl.uniform1f(u.halftoneLuma,  v.u_halftone_luma  != null ? v.u_halftone_luma  : 0.0);
      gl.uniform1f(u.vignetteTop,    v.u_vignette_top    != null ? v.u_vignette_top    : 0.0);
      gl.uniform1f(u.vignetteBottom, v.u_vignette_bottom != null ? v.u_vignette_bottom : 0.0);
      gl.uniform1f(u.vignetteLeft,   v.u_vignette_left   != null ? v.u_vignette_left   : 0.0);
      gl.uniform1f(u.vignetteRight,  v.u_vignette_right  != null ? v.u_vignette_right  : 0.0);
      gl.uniform1f(u.vignetteAnchorX, v.u_vignette_anchor_x != null ? v.u_vignette_anchor_x : 0.5);
      gl.uniform1f(u.vignetteAnchorY, v.u_vignette_anchor_y != null ? v.u_vignette_anchor_y : 0.5);
      gl.uniform1f(u.posX,          v.u_pos_x          != null ? v.u_pos_x          : 0.0);
      gl.uniform1f(u.posY,          v.u_pos_y          != null ? v.u_pos_y          : 0.0);
      gl.uniform1f(u.scale,         v.u_scale          != null ? v.u_scale          : 1.0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sdfTex);
      gl.uniform1i(u.sdfTex, 0);
    },
  });
}());
