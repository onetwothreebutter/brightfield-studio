(function () {
  'use strict';

  // ── Fragment shader ─────────────────────────────────────────────────────────
  var fragSrc = [
    '#version 300 es',
    'precision mediump float;',
    '',
    'uniform vec2  u_resolution;',
    'uniform float u_line_count;',
    'uniform float u_line_width;',
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
    '// Sphere',
    'uniform vec2  u_sphere_pos;',
    'uniform float u_sphere_closeness;',
    'uniform float u_sphere_radius;',
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
    'void main() {',
    '  vec2 uv = gl_FragCoord.xy / u_resolution;',
    '  uv = (uv - 0.5) / u_scale + 0.5 + vec2(u_pos_x, u_pos_y);',
    '  vec2 dUV = gl_FragCoord.xy / u_resolution;',
    '',
    '  // The sphere pushes the sample point radially away from its center —',
    '  // everything downstream (line pattern and palette lookup, both driven',
    '  // off uv) moves together, as if the surface itself bulged around it.',
    '  vec2 toSphere = uv - u_sphere_pos;',
    '  float sphereDist = length(toSphere);',
    '  float influence = 1.0 - smoothstep(0.0, u_sphere_radius, sphereDist);',
    '  vec2 pushDir = normalize(toSphere + vec2(1e-5));',
    '  uv -= pushDir * influence * u_sphere_closeness;',
    '',
    '  float lineUV  = uv.y;',
    '  float spacing = 1.0 / u_line_count;',
    '  float nearest = floor(lineUV / spacing + 0.5) * spacing;',
    '  float dist    = abs(lineUV - nearest);',
    '  float aa      = fwidth(lineUV) + 0.0005;',
    '  float lineMask = 1.0 - smoothstep(u_line_width, u_line_width + aa, dist);',
    '',
    '  float t = clamp(uv.y, 0.0, 1.0);',
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

  // ── Sphere position: tracks the pointer live in uv space ────────────────────
  // Starts centered so the effect is visible before any interaction; "closeness"
  // is a GUI slider (fixed depth), not derived from pointer speed or distance.
  var spherePos = { x: 0.5, y: 0.5 };

  var canvasEl = document.getElementById('shader-canvas');
  if (canvasEl) {
    canvasEl.style.touchAction = 'none';

    function pointFromEvent(e) {
      var rect = canvasEl.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) / rect.width,
        y: 1 - (e.clientY - rect.top) / rect.height,
      };
    }

    canvasEl.addEventListener('pointermove', function (e) {
      spherePos = pointFromEvent(e);
    });
  }

  window.ShaderBase.create({
    fragSrc: fragSrc,

    setup: function (gl, program) {
      return {
        res:              gl.getUniformLocation(program, 'u_resolution'),
        lineCount:        gl.getUniformLocation(program, 'u_line_count'),
        lineWidth:        gl.getUniformLocation(program, 'u_line_width'),
        colorMode:        gl.getUniformLocation(program, 'u_color_mode'),
        palA:             gl.getUniformLocation(program, 'u_a'),
        palB:             gl.getUniformLocation(program, 'u_b'),
        palC:             gl.getUniformLocation(program, 'u_c'),
        palD:             gl.getUniformLocation(program, 'u_d'),
        color0:           gl.getUniformLocation(program, 'u_color0'),
        color1:           gl.getUniformLocation(program, 'u_color1'),
        color2:           gl.getUniformLocation(program, 'u_color2'),
        color3:           gl.getUniformLocation(program, 'u_color3'),
        spherePos:        gl.getUniformLocation(program, 'u_sphere_pos'),
        sphereCloseness:  gl.getUniformLocation(program, 'u_sphere_closeness'),
        sphereRadius:     gl.getUniformLocation(program, 'u_sphere_radius'),
        opacity:          gl.getUniformLocation(program, 'u_opacity'),
        distress:         gl.getUniformLocation(program, 'u_distress'),
        distressScale:    gl.getUniformLocation(program, 'u_distress_scale'),
        grainMode:        gl.getUniformLocation(program, 'u_grain_mode'),
        distressFalloff:  gl.getUniformLocation(program, 'u_distress_falloff'),
        halftoneAngle:    gl.getUniformLocation(program, 'u_halftone_angle'),
        halftoneLuma:     gl.getUniformLocation(program, 'u_halftone_luma'),
        vignetteTop:      gl.getUniformLocation(program, 'u_vignette_top'),
        vignetteBottom:   gl.getUniformLocation(program, 'u_vignette_bottom'),
        vignetteLeft:     gl.getUniformLocation(program, 'u_vignette_left'),
        vignetteRight:    gl.getUniformLocation(program, 'u_vignette_right'),
        vignetteAnchorX:  gl.getUniformLocation(program, 'u_vignette_anchor_x'),
        vignetteAnchorY:  gl.getUniformLocation(program, 'u_vignette_anchor_y'),
        posX:             gl.getUniformLocation(program, 'u_pos_x'),
        posY:             gl.getUniformLocation(program, 'u_pos_y'),
        scale:            gl.getUniformLocation(program, 'u_scale'),
      };
    },

    render: function (gl, u, v, w, h) {
      gl.uniform2f(u.res, w, h);
      gl.uniform1f(u.lineCount, v.u_line_count != null ? v.u_line_count : 20);
      gl.uniform1f(u.lineWidth, v.u_line_width != null ? v.u_line_width : 0.004);
      gl.uniform1f(u.colorMode, parseFloat(v.u_color_mode || '0'));
      gl.uniform3fv(u.palA, v.u_a || [0.5, 0.5, 0.5]);
      gl.uniform3fv(u.palB, v.u_b || [0.5, 0.5, 0.5]);
      gl.uniform3fv(u.palC, v.u_c || [1.0, 1.0, 1.0]);
      gl.uniform3fv(u.palD, v.u_d || [0.0, 0.33, 0.67]);
      gl.uniform3fv(u.color0, v.u_color0 || [1.0, 0.2, 0.4]);
      gl.uniform3fv(u.color1, v.u_color1 || [1.0, 0.8, 0.0]);
      gl.uniform3fv(u.color2, v.u_color2 || [0.0, 0.8, 1.0]);
      gl.uniform3fv(u.color3, v.u_color3 || [0.667, 0.0, 1.0]);

      gl.uniform2f(u.spherePos, spherePos.x, spherePos.y);
      gl.uniform1f(u.sphereCloseness, v.u_sphere_closeness != null ? v.u_sphere_closeness : 0.15);
      gl.uniform1f(u.sphereRadius, v.u_sphere_radius != null ? v.u_sphere_radius : 0.25);

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
