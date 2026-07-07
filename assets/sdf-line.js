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
    '// Line SDF',
    'uniform float u_line_angle;',
    'uniform float u_line_length;',
    'uniform float u_line_width;',
    'uniform float u_repeat_enabled;',
    'uniform float u_line_spacing;',
    'uniform float u_rings_enabled;',
    'uniform float u_ring_spacing;',
    'uniform float u_ring_width;',
    '',
    '// Palette — cosine (mode 0) or 4-stop (mode 1), driven by position along the line',
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
    '// IQ\'s capsule SDF (flattened to the z=0 plane — a and p carry z=0, so this',
    '// reduces to a 2D rounded line, but keeps the canonical 3D form). Returns',
    '// the surface distance plus h (0 at a, 1 at b), which drives the palette so',
    '// color travels along the length of the line.',
    'vec2 sdCapsuleH(vec3 p, vec3 a, vec3 b, float r) {',
    '  vec3 pa = p - a, ba = b - a;',
    '  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);',
    '  return vec2(length(pa - ba * h) - r, h);',
    '}',
    '',
    'void main() {',
    '  vec2 uv = gl_FragCoord.xy / u_resolution;',
    '  uv = (uv - 0.5) / u_scale + 0.5 + vec2(u_pos_x, u_pos_y);',
    '  vec2 dUV = gl_FragCoord.xy / u_resolution;',
    '  vec2 p = vec2((uv.x - 0.5) * u_aspect, uv.y - 0.5);',
    '',
    '  float rad  = u_line_angle * 3.14159265 / 180.0;',
    '  vec2  dir  = vec2(cos(rad), sin(rad));',
    '  vec2  perp = vec2(-dir.y, dir.x);',
    '  vec3  a    = vec3(-dir * (u_line_length * 0.5), 0.0);',
    '  vec3  b    = vec3( dir * (u_line_length * 0.5), 0.0);',
    '',
    '  // Fold space along the perpendicular axis so the same capsule repeats as',
    '  // a fence of parallel lines, evenly spaced by u_line_spacing. Only',
    '  // applied when u_repeat_enabled is on, so the single capsule (with its',
    '  // gradient along h) stays clean and easy to read when off.',
    '  float d      = dot(p, perp);',
    '  float dRep   = mod(d + u_line_spacing * 0.5, u_line_spacing) - u_line_spacing * 0.5;',
    '  vec2  pRep   = mix(p, p - perp * (d - dRep), u_repeat_enabled);',
    '',
    '  vec2  sh   = sdCapsuleH(vec3(pRep, 0.0), a, b, u_line_width);',
    '  float dist = sh.x;',
    '  float h    = sh.y;',
    '',
    '  float aa       = fwidth(dist) + 0.0005;',
    '  float lineMask = 1.0 - smoothstep(0.0, aa, dist);',
    '',
    '  // Concentric outlines: fold the (signed) distance into repeating bands so',
    '  // rings expand outward from the capsule surface (dist = 0), both inside',
    '  // and outside, at every multiple of u_ring_spacing.',
    '  float ringT    = dist / u_ring_spacing;',
    '  float ringFrac = fract(ringT);',
    '  float ringDist = min(ringFrac, 1.0 - ringFrac) * u_ring_spacing;',
    '  float ringMask = 1.0 - smoothstep(u_ring_width, u_ring_width + aa, ringDist);',
    '',
    '  float shapeMask = mix(lineMask, ringMask, u_rings_enabled);',
    '',
    '  vec3 palColor = cosinePalette(h, u_a, u_b, u_c, u_d);',
    '',
    '  float t01 = clamp(h * 3.0, 0.0, 1.0);',
    '  float t12 = clamp((h - 1.0 / 3.0) * 3.0, 0.0, 1.0);',
    '  float t23 = clamp((h - 2.0 / 3.0) * 3.0, 0.0, 1.0);',
    '  vec3 seg01 = mix(u_color0, u_color1, t01);',
    '  vec3 seg12 = mix(u_color1, u_color2, t12);',
    '  vec3 seg23 = mix(u_color2, u_color3, t23);',
    '  vec3 gradColor = mix(mix(seg01, seg12, step(1.0 / 3.0, h)), seg23, step(2.0 / 3.0, h));',
    '  gradColor = clamp(gradColor, 0.0, 1.0);',
    '',
    '  vec3 finalColor = mix(palColor, gradColor, u_color_mode);',
    '',
    '  float vigMask = computeVigMask(dUV);',
    '  float alpha   = shapeMask;',
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
        lineAngle:       gl.getUniformLocation(program, 'u_line_angle'),
        lineLength:      gl.getUniformLocation(program, 'u_line_length'),
        lineWidth:       gl.getUniformLocation(program, 'u_line_width'),
        repeatEnabled:   gl.getUniformLocation(program, 'u_repeat_enabled'),
        lineSpacing:     gl.getUniformLocation(program, 'u_line_spacing'),
        ringsEnabled:    gl.getUniformLocation(program, 'u_rings_enabled'),
        ringSpacing:     gl.getUniformLocation(program, 'u_ring_spacing'),
        ringWidth:       gl.getUniformLocation(program, 'u_ring_width'),
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
      gl.uniform1f(u.lineAngle, v.u_line_angle != null ? v.u_line_angle : 0.0);
      gl.uniform1f(u.lineLength, v.u_line_length != null ? v.u_line_length : 1.4);
      gl.uniform1f(u.lineWidth, v.u_line_width != null ? v.u_line_width : 0.02);
      gl.uniform1f(u.repeatEnabled, v.u_repeat_enabled != null ? v.u_repeat_enabled : 0.0);
      gl.uniform1f(u.lineSpacing, v.u_line_spacing != null ? v.u_line_spacing : 0.2);
      gl.uniform1f(u.ringsEnabled, v.u_rings_enabled != null ? v.u_rings_enabled : 0.0);
      gl.uniform1f(u.ringSpacing, v.u_ring_spacing != null ? v.u_ring_spacing : 0.03);
      gl.uniform1f(u.ringWidth, v.u_ring_width != null ? v.u_ring_width : 0.006);
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
