(function () {
  'use strict';

  // ── Fragment shader ─────────────────────────────────────────────────────────
  var fragSrc = [
    '#version 300 es',
    'precision mediump float;',
    '',
    'uniform vec2  u_resolution;',
    'uniform float u_aspect;',
    '',
    '// Terrain — each hill is a raised-cosine bump on distance-to-center (an SDF',
    '// falloff), summed together so overlapping hills blend into ridges/valleys.',
    'uniform vec2  u_hill1_pos;',
    'uniform float u_hill1_radius;',
    'uniform float u_hill1_height;',
    'uniform vec2  u_hill2_pos;',
    'uniform float u_hill2_radius;',
    'uniform float u_hill2_height;',
    'uniform vec2  u_hill3_pos;',
    'uniform float u_hill3_radius;',
    'uniform float u_hill3_height;',
    '',
    '// Contour lines',
    'uniform float u_contour_spacing;',
    'uniform float u_contour_width;',
    '',
    '// Palette — cosine (mode 0) or 4-stop (mode 1), driven by elevation',
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
    '// Distance from p to a hill\'s center, turned into a smooth raised-cosine',
    '// bump: full height at the center, fading to 0 at the radius. Using the',
    '// (unsigned) SDF-style distance as the input keeps every hill\'s shape',
    '// independent of resolution and easy to blend by simple addition.',
    'float hillHeight(vec2 p, vec2 center, float radius, float amp) {',
    '  float d = length(p - center);',
    '  float t = clamp(d / max(radius, 0.0001), 0.0, 1.0);',
    '  return amp * 0.5 * (1.0 + cos(3.14159265 * t));',
    '}',
    '',
    '// Evaluates the contour design color + alpha at any uv (post pos/scale',
    '// transform). aaFixed: 0.0 for the per-fragment path (fwidth-based AA);',
    '// a small fixed half-width when sampling at halftone cell positions.',
    'vec4 designEval(vec2 uv, float aaFixed) {',
    '  vec2 p = vec2((uv.x - 0.5) * u_aspect, uv.y - 0.5);',
    '',
    '  // Elevation: heights add, so overlapping hills rise together and',
    '  // opposite-signed hills (valleys) carve into neighboring peaks.',
    '  float elevation = hillHeight(p, u_hill1_pos, u_hill1_radius, u_hill1_height)',
    '                   + hillHeight(p, u_hill2_pos, u_hill2_radius, u_hill2_height)',
    '                   + hillHeight(p, u_hill3_pos, u_hill3_radius, u_hill3_height);',
    '',
    '  // Isolines: fold elevation into repeating bands, same technique as the',
    '  // concentric SDF rings, but driven by the terrain height instead of',
    '  // distance to a single shape — this is what makes the lines bend around',
    '  // each hill\'s slope automatically.',
    '  float contourT    = elevation / u_contour_spacing;',
    '  float contourFrac = fract(contourT);',
    '  float contourDist = min(contourFrac, 1.0 - contourFrac) * u_contour_spacing;',
    '  float aa          = max(fwidth(elevation), aaFixed) + 0.0005;',
    '  float isoMask      = 1.0 - smoothstep(u_contour_width, u_contour_width + aa, contourDist);',
    '',
    '  // Outer outline: elevation flatlines at exactly 0 everywhere past every',
    '  // hill\'s radius (the raised-cosine bump clamps there), so treating that',
    '  // as just another isoline would paint the whole background solid. Trace',
    '  // the true footprint boundary instead, via the exact SDF union of the',
    '  // three hill circles (min of per-circle distances), and clip the interior',
    '  // isolines to inside that footprint so they never leak into the flat',
    '  // exterior.',
    '  float d1        = length(p - u_hill1_pos) - u_hill1_radius;',
    '  float d2        = length(p - u_hill2_pos) - u_hill2_radius;',
    '  float d3        = length(p - u_hill3_pos) - u_hill3_radius;',
    '  float sdOuter    = min(d1, min(d2, d3));',
    '  float insideUnion = 1.0 - step(0.0, sdOuter);',
    '  float aaOuter    = max(fwidth(sdOuter), aaFixed) + 0.0005;',
    '  float outlineMask = 1.0 - smoothstep(u_contour_width, u_contour_width + aaOuter, abs(sdOuter));',
    '  float lineMask     = max(isoMask * insideUnion, outlineMask);',
    '',
    '  float t = clamp(elevation * 0.5 + 0.5, 0.0, 1.0);',
    '  vec3  palColor = cosinePalette(t, u_a, u_b, u_c, u_d);',
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
    '  vec3 gradColor = oklab_to_linear_rgb(oklch_to_oklab(blendedLch));',
    '  gradColor = clamp(gradColor, 0.0, 1.0);',
    '',
    '  vec3 finalColor = mix(palColor, gradColor, u_color_mode);',
    '  return vec4(finalColor, lineMask);',
    '}',
    '',
    'void main() {',
    '  vec2 uv = gl_FragCoord.xy / u_resolution;',
    '  uv = (uv - 0.5) / u_scale + 0.5 + vec2(u_pos_x, u_pos_y);',
    '  vec2 dUV = gl_FragCoord.xy / u_resolution;',
    '  vec4 px = designEval(uv, 0.0);',
    '  vec3 finalColor = px.rgb;',
    '  float vigMask = computeVigMask(dUV);',
    '  float alpha;',
    '  if (u_grain_mode >= 3.5) {',
    '    // Half-tone: size each dot by design coverage over its cell (3x3',
    '    // supersample) so dots shrink toward contour edges instead of slicing.',
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
    '    alpha = applyDistress(px.a, dUV, u_distress, u_distress_scale, u_grain_mode, u_distress_falloff, dot(finalColor, vec3(0.299, 0.587, 0.114)), vigMask);',
    '    alpha *= u_opacity;',
    '    finalColor *= vigMask;',
    '  }',
    '',
    '  vec3 encoded = pow(max(finalColor, 0.0), vec3(1.0 / 2.2));',
    '  fragColor = vec4(encoded * alpha, alpha);',
    '}'
  ].join('\n');

  window.ShaderBase.create({
    fragSrc: fragSrc,

    setup: function (gl, program) {
      return {
        res:             gl.getUniformLocation(program, 'u_resolution'),
        aspect:          gl.getUniformLocation(program, 'u_aspect'),
        hill1Pos:        gl.getUniformLocation(program, 'u_hill1_pos'),
        hill1Radius:     gl.getUniformLocation(program, 'u_hill1_radius'),
        hill1Height:     gl.getUniformLocation(program, 'u_hill1_height'),
        hill2Pos:        gl.getUniformLocation(program, 'u_hill2_pos'),
        hill2Radius:     gl.getUniformLocation(program, 'u_hill2_radius'),
        hill2Height:     gl.getUniformLocation(program, 'u_hill2_height'),
        hill3Pos:        gl.getUniformLocation(program, 'u_hill3_pos'),
        hill3Radius:     gl.getUniformLocation(program, 'u_hill3_radius'),
        hill3Height:     gl.getUniformLocation(program, 'u_hill3_height'),
        contourSpacing:  gl.getUniformLocation(program, 'u_contour_spacing'),
        contourWidth:    gl.getUniformLocation(program, 'u_contour_width'),
        colorMode:       gl.getUniformLocation(program, 'u_color_mode'),
        palA:            gl.getUniformLocation(program, 'u_a'),
        palB:            gl.getUniformLocation(program, 'u_b'),
        palC:            gl.getUniformLocation(program, 'u_c'),
        palD:            gl.getUniformLocation(program, 'u_d'),
        color0:          gl.getUniformLocation(program, 'u_color0'),
        color1:          gl.getUniformLocation(program, 'u_color1'),
        color2:          gl.getUniformLocation(program, 'u_color2'),
        color3:          gl.getUniformLocation(program, 'u_color3'),
        opacity:         gl.getUniformLocation(program, 'u_opacity'),
        distress:        gl.getUniformLocation(program, 'u_distress'),
        distressScale:   gl.getUniformLocation(program, 'u_distress_scale'),
        grainMode:       gl.getUniformLocation(program, 'u_grain_mode'),
        distressFalloff: gl.getUniformLocation(program, 'u_distress_falloff'),
        halftoneAngle:   gl.getUniformLocation(program, 'u_halftone_angle'),
        halftoneLuma:    gl.getUniformLocation(program, 'u_halftone_luma'),
        halftoneShape:   gl.getUniformLocation(program, 'u_halftone_shape'),
        vignetteTop:     gl.getUniformLocation(program, 'u_vignette_top'),
        vignetteBottom:  gl.getUniformLocation(program, 'u_vignette_bottom'),
        vignetteLeft:    gl.getUniformLocation(program, 'u_vignette_left'),
        vignetteRight:   gl.getUniformLocation(program, 'u_vignette_right'),
        vignetteAnchorX: gl.getUniformLocation(program, 'u_vignette_anchor_x'),
        vignetteAnchorY: gl.getUniformLocation(program, 'u_vignette_anchor_y'),
        posX:            gl.getUniformLocation(program, 'u_pos_x'),
        posY:            gl.getUniformLocation(program, 'u_pos_y'),
        scale:           gl.getUniformLocation(program, 'u_scale'),
      };
    },

    render: function (gl, u, v, w, h) {
      gl.uniform2f(u.res, w, h);
      gl.uniform1f(u.aspect, w / h);
      gl.uniform2f(u.hill1Pos, v.u_hill1_x != null ? v.u_hill1_x : -0.3, v.u_hill1_y != null ? v.u_hill1_y : 0.2);
      gl.uniform1f(u.hill1Radius, v.u_hill1_radius != null ? v.u_hill1_radius : 0.4);
      gl.uniform1f(u.hill1Height, v.u_hill1_height != null ? v.u_hill1_height : 1.0);
      gl.uniform2f(u.hill2Pos, v.u_hill2_x != null ? v.u_hill2_x : 0.28, v.u_hill2_y != null ? v.u_hill2_y : -0.1);
      gl.uniform1f(u.hill2Radius, v.u_hill2_radius != null ? v.u_hill2_radius : 0.35);
      gl.uniform1f(u.hill2Height, v.u_hill2_height != null ? v.u_hill2_height : 0.8);
      gl.uniform2f(u.hill3Pos, v.u_hill3_x != null ? v.u_hill3_x : 0.0, v.u_hill3_y != null ? v.u_hill3_y : -0.32);
      gl.uniform1f(u.hill3Radius, v.u_hill3_radius != null ? v.u_hill3_radius : 0.3);
      gl.uniform1f(u.hill3Height, v.u_hill3_height != null ? v.u_hill3_height : -0.6);
      gl.uniform1f(u.contourSpacing, v.u_contour_spacing != null ? v.u_contour_spacing : 0.12);
      gl.uniform1f(u.contourWidth, v.u_contour_width != null ? v.u_contour_width : 0.025);
      gl.uniform1f(u.colorMode, parseFloat(v.u_color_mode || '0'));
      gl.uniform3fv(u.palA, v.u_a || [0.5, 0.5, 0.5]);
      gl.uniform3fv(u.palB, v.u_b || [0.5, 0.5, 0.5]);
      gl.uniform3fv(u.palC, v.u_c || [1.0, 1.0, 1.0]);
      gl.uniform3fv(u.palD, v.u_d || [0.0, 0.33, 0.67]);
      gl.uniform3fv(u.color0, v.u_color0 || [1.0, 0.2, 0.4]);
      gl.uniform3fv(u.color1, v.u_color1 || [1.0, 0.8, 0.0]);
      gl.uniform3fv(u.color2, v.u_color2 || [0.0, 0.8, 1.0]);
      gl.uniform3fv(u.color3, v.u_color3 || [0.667, 0.0, 1.0]);

      gl.uniform1f(u.opacity, v.u_opacity != null ? v.u_opacity : 1.0);
      var _gm = Math.round(v.u_grain_mode != null ? parseFloat(v.u_grain_mode) : 0);
      gl.uniform1f(u.distress, v['u_distress_' + _gm] != null ? v['u_distress_' + _gm] : (v.u_distress != null ? v.u_distress : 0.0));
      gl.uniform1f(u.distressScale, v['u_distress_scale_' + _gm] != null ? v['u_distress_scale_' + _gm] : (v.u_distress_scale != null ? v.u_distress_scale : 80.0));
      gl.uniform1f(u.grainMode, v.u_grain_mode != null ? parseFloat(v.u_grain_mode) : 0.0);
      gl.uniform1f(u.distressFalloff, v.u_distress_falloff != null ? v.u_distress_falloff : 0.0);
      gl.uniform1f(u.halftoneAngle, (v.u_halftone_angle != null ? v.u_halftone_angle : 45.0) * Math.PI / 180.0);
      gl.uniform1f(u.halftoneLuma, v.u_halftone_luma != null ? v.u_halftone_luma : 0.0);
      gl.uniform1f(u.halftoneShape, v.u_halftone_shape != null ? parseFloat(v.u_halftone_shape) : 0.0);
      gl.uniform1f(u.vignetteTop, v.u_vignette_top != null ? v.u_vignette_top : 0.0);
      gl.uniform1f(u.vignetteBottom, v.u_vignette_bottom != null ? v.u_vignette_bottom : 0.0);
      gl.uniform1f(u.vignetteLeft, v.u_vignette_left != null ? v.u_vignette_left : 0.0);
      gl.uniform1f(u.vignetteRight, v.u_vignette_right != null ? v.u_vignette_right : 0.0);
      gl.uniform1f(u.vignetteAnchorX, v.u_vignette_anchor_x != null ? v.u_vignette_anchor_x : 0.5);
      gl.uniform1f(u.vignetteAnchorY, v.u_vignette_anchor_y != null ? v.u_vignette_anchor_y : 0.5);
      gl.uniform1f(u.posX, v.u_pos_x != null ? v.u_pos_x : 0.0);
      gl.uniform1f(u.posY, v.u_pos_y != null ? v.u_pos_y : 0.0);
      gl.uniform1f(u.scale, v.u_scale != null ? v.u_scale : 1.0);
    },
  });
}());
