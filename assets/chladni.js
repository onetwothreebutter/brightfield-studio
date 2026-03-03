(function () {
  'use strict';

  // Chladni figure shader — converted from Shadertoy mainImage() to WebGL 1.0
  var fragSrc = [
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
    'uniform float u_transparent_bg;',
    '',
    'const float PI = 3.14159265359;',
    '',
    'float chladni(vec2 p) {',
    '  return u_a * sin(PI * u_n * p.x) * sin(PI * u_m * p.y)',
    '       + u_b * sin(PI * u_m * p.x) * sin(PI * u_n * p.y);',
    '}',
    '',
    'void main() {',
    '  vec2 p = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;',
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
    '  float alpha = mix(1.0, smoothstep(0.01, 0.05, luma), u_transparent_bg);',
    '  gl_FragColor = vec4(col, alpha);',
    '}'
  ].join('\n');

  window.ShaderBase.create({
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
        transparentBg: gl.getUniformLocation(program, 'u_transparent_bg'),
      };
    },

    render: function (gl, u, v, w, h) {
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
      gl.uniform1f(u.transparentBg, v.u_transparent_bg != null ? v.u_transparent_bg : 0.0);
    },
  });
}());
