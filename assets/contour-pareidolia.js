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
    'void main() {',
    '  vec2 uv = gl_FragCoord.xy / u_resolution;',
    '  uv = (uv - 0.5) / u_scale + 0.5 + vec2(u_pos_x, u_pos_y);',
    '  vec2 dUV = gl_FragCoord.xy / u_resolution;',
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
    '  float aa          = fwidth(elevation) + 0.0005;',
    '  float lineMask     = 1.0 - smoothstep(u_contour_width, u_contour_width + aa, contourDist);',
    '',
    '  float t = clamp(elevation * 0.5 + 0.5, 0.0, 1.0);',
    '  vec3  palColor = cosinePalette(t, u_a, u_b, u_c, u_d);',
    '',
    '  float t01 = clamp(t * 3.0, 0.0, 1.0);',
    '  float t12 = clamp((t - 1.0 / 3.0) * 3.0, 0.0, 1.0);',
    '  float t23 = clamp((t - 2.0 / 3.0) * 3.0, 0.0, 1.0);',
    '  vec3 seg01 = mix(u_color0, u_color1, t01);',
    '  vec3 seg12 = mix(u_color1, u_color2, t12);',
    '  vec3 seg23 = mix(u_color2, u_color3, t23);',
    '  vec3 gradColor = mix(mix(seg01, seg12, step(1.0 / 3.0, t)), seg23, step(2.0 / 3.0, t));',
    '  gradColor = clamp(gradColor, 0.0, 1.0);',
    '',
    '  vec3 finalColor = mix(palColor, gradColor, u_color_mode);',
    '',
    '  float vigMask = computeVigMask(dUV);',
    '  float alpha   = lineMask;',
    '  alpha = applyDistress(alpha, dUV, u_distress, u_distress_scale, u_grain_mode, u_distress_falloff, dot(finalColor, vec3(0.299, 0.587, 0.114)), vigMask);',
    '  alpha *= u_opacity * vigMask;',
    '  finalColor *= vigMask;',
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
