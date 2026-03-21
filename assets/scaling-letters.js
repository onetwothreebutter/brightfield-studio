(function () {
  'use strict';

  // ScalingLetters port — asymmetric letter-grid shader.
  // Left cell is always 2/3 width; right side is divided into 1–5 smaller cells
  // depending on word length (1–6 chars). Each cell shows one letter texture,
  // colored with a cosine palette along the local X axis.

  var CANVAS_SIZE = 512;

  // Returns the width/height aspect ratio for each letter's canvas texture.
  // texIndex is 1-based; letterCount is the number of letters in the word.
  // aspect is the canvas width/height ratio.
  function getCellCa(texIndex, letterCount, aspect) {
    if (texIndex === 1) return letterCount === 1 ? aspect : aspect * 2 / 3;
    if (letterCount === 2) return aspect / 3;
    if (letterCount === 3) return aspect * 2 / 3;
    if (letterCount === 4) return texIndex === 2 ? aspect * 2 / 3 : aspect / 3;
    if (letterCount === 5) return (texIndex === 2 || texIndex === 5) ? aspect : aspect / 2;
    return aspect * 2 / 3; // N=6: all right-side cells
  }

  function drawLetter(ctx, letter, font, size, outlineEnabled, outlineWidth, ca) {
    var canvas   = ctx.canvas;
    var canvasW  = Math.max(1, Math.round(CANVAS_SIZE * ca));
    canvas.width  = canvasW;
    canvas.height = CANVAS_SIZE;
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvasW, CANVAS_SIZE);
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
        ctx.strokeText(letter, canvasW / 2, y);
      }
      ctx.fillStyle = 'rgb(255,0,0)';
      ctx.fillText(letter, canvasW / 2, y);
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
    'uniform int       u_letter_count;',
    'uniform float     u_border_width;',
    'uniform vec3      u_border_color;',
    'uniform vec3      u_outline_color;',
    'uniform float     u_text_enabled;',
    'uniform float     u_outer_border;',
    'uniform vec3      u_a;',
    'uniform vec3      u_b;',
    'uniform vec3      u_c;',
    'uniform vec3      u_d;',
    'uniform sampler2D u_tex1;',
    'uniform sampler2D u_tex2;',
    'uniform sampler2D u_tex3;',
    'uniform sampler2D u_tex4;',
    'uniform sampler2D u_tex5;',
    'uniform sampler2D u_tex6;',
    'uniform float     u_opacity;',
    'uniform float     u_distress;',
    'uniform float     u_distress_scale;',
    '',
    'out vec4 fragColor;',
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
    '  vec2  uvCoord    = gl_FragCoord.xy / u_resolution;',
    '  float bw         = u_border_width;',
    '  float aa         = 0.0008;',
    '  vec2  localUV    = vec2(0.0);',
    '  vec4  activeSample = vec4(0.0);',
    '  float isBorder   = 0.0;',
    '',
    '  if (u_letter_count == 1) {',
    '    localUV      = uvCoord;',
    '    activeSample = texture(u_tex1, uvCoord);',
    '',
    '  } else if (u_letter_count == 2) {',
    '    float isRight = step(2.0/3.0, uvCoord.x);',
    '    vec2 luv1 = vec2(uvCoord.x * 1.5, uvCoord.y);',
    '    vec2 luv2 = vec2((uvCoord.x - 2.0/3.0) * 3.0, uvCoord.y);',
    '    localUV      = mix(luv1, luv2, isRight);',
    '    activeSample = mix(texture(u_tex1, luv1), texture(u_tex2, luv2), isRight);',
    '    isBorder = 1.0 - smoothstep(bw-aa, bw+aa, abs(uvCoord.x - 2.0/3.0));',
    '',
    '  } else if (u_letter_count == 3) {',
    '    float isRight = step(2.0/3.0, uvCoord.x);',
    '    float isTop   = step(0.5, uvCoord.y);',
    '    vec2 luv1 = vec2(uvCoord.x * 1.5, uvCoord.y);',
    '    vec2 luv2 = vec2((uvCoord.x - 2.0/3.0) * 3.0, (uvCoord.y - 0.5) * 2.0);',
    '    vec2 luv3 = vec2((uvCoord.x - 2.0/3.0) * 3.0, uvCoord.y * 2.0);',
    '    vec2 rightUV     = mix(luv3, luv2, isTop);',
    '    vec4 rightSample = mix(texture(u_tex3, luv3), texture(u_tex2, luv2), isTop);',
    '    localUV      = mix(luv1, rightUV, isRight);',
    '    activeSample = mix(texture(u_tex1, luv1), rightSample, isRight);',
    '    float vertB  = 1.0 - smoothstep(bw-aa, bw+aa, abs(uvCoord.x - 2.0/3.0));',
    '    float horizB = isRight * (1.0 - smoothstep(bw-aa, bw+aa, abs(uvCoord.y - 0.5) / u_aspect));',
    '    isBorder = max(vertB, horizB);',
    '',
    '  } else if (u_letter_count == 4) {',
    '    float isRight       = step(2.0/3.0, uvCoord.x);',
    '    float isTop         = step(0.5, uvCoord.y);',
    '    float isMidRight    = step(5.0/6.0, uvCoord.x);',
    '    float isBottomRight = isRight * (1.0 - isTop);',
    '    vec2 luv1 = vec2(uvCoord.x * 1.5, uvCoord.y);',
    '    vec2 luv2 = vec2((uvCoord.x - 2.0/3.0) * 3.0, (uvCoord.y - 0.5) * 2.0);',
    '    vec2 luv3 = vec2((uvCoord.x - 2.0/3.0) * 6.0, uvCoord.y * 2.0);',
    '    vec2 luv4 = vec2((uvCoord.x - 5.0/6.0) * 6.0, uvCoord.y * 2.0);',
    '    vec2 botRightUV     = mix(luv3, luv4, isMidRight);',
    '    vec4 botRightSample = mix(texture(u_tex3, luv3), texture(u_tex4, luv4), isMidRight);',
    '    vec2 rightUV     = mix(botRightUV, luv2, isTop);',
    '    vec4 rightSample = mix(botRightSample, texture(u_tex2, luv2), isTop);',
    '    localUV      = mix(luv1, rightUV, isRight);',
    '    activeSample = mix(texture(u_tex1, luv1), rightSample, isRight);',
    '    float vertB  = 1.0 - smoothstep(bw-aa, bw+aa, abs(uvCoord.x - 2.0/3.0));',
    '    float horizB = isRight       * (1.0 - smoothstep(bw-aa, bw+aa, abs(uvCoord.y - 0.5)     / u_aspect));',
    '    float midB   = isBottomRight * (1.0 - smoothstep(bw-aa, bw+aa, abs(uvCoord.x - 5.0/6.0)));',
    '    isBorder = max(max(vertB, horizB), midB);',
    '',
    '  } else if (u_letter_count == 5) {',
    '    float isRight      = step(2.0/3.0, uvCoord.x);',
    '    float isTopThird   = step(2.0/3.0, uvCoord.y);',
    '    float isAboveThird = step(1.0/3.0, uvCoord.y);',
    '    float isMidRight   = step(5.0/6.0, uvCoord.x);',
    '    float isMidRow     = isRight * isAboveThird * (1.0 - isTopThird);',
    '    vec2 luv1 = vec2(uvCoord.x * 1.5, uvCoord.y);',
    '    vec2 luv2 = vec2((uvCoord.x - 2.0/3.0) * 3.0, (uvCoord.y - 2.0/3.0) * 3.0);',
    '    vec2 luv3 = vec2((uvCoord.x - 2.0/3.0) * 6.0, (uvCoord.y - 1.0/3.0) * 3.0);',
    '    vec2 luv4 = vec2((uvCoord.x - 5.0/6.0) * 6.0, (uvCoord.y - 1.0/3.0) * 3.0);',
    '    vec2 luv5 = vec2((uvCoord.x - 2.0/3.0) * 3.0, uvCoord.y * 3.0);',
    '    vec2 midUV        = mix(luv3, luv4, isMidRight);',
    '    vec2 nonTopUV     = mix(luv5, midUV, isAboveThird);',
    '    vec2 rightUV      = mix(nonTopUV, luv2, isTopThird);',
    '    localUV = mix(luv1, rightUV, isRight);',
    '    vec4 midSample    = mix(texture(u_tex3, luv3), texture(u_tex4, luv4), isMidRight);',
    '    vec4 nonTopSample = mix(texture(u_tex5, luv5), midSample, isAboveThird);',
    '    vec4 rightSample  = mix(nonTopSample, texture(u_tex2, luv2), isTopThird);',
    '    activeSample = mix(texture(u_tex1, luv1), rightSample, isRight);',
    '    float vertB     = 1.0 - smoothstep(bw-aa, bw+aa, abs(uvCoord.x - 2.0/3.0));',
    '    float horizTopB = isRight  * (1.0 - smoothstep(bw-aa, bw+aa, abs(uvCoord.y - 2.0/3.0) / u_aspect));',
    '    float horizBotB = isRight  * (1.0 - smoothstep(bw-aa, bw+aa, abs(uvCoord.y - 1.0/3.0) / u_aspect));',
    '    float midB      = isMidRow * (1.0 - smoothstep(bw-aa, bw+aa, abs(uvCoord.x - 5.0/6.0)));',
    '    isBorder = max(max(vertB, horizTopB), max(horizBotB, midB));',
    '',
    '  } else {',
    '    // N=6',
    '    float isRight       = step(2.0/3.0, uvCoord.x);',
    '    float isTop         = step(0.5, uvCoord.y);',
    '    float isMidRight    = step(5.0/6.0, uvCoord.x);',
    '    float isMidBottom   = step(0.25, uvCoord.y);',
    '    float isBottomRight = isRight * (1.0 - isTop);',
    '    vec2 luv1 = vec2(uvCoord.x * 1.5, uvCoord.y);',
    '    vec2 luv2 = vec2((uvCoord.x - 2.0/3.0) * 3.0, (uvCoord.y - 0.5)  * 2.0);',
    '    vec2 luv3 = vec2((uvCoord.x - 2.0/3.0) * 6.0, (uvCoord.y - 0.25) * 4.0);',
    '    vec2 luv4 = vec2((uvCoord.x - 5.0/6.0) * 6.0, (uvCoord.y - 0.25) * 4.0);',
    '    vec2 luv5 = vec2((uvCoord.x - 2.0/3.0) * 6.0, uvCoord.y * 4.0);',
    '    vec2 luv6 = vec2((uvCoord.x - 5.0/6.0) * 6.0, uvCoord.y * 4.0);',
    '    vec2 botTopUV  = mix(luv3, luv4, isMidRight);',
    '    vec2 botBotUV  = mix(luv5, luv6, isMidRight);',
    '    vec2 botUV     = mix(botBotUV, botTopUV, isMidBottom);',
    '    vec2 rightUV   = mix(botUV, luv2, isTop);',
    '    localUV = mix(luv1, rightUV, isRight);',
    '    vec4 botTopSample = mix(texture(u_tex3, luv3), texture(u_tex4, luv4), isMidRight);',
    '    vec4 botBotSample = mix(texture(u_tex5, luv5), texture(u_tex6, luv6), isMidRight);',
    '    vec4 botSample    = mix(botBotSample, botTopSample, isMidBottom);',
    '    vec4 rightSample  = mix(botSample, texture(u_tex2, luv2), isTop);',
    '    activeSample = mix(texture(u_tex1, luv1), rightSample, isRight);',
    '    float vertB   = 1.0 - smoothstep(bw-aa, bw+aa, abs(uvCoord.x - 2.0/3.0));',
    '    float horizB  = isRight       * (1.0 - smoothstep(bw-aa, bw+aa, abs(uvCoord.y - 0.5)  / u_aspect));',
    '    float midB    = isBottomRight * (1.0 - smoothstep(bw-aa, bw+aa, abs(uvCoord.x - 5.0/6.0)));',
    '    float midBotB = isBottomRight * (1.0 - smoothstep(bw-aa, bw+aa, abs(uvCoord.y - 0.25) / u_aspect));',
    '    isBorder = max(max(vertB, horizB), max(midB, midBotB));',
    '  }',
    '',
    '  // ── Colour ────────────────────────────────────────────────────────────────',
    '  float fillMask    = smoothstep(0.3, 0.7, activeSample.r) * u_text_enabled;',
    '  float outlineMask = smoothstep(0.3, 0.7, activeSample.g) * u_text_enabled;',
    '  vec3  cosCol      = cosinePalette(localUV.x, u_a, u_b, u_c, u_d);',
    '  vec3  letterColor = mix(cosCol, u_outline_color, outlineMask);',
    '  float letterAlpha = max(fillMask, outlineMask);',
    '',
    '  // ── Outer border ──────────────────────────────────────────────────────────',
    '  float edgeX    = min(uvCoord.x, 1.0 - uvCoord.x);',
    '  float edgeY    = min(uvCoord.y, 1.0 - uvCoord.y) / u_aspect;',
    '  float edgeDist = min(edgeX, edgeY);',
    '  float outerB   = u_outer_border * (1.0 - smoothstep(bw*0.5-aa, bw*0.5+aa, edgeDist));',
    '',
    '  // ── Composite ─────────────────────────────────────────────────────────────',
    '  vec3  finalColor = mix(mix(vec3(0.0), letterColor, letterAlpha), u_border_color, isBorder);',
    '  finalColor = mix(finalColor, u_border_color, outerB);',
    '  float alpha = max(max(isBorder, outerB), letterAlpha);',
    '',
    '  // ── Distress + finish ─────────────────────────────────────────────────────',
    '  float dn = distressNoise(uvCoord, u_distress_scale) * 0.67',
    '           + distressNoise(uvCoord, u_distress_scale * 2.73) * 0.33;',
    '  alpha = alpha * step(u_distress, dn) * u_opacity;',
    '',
    '  vec3 encoded = pow(max(finalColor, 0.0), vec3(1.0 / 2.2));',
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

      for (var i = 0; i < 6; i++) {
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
        letterCount:  gl.getUniformLocation(program, 'u_letter_count'),
        borderWidth:  gl.getUniformLocation(program, 'u_border_width'),
        borderColor:  gl.getUniformLocation(program, 'u_border_color'),
        outlineColor: gl.getUniformLocation(program, 'u_outline_color'),
        textEnabled:  gl.getUniformLocation(program, 'u_text_enabled'),
        outerBorder:  gl.getUniformLocation(program, 'u_outer_border'),
        palA:         gl.getUniformLocation(program, 'u_a'),
        palB:         gl.getUniformLocation(program, 'u_b'),
        palC:         gl.getUniformLocation(program, 'u_c'),
        palD:         gl.getUniformLocation(program, 'u_d'),
        tex1:         gl.getUniformLocation(program, 'u_tex1'),
        tex2:         gl.getUniformLocation(program, 'u_tex2'),
        tex3:         gl.getUniformLocation(program, 'u_tex3'),
        tex4:         gl.getUniformLocation(program, 'u_tex4'),
        tex5:         gl.getUniformLocation(program, 'u_tex5'),
        tex6:         gl.getUniformLocation(program, 'u_tex6'),
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
      var word           = v.u_word         != null ? v.u_word         : 'ABCDE';
      var fontFamily     = v.u_font_family  || 'Montserrat';
      var fontSize       = v.u_font_size    != null ? v.u_font_size    : 300;
      var textEnabled    = v.u_text_enabled != null ? v.u_text_enabled : 1.0;
      var outlineEnabled = v.outlineEnabled ? true : false;
      var outlineWidth   = v.outlineWidth   != null ? v.outlineWidth   : 12;
      var borderWidth    = v.u_border_width != null ? v.u_border_width : 0.01;
      var borderColor    = v.u_border_color || [1.0, 1.0, 1.0];
      var outerBorder    = v.u_outer_border != null ? v.u_outer_border : 0.0;
      var outlineColor   = v.u_outline_color || [0.0, 0.0, 0.0];
      var palA           = v.u_a             || [0.5, 0.5, 0.5];
      var palB           = v.u_b             || [0.5, 0.5, 0.5];
      var palC           = v.u_c             || [1.0, 1.0, 1.0];
      var palD           = v.u_d             || [0.0, 0.33, 0.67];
      var aspect         = h > 0 ? w / h : 1.0;

      var letters     = word.slice(0, 6).split('').filter(Boolean);
      var letterCount = Math.max(1, letters.length);

      var texUnits    = [gl.TEXTURE0, gl.TEXTURE1, gl.TEXTURE2, gl.TEXTURE3, gl.TEXTURE4, gl.TEXTURE5];
      var texUniforms = [u.tex1, u.tex2, u.tex3, u.tex4, u.tex5, u.tex6];

      for (var i = 0; i < 6; i++) {
        var letter = textEnabled ? (letters[i] || '') : '';
        var ca     = getCellCa(i + 1, letterCount, aspect);
        var key    = letter + '|' + fontFamily + '|' + fontSize + '|' + outlineEnabled + '|' + outlineWidth + '|' + letterCount + '|' + ca;
        if (key !== u._lastLetterKeys[i]) {
          drawLetter(u._texCtxs[i], letter, fontFamily, fontSize, outlineEnabled, outlineWidth, ca);
          uploadTex(gl, u._glTextures[i], u._texCanvases[i]);
          u._lastLetterKeys[i] = key;
        }
        gl.activeTexture(texUnits[i]);
        gl.bindTexture(gl.TEXTURE_2D, u._glTextures[i]);
        gl.uniform1i(texUniforms[i], i);
      }

      gl.uniform2f(u.res,          w, h);
      gl.uniform1f(u.aspect,       aspect);
      gl.uniform1i(u.letterCount,  letterCount);
      gl.uniform1f(u.borderWidth,  borderWidth);
      gl.uniform3fv(u.borderColor, borderColor);
      gl.uniform1f(u.outerBorder,  outerBorder);
      gl.uniform3fv(u.outlineColor, outlineColor);
      gl.uniform1f(u.textEnabled,  textEnabled);
      gl.uniform3fv(u.palA,        palA);
      gl.uniform3fv(u.palB,        palB);
      gl.uniform3fv(u.palC,        palC);
      gl.uniform3fv(u.palD,        palD);
      gl.uniform1f(u.opacity,       v.u_opacity        != null ? v.u_opacity        : 1.0);
      gl.uniform1f(u.distress,      v.u_distress       != null ? v.u_distress       : 0.0);
      gl.uniform1f(u.distressScale, v.u_distress_scale != null ? v.u_distress_scale : 80.0);
    },
  });
}());
