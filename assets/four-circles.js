(function () {
  'use strict';

  // FourCircles port — 2×2 grid of circles with triangular cutouts (pinwheel),
  // per-quadrant letter textures, cosine/4-stop palette, and per-quadrant rotation.

  var CANVAS_SIZE = 512;

  function drawLetter(ctx, letter, font, size, outlineEnabled, outlineWidth) {
    var canvas   = ctx.canvas;
    canvas.width  = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    if (letter) {
      ctx.font         = 'bold ' + size + 'px ' + font + ', monospace';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'alphabetic';
      var metrics = ctx.measureText(letter);
      var y = CANVAS_SIZE / 2 +
        (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2;
      if (outlineEnabled && outlineWidth > 0) {
        ctx.strokeStyle = 'rgb(0,255,0)';
        ctx.lineWidth   = outlineWidth * 2;
        ctx.lineJoin    = 'round';
        ctx.strokeText(letter, CANVAS_SIZE / 2, y);
      }
      ctx.fillStyle = 'rgb(255,0,0)';
      ctx.fillText(letter, CANVAS_SIZE / 2, y);
    }
  }

  function uploadTex(gl, tex, canvas) {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  var fragSrc = [
    '#version 300 es',
    'precision mediump float;',
    '',
    'uniform vec2      u_resolution;',
    'uniform float     u_aspect;',
    'uniform float     u_circle_size;',
    'uniform float     u_tri_size;',
    'uniform float     u_tri_angle;',
    'uniform float     u_tri_apex;',
    'uniform float     u_offset_x;',
    'uniform float     u_offset_y;',
    'uniform float     u_rot1;',
    'uniform float     u_rot2;',
    'uniform float     u_rot3;',
    'uniform float     u_rot4;',
    'uniform float     u_global_grad;',
    'uniform float     u_text_enabled;',
    'uniform vec3      u_outline_color;',
    'uniform vec3      u_a;',
    'uniform vec3      u_b;',
    'uniform vec3      u_c;',
    'uniform vec3      u_d;',
    'uniform float     u_color_mode;',
    'uniform vec3      u_color0;',
    'uniform vec3      u_color1;',
    'uniform vec3      u_color2;',
    'uniform vec3      u_color3;',
    'uniform sampler2D u_tex1;',
    'uniform sampler2D u_tex2;',
    'uniform sampler2D u_tex3;',
    'uniform sampler2D u_tex4;',
    'uniform float     u_opacity;',
    'uniform float     u_distress;',
    'uniform float     u_distress_scale;',
    '',
    'out vec4 fragColor;',
    '',
    'vec2 rotate2d(vec2 p, float a) {',
    '  return vec2(p.x * cos(a) - p.y * sin(a), p.x * sin(a) + p.y * cos(a));',
    '}',
    '',
    '// IQ isosceles triangle SDF: apex at origin, base at y = q.y, half-base-width = q.x.',
    'float sdIsosceles(vec2 p_in, vec2 q) {',
    '  vec2  p = vec2(abs(p_in.x), p_in.y);',
    '  vec2  a = p - q * clamp(dot(p, q) / dot(q, q), 0.0, 1.0);',
    '  vec2  b = p - q * vec2(clamp(p.x / q.x, 0.0, 1.0), 1.0);',
    '  float s = -sign(q.y);',
    '  vec2  d = min(',
    '    vec2(dot(a, a), s * (p.x * q.y - p.y * q.x)),',
    '    vec2(dot(b, b), s * (p.y - q.y))',
    '  );',
    '  return -sqrt(d.x) * sign(d.y);',
    '}',
    '',
    'vec3 cosinePalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {',
    '  return a + b * cos(6.28318 * (c * t + d));',
    '}',
    '',
    'float hash21(vec2 p) {',
    '  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);',
    '}',
    'float distressNoise(vec2 uv, float scale) {',
    '  vec2 ip = uv * scale; vec2 i = floor(ip); vec2 f = fract(ip);',
    '  float a = hash21(i),         b = hash21(i + vec2(1.0, 0.0)),',
    '        c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));',
    '  vec2 u = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);',
    '}',
    '',
    'void main() {',
    '  vec2 uv = gl_FragCoord.xy / u_resolution;',
    '',
    '  // Quadrant indices: cellX/Y ∈ {0, 1}',
    '  float cellX   = floor(uv.x * 2.0);',
    '  float cellY   = floor(uv.y * 2.0);',
    '  vec2  localUV = fract(uv * 2.0);',
    '',
    '  float isRight = step(0.5, cellX);   // 1 = right half',
    '  float isTop   = step(0.5, cellY);   // 1 = top half (WebGL y=0 is bottom)',
    '',
    '  // Aspect-corrected local point centred at (0, 0)',
    '  vec2 localP = vec2((localUV.x - 0.5) * u_aspect, localUV.y - 0.5);',
    '',
    '  // Per-quadrant shift toward/away from image centre',
    '  vec2 shiftedP = localP + vec2(',
    '    mix(u_offset_x, -u_offset_x, isRight),',
    '    mix(u_offset_y, -u_offset_y, isTop)',
    '  );',
    '',
    '  // Per-quadrant rotation',
    '  float activeRot = mix(',
    '    mix(u_rot3, u_rot4, isRight),',
    '    mix(u_rot1, u_rot2, isRight),',
    '    isTop',
    '  );',
    '  vec2 rotatedP = rotate2d(shiftedP, activeRot);',
    '',
    '  // ── Circle SDF ──────────────────────────────────────────────────────────',
    '  float circleSdf  = length(rotatedP) - u_circle_size;',
    '  float aaCircle   = fwidth(circleSdf);',
    '  float circleMask = 1.0 - smoothstep(-aaCircle, aaCircle, circleSdf);',
    '',
    '  // ── Pinwheel triangle SDFs ──────────────────────────────────────────────',
    '  // Extra per-triangle rotation applied on top of the per-quadrant rotation.',
    '  vec2 triP = rotate2d(rotatedP, u_tri_angle);',
    '',
    '  // Rotating the input point by θ rotates the shape by −θ.',
    '  //   top-left  → pointing right: p\' = (−y,  x)',
    '  //   top-right → pointing down:  p\' = (−x, −y)',
    '  //   bot-left  → pointing up:    p\' = ( x,  y)  (no rotation)',
    '  //   bot-right → pointing left:  p\' = ( y, −x)',
    '  vec2 pForRight = vec2(-triP.y,  triP.x);',
    '  vec2 pForDown  = vec2(-triP.x, -triP.y);',
    '  vec2 pForUp    = triP;',
    '  vec2 pForLeft  = vec2( triP.y, -triP.x);',
    '',
    '  float triHalfWidth = u_tri_size * tan(u_tri_apex * 0.5);',
    '  vec2  triQ         = vec2(triHalfWidth, u_tri_size);',
    '',
    '  float triRight = sdIsosceles(pForRight, triQ);',
    '  float triDown  = sdIsosceles(pForDown,  triQ);',
    '  float triUp    = sdIsosceles(pForUp,    triQ);',
    '  float triLeft  = sdIsosceles(pForLeft,  triQ);',
    '',
    '  // Select by quadrant: top-left=right, top-right=down, bot-left=up, bot-right=left',
    '  float activeTri = mix(',
    '    mix(triUp,    triLeft, isRight),',
    '    mix(triRight, triDown, isRight),',
    '    isTop',
    '  );',
    '',
    '  float aaTri     = fwidth(activeTri);',
    '  float triCutout = 1.0 - smoothstep(-aaTri, aaTri, activeTri);',
    '',
    '  float shapeMask = circleMask * (1.0 - triCutout);',
    '',
    '  // ── Letter textures ─────────────────────────────────────────────────────',
    '  // tex1 = top-left, tex2 = top-right, tex3 = bot-left, tex4 = bot-right',
    '  vec4 t1 = texture(u_tex1, localUV);',
    '  vec4 t2 = texture(u_tex2, localUV);',
    '  vec4 t3 = texture(u_tex3, localUV);',
    '  vec4 t4 = texture(u_tex4, localUV);',
    '  vec4 activeTex = mix(mix(t3, t4, isRight), mix(t1, t2, isRight), isTop);',
    '',
    '  // Green channel = outline stroke; red channel = letter fill (unused in color path)',
    '  float outlineSample = smoothstep(0.3, 0.7, activeTex.g) * u_text_enabled;',
    '',
    '  // ── Colour ──────────────────────────────────────────────────────────────',
    '  float palT      = mix(localUV.x, uv.x, u_global_grad);',
    '  vec3  cosineCol = cosinePalette(palT, u_a, u_b, u_c, u_d);',
    '',
    '  float t01    = clamp(palT * 3.0, 0.0, 1.0);',
    '  float t12    = clamp((palT - 1.0 / 3.0) * 3.0, 0.0, 1.0);',
    '  float t23    = clamp((palT - 2.0 / 3.0) * 3.0, 0.0, 1.0);',
    '  vec3  seg01  = mix(u_color0, u_color1, t01);',
    '  vec3  seg12  = mix(u_color1, u_color2, t12);',
    '  vec3  seg23  = mix(u_color2, u_color3, t23);',
    '  vec3  gradCol = mix(mix(seg01, seg12, step(1.0 / 3.0, palT)), seg23, step(2.0 / 3.0, palT));',
    '',
    '  vec3 col        = mix(cosineCol, gradCol, u_color_mode);',
    '  vec3 layerColor = mix(col, u_outline_color, outlineSample);',
    '',
    '  // ── Distress + output ───────────────────────────────────────────────────',
    '  vec2  dUV = gl_FragCoord.xy / u_resolution;',
    '  float dn  = distressNoise(dUV, u_distress_scale) * 0.67',
    '            + distressNoise(dUV, u_distress_scale * 2.73) * 0.33;',
    '',
    '  float alpha   = shapeMask * step(u_distress, dn) * u_opacity;',
    '  vec3  encoded = pow(max(layerColor, 0.0), vec3(1.0 / 2.2));',
    '  fragColor = vec4(encoded, alpha);',
    '}',
  ].join('\n');

  window.ShaderBase.create({
    fragSrc: fragSrc,

    setup: function (gl, program) {
      var texCanvases    = [];
      var texCtxs        = [];
      var glTextures     = [];
      var lastLetterKeys = [];

      for (var i = 0; i < 4; i++) {
        var c = document.createElement('canvas');
        c.width  = CANVAS_SIZE;
        c.height = CANVAS_SIZE;
        texCanvases.push(c);
        var ctx = c.getContext('2d');
        texCtxs.push(ctx);
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
        var t = gl.createTexture();
        glTextures.push(t);
        uploadTex(gl, t, c);
        lastLetterKeys.push(null);
      }

      return {
        res:          gl.getUniformLocation(program, 'u_resolution'),
        aspect:       gl.getUniformLocation(program, 'u_aspect'),
        circleSize:   gl.getUniformLocation(program, 'u_circle_size'),
        triSize:      gl.getUniformLocation(program, 'u_tri_size'),
        triAngle:     gl.getUniformLocation(program, 'u_tri_angle'),
        triApex:      gl.getUniformLocation(program, 'u_tri_apex'),
        offsetX:      gl.getUniformLocation(program, 'u_offset_x'),
        offsetY:      gl.getUniformLocation(program, 'u_offset_y'),
        rot1:         gl.getUniformLocation(program, 'u_rot1'),
        rot2:         gl.getUniformLocation(program, 'u_rot2'),
        rot3:         gl.getUniformLocation(program, 'u_rot3'),
        rot4:         gl.getUniformLocation(program, 'u_rot4'),
        globalGrad:   gl.getUniformLocation(program, 'u_global_grad'),
        textEnabled:  gl.getUniformLocation(program, 'u_text_enabled'),
        outlineColor: gl.getUniformLocation(program, 'u_outline_color'),
        palA:         gl.getUniformLocation(program, 'u_a'),
        palB:         gl.getUniformLocation(program, 'u_b'),
        palC:         gl.getUniformLocation(program, 'u_c'),
        palD:         gl.getUniformLocation(program, 'u_d'),
        colorMode:    gl.getUniformLocation(program, 'u_color_mode'),
        color0:       gl.getUniformLocation(program, 'u_color0'),
        color1:       gl.getUniformLocation(program, 'u_color1'),
        color2:       gl.getUniformLocation(program, 'u_color2'),
        color3:       gl.getUniformLocation(program, 'u_color3'),
        tex1:         gl.getUniformLocation(program, 'u_tex1'),
        tex2:         gl.getUniformLocation(program, 'u_tex2'),
        tex3:         gl.getUniformLocation(program, 'u_tex3'),
        tex4:         gl.getUniformLocation(program, 'u_tex4'),
        opacity:       gl.getUniformLocation(program, 'u_opacity'),
        distress:      gl.getUniformLocation(program, 'u_distress'),
        distressScale: gl.getUniformLocation(program, 'u_distress_scale'),
        // Internal letter-texture state (not uniform locations).
        _texCanvases:    texCanvases,
        _texCtxs:        texCtxs,
        _glTextures:     glTextures,
        _lastLetterKeys: lastLetterKeys,
      };
    },

    render: function (gl, u, v, w, h) {
      var DEG = Math.PI / 180;

      var circleSize   = v.u_circle_size   != null ? v.u_circle_size   : 0.42;
      var triSize      = v.u_tri_size      != null ? v.u_tri_size      : 0.22;
      var triAngle     = (v.u_tri_angle    != null ? v.u_tri_angle    : 0)    * DEG;
      var triApex      = (v.u_tri_apex     != null ? v.u_tri_apex     : 90)   * DEG;
      var offsetX      = v.u_offset_x      != null ? v.u_offset_x      : 0.0;
      var offsetY      = v.u_offset_y      != null ? v.u_offset_y      : 0.0;
      var rot1         = (v.u_rot1         != null ? v.u_rot1         : 0)    * DEG;
      var rot2         = (v.u_rot2         != null ? v.u_rot2         : 0)    * DEG;
      var rot3         = (v.u_rot3         != null ? v.u_rot3         : 0)    * DEG;
      var rot4         = (v.u_rot4         != null ? v.u_rot4         : 0)    * DEG;
      var globalGrad   = v.u_global_grad   != null ? v.u_global_grad   : 0.0;
      var textEnabled  = v.u_text_enabled  != null ? v.u_text_enabled  : 1.0;
      var outlineColor = v.u_outline_color || [0.0, 0.0, 0.0];
      var palA         = v.u_a             || [0.5, 0.5, 0.5];
      var palB         = v.u_b             || [0.5, 0.5, 0.5];
      var palC         = v.u_c             || [1.0, 1.0, 1.0];
      var palD         = v.u_d             || [0.0, 0.33, 0.67];
      var colorMode    = v.u_color_mode    != null ? v.u_color_mode    : 0.0;
      var color0       = v.u_color0        || [1.0, 0.2,   0.4];
      var color1       = v.u_color1        || [1.0, 0.8,   0.0];
      var color2       = v.u_color2        || [0.0, 0.8,   1.0];
      var color3       = v.u_color3        || [0.667, 0.0, 1.0];
      var fontFamily   = v.u_font_family   || 'Montserrat';
      var fontSize     = v.u_font_size     != null ? v.u_font_size     : 300;
      var outlineEnabled = v.outlineEnabled ? true : false;
      var outlineWidth   = v.outlineWidth  != null ? v.outlineWidth    : 12;
      var aspect         = h > 0 ? w / h : 1.0;

      // When text is disabled pass '' so the canvas is blank (black — no green channel).
      var letters = [
        textEnabled ? (v.u_letter1 != null ? v.u_letter1 : 'A') : '',
        textEnabled ? (v.u_letter2 != null ? v.u_letter2 : 'B') : '',
        textEnabled ? (v.u_letter3 != null ? v.u_letter3 : 'C') : '',
        textEnabled ? (v.u_letter4 != null ? v.u_letter4 : 'D') : '',
      ];

      // Redraw and re-upload any letter texture whose key changed.
      var texUnits    = [gl.TEXTURE0, gl.TEXTURE1, gl.TEXTURE2, gl.TEXTURE3];
      var texUniforms = [u.tex1, u.tex2, u.tex3, u.tex4];
      for (var i = 0; i < 4; i++) {
        var key = letters[i] + '|' + fontFamily + '|' + fontSize + '|' + outlineEnabled + '|' + outlineWidth;
        if (key !== u._lastLetterKeys[i]) {
          drawLetter(u._texCtxs[i], letters[i], fontFamily, fontSize, outlineEnabled, outlineWidth);
          uploadTex(gl, u._glTextures[i], u._texCanvases[i]);
          u._lastLetterKeys[i] = key;
        }
        gl.activeTexture(texUnits[i]);
        gl.bindTexture(gl.TEXTURE_2D, u._glTextures[i]);
        gl.uniform1i(texUniforms[i], i);
      }

      gl.uniform2f(u.res,          w, h);
      gl.uniform1f(u.aspect,       aspect);
      gl.uniform1f(u.circleSize,   circleSize);
      gl.uniform1f(u.triSize,      triSize);
      gl.uniform1f(u.triAngle,     triAngle);
      gl.uniform1f(u.triApex,      triApex);
      gl.uniform1f(u.offsetX,      offsetX);
      gl.uniform1f(u.offsetY,      offsetY);
      gl.uniform1f(u.rot1,         rot1);
      gl.uniform1f(u.rot2,         rot2);
      gl.uniform1f(u.rot3,         rot3);
      gl.uniform1f(u.rot4,         rot4);
      gl.uniform1f(u.globalGrad,   globalGrad);
      gl.uniform1f(u.textEnabled,  textEnabled);
      gl.uniform3fv(u.outlineColor, outlineColor);
      gl.uniform3fv(u.palA,        palA);
      gl.uniform3fv(u.palB,        palB);
      gl.uniform3fv(u.palC,        palC);
      gl.uniform3fv(u.palD,        palD);
      gl.uniform1f(u.colorMode,    colorMode);
      gl.uniform3fv(u.color0,      color0);
      gl.uniform3fv(u.color1,      color1);
      gl.uniform3fv(u.color2,      color2);
      gl.uniform3fv(u.color3,      color3);
      gl.uniform1f(u.opacity,       v.u_opacity        != null ? v.u_opacity        : 1.0);
      gl.uniform1f(u.distress,      v.u_distress       != null ? v.u_distress       : 0.0);
      gl.uniform1f(u.distressScale, v.u_distress_scale != null ? v.u_distress_scale : 80.0);
    },
  });
}());
