(function () {
  'use strict';

  // LineCircle port — faithful to the Three.js TSL original
  var fragSrc = [
    '#extension GL_OES_standard_derivatives : enable',
    'precision mediump float;',
    'uniform vec2  u_resolution;',
    'uniform float u_aspect;',
    'uniform float u_radius;',
    'uniform float u_line_count;',
    'uniform float u_power;',
    'uniform float u_width_top;',
    'uniform float u_width_bot;',
    'uniform vec3  u_palette_a;',
    'uniform vec3  u_palette_b;',
    'uniform vec3  u_palette_c;',
    'uniform vec3  u_palette_d;',
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
    '  vec3 palColor = cosinePalette(t, u_palette_a, u_palette_b, u_palette_c, u_palette_d);',
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
    '  vec3 base = palColor * circleMask * lineMask * triMask * centerMask;',
    '',
    '  // Text overlay — aspect-corrected UV so glyphs appear undistorted',
    '  vec2 textAnchor    = vec2(u_text_x, u_text_y);',
    '  vec2 textDelta     = uv - textAnchor;',
    '  vec2 textUV        = vec2(textDelta.x * u_aspect, textDelta.y) + textAnchor;',
    '  vec4 texSample     = texture2D(u_text_texture, textUV);',
    '  // R channel = fill, G channel = outline',
    '  float fillSample    = smoothstep(0.05, 0.6, texSample.r);',
    '  float outlineSample = smoothstep(0.05, 0.6, texSample.g);',
    '  vec3 withOutline   = mix(base, u_outline_color, outlineSample);',
    '  // Text fill uses palette color by default; custom color when u_use_text_color=1',
    '  vec3 textFillColor = mix(palColor, u_text_color, u_use_text_color);',
    '  vec3 finalColor    = mix(withOutline, textFillColor, fillSample);',
    '',
    '  float contentAlpha = max(circleMask * lineMask * triMask * centerMask, max(fillSample, outlineSample));',
    '  float alpha        = mix(1.0, contentAlpha, u_transparent_bg);',
    '  gl_FragColor = vec4(finalColor, alpha);',
    '}'
  ].join('\n');

  window.ShaderBase.create({
    fragSrc: fragSrc,
    useDerivatives: true,

    setup: function (gl, program) {
      return {
        res:                 gl.getUniformLocation(program, 'u_resolution'),
        aspect:              gl.getUniformLocation(program, 'u_aspect'),
        radius:              gl.getUniformLocation(program, 'u_radius'),
        lineCount:           gl.getUniformLocation(program, 'u_line_count'),
        power:               gl.getUniformLocation(program, 'u_power'),
        widthTop:            gl.getUniformLocation(program, 'u_width_top'),
        widthBot:            gl.getUniformLocation(program, 'u_width_bot'),
        paletteA:            gl.getUniformLocation(program, 'u_palette_a'),
        paletteB:            gl.getUniformLocation(program, 'u_palette_b'),
        paletteC:            gl.getUniformLocation(program, 'u_palette_c'),
        paletteD:            gl.getUniformLocation(program, 'u_palette_d'),
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
      gl.uniform3fv(u.paletteA,    v.u_palette_a  || [0.5, 0.5, 0.5]);
      gl.uniform3fv(u.paletteB,    v.u_palette_b  || [0.5, 0.5, 0.5]);
      gl.uniform3fv(u.paletteC,    v.u_palette_c  || [1.0, 1.0, 1.0]);
      gl.uniform3fv(u.paletteD,    v.u_palette_d  || [0.263, 0.416, 0.557]);
      gl.uniform3fv(u.textColor,   v.u_text_color    || [1.0, 1.0, 1.0]);
      gl.uniform1f(u.useTextColor, v.u_use_text_color       != null ? v.u_use_text_color       : 0.0);
      gl.uniform3fv(u.outlineColor, v.u_outline_color || [0.0, 0.0, 0.0]);
      gl.uniform1f(u.textX,        v.textX                  != null ? v.textX                  : 0.5);
      gl.uniform1f(u.textY,        v.textY                  != null ? v.textY                  : 0.5);
      gl.uniform1f(u.triEnabled,   v.u_tri_enabled          != null ? v.u_tri_enabled          : 1.0);
      gl.uniform1f(u.triRotation,  v.u_tri_rotation         != null ? v.u_tri_rotation         : 0.0);
      gl.uniform1f(u.triSize,      v.u_tri_size             != null ? v.u_tri_size             : 1.0);
      // uTriWidth in radians; default 30° = equilateral half-angle
      gl.uniform1f(u.triWidth,     v.u_tri_width            != null ? v.u_tri_width            : Math.PI / 6);
      gl.uniform1f(u.centerCircleEnabled, v.u_center_circle_enabled != null ? v.u_center_circle_enabled : 0.0);
      gl.uniform1f(u.centerCircleRadius,  v.u_center_circle_radius  != null ? v.u_center_circle_radius  : 0.05);
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
        var fontFamily = v.textFont ? '"' + v.textFont + '"' : '"IBM Plex Mono"';
        var fontSize   = v.textFontSize || 120;
        var tx         = v.textX != null ? v.textX : 0.5;
        var ty         = v.textY != null ? v.textY : 0.5;
        var cx         = tx * size;
        // Canvas Y=0 is top; UNPACK_FLIP_Y maps it to UV y=1 (top).
        // Drawing at (1-ty)*size means ty=1→canvas top→UV top, ty=0→canvas bottom→UV bottom.
        var cy         = (1 - ty) * size;

        ctx.font         = fontSize + 'px ' + fontFamily + ', monospace';
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
      return JSON.stringify([v.text, v.textX, v.textY, v.textFontSize, v.textFont, v.outlineEnabled, v.outlineWidth]);
    },
  });
}());
