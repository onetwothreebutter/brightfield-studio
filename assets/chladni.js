(function () {
  'use strict';

  // Chladni figure shader — converted from Shadertoy mainImage() to WebGL 1.0
  var fragSrc = [
    '#version 300 es',
    'precision highp float;',
    'uniform vec2  u_resolution;',
    'uniform float u_n;',
    'uniform float u_m;',
    'uniform float u_a;',
    'uniform float u_b;',
    'uniform float u_threshold;',
    'uniform float u_chroma;',
    'uniform float u_glow;',
    'uniform float u_rotation;',
    'uniform float u_grad_mode;',
    'uniform vec3  u_color1;',
    'uniform vec3  u_color2;',
    'uniform float u_opacity;',
    'uniform float u_distress;',
    'uniform float u_distress_scale;',
    'uniform float u_grain_mode;',
    'uniform float u_distress_falloff;',
    'uniform float u_pos_x;',
    'uniform float u_pos_y;',
    'uniform float u_scale;',
    'uniform float u_aspect;',
    'uniform vec3  u_text_color;',
    'uniform float u_use_text_color;',
    'uniform vec3  u_outline_color;',
    'uniform float u_text_x;',
    'uniform float u_text_y;',
    'uniform sampler2D u_text_texture;',
    '',
    'out vec4 fragColor;',
    '',
    window.ShaderBase.commonGLSL,
    '',
    'const float PI = 3.14159265359;',
    '',
    'float chladni(vec2 p) {',
    '  return u_a * sin(PI * u_n * p.x) * sin(PI * u_m * p.y)',
    '       + u_b * sin(PI * u_m * p.x) * sin(PI * u_n * p.y);',
    '}',
    '',
    'void main() {',
    '  vec2 uv = gl_FragCoord.xy / u_resolution;',
    '  uv = (uv - 0.5) / u_scale + 0.5 + vec2(u_pos_x, u_pos_y);',
    '  vec2 p = vec2((uv.x * 2.0 - 1.0) * u_aspect, uv.y * 2.0 - 1.0);',
    '',
    '  float cr = cos(u_rotation), sr = sin(u_rotation);',
    '  vec2  rp = vec2(cr * p.x - sr * p.y, sr * p.x + cr * p.y);',
    '',
    '  float ca   = u_chroma * 0.007;',
    '  float ampR = chladni(rp * (1.0 + ca));',
    '  float ampG = chladni(rp);',
    '  float ampB = chladni(rp * (1.0 - ca));',
    '',
    '  float hardR = step(abs(ampR), u_threshold);',
    '  float hardG = step(abs(ampG), u_threshold);',
    '  float hardB = step(abs(ampB), u_threshold);',
    '',
    '  float gw    = u_threshold * 5.0;',
    '  float softR = (1.0 - smoothstep(u_threshold, u_threshold + gw, abs(ampR))) * u_glow * 0.45;',
    '  float softG = (1.0 - smoothstep(u_threshold, u_threshold + gw, abs(ampG))) * u_glow * 0.45;',
    '  float softB = (1.0 - smoothstep(u_threshold, u_threshold + gw, abs(ampB))) * u_glow * 0.45;',
    '',
    '  vec3 pattern = vec3(',
    '    min(hardR + softR, 1.0),',
    '    min(hardG + softG, 1.0),',
    '    min(hardB + softB, 1.0)',
    '  );',
    '',
    '  float tRadial  = clamp(length(p), 0.0, 1.0);',
    '  float tLinear  = clamp(rp.x * 0.5 + 0.5, 0.0, 1.0);',
    '  float tAngular = fract(atan(p.y, p.x) / (2.0 * PI) + 0.5);',
    '',
    '  float m1 = step(0.5, u_grad_mode) * (1.0 - step(1.5, u_grad_mode));',
    '  float m2 = step(1.5, u_grad_mode) * (1.0 - step(2.5, u_grad_mode));',
    '  float m3 = step(2.5, u_grad_mode);',
    '  float t  = tRadial * m1 + tLinear * m2 + tAngular * m3;',
    '',
    '  vec3 baseColor = mix(u_color1, u_color2, t);',
    '  vec3 col       = pattern * baseColor;',
    '  col += baseColor * 0.016;',
    '',
    '  // For print export: make background transparent based on luminance',
    '  float luma  = dot(col, vec3(0.299, 0.587, 0.114));',
    '  float alpha = smoothstep(0.01, 0.05, luma);',
    '  vec2 dUV = gl_FragCoord.xy / u_resolution;',
    '  float vigMask = computeVigMask(dUV);',
    '  alpha = applyDistress(alpha, dUV, u_distress, u_distress_scale, u_grain_mode, u_distress_falloff, luma, vigMask) * u_opacity;',
    '  col = col * vigMask;',
    '  alpha = alpha * vigMask;',
    '  vec2 textAnchor    = vec2(u_text_x, u_text_y);',
    '  vec2 textDelta     = uv - textAnchor;',
    '  vec2 textUV        = vec2(textDelta.x * u_aspect, textDelta.y) + textAnchor;',
    '  vec4 texSample     = texture(u_text_texture, textUV);',
    '  float fillSample    = smoothstep(0.05, 0.6, texSample.r);',
    '  float outlineSample = smoothstep(0.05, 0.6, texSample.g);',
    '  vec3 withOutline   = mix(col, u_outline_color, outlineSample);',
    '  vec3 textFillColor = mix(baseColor, u_text_color, u_use_text_color);',
    '  vec3 finalColor    = mix(withOutline, textFillColor, fillSample);',
    '  float textAlpha    = clamp(fillSample + outlineSample, 0.0, 1.0);',
    '  alpha = mix(alpha, 1.0, textAlpha);',
    '  vec3 encoded = pow(max(finalColor, 0.0), vec3(1.0 / 2.2));',
    '  fragColor = vec4(encoded * alpha, alpha);',
    '}'
  ].join('\n');

  window.ShaderBase.create({
    animateValues:  true,
    instantKeys:    ['u_opacity', 'u_distress_0', 'u_distress_scale_0', 'u_distress_1', 'u_distress_scale_1', 'u_distress_2', 'u_distress_scale_2', 'u_distress_3', 'u_distress_scale_3', 'u_grain_mode', 'u_distress_falloff'],
    fragSrc: fragSrc,

    setup: function (gl, program) {
      return {
        res:          gl.getUniformLocation(program, 'u_resolution'),
        n:            gl.getUniformLocation(program, 'u_n'),
        m:            gl.getUniformLocation(program, 'u_m'),
        a:            gl.getUniformLocation(program, 'u_a'),
        b:            gl.getUniformLocation(program, 'u_b'),
        threshold:    gl.getUniformLocation(program, 'u_threshold'),
        chroma:       gl.getUniformLocation(program, 'u_chroma'),
        glow:         gl.getUniformLocation(program, 'u_glow'),
        rotation:     gl.getUniformLocation(program, 'u_rotation'),
        gradMode:     gl.getUniformLocation(program, 'u_grad_mode'),
        color1:       gl.getUniformLocation(program, 'u_color1'),
        color2:       gl.getUniformLocation(program, 'u_color2'),
        opacity:       gl.getUniformLocation(program, 'u_opacity'),
        distress:        gl.getUniformLocation(program, 'u_distress'),
        distressScale:   gl.getUniformLocation(program, 'u_distress_scale'),
        grainMode:       gl.getUniformLocation(program, 'u_grain_mode'),
        distressFalloff: gl.getUniformLocation(program, 'u_distress_falloff'),
        halftoneAngle:   gl.getUniformLocation(program, 'u_halftone_angle'),
        halftoneLuma:    gl.getUniformLocation(program, 'u_halftone_luma'),
        posX:            gl.getUniformLocation(program, 'u_pos_x'),
        posY:          gl.getUniformLocation(program, 'u_pos_y'),
        scale:         gl.getUniformLocation(program, 'u_scale'),
        vignetteTop:    gl.getUniformLocation(program, 'u_vignette_top'),
        vignetteBottom: gl.getUniformLocation(program, 'u_vignette_bottom'),
        vignetteLeft:   gl.getUniformLocation(program, 'u_vignette_left'),
        vignetteRight:  gl.getUniformLocation(program, 'u_vignette_right'),
        vignetteAnchorX:     gl.getUniformLocation(program, 'u_vignette_anchor_x'),
        vignetteAnchorY:     gl.getUniformLocation(program, 'u_vignette_anchor_y'),
        aspect:        gl.getUniformLocation(program, 'u_aspect'),
        textColor:     gl.getUniformLocation(program, 'u_text_color'),
        useTextColor:  gl.getUniformLocation(program, 'u_use_text_color'),
        outlineColor:  gl.getUniformLocation(program, 'u_outline_color'),
        textX:         gl.getUniformLocation(program, 'u_text_x'),
        textY:         gl.getUniformLocation(program, 'u_text_y'),
        textTex:       gl.getUniformLocation(program, 'u_text_texture'),
      };
    },

    render: function (gl, u, v, w, h, t, textTex) {
      gl.uniform2f(u.res,        w, h);
      gl.uniform1f(u.n,          v.u_n         != null ? v.u_n         : 8.5);
      gl.uniform1f(u.m,          v.u_m         != null ? v.u_m         : 4.5);
      gl.uniform1f(u.a,          v.u_a         != null ? v.u_a         : -0.35);
      gl.uniform1f(u.b,          v.u_b         != null ? v.u_b         : -0.20);
      gl.uniform1f(u.threshold,  v.u_threshold != null ? v.u_threshold : 0.135);
      gl.uniform1f(u.chroma,     v.u_chroma    != null ? v.u_chroma    : 1.5);
      gl.uniform1f(u.glow,       v.u_glow      != null ? v.u_glow      : 0.5);
      gl.uniform1f(u.rotation,   v.u_rotation  != null ? v.u_rotation  : Math.PI / 2);
      gl.uniform1f(u.gradMode,   v.u_grad_mode != null ? parseFloat(v.u_grad_mode) : 1.0);
      gl.uniform3fv(u.color1,    v.u_color1 || [0.0, 0.722, 1.0]);
      gl.uniform3fv(u.color2,    v.u_color2 || [1.0, 0.690, 0.0]);
      gl.uniform1f(u.opacity,       v.u_opacity        != null ? v.u_opacity        : 1.0);
      var _gm = Math.round(v.u_grain_mode != null ? parseFloat(v.u_grain_mode) : 0);
      gl.uniform1f(u.distress,      v['u_distress_' + _gm]       != null ? v['u_distress_' + _gm]       : (v.u_distress       != null ? v.u_distress       : 0.0));
      gl.uniform1f(u.distressScale, v['u_distress_scale_' + _gm] != null ? v['u_distress_scale_' + _gm] : (v.u_distress_scale != null ? v.u_distress_scale : 80.0));
      gl.uniform1f(u.grainMode,        v.u_grain_mode       != null ? parseFloat(v.u_grain_mode) : 0.0);
      gl.uniform1f(u.distressFalloff,  v.u_distress_falloff != null ? v.u_distress_falloff : 0.0);
      gl.uniform1f(u.halftoneAngle, (v.u_halftone_angle != null ? v.u_halftone_angle : 45.0) * Math.PI / 180.0);
      gl.uniform1f(u.halftoneLuma,  v.u_halftone_luma  != null ? v.u_halftone_luma  : 0.0);
      gl.uniform1f(u.posX,             v.u_pos_x            != null ? v.u_pos_x            : 0.0);
      gl.uniform1f(u.posY,         v.u_pos_y  != null ? v.u_pos_y  : 0.0);
      gl.uniform1f(u.scale,        v.u_scale  != null ? v.u_scale  : 1.0);
      gl.uniform1f(u.vignetteTop,    v.u_vignette_top    != null ? v.u_vignette_top    : 0.0);
      gl.uniform1f(u.vignetteBottom, v.u_vignette_bottom != null ? v.u_vignette_bottom : 0.0);
      gl.uniform1f(u.vignetteLeft,   v.u_vignette_left   != null ? v.u_vignette_left   : 0.0);
      gl.uniform1f(u.vignetteRight,  v.u_vignette_right  != null ? v.u_vignette_right  : 0.0);
      gl.uniform1f(u.vignetteAnchorX, v.u_vignette_anchor_x != null ? v.u_vignette_anchor_x : 0.5);
      gl.uniform1f(u.vignetteAnchorY, v.u_vignette_anchor_y != null ? v.u_vignette_anchor_y : 0.5);
      gl.uniform1f(u.aspect,        w / h);
      gl.uniform3fv(u.textColor,    v.u_text_color    || [1.0, 1.0, 1.0]);
      gl.uniform1f(u.useTextColor,  v.u_use_text_color != null ? v.u_use_text_color : 0.0);
      gl.uniform3fv(u.outlineColor, v.u_outline_color || [0.0, 0.0, 0.0]);
      gl.uniform1f(u.textX,         v.textX            != null ? v.textX            : 0.5);
      gl.uniform1f(u.textY,         v.textY            != null ? v.textY            : 0.5);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, textTex);
      gl.uniform1i(u.textTex, 0);
    },

    drawText: function (ctx, size, v) {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, size, size);

      var txt = v.text || '';
      if (txt) {
        var fontFamily = v.textFont ? '"' + v.textFont + '"' : '"Montserrat"';
        var fontSize   = v.textFontSize || 120;
        var tx         = v.textX != null ? v.textX : 0.5;
        var ty         = v.textY != null ? v.textY : 0.5;
        var cx         = tx * size;
        var cy         = (1 - ty) * size;

        ctx.font         = 'bold ' + fontSize + 'px ' + fontFamily + ', monospace';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';

        if (v.outlineEnabled && v.outlineWidth > 0) {
          ctx.strokeStyle = 'rgb(0,255,0)';
          ctx.lineWidth   = (v.outlineWidth || 8) * 2;
          ctx.lineJoin    = 'round';
          ctx.strokeText(txt, cx, cy);
        }

        ctx.fillStyle = 'rgb(255,0,0)';
        ctx.fillText(txt, cx, cy);
      }
    },

    textKey: function (v) {
      return JSON.stringify([v.text, v.textX, v.textY, v.textFontSize, v.textFont, v.outlineEnabled, v.outlineWidth, v.u_outline_color]);
    },
  });
}());
