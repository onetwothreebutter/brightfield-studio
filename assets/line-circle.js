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
    'uniform float u_transparent_bg;',
    '',
    'out vec4 fragColor;',
    '',
    'vec3 cosinePalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {',
    '  return a + b * cos(6.28318 * (c * t + d));',
    '}',
    '',
    'void main() {',
    '  vec2 uv = gl_FragCoord.xy / u_resolution;',
    '  vec2 centeredUV = uv - 0.5;',
    '',
    '  // Aspect-corrected circle SDF',
    '  vec2  correctedUV = vec2(centeredUV.x * u_aspect, centeredUV.y);',
    '  float circleSDF   = length(correctedUV) - u_radius;',
    '  float aaCircle    = fwidth(circleSDF) * 0.5;',
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
    '  float aaLine   = fwidth(phase) * 0.5;',
    '  float lineMask = 1.0 - smoothstep(lineWidth - aaLine, lineWidth + aaLine, phase);',
    '',
    '  // Cosine palette driven by vertical position',
    '  vec3 palColor = cosinePalette(t, u_a, u_b, u_c, u_d);',
    '',
    '  // 4-stop linear gradient (same t driver)',
    '  float t01 = clamp(t * 3.0, 0.0, 1.0);',
    '  float t12 = clamp((t - 1.0 / 3.0) * 3.0, 0.0, 1.0);',
    '  float t23 = clamp((t - 2.0 / 3.0) * 3.0, 0.0, 1.0);',
    '  vec3 seg01 = mix(u_color0, u_color1, t01);',
    '  vec3 seg12 = mix(u_color1, u_color2, t12);',
    '  vec3 seg23 = mix(u_color2, u_color3, t23);',
    '  vec3 gradColor = mix(mix(seg01, seg12, step(1.0 / 3.0, t)), seg23, step(2.0 / 3.0, t));',
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
    '  float aaTriL = fwidth(triEdgeL) * 0.5;',
    '  float aaTriR = fwidth(triEdgeR) * 0.5;',
    '  float aaTriB = fwidth(triEdgeB) * 0.5;',
    '  float triInner = smoothstep(-aaTriL, aaTriL, triEdgeL)',
    '                 * smoothstep(-aaTriR, aaTriR, triEdgeR)',
    '                 * smoothstep(-aaTriB, aaTriB, triEdgeB);',
    '  float triMask  = mix(1.0, 1.0 - triInner, u_tri_enabled);',
    '',
    '  // Center circle cutout',
    '  float centerSDF   = length(correctedUV) - u_center_circle_radius;',
    '  float aaCenter    = fwidth(centerSDF) * 0.5;',
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
    '  float alpha          = mix(1.0, finalAlpha, u_transparent_bg);',
    '  vec3 encoded = pow(max(finalColor, 0.0), vec3(1.0 / 2.2));',
    '  fragColor = vec4(encoded, alpha);',
    '}'
  ].join('\n');

  window.ShaderBase.create({
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
        transparentBg:       gl.getUniformLocation(program, 'u_transparent_bg'),
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
      gl.uniform1f(u.colorMode,    v.u_color_mode  != null ? v.u_color_mode  : 0.0);
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
      gl.uniform1f(u.transparentBg, v.u_transparent_bg      != null ? v.u_transparent_bg      : 0.0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, textTex);
      gl.uniform1i(u.textTex, 0);
    },

    drawText: function (ctx, size, v, w, h) {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, size, size);

      var txt = v.text || '';
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
      return JSON.stringify([v.text, v.textX, v.textY, v.textFontSize, v.textFont, v.outlineEnabled, v.outlineWidth, v.u_outline_color]);
    },
  });
}());
