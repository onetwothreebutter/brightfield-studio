(function () {
  'use strict';

  // LineCircle port — faithful to the Three.js TSL original
  var fragSrc = [
    '#version 300 es',
    'precision mediump float;',
    'uniform vec2  u_resolution;',
    'uniform float u_aspect;',
    'uniform float u_radius;',
    'uniform float u_line_count;',
    'uniform float u_power;',
    'uniform float u_width_top;',
    'uniform float u_width_bot;',
    'uniform vec3  u_a;',
    'uniform vec3  u_b;',
    'uniform vec3  u_c;',
    'uniform vec3  u_d;',
    'uniform float u_color_mode;',
    'uniform vec3  u_color0;',
    'uniform vec3  u_color1;',
    'uniform vec3  u_color2;',
    'uniform vec3  u_color3;',
    'uniform vec3  u_text_color;',
    'uniform float u_use_text_color;',
    'uniform vec3  u_outline_color;',
    'uniform float u_text_x;',
    'uniform float u_text_y;',
    'uniform sampler2D u_text_texture;',
    // Triangle mask
    'uniform float u_tri_enabled;',
    'uniform float u_tri_rotation;',
    'uniform float u_tri_size;',
    'uniform float u_tri_width;',
    // Center circle cutout
    'uniform float u_center_circle_enabled;',
    'uniform float u_center_circle_radius;',
    // Export
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
    '// Evaluates the design color + alpha at any uv (post pos/scale transform).',
    '// aaFixed: 0.0 for the per-fragment path (fwidth-based AA); a small fixed',
    '// half-width when sampling at halftone cell positions, where uv is constant',
    '// across fragments and fwidth is meaningless.',
    'vec4 designEval(vec2 uv, float aaFixed) {',
    '  vec2 centeredUV = uv - 0.5;',
    '',
    '  // Aspect-corrected circle SDF',
    '  vec2  correctedUV = vec2(centeredUV.x * u_aspect, centeredUV.y);',
    '  float circleSDF   = length(correctedUV) - u_radius;',
    '  float aaCircle    = max(fwidth(circleSDF) * 0.5, aaFixed);',
    '  float circleMask  = 1.0 - smoothstep(-aaCircle, aaCircle, circleSDF);',
    '',
    '  // t: 0 at top of circle, 1 at bottom',
    '  float circleTop = 0.5 + u_radius;',
    '  float t = clamp((circleTop - uv.y) / (u_radius * 2.0), 0.0, 1.0);',
    '',
    '  // Power-warp t so line spacing compresses toward the bottom',
    '  float warped = pow(t, u_power);',
    '',
    '  // Repeating phase [0, 1) within each line cell',
    '  float phase = fract(warped * u_line_count);',
    '',
    '  // Line fill fraction: thin at top, thick at bottom',
    '  float lineWidth = mix(u_width_top, u_width_bot, t);',
    '',
    '  // 1 inside the filled stripe, 0 in the gap',
    '  float aaLine   = max(fwidth(phase) * 0.5, aaFixed);',
    '  float lineMask = 1.0 - smoothstep(lineWidth - aaLine, lineWidth + aaLine, phase);',
    '',
    '  // Cosine palette driven by vertical position',
    '  vec3 palColor = cosinePalette(t, u_a, u_b, u_c, u_d);',
    '',
    '  // 4-stop linear gradient (same t driver)',
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
    '  vec3 finalPal = mix(palColor, gradColor, u_color_mode);',
    '',
    '  // Triangle cutout — rotated in aspect-corrected space, apex at center',
    '  float cosR   = cos(u_tri_rotation);',
    '  float sinR   = sin(u_tri_rotation);',
    '  vec2 triUV   = vec2(',
    '    correctedUV.x * cosR - correctedUV.y * sinR,',
    '    correctedUV.x * sinR + correctedUV.y * cosR',
    '  );',
    '  float cosW     = cos(u_tri_width);',
    '  float sinW     = sin(u_tri_width);',
    '  float triEdgeL = triUV.x * cosW - triUV.y * sinW;',
    '  float triEdgeR = -triUV.x * cosW - triUV.y * sinW;',
    '  float triEdgeB = triUV.y + u_radius * u_tri_size;',
    '  float aaTriL = max(fwidth(triEdgeL) * 0.5, aaFixed);',
    '  float aaTriR = max(fwidth(triEdgeR) * 0.5, aaFixed);',
    '  float aaTriB = max(fwidth(triEdgeB) * 0.5, aaFixed);',
    '  float triInner = smoothstep(-aaTriL, aaTriL, triEdgeL)',
    '                 * smoothstep(-aaTriR, aaTriR, triEdgeR)',
    '                 * smoothstep(-aaTriB, aaTriB, triEdgeB);',
    '  float triMask  = mix(1.0, 1.0 - triInner, u_tri_enabled);',
    '',
    '  // Center circle cutout',
    '  float centerSDF   = length(correctedUV) - u_center_circle_radius;',
    '  float aaCenter    = max(fwidth(centerSDF) * 0.5, aaFixed);',
    '  float centerInner = 1.0 - smoothstep(-aaCenter, aaCenter, centerSDF);',
    '  float centerMask  = mix(1.0, 1.0 - centerInner, u_center_circle_enabled);',
    '',
    '  // Circle + lines + triangle + center circle base color',
    '  vec3 base = finalPal * circleMask * lineMask * triMask * centerMask;',
    '',
    '  // Text overlay — aspect-corrected UV so glyphs appear undistorted',
    '  vec2 textAnchor    = vec2(u_text_x, u_text_y);',
    '  vec2 textDelta     = uv - textAnchor;',
    '  vec2 textUV        = vec2(textDelta.x * u_aspect, textDelta.y) + textAnchor;',
    '  vec4 texSample     = texture(u_text_texture, textUV);',
    '  // R channel = fill, G channel = outline',
    '  float fillSample    = smoothstep(0.05, 0.6, texSample.r);',
    '  float outlineSample = smoothstep(0.05, 0.6, texSample.g);',
    '  vec3 withOutline   = mix(base, u_outline_color, outlineSample);',
    '  // Text fill uses palette color by default; custom color when u_use_text_color=1',
    '  vec3 textFillColor = mix(finalPal, u_text_color, u_use_text_color);',
    '  vec3 finalColor    = mix(withOutline, textFillColor, fillSample);',
    '',
    '  float visibilityMask = circleMask * lineMask * triMask * centerMask;',
    '  float textAlpha      = fillSample + outlineSample;',
    '  float finalAlpha     = mix(visibilityMask, 1.0, textAlpha);',
    '  return vec4(finalColor, finalAlpha);',
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
    '    // Half-tone: size each dot by design coverage over its cell (3x3',
    '    // supersample) so dots shrink toward design edges instead of slicing.',
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
    '  }',
    '  vec3 encoded = pow(max(finalColor, 0.0), vec3(1.0 / 2.2));',
    '  fragColor = vec4(encoded * alpha, alpha);',
    '}'
  ].join('\n');

  window.ShaderBase.create({
    animateValues:  true,
    instantKeys:    ['u_opacity', 'u_distress_0', 'u_distress_scale_0', 'u_distress_1', 'u_distress_scale_1', 'u_distress_2', 'u_distress_scale_2', 'u_distress_3', 'u_distress_scale_3', 'u_grain_mode', 'u_halftone_shape', 'u_distress_falloff', 'u_vignette_top', 'u_vignette_bottom', 'u_vignette_left', 'u_vignette_right', 'u_vignette_anchor_x', 'u_vignette_anchor_y'],
    fragSrc: fragSrc,
    setup: function (gl, program) {
      return {
        res:                 gl.getUniformLocation(program, 'u_resolution'),
        aspect:              gl.getUniformLocation(program, 'u_aspect'),
        radius:              gl.getUniformLocation(program, 'u_radius'),
        lineCount:           gl.getUniformLocation(program, 'u_line_count'),
        power:               gl.getUniformLocation(program, 'u_power'),
        widthTop:            gl.getUniformLocation(program, 'u_width_top'),
        widthBot:            gl.getUniformLocation(program, 'u_width_bot'),
        palA:                gl.getUniformLocation(program, 'u_a'),
        palB:                gl.getUniformLocation(program, 'u_b'),
        palC:                gl.getUniformLocation(program, 'u_c'),
        palD:                gl.getUniformLocation(program, 'u_d'),
        colorMode:           gl.getUniformLocation(program, 'u_color_mode'),
        color0:              gl.getUniformLocation(program, 'u_color0'),
        color1:              gl.getUniformLocation(program, 'u_color1'),
        color2:              gl.getUniformLocation(program, 'u_color2'),
        color3:              gl.getUniformLocation(program, 'u_color3'),
        textColor:           gl.getUniformLocation(program, 'u_text_color'),
        useTextColor:        gl.getUniformLocation(program, 'u_use_text_color'),
        outlineColor:        gl.getUniformLocation(program, 'u_outline_color'),
        textX:               gl.getUniformLocation(program, 'u_text_x'),
        textY:               gl.getUniformLocation(program, 'u_text_y'),
        textTex:             gl.getUniformLocation(program, 'u_text_texture'),
        triEnabled:          gl.getUniformLocation(program, 'u_tri_enabled'),
        triRotation:         gl.getUniformLocation(program, 'u_tri_rotation'),
        triSize:             gl.getUniformLocation(program, 'u_tri_size'),
        triWidth:            gl.getUniformLocation(program, 'u_tri_width'),
        centerCircleEnabled: gl.getUniformLocation(program, 'u_center_circle_enabled'),
        centerCircleRadius:  gl.getUniformLocation(program, 'u_center_circle_radius'),
        opacity:             gl.getUniformLocation(program, 'u_opacity'),
        distress:        gl.getUniformLocation(program, 'u_distress'),
        distressScale:   gl.getUniformLocation(program, 'u_distress_scale'),
        grainMode:       gl.getUniformLocation(program, 'u_grain_mode'),
        distressFalloff: gl.getUniformLocation(program, 'u_distress_falloff'),
        halftoneAngle:   gl.getUniformLocation(program, 'u_halftone_angle'),
        halftoneLuma:    gl.getUniformLocation(program, 'u_halftone_luma'),
        halftoneShape:   gl.getUniformLocation(program, 'u_halftone_shape'),
        posX:                gl.getUniformLocation(program, 'u_pos_x'),
        posY:                gl.getUniformLocation(program, 'u_pos_y'),
        scale:               gl.getUniformLocation(program, 'u_scale'),
        vignetteTop:         gl.getUniformLocation(program, 'u_vignette_top'),
        vignetteBottom:      gl.getUniformLocation(program, 'u_vignette_bottom'),
        vignetteLeft:        gl.getUniformLocation(program, 'u_vignette_left'),
        vignetteRight:       gl.getUniformLocation(program, 'u_vignette_right'),
        vignetteAnchorX:     gl.getUniformLocation(program, 'u_vignette_anchor_x'),
        vignetteAnchorY:     gl.getUniformLocation(program, 'u_vignette_anchor_y'),
      };
    },

    render: function (gl, u, v, w, h, t, textTex) {
      gl.uniform2f(u.res,          w, h);
      gl.uniform1f(u.aspect,       w / h);
      gl.uniform1f(u.radius,       v.u_radius              != null ? v.u_radius              : 0.4);
      gl.uniform1f(u.lineCount,    v.u_line_count           != null ? v.u_line_count           : 20.0);
      gl.uniform1f(u.power,        v.u_power                != null ? v.u_power                : 2.5);
      gl.uniform1f(u.widthTop,     v.u_width_top            != null ? v.u_width_top            : 0.05);
      gl.uniform1f(u.widthBot,     v.u_width_bot            != null ? v.u_width_bot            : 0.75);
      gl.uniform3fv(u.palA,        v.u_a  || [0.5, 0.5, 0.5]);
      gl.uniform3fv(u.palB,        v.u_b  || [0.5, 0.5, 0.5]);
      gl.uniform3fv(u.palC,        v.u_c  || [1.0, 1.0, 1.0]);
      gl.uniform3fv(u.palD,        v.u_d  || [0.0, 0.33, 0.67]);
      gl.uniform1f(u.colorMode,    v.u_color_mode  != null ? parseFloat(v.u_color_mode)  : 0.0);
      gl.uniform3fv(u.color0,      v.u_color0     || [1.0, 0.2,  0.4]);
      gl.uniform3fv(u.color1,      v.u_color1     || [1.0, 0.8,  0.0]);
      gl.uniform3fv(u.color2,      v.u_color2     || [0.0, 0.8,  1.0]);
      gl.uniform3fv(u.color3,      v.u_color3     || [0.667, 0.0, 1.0]);
      gl.uniform3fv(u.textColor,   v.u_text_color    || [1.0, 1.0, 1.0]);
      gl.uniform1f(u.useTextColor, v.u_use_text_color       != null ? v.u_use_text_color       : 0.0);
      gl.uniform3fv(u.outlineColor, v.u_outline_color || [0.0, 0.0, 0.0]);
      gl.uniform1f(u.textX,        v.textX                  != null ? v.textX                  : 0.3);
      gl.uniform1f(u.textY,        v.textY                  != null ? v.textY                  : 0.71);
      gl.uniform1f(u.triEnabled,   v.u_tri_enabled          != null ? v.u_tri_enabled          : 1.0);
      gl.uniform1f(u.triRotation,  v.u_tri_rotation         != null ? v.u_tri_rotation         : 0.0);
      gl.uniform1f(u.triSize,      v.u_tri_size             != null ? v.u_tri_size             : 1.0);
      // uTriWidth in radians; default 45°
      gl.uniform1f(u.triWidth,     v.u_tri_width            != null ? v.u_tri_width            : (45 * Math.PI) / 180);
      gl.uniform1f(u.centerCircleEnabled, v.u_center_circle_enabled != null ? v.u_center_circle_enabled : 1.0);
      gl.uniform1f(u.centerCircleRadius,  v.u_center_circle_radius  != null ? v.u_center_circle_radius  : 0.04);
      gl.uniform1f(u.opacity,      v.u_opacity              != null ? v.u_opacity              : 1.0);
      var _gm = Math.round(v.u_grain_mode != null ? parseFloat(v.u_grain_mode) : 0);
      gl.uniform1f(u.distress,      v['u_distress_' + _gm]       != null ? v['u_distress_' + _gm]       : (v.u_distress       != null ? v.u_distress       : 0.0));
      gl.uniform1f(u.distressScale, v['u_distress_scale_' + _gm] != null ? v['u_distress_scale_' + _gm] : (v.u_distress_scale != null ? v.u_distress_scale : 80.0));
      gl.uniform1f(u.grainMode,        v.u_grain_mode       != null ? parseFloat(v.u_grain_mode) : 0.0);
      gl.uniform1f(u.distressFalloff,  v.u_distress_falloff != null ? v.u_distress_falloff : 0.0);
      gl.uniform1f(u.halftoneAngle, (v.u_halftone_angle != null ? v.u_halftone_angle : 45.0) * Math.PI / 180.0);
      gl.uniform1f(u.halftoneLuma,  v.u_halftone_luma  != null ? v.u_halftone_luma  : 0.0);
      gl.uniform1f(u.halftoneShape, v.u_halftone_shape != null ? parseFloat(v.u_halftone_shape) : 0.0);
      gl.uniform1f(u.posX,        v.u_pos_x      != null ? v.u_pos_x      : 0.0);
      gl.uniform1f(u.posY,        v.u_pos_y      != null ? v.u_pos_y      : 0.0);
      gl.uniform1f(u.scale,       v.u_scale      != null ? v.u_scale      : 1.0);
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

    drawText: function (ctx, size, v, w, h) {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, size, size);

      var txt = v.u_text_enabled ? (v.text || '') : '';
      if (txt) {
        var fontFamily = v.textFont ? '"' + v.textFont + '"' : '"Montserrat"';
        var fontSize   = v.textFontSize || 120;
        var tx         = v.textX != null ? v.textX : 0.3;
        var ty         = v.textY != null ? v.textY : 0.85;
        var cx         = tx * size;
        // Canvas Y=0 is top; UNPACK_FLIP_Y maps it to UV y=1 (top).
        // Drawing at (1-ty)*size means ty=1→canvas top→UV top, ty=0→canvas bottom→UV bottom.
        var cy         = (1 - ty) * size;

        ctx.font         = 'bold ' + fontSize + 'px ' + fontFamily + ', monospace';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';

        // Outline pass — pure green channel
        if (v.outlineEnabled && v.outlineWidth > 0) {
          ctx.strokeStyle = 'rgb(0,255,0)';
          ctx.lineWidth   = (v.outlineWidth || 8) * 2;
          ctx.lineJoin    = 'round';
          ctx.strokeText(txt, cx, cy);
        }

        // Fill pass — pure red channel
        ctx.fillStyle = 'rgb(255,0,0)';
        ctx.fillText(txt, cx, cy);
      }
    },

    textKey: function (v) {
      return JSON.stringify([v.u_text_enabled, v.text, v.textX, v.textY, v.textFontSize, v.textFont, v.outlineEnabled, v.outlineWidth, v.u_outline_color]);
    },
  });
}());
