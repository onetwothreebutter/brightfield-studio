(function () {
  'use strict';


  // LineText port — faithful to the Three.js TSL original
  var fragSrc = [
    '#version 300 es',
    'precision mediump float;',
    'uniform vec2  u_resolution;',
    'uniform float u_rows;',
    'uniform float u_base_thickness;',
    'uniform float u_text_thickness;',
    'uniform vec3  u_a;',
    'uniform vec3  u_b;',
    'uniform vec3  u_c;',
    'uniform vec3  u_d;',
    'uniform float u_color_mode;',
    'uniform vec3  u_color0;',
    'uniform vec3  u_color1;',
    'uniform vec3  u_color2;',
    'uniform vec3  u_color3;',
    'uniform sampler2D u_text_texture;',
    'uniform float u_text_y;',
    'uniform float u_cap_radius;',
    'uniform float u_text_tex_size;',
    'uniform float u_pos_x;',
    'uniform float u_pos_y;',
    'uniform float u_scale;',
    'uniform float u_opacity;',
    'uniform float u_distress;',
    'uniform float u_distress_scale;',
    'uniform float u_grain_mode;',
    'uniform float u_distress_falloff;',
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
    '// Gaussian-weighted 5x5 blur of the text texture, done in GLSL for',
    '// cross-browser consistency (canvas blur APIs differ across browsers).',
    '// u_cap_radius is in texture pixels; step = capRadius/2 px, sigma = 2 steps.',
    'float blurredTextSample(vec2 uv) {',
    '  float hard = texture(u_text_texture, uv).r;',
    '  if (u_cap_radius <= 0.0) return hard;',
    '  float texelSize = 1.0 / u_text_tex_size;',
    '  float uvStep    = u_cap_radius * 0.5 * texelSize;',
    '  float sigma     = 2.0;',
    '  float sum = 0.0;',
    '  float totalWeight = 0.0;',
    '  for (int i = -2; i <= 2; i++) {',
    '    for (int j = -2; j <= 2; j++) {',
    '      float fi = float(i);',
    '      float fj = float(j);',
    '      float w  = exp(-0.5 * (fi * fi + fj * fj) / (sigma * sigma));',
    '      sum         += texture(u_text_texture, uv + vec2(fi, fj) * uvStep).r * w;',
    '      totalWeight += w;',
    '    }',
    '  }',
    '  float blurred = sum / totalWeight;',
    '  // max with hard sample keeps the interior of letters at 1.0',
    '  return max(hard, blurred);',
    '}',
    '',
    'void main() {',
    '  vec2 uv = gl_FragCoord.xy / u_resolution;',
    '  uv = (uv - 0.5) / u_scale + 0.5 + vec2(u_pos_x, u_pos_y);',
    '',
    '  // R channel = text mask (0..1); blur in blurredTextSample creates soft cap falloff',
    '  float textSample = blurredTextSample(uv);',
    '',
    '  float rowY      = fract(uv.y * u_rows);',
    '  float distCenter = abs(rowY - 0.5);',
    '',
    '  // Thin base line, fattened where text is present',
    '  float halfThick = u_base_thickness + textSample * u_text_thickness;',
    '',
    '  // AA via fwidth (GLSL ES 3.0 built-in)',
    '  float d  = distCenter - halfThick;',
    '  float aa = fwidth(d) * 0.5;',
    '  float lineMask = 1.0 - smoothstep(-aa, aa, d);',
    '',
    '  // Cosine palette along X axis',
    '  vec3 palColor = cosinePalette(uv.x, u_a, u_b, u_c, u_d);',
    '',
    '  // 4-stop linear gradient along X axis',
    '  float t01 = clamp(uv.x * 3.0, 0.0, 1.0);',
    '  float t12 = clamp((uv.x - 1.0 / 3.0) * 3.0, 0.0, 1.0);',
    '  float t23 = clamp((uv.x - 2.0 / 3.0) * 3.0, 0.0, 1.0);',
    '  vec3 lch0 = oklab_to_oklch(linear_rgb_to_oklab(u_color0));',
    '  vec3 lch1 = oklab_to_oklch(linear_rgb_to_oklab(u_color1));',
    '  vec3 lch2 = oklab_to_oklch(linear_rgb_to_oklab(u_color2));',
    '  vec3 lch3 = oklab_to_oklch(linear_rgb_to_oklab(u_color3));',
    '  vec3 seg01 = mix_oklch(lch0, lch1, t01);',
    '  vec3 seg12 = mix_oklch(lch1, lch2, t12);',
    '  vec3 seg23 = mix_oklch(lch2, lch3, t23);',
    '  vec3 blendedLch = mix(mix(seg01, seg12, step(1.0 / 3.0, uv.x)), seg23, step(2.0 / 3.0, uv.x));',
    '  vec3 gradColor = clamp(oklab_to_linear_rgb(oklch_to_oklab(blendedLch)), 0.0, 1.0);',
    '  vec3 col = mix(palColor, gradColor, u_color_mode);',
    '',
    '  vec2 dUV = gl_FragCoord.xy / u_resolution;',
    '  float vigMask = computeVigMask(dUV);',
    '',
    '  vec3 encoded = pow(max(col, 0.0), vec3(1.0 / 2.2));',
    '  float alpha = applyDistress(lineMask * vigMask, dUV, u_distress, u_distress_scale, u_grain_mode, u_distress_falloff, dot(col, vec3(0.299, 0.587, 0.114)), vigMask) * u_opacity;',
    '  fragColor = vec4(encoded * alpha, alpha);',
    '}',
  ].join('\n');

  window.ShaderBase.create({
    animateValues:  true,
    instantKeys:    ['u_opacity', 'u_distress_0', 'u_distress_scale_0', 'u_distress_1', 'u_distress_scale_1', 'u_distress_2', 'u_distress_scale_2', 'u_distress_3', 'u_distress_scale_3', 'u_grain_mode', 'u_distress_falloff', 'u_vignette_top', 'u_vignette_bottom', 'u_vignette_left', 'u_vignette_right', 'u_vignette_anchor_x', 'u_vignette_anchor_y'],
    fragSrc: fragSrc,

    setup: function (gl, program) {
      return {
        res:           gl.getUniformLocation(program, 'u_resolution'),
        rows:          gl.getUniformLocation(program, 'u_rows'),
        baseThickness: gl.getUniformLocation(program, 'u_base_thickness'),
        textThickness: gl.getUniformLocation(program, 'u_text_thickness'),
        palA:          gl.getUniformLocation(program, 'u_a'),
        palB:          gl.getUniformLocation(program, 'u_b'),
        palC:          gl.getUniformLocation(program, 'u_c'),
        palD:          gl.getUniformLocation(program, 'u_d'),
        colorMode:     gl.getUniformLocation(program, 'u_color_mode'),
        color0:        gl.getUniformLocation(program, 'u_color0'),
        color1:        gl.getUniformLocation(program, 'u_color1'),
        color2:        gl.getUniformLocation(program, 'u_color2'),
        color3:        gl.getUniformLocation(program, 'u_color3'),
        textTex:       gl.getUniformLocation(program, 'u_text_texture'),
        textY:         gl.getUniformLocation(program, 'u_text_y'),
        vignetteTop:     gl.getUniformLocation(program, 'u_vignette_top'),
        vignetteBottom:  gl.getUniformLocation(program, 'u_vignette_bottom'),
        vignetteLeft:    gl.getUniformLocation(program, 'u_vignette_left'),
        vignetteRight:   gl.getUniformLocation(program, 'u_vignette_right'),
        vignetteAnchorX:     gl.getUniformLocation(program, 'u_vignette_anchor_x'),
        vignetteAnchorY:     gl.getUniformLocation(program, 'u_vignette_anchor_y'),
        opacity:         gl.getUniformLocation(program, 'u_opacity'),
        distress:        gl.getUniformLocation(program, 'u_distress'),
        distressScale:   gl.getUniformLocation(program, 'u_distress_scale'),
        grainMode:       gl.getUniformLocation(program, 'u_grain_mode'),
        distressFalloff: gl.getUniformLocation(program, 'u_distress_falloff'),
        halftoneAngle:   gl.getUniformLocation(program, 'u_halftone_angle'),
        halftoneLuma:    gl.getUniformLocation(program, 'u_halftone_luma'),
        capRadius:     gl.getUniformLocation(program, 'u_cap_radius'),
        texSize:       gl.getUniformLocation(program, 'u_text_tex_size'),
        posX:          gl.getUniformLocation(program, 'u_pos_x'),
        posY:          gl.getUniformLocation(program, 'u_pos_y'),
        scale:         gl.getUniformLocation(program, 'u_scale'),
      };
    },

    render: function (gl, u, v, w, h, t, textTex) {
      gl.uniform2f(u.res,           w, h);
      gl.uniform1f(u.rows,          v.u_rows           != null ? v.u_rows           : 80.0);
      gl.uniform1f(u.baseThickness, v.u_base_thickness != null ? v.u_base_thickness : 0.02);
      gl.uniform1f(u.textThickness, v.u_text_thickness != null ? v.u_text_thickness : 0.4);
      gl.uniform3fv(u.palA,         v.u_a || [0.5, 0.5, 0.5]);
      gl.uniform3fv(u.palB,         v.u_b || [0.5, 0.5, 0.5]);
      gl.uniform3fv(u.palC,         v.u_c || [1.0, 1.0, 1.0]);
      gl.uniform3fv(u.palD,         v.u_d || [0.0, 0.33, 0.67]);
      gl.uniform1f(u.colorMode,     v.u_color_mode != null ? parseFloat(v.u_color_mode) : 0.0);
      gl.uniform3fv(u.color0,       v.u_color0 || [1.0, 0.2,  0.4]);
      gl.uniform3fv(u.color1,       v.u_color1 || [1.0, 0.8,  0.0]);
      gl.uniform3fv(u.color2,       v.u_color2 || [0.0, 0.8,  1.0]);
      gl.uniform3fv(u.color3,       v.u_color3 || [0.667, 0.0, 1.0]);
      gl.uniform1f(u.textY,         v.textY != null ? v.textY : 0.5);
      gl.uniform1f(u.vignetteTop,    v.u_vignette_top    != null ? v.u_vignette_top    : 2.0);
      gl.uniform1f(u.vignetteBottom, v.u_vignette_bottom != null ? v.u_vignette_bottom : 2.0);
      gl.uniform1f(u.vignetteLeft,   v.u_vignette_left   != null ? v.u_vignette_left   : 2.0);
      gl.uniform1f(u.vignetteRight,  v.u_vignette_right  != null ? v.u_vignette_right  : 2.0);
      gl.uniform1f(u.vignetteAnchorX, v.u_vignette_anchor_x != null ? v.u_vignette_anchor_x : 0.5);
      gl.uniform1f(u.vignetteAnchorY, v.u_vignette_anchor_y != null ? v.u_vignette_anchor_y : 0.5);
      gl.uniform1f(u.opacity,          v.u_opacity         != null ? v.u_opacity         : 1.0);
      var _gm = Math.round(v.u_grain_mode != null ? parseFloat(v.u_grain_mode) : 0);
      gl.uniform1f(u.distress,      v['u_distress_' + _gm]       != null ? v['u_distress_' + _gm]       : (v.u_distress       != null ? v.u_distress       : 0.0));
      gl.uniform1f(u.distressScale, v['u_distress_scale_' + _gm] != null ? v['u_distress_scale_' + _gm] : (v.u_distress_scale != null ? v.u_distress_scale : 80.0));
      gl.uniform1f(u.grainMode,        v.u_grain_mode      != null ? parseFloat(v.u_grain_mode) : 0.0);
      gl.uniform1f(u.distressFalloff,  v.u_distress_falloff != null ? v.u_distress_falloff : 0.0);
      gl.uniform1f(u.halftoneAngle, (v.u_halftone_angle != null ? v.u_halftone_angle : 45.0) * Math.PI / 180.0);
      gl.uniform1f(u.halftoneLuma,  v.u_halftone_luma  != null ? v.u_halftone_luma  : 0.0);
      gl.uniform1f(u.capRadius,     v.textCapRadius != null ? v.textCapRadius : 20.0);
      gl.uniform1f(u.texSize,       1024.0);
      gl.uniform1f(u.posX,         v.u_pos_x  != null ? v.u_pos_x  : 0.0);
      gl.uniform1f(u.posY,         v.u_pos_y  != null ? v.u_pos_y  : 0.0);
      gl.uniform1f(u.scale,        v.u_scale  != null ? v.u_scale  : 1.0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, textTex);
      gl.uniform1i(u.textTex, 0);
    },

    drawText: function (ctx, size, v) {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, size, size);

      var txt = v.text || '';
      if (!txt) return;

      var fontFamily = v.textFont ? '"' + v.textFont + '"' : '"Montserrat"';
      var fontSize   = v.textFontSize != null ? v.textFontSize : 202;

      // Hard white text on black — blur is applied in the fragment shader
      ctx.font         = 'bold ' + fontSize + 'px ' + fontFamily + ', sans-serif';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle    = 'white';
      // Canvas Y=0 is top; UNPACK_FLIP_Y maps canvas top → UV bottom.
      // textY=0.5 (center) → canvas y = (1-0.5)*size = size/2.
      var ty = v.textY != null ? v.textY : 0.5;
      ctx.fillText(txt, size / 2, (1 - ty) * size);
    },

    textKey: function (v) {
      return JSON.stringify([v.text, v.textFont, v.textFontSize, v.textY]);
    },
  });
}());
