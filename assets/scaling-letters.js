(function () {
  'use strict';

  // ScalingLetters port — asymmetric letter-grid shader.
  // Left cell is always 2/3 width; right side is divided into 1–10 smaller cells
  // depending on word length (1–11 chars). Each row adds one more cell than the row
  // above: row1=1, row2=2, row3=3, row4=4 (triangle layout).

  var CANVAS_SIZE = 512;

  // Returns the width/height aspect ratio for each letter's canvas texture.
  // texIndex is 1-based; letterCount is the number of letters in the word.
  // gridAspect is the canvas width/height ratio.
  function getCellCa(texIndex, letterCount, gridAspect) {
    var H1   = 0.4;   // N=3,4: row1 height
    var T1   = 0.6;   // N=3,4: row1 bottom boundary
    var H1B  = 0.45;  // N=5,6,7: row1 height
    var H2B  = 0.35;  // N=5,6,7: row2 height
    var H3B  = 0.20;  // N=5,6,7: row3 height
    var H4_1 = 0.30;  // N=8-11: row1 height
    var H4_2 = 0.27;  // N=8-11: row2 height
    var H4_3 = 0.23;  // N=8-11: row3 height
    var H4_4 = 0.20;  // N=8-11: row4 height

    if (texIndex === 1) return letterCount === 1 ? gridAspect : (2 / 3) * gridAspect;
    if (letterCount === 2) return (1 / 3) * gridAspect;
    if (letterCount <= 4) {
      if (texIndex === 2) return (1 / 3 / H1) * gridAspect;
      if (letterCount === 3) return (1 / 3 / T1) * gridAspect;
      return (1 / 6 / T1) * gridAspect; // N=4 row2 (2 cells)
    }
    if (letterCount <= 7) {
      // N=5,6,7: 3-row layout
      if (texIndex === 2) return (1 / 3 / H1B) * gridAspect;
      if (texIndex <= 4)  return (1 / 6 / H2B) * gridAspect;
      // row3: 1 cell (N=5), 2 cells (N=6), 3 cells (N=7)
      if (letterCount === 5) return (1 / 3 / H3B) * gridAspect;
      if (letterCount === 6) return (1 / 6 / H3B) * gridAspect;
      return (1 / 9 / H3B) * gridAspect; // N=7, 3 cells
    }
    // N=8-11: 4-row layout
    if (texIndex === 2) return (1 / 3 / H4_1) * gridAspect;
    if (texIndex <= 4)  return (1 / 6 / H4_2) * gridAspect;
    if (texIndex <= 7)  return (1 / 9 / H4_3) * gridAspect;
    // row4: 1 cell (N=8), 2 cells (N=9), 3 cells (N=10), 4 cells (N=11)
    var row4Count = letterCount - 7;
    return (1 / (3 * row4Count) / H4_4) * gridAspect;
  }

  function drawLetter(ctx, letter, font, size, outlineEnabled, outlineWidth, ca) {
    var canvas   = ctx.canvas;
    var canvasW  = Math.max(1, Math.round(CANVAS_SIZE * ca));
    canvas.width  = canvasW;
    canvas.height = CANVAS_SIZE;
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvasW, CANVAS_SIZE);
    if (letter) {
      ctx.font         = '600 ' + size + 'px ' + font + ', monospace';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      if (outlineEnabled && outlineWidth > 0) {
        ctx.strokeStyle = 'rgb(0,255,0)';
        ctx.lineWidth   = outlineWidth * 2;
        ctx.lineJoin    = 'round';
        ctx.strokeText(letter, canvasW / 2, CANVAS_SIZE / 2);
      }
      ctx.fillStyle = 'rgb(255,0,0)';
      ctx.fillText(letter, canvasW / 2, CANVAS_SIZE / 2);
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
    'uniform vec3      u_text_color;',
    'uniform float     u_color_mode;',
    'uniform vec3      u_color0;',
    'uniform vec3      u_color1;',
    'uniform vec3      u_color2;',
    'uniform vec3      u_color3;',
    'uniform sampler2D u_tex1;',
    'uniform sampler2D u_tex2;',
    'uniform sampler2D u_tex3;',
    'uniform sampler2D u_tex4;',
    'uniform sampler2D u_tex5;',
    'uniform sampler2D u_tex6;',
    'uniform sampler2D u_tex7;',
    'uniform sampler2D u_tex8;',
    'uniform sampler2D u_tex9;',
    'uniform sampler2D u_tex10;',
    'uniform sampler2D u_tex11;',
    'uniform float     u_invert;',
    'uniform float     u_grid_aspect;',
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
    '',
    '  // ── Grid crop: constrain to target aspect, centred in canvas ────────────────',
    '  float GRID_ASPECT = u_grid_aspect;',
    '  const float ROW_T1  = 0.6;',
    '  const float ROW_T1B = 0.55;',
    '  const float ROW_T2  = 0.20;',
    '  const float ROW_4A  = 0.70;',
    '  const float ROW_4B  = 0.43;',
    '  const float ROW_4C  = 0.20;',
    '  float scaleX  = min(1.0, GRID_ASPECT / u_aspect);',
    '  float scaleY  = min(1.0, u_aspect / GRID_ASPECT);',
    '  float marginX = (1.0 - scaleX) * 0.5;',
    '  float marginY = (1.0 - scaleY) * 0.5;',
    '  if (uvCoord.x < marginX || uvCoord.x > 1.0 - marginX ||',
    '      uvCoord.y < marginY || uvCoord.y > 1.0 - marginY) {',
    '    fragColor = vec4(0.0); return;',
    '  }',
    '  vec2 gridUV = vec2((uvCoord.x - marginX) / scaleX,',
    '                     (uvCoord.y - marginY) / scaleY);',
    '',
    '  vec2  localUV    = vec2(0.0);',
    '  vec4  activeSample = vec4(0.0);',
    '  float isBorder   = 0.0;',
    '',
    '  if (u_letter_count == 1) {',
    '    localUV      = gridUV;',
    '    activeSample = texture(u_tex1, gridUV);',
    '',
    '  } else if (u_letter_count == 2) {',
    '    float isRight = step(2.0/3.0, gridUV.x);',
    '    vec2 luv1 = vec2(gridUV.x * 1.5, gridUV.y);',
    '    vec2 luv2 = vec2((gridUV.x - 2.0/3.0) * 3.0, gridUV.y);',
    '    localUV      = mix(luv1, luv2, isRight);',
    '    activeSample = mix(texture(u_tex1, luv1), texture(u_tex2, luv2), isRight);',
    '    isBorder = 1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.x - 2.0/3.0));',
    '',
    '  } else if (u_letter_count == 3) {',
    '    float isRight = step(2.0/3.0, gridUV.x);',
    '    float isTop   = step(ROW_T1, gridUV.y);',
    '    vec2 luv1 = vec2(gridUV.x * 1.5, gridUV.y);',
    '    vec2 luv2 = vec2((gridUV.x - 2.0/3.0) * 3.0, (gridUV.y - ROW_T1) / (1.0 - ROW_T1));',
    '    vec2 luv3 = vec2((gridUV.x - 2.0/3.0) * 3.0, gridUV.y / ROW_T1);',
    '    vec2 rightUV     = mix(luv3, luv2, isTop);',
    '    vec4 rightSample = mix(texture(u_tex3, luv3), texture(u_tex2, luv2), isTop);',
    '    localUV      = mix(luv1, rightUV, isRight);',
    '    activeSample = mix(texture(u_tex1, luv1), rightSample, isRight);',
    '    float vertB  = 1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.x - 2.0/3.0));',
    '    float horizB = isRight * (1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.y - ROW_T1) / GRID_ASPECT));',
    '    isBorder = max(vertB, horizB);',
    '',
    '  } else if (u_letter_count == 4) {',
    '    float isRight       = step(2.0/3.0, gridUV.x);',
    '    float isTop         = step(ROW_T1, gridUV.y);',
    '    float isMidRight    = step(5.0/6.0, gridUV.x);',
    '    float isBottomRight = isRight * (1.0 - isTop);',
    '    vec2 luv1 = vec2(gridUV.x * 1.5, gridUV.y);',
    '    vec2 luv2 = vec2((gridUV.x - 2.0/3.0) * 3.0, (gridUV.y - ROW_T1) / (1.0 - ROW_T1));',
    '    vec2 luv3 = vec2((gridUV.x - 2.0/3.0) * 6.0, gridUV.y / ROW_T1);',
    '    vec2 luv4 = vec2((gridUV.x - 5.0/6.0) * 6.0, gridUV.y / ROW_T1);',
    '    vec2 botRightUV     = mix(luv3, luv4, isMidRight);',
    '    vec4 botRightSample = mix(texture(u_tex3, luv3), texture(u_tex4, luv4), isMidRight);',
    '    vec2 rightUV     = mix(botRightUV, luv2, isTop);',
    '    vec4 rightSample = mix(botRightSample, texture(u_tex2, luv2), isTop);',
    '    localUV      = mix(luv1, rightUV, isRight);',
    '    activeSample = mix(texture(u_tex1, luv1), rightSample, isRight);',
    '    float vertB  = 1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.x - 2.0/3.0));',
    '    float horizB = isRight       * (1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.y - ROW_T1) / GRID_ASPECT));',
    '    float midB   = isBottomRight * (1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.x - 5.0/6.0)));',
    '    isBorder = max(max(vertB, horizB), midB);',
    '',
    '  } else if (u_letter_count == 5) {',
    '    float isRight      = step(2.0/3.0, gridUV.x);',
    '    float isTopThird   = step(ROW_T1B, gridUV.y);',
    '    float isAboveThird = step(ROW_T2, gridUV.y);',
    '    float isMidRight   = step(5.0/6.0, gridUV.x);',
    '    float isMidRow     = isRight * isAboveThird * (1.0 - isTopThird);',
    '    vec2 luv1 = vec2(gridUV.x * 1.5, gridUV.y);',
    '    vec2 luv2 = vec2((gridUV.x - 2.0/3.0) * 3.0, (gridUV.y - ROW_T1B) / (1.0 - ROW_T1B));',
    '    vec2 luv3 = vec2((gridUV.x - 2.0/3.0) * 6.0, (gridUV.y - ROW_T2) / (ROW_T1B - ROW_T2));',
    '    vec2 luv4 = vec2((gridUV.x - 5.0/6.0) * 6.0, (gridUV.y - ROW_T2) / (ROW_T1B - ROW_T2));',
    '    vec2 luv5 = vec2((gridUV.x - 2.0/3.0) * 3.0, gridUV.y / ROW_T2);',
    '    vec2 midUV        = mix(luv3, luv4, isMidRight);',
    '    vec2 nonTopUV     = mix(luv5, midUV, isAboveThird);',
    '    vec2 rightUV      = mix(nonTopUV, luv2, isTopThird);',
    '    localUV = mix(luv1, rightUV, isRight);',
    '    vec4 midSample    = mix(texture(u_tex3, luv3), texture(u_tex4, luv4), isMidRight);',
    '    vec4 nonTopSample = mix(texture(u_tex5, luv5), midSample, isAboveThird);',
    '    vec4 rightSample  = mix(nonTopSample, texture(u_tex2, luv2), isTopThird);',
    '    activeSample = mix(texture(u_tex1, luv1), rightSample, isRight);',
    '    float vertB     = 1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.x - 2.0/3.0));',
    '    float horizTopB = isRight  * (1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.y - ROW_T1B) / GRID_ASPECT));',
    '    float horizBotB = isRight  * (1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.y - ROW_T2)  / GRID_ASPECT));',
    '    float midB      = isMidRow * (1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.x - 5.0/6.0)));',
    '    isBorder = max(max(vertB, horizTopB), max(horizBotB, midB));',
    '',
    '  } else if (u_letter_count == 6) {',
    '    float isRight       = step(2.0/3.0, gridUV.x);',
    '    float isTop         = step(ROW_T1B, gridUV.y);',
    '    float isMidRight    = step(5.0/6.0, gridUV.x);',
    '    float isMidBottom   = step(ROW_T2, gridUV.y);',
    '    float isBottomRight = isRight * (1.0 - isTop);',
    '    vec2 luv1 = vec2(gridUV.x * 1.5, gridUV.y);',
    '    vec2 luv2 = vec2((gridUV.x - 2.0/3.0) * 3.0, (gridUV.y - ROW_T1B) / (1.0 - ROW_T1B));',
    '    vec2 luv3 = vec2((gridUV.x - 2.0/3.0) * 6.0, (gridUV.y - ROW_T2) / (ROW_T1B - ROW_T2));',
    '    vec2 luv4 = vec2((gridUV.x - 5.0/6.0) * 6.0, (gridUV.y - ROW_T2) / (ROW_T1B - ROW_T2));',
    '    vec2 luv5 = vec2((gridUV.x - 2.0/3.0) * 6.0, gridUV.y / ROW_T2);',
    '    vec2 luv6 = vec2((gridUV.x - 5.0/6.0) * 6.0, gridUV.y / ROW_T2);',
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
    '    float vertB   = 1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.x - 2.0/3.0));',
    '    float horizB  = isRight       * (1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.y - ROW_T1B) / GRID_ASPECT));',
    '    float midB    = isBottomRight * (1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.x - 5.0/6.0)));',
    '    float midBotB = isBottomRight * (1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.y - ROW_T2)  / GRID_ASPECT));',
    '    isBorder = max(max(vertB, horizB), max(midB, midBotB));',
    '',
    '  } else if (u_letter_count == 7) {',
    '    // 3 rows: row1=1, row2=2, row3=3',
    '    float isRight    = step(2.0/3.0, gridUV.x);',
    '    float isRow1     = step(ROW_T1B, gridUV.y);',
    '    float isAboveBt  = step(ROW_T2, gridUV.y);',
    '    float isMidRight = step(5.0/6.0, gridUV.x);',
    '    float isR3Ge2    = step(7.0/9.0, gridUV.x);',
    '    float isR3Ge3    = step(8.0/9.0, gridUV.x);',
    '    float isMidRow   = isRight * isAboveBt  * (1.0 - isRow1);',
    '    float isBotRow   = isRight * (1.0 - isAboveBt);',
    '    vec2 luv1 = vec2(gridUV.x * 1.5, gridUV.y);',
    '    vec2 luv2 = vec2((gridUV.x - 2.0/3.0) * 3.0, (gridUV.y - ROW_T1B) / (1.0 - ROW_T1B));',
    '    vec2 luv3 = vec2((gridUV.x - 2.0/3.0) * 6.0, (gridUV.y - ROW_T2) / (ROW_T1B - ROW_T2));',
    '    vec2 luv4 = vec2((gridUV.x - 5.0/6.0) * 6.0, (gridUV.y - ROW_T2) / (ROW_T1B - ROW_T2));',
    '    vec2 luv5 = vec2((gridUV.x - 2.0/3.0) * 9.0, gridUV.y / ROW_T2);',
    '    vec2 luv6 = vec2((gridUV.x - 7.0/9.0) * 9.0, gridUV.y / ROW_T2);',
    '    vec2 luv7 = vec2((gridUV.x - 8.0/9.0) * 9.0, gridUV.y / ROW_T2);',
    '    vec2 row3UV = mix(mix(luv5, luv6, isR3Ge2), luv7, isR3Ge3);',
    '    vec4 row3S  = mix(mix(texture(u_tex5, luv5), texture(u_tex6, luv6), isR3Ge2), texture(u_tex7, luv7), isR3Ge3);',
    '    vec2 row2UV = mix(luv3, luv4, isMidRight);',
    '    vec4 row2S  = mix(texture(u_tex3, luv3), texture(u_tex4, luv4), isMidRight);',
    '    vec2 rightUV    = mix(mix(row3UV, row2UV, isAboveBt), luv2, isRow1);',
    '    vec4 rightSample = mix(mix(row3S, row2S, isAboveBt), texture(u_tex2, luv2), isRow1);',
    '    localUV      = mix(luv1, rightUV, isRight);',
    '    activeSample = mix(texture(u_tex1, luv1), rightSample, isRight);',
    '    float vertB  = 1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.x - 2.0/3.0));',
    '    float horizT = isRight  * (1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.y - ROW_T1B) / GRID_ASPECT));',
    '    float horizB = isRight  * (1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.y - ROW_T2)  / GRID_ASPECT));',
    '    float midV   = isMidRow * (1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.x - 5.0/6.0)));',
    '    float bot1V  = isBotRow * (1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.x - 7.0/9.0)));',
    '    float bot2V  = isBotRow * (1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.x - 8.0/9.0)));',
    '    isBorder = max(max(max(vertB, horizT), max(horizB, midV)), max(bot1V, bot2V));',
    '',
    '  } else if (u_letter_count == 8) {',
    '    // 4 rows: row1=1, row2=2, row3=3, row4=1',
    '    float isRight     = step(2.0/3.0, gridUV.x);',
    '    float isRow1      = step(ROW_4A, gridUV.y);',
    '    float isAboveR4   = step(ROW_4C, gridUV.y);',
    '    float isAboveR3   = step(ROW_4B, gridUV.y);',
    '    float isMidRight  = step(5.0/6.0, gridUV.x);',
    '    float isR3Ge2     = step(7.0/9.0, gridUV.x);',
    '    float isR3Ge3     = step(8.0/9.0, gridUV.x);',
    '    float isRow2Reg   = isRight * isAboveR3 * (1.0 - isRow1);',
    '    float isRow3Reg   = isRight * isAboveR4 * (1.0 - isAboveR3);',
    '    float isRow4Reg   = isRight * (1.0 - isAboveR4);',
    '    vec2 luv1 = vec2(gridUV.x * 1.5, gridUV.y);',
    '    vec2 luv2 = vec2((gridUV.x - 2.0/3.0) * 3.0,  (gridUV.y - ROW_4A) / (1.0 - ROW_4A));',
    '    vec2 luv3 = vec2((gridUV.x - 2.0/3.0) * 6.0,  (gridUV.y - ROW_4B) / (ROW_4A - ROW_4B));',
    '    vec2 luv4 = vec2((gridUV.x - 5.0/6.0) * 6.0,  (gridUV.y - ROW_4B) / (ROW_4A - ROW_4B));',
    '    vec2 luv5 = vec2((gridUV.x - 2.0/3.0) * 9.0,  (gridUV.y - ROW_4C) / (ROW_4B - ROW_4C));',
    '    vec2 luv6 = vec2((gridUV.x - 7.0/9.0) * 9.0,  (gridUV.y - ROW_4C) / (ROW_4B - ROW_4C));',
    '    vec2 luv7 = vec2((gridUV.x - 8.0/9.0) * 9.0,  (gridUV.y - ROW_4C) / (ROW_4B - ROW_4C));',
    '    vec2 luv8 = vec2((gridUV.x - 2.0/3.0) * 3.0,  gridUV.y / ROW_4C);',
    '    vec2 row3UV = mix(mix(luv5, luv6, isR3Ge2), luv7, isR3Ge3);',
    '    vec4 row3S  = mix(mix(texture(u_tex5, luv5), texture(u_tex6, luv6), isR3Ge2), texture(u_tex7, luv7), isR3Ge3);',
    '    vec2 row2UV = mix(luv3, luv4, isMidRight);',
    '    vec4 row2S  = mix(texture(u_tex3, luv3), texture(u_tex4, luv4), isMidRight);',
    '    vec2 rightUV    = mix(mix(mix(luv8, row3UV, isAboveR4), row2UV, isAboveR3), luv2, isRow1);',
    '    vec4 rightSample = mix(mix(mix(texture(u_tex8, luv8), row3S, isAboveR4), row2S, isAboveR3), texture(u_tex2, luv2), isRow1);',
    '    localUV      = mix(luv1, rightUV, isRight);',
    '    activeSample = mix(texture(u_tex1, luv1), rightSample, isRight);',
    '    float vertB  = 1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.x - 2.0/3.0));',
    '    float horiz1 = isRight    * (1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.y - ROW_4A) / GRID_ASPECT));',
    '    float horiz2 = isRight    * (1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.y - ROW_4B) / GRID_ASPECT));',
    '    float horiz3 = isRight    * (1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.y - ROW_4C) / GRID_ASPECT));',
    '    float r2V    = isRow2Reg  * (1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.x - 5.0/6.0)));',
    '    float r3V1   = isRow3Reg  * (1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.x - 7.0/9.0)));',
    '    float r3V2   = isRow3Reg  * (1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.x - 8.0/9.0)));',
    '    isBorder = max(max(max(vertB, horiz1), max(horiz2, horiz3)), max(max(r2V, r3V1), r3V2));',
    '',
    '  } else if (u_letter_count == 9) {',
    '    // 4 rows: row1=1, row2=2, row3=3, row4=2',
    '    float isRight     = step(2.0/3.0, gridUV.x);',
    '    float isRow1      = step(ROW_4A, gridUV.y);',
    '    float isAboveR4   = step(ROW_4C, gridUV.y);',
    '    float isAboveR3   = step(ROW_4B, gridUV.y);',
    '    float isMidRight  = step(5.0/6.0, gridUV.x);',
    '    float isR3Ge2     = step(7.0/9.0, gridUV.x);',
    '    float isR3Ge3     = step(8.0/9.0, gridUV.x);',
    '    float isRow2Reg   = isRight * isAboveR3 * (1.0 - isRow1);',
    '    float isRow3Reg   = isRight * isAboveR4 * (1.0 - isAboveR3);',
    '    float isRow4Reg   = isRight * (1.0 - isAboveR4);',
    '    vec2 luv1 = vec2(gridUV.x * 1.5, gridUV.y);',
    '    vec2 luv2 = vec2((gridUV.x - 2.0/3.0) * 3.0,  (gridUV.y - ROW_4A) / (1.0 - ROW_4A));',
    '    vec2 luv3 = vec2((gridUV.x - 2.0/3.0) * 6.0,  (gridUV.y - ROW_4B) / (ROW_4A - ROW_4B));',
    '    vec2 luv4 = vec2((gridUV.x - 5.0/6.0) * 6.0,  (gridUV.y - ROW_4B) / (ROW_4A - ROW_4B));',
    '    vec2 luv5 = vec2((gridUV.x - 2.0/3.0) * 9.0,  (gridUV.y - ROW_4C) / (ROW_4B - ROW_4C));',
    '    vec2 luv6 = vec2((gridUV.x - 7.0/9.0) * 9.0,  (gridUV.y - ROW_4C) / (ROW_4B - ROW_4C));',
    '    vec2 luv7 = vec2((gridUV.x - 8.0/9.0) * 9.0,  (gridUV.y - ROW_4C) / (ROW_4B - ROW_4C));',
    '    vec2 luv8 = vec2((gridUV.x - 2.0/3.0) * 6.0,  gridUV.y / ROW_4C);',
    '    vec2 luv9 = vec2((gridUV.x - 5.0/6.0) * 6.0,  gridUV.y / ROW_4C);',
    '    vec2 row3UV = mix(mix(luv5, luv6, isR3Ge2), luv7, isR3Ge3);',
    '    vec4 row3S  = mix(mix(texture(u_tex5, luv5), texture(u_tex6, luv6), isR3Ge2), texture(u_tex7, luv7), isR3Ge3);',
    '    vec2 row2UV = mix(luv3, luv4, isMidRight);',
    '    vec4 row2S  = mix(texture(u_tex3, luv3), texture(u_tex4, luv4), isMidRight);',
    '    vec2 row4UV  = mix(luv8, luv9, isMidRight);',
    '    vec4 row4S   = mix(texture(u_tex8, luv8), texture(u_tex9, luv9), isMidRight);',
    '    vec2 rightUV    = mix(mix(mix(row4UV, row3UV, isAboveR4), row2UV, isAboveR3), luv2, isRow1);',
    '    vec4 rightSample = mix(mix(mix(row4S, row3S, isAboveR4), row2S, isAboveR3), texture(u_tex2, luv2), isRow1);',
    '    localUV      = mix(luv1, rightUV, isRight);',
    '    activeSample = mix(texture(u_tex1, luv1), rightSample, isRight);',
    '    float vertB  = 1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.x - 2.0/3.0));',
    '    float horiz1 = isRight    * (1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.y - ROW_4A) / GRID_ASPECT));',
    '    float horiz2 = isRight    * (1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.y - ROW_4B) / GRID_ASPECT));',
    '    float horiz3 = isRight    * (1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.y - ROW_4C) / GRID_ASPECT));',
    '    float r2V    = isRow2Reg  * (1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.x - 5.0/6.0)));',
    '    float r3V1   = isRow3Reg  * (1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.x - 7.0/9.0)));',
    '    float r3V2   = isRow3Reg  * (1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.x - 8.0/9.0)));',
    '    float r4V    = isRow4Reg  * (1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.x - 5.0/6.0)));',
    '    isBorder = max(max(max(vertB, horiz1), max(horiz2, horiz3)), max(max(r2V, r3V1), max(r3V2, r4V)));',
    '',
    '  } else if (u_letter_count == 10) {',
    '    // 4 rows: row1=1, row2=2, row3=3, row4=3',
    '    float isRight     = step(2.0/3.0, gridUV.x);',
    '    float isRow1      = step(ROW_4A, gridUV.y);',
    '    float isAboveR4   = step(ROW_4C, gridUV.y);',
    '    float isAboveR3   = step(ROW_4B, gridUV.y);',
    '    float isMidRight  = step(5.0/6.0, gridUV.x);',
    '    float isR3Ge2     = step(7.0/9.0, gridUV.x);',
    '    float isR3Ge3     = step(8.0/9.0, gridUV.x);',
    '    float isRow2Reg   = isRight * isAboveR3 * (1.0 - isRow1);',
    '    float isRow3Reg   = isRight * isAboveR4 * (1.0 - isAboveR3);',
    '    float isRow4Reg   = isRight * (1.0 - isAboveR4);',
    '    vec2 luv1  = vec2(gridUV.x * 1.5, gridUV.y);',
    '    vec2 luv2  = vec2((gridUV.x - 2.0/3.0) * 3.0,  (gridUV.y - ROW_4A) / (1.0 - ROW_4A));',
    '    vec2 luv3  = vec2((gridUV.x - 2.0/3.0) * 6.0,  (gridUV.y - ROW_4B) / (ROW_4A - ROW_4B));',
    '    vec2 luv4  = vec2((gridUV.x - 5.0/6.0) * 6.0,  (gridUV.y - ROW_4B) / (ROW_4A - ROW_4B));',
    '    vec2 luv5  = vec2((gridUV.x - 2.0/3.0) * 9.0,  (gridUV.y - ROW_4C) / (ROW_4B - ROW_4C));',
    '    vec2 luv6  = vec2((gridUV.x - 7.0/9.0) * 9.0,  (gridUV.y - ROW_4C) / (ROW_4B - ROW_4C));',
    '    vec2 luv7  = vec2((gridUV.x - 8.0/9.0) * 9.0,  (gridUV.y - ROW_4C) / (ROW_4B - ROW_4C));',
    '    vec2 luv8  = vec2((gridUV.x - 2.0/3.0) * 9.0,  gridUV.y / ROW_4C);',
    '    vec2 luv9  = vec2((gridUV.x - 7.0/9.0) * 9.0,  gridUV.y / ROW_4C);',
    '    vec2 luv10 = vec2((gridUV.x - 8.0/9.0) * 9.0,  gridUV.y / ROW_4C);',
    '    vec2 row3UV = mix(mix(luv5, luv6, isR3Ge2), luv7, isR3Ge3);',
    '    vec4 row3S  = mix(mix(texture(u_tex5, luv5), texture(u_tex6, luv6), isR3Ge2), texture(u_tex7, luv7), isR3Ge3);',
    '    vec2 row2UV = mix(luv3, luv4, isMidRight);',
    '    vec4 row2S  = mix(texture(u_tex3, luv3), texture(u_tex4, luv4), isMidRight);',
    '    vec2 row4UV  = mix(mix(luv8, luv9, isR3Ge2), luv10, isR3Ge3);',
    '    vec4 row4S   = mix(mix(texture(u_tex8, luv8), texture(u_tex9, luv9), isR3Ge2), texture(u_tex10, luv10), isR3Ge3);',
    '    vec2 rightUV    = mix(mix(mix(row4UV, row3UV, isAboveR4), row2UV, isAboveR3), luv2, isRow1);',
    '    vec4 rightSample = mix(mix(mix(row4S, row3S, isAboveR4), row2S, isAboveR3), texture(u_tex2, luv2), isRow1);',
    '    localUV      = mix(luv1, rightUV, isRight);',
    '    activeSample = mix(texture(u_tex1, luv1), rightSample, isRight);',
    '    float vertB  = 1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.x - 2.0/3.0));',
    '    float horiz1 = isRight    * (1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.y - ROW_4A) / GRID_ASPECT));',
    '    float horiz2 = isRight    * (1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.y - ROW_4B) / GRID_ASPECT));',
    '    float horiz3 = isRight    * (1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.y - ROW_4C) / GRID_ASPECT));',
    '    float r2V    = isRow2Reg  * (1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.x - 5.0/6.0)));',
    '    float r3V1   = isRow3Reg  * (1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.x - 7.0/9.0)));',
    '    float r3V2   = isRow3Reg  * (1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.x - 8.0/9.0)));',
    '    float r4V1   = isRow4Reg  * (1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.x - 7.0/9.0)));',
    '    float r4V2   = isRow4Reg  * (1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.x - 8.0/9.0)));',
    '    isBorder = max(max(max(vertB, horiz1), max(horiz2, horiz3)), max(max(r2V, r3V1), max(r3V2, max(r4V1, r4V2))));',
    '',
    '  } else {',
    '    // N=11: 4 rows: row1=1, row2=2, row3=3, row4=4',
    '    float isRight     = step(2.0/3.0, gridUV.x);',
    '    float isRow1      = step(ROW_4A, gridUV.y);',
    '    float isAboveR4   = step(ROW_4C, gridUV.y);',
    '    float isAboveR3   = step(ROW_4B, gridUV.y);',
    '    float isMidRight  = step(5.0/6.0, gridUV.x);',
    '    float isR3Ge2     = step(7.0/9.0,   gridUV.x);',
    '    float isR3Ge3     = step(8.0/9.0,   gridUV.x);',
    '    float isR4Ge2     = step(3.0/4.0,   gridUV.x);',
    '    float isR4Ge3     = step(5.0/6.0,   gridUV.x);',
    '    float isR4Ge4     = step(11.0/12.0, gridUV.x);',
    '    float isRow2Reg   = isRight * isAboveR3 * (1.0 - isRow1);',
    '    float isRow3Reg   = isRight * isAboveR4 * (1.0 - isAboveR3);',
    '    float isRow4Reg   = isRight * (1.0 - isAboveR4);',
    '    vec2 luv1  = vec2(gridUV.x * 1.5, gridUV.y);',
    '    vec2 luv2  = vec2((gridUV.x - 2.0/3.0)   * 3.0,  (gridUV.y - ROW_4A) / (1.0 - ROW_4A));',
    '    vec2 luv3  = vec2((gridUV.x - 2.0/3.0)   * 6.0,  (gridUV.y - ROW_4B) / (ROW_4A - ROW_4B));',
    '    vec2 luv4  = vec2((gridUV.x - 5.0/6.0)   * 6.0,  (gridUV.y - ROW_4B) / (ROW_4A - ROW_4B));',
    '    vec2 luv5  = vec2((gridUV.x - 2.0/3.0)   * 9.0,  (gridUV.y - ROW_4C) / (ROW_4B - ROW_4C));',
    '    vec2 luv6  = vec2((gridUV.x - 7.0/9.0)   * 9.0,  (gridUV.y - ROW_4C) / (ROW_4B - ROW_4C));',
    '    vec2 luv7  = vec2((gridUV.x - 8.0/9.0)   * 9.0,  (gridUV.y - ROW_4C) / (ROW_4B - ROW_4C));',
    '    vec2 luv8  = vec2((gridUV.x - 2.0/3.0)   * 12.0, gridUV.y / ROW_4C);',
    '    vec2 luv9  = vec2((gridUV.x - 3.0/4.0)   * 12.0, gridUV.y / ROW_4C);',
    '    vec2 luv10 = vec2((gridUV.x - 5.0/6.0)   * 12.0, gridUV.y / ROW_4C);',
    '    vec2 luv11 = vec2((gridUV.x - 11.0/12.0) * 12.0, gridUV.y / ROW_4C);',
    '    vec2 row3UV = mix(mix(luv5, luv6, isR3Ge2), luv7, isR3Ge3);',
    '    vec4 row3S  = mix(mix(texture(u_tex5, luv5), texture(u_tex6, luv6), isR3Ge2), texture(u_tex7, luv7), isR3Ge3);',
    '    vec2 row2UV = mix(luv3, luv4, isMidRight);',
    '    vec4 row2S  = mix(texture(u_tex3, luv3), texture(u_tex4, luv4), isMidRight);',
    '    vec2 row4UV  = mix(mix(mix(luv8, luv9, isR4Ge2), luv10, isR4Ge3), luv11, isR4Ge4);',
    '    vec4 row4S   = mix(mix(mix(texture(u_tex8, luv8), texture(u_tex9, luv9), isR4Ge2), texture(u_tex10, luv10), isR4Ge3), texture(u_tex11, luv11), isR4Ge4);',
    '    vec2 rightUV    = mix(mix(mix(row4UV, row3UV, isAboveR4), row2UV, isAboveR3), luv2, isRow1);',
    '    vec4 rightSample = mix(mix(mix(row4S, row3S, isAboveR4), row2S, isAboveR3), texture(u_tex2, luv2), isRow1);',
    '    localUV      = mix(luv1, rightUV, isRight);',
    '    activeSample = mix(texture(u_tex1, luv1), rightSample, isRight);',
    '    float vertB  = 1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.x - 2.0/3.0));',
    '    float horiz1 = isRight    * (1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.y - ROW_4A) / GRID_ASPECT));',
    '    float horiz2 = isRight    * (1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.y - ROW_4B) / GRID_ASPECT));',
    '    float horiz3 = isRight    * (1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.y - ROW_4C) / GRID_ASPECT));',
    '    float r2V    = isRow2Reg  * (1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.x - 5.0/6.0)));',
    '    float r3V1   = isRow3Reg  * (1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.x - 7.0/9.0)));',
    '    float r3V2   = isRow3Reg  * (1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.x - 8.0/9.0)));',
    '    float r4V1   = isRow4Reg  * (1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.x - 3.0/4.0)));',
    '    float r4V2   = isRow4Reg  * (1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.x - 5.0/6.0)));',
    '    float r4V3   = isRow4Reg  * (1.0 - smoothstep(bw-aa, bw+aa, abs(gridUV.x - 11.0/12.0)));',
    '    isBorder = max(max(max(vertB, horiz1), max(horiz2, horiz3)), max(max(r2V, r3V1), max(r3V2, max(max(r4V1, r4V2), r4V3))));',
    '  }',
    '',
    '  // ── Colour ────────────────────────────────────────────────────────────────',
    '  float fillMask    = smoothstep(0.3, 0.7, activeSample.r) * u_text_enabled;',
    '  float outlineMask = smoothstep(0.3, 0.7, activeSample.g) * u_text_enabled;',
    '  float effectiveFill = mix(fillMask, 1.0 - fillMask, u_invert);',
    '  float letterAlpha = max(effectiveFill, outlineMask);',
    '  vec3  cosCol  = cosinePalette(localUV.x, u_a, u_b, u_c, u_d);',
    '  float t01     = clamp(localUV.x * 3.0, 0.0, 1.0);',
    '  float t12     = clamp((localUV.x - 1.0/3.0) * 3.0, 0.0, 1.0);',
    '  float t23     = clamp((localUV.x - 2.0/3.0) * 3.0, 0.0, 1.0);',
    '  vec3  seg01   = mix(u_color0, u_color1, t01);',
    '  vec3  seg12   = mix(u_color1, u_color2, t12);',
    '  vec3  seg23   = mix(u_color2, u_color3, t23);',
    '  vec3  gradCol = mix(mix(seg01, seg12, step(1.0/3.0, localUV.x)), seg23, step(2.0/3.0, localUV.x));',
    '  // u_color_mode: 0=flat, 1=4-stop, 2=cosine',
    '  vec3  fillCol = mix(mix(u_text_color, gradCol, step(0.5, u_color_mode)), cosCol, step(1.5, u_color_mode));',
    '  vec3  letterColor = mix(fillCol, u_outline_color, outlineMask);',
    '',
    '  // ── Outer border ──────────────────────────────────────────────────────────',
    '  float edgeX    = min(gridUV.x, 1.0 - gridUV.x);',
    '  float edgeY    = min(gridUV.y, 1.0 - gridUV.y) / GRID_ASPECT;',
    '  float edgeDist = min(edgeX, edgeY);',
    '  float outerB   = u_outer_border * (1.0 - smoothstep(bw*2.0-aa, bw*2.0+aa, edgeDist));',
    '',
    '  // ── Composite ─────────────────────────────────────────────────────────────',
    '  float activeBorder = isBorder * (1.0 - u_invert);',
    '  float activeOuterB = outerB   * (1.0 - u_invert);',
    '  vec3  finalColor = mix(mix(vec3(0.0), letterColor, letterAlpha), u_border_color, activeBorder);',
    '  finalColor = mix(finalColor, u_border_color, activeOuterB);',
    '  float alpha = max(max(activeBorder, activeOuterB), letterAlpha);',
    '',
    '  // ── Distress + finish ─────────────────────────────────────────────────────',
    '  float dn = distressNoise(gridUV, u_distress_scale) * 0.67',
    '           + distressNoise(gridUV, u_distress_scale * 2.73) * 0.33;',
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

      for (var i = 0; i < 11; i++) {
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
        gridAspect:   gl.getUniformLocation(program, 'u_grid_aspect'),
        palA:         gl.getUniformLocation(program, 'u_a'),
        palB:         gl.getUniformLocation(program, 'u_b'),
        palC:         gl.getUniformLocation(program, 'u_c'),
        palD:         gl.getUniformLocation(program, 'u_d'),
        textColor:    gl.getUniformLocation(program, 'u_text_color'),
        colorMode:    gl.getUniformLocation(program, 'u_color_mode'),
        color0:       gl.getUniformLocation(program, 'u_color0'),
        color1:       gl.getUniformLocation(program, 'u_color1'),
        color2:       gl.getUniformLocation(program, 'u_color2'),
        color3:       gl.getUniformLocation(program, 'u_color3'),
        tex1:         gl.getUniformLocation(program, 'u_tex1'),
        tex2:         gl.getUniformLocation(program, 'u_tex2'),
        tex3:         gl.getUniformLocation(program, 'u_tex3'),
        tex4:         gl.getUniformLocation(program, 'u_tex4'),
        tex5:         gl.getUniformLocation(program, 'u_tex5'),
        tex6:         gl.getUniformLocation(program, 'u_tex6'),
        tex7:         gl.getUniformLocation(program, 'u_tex7'),
        tex8:         gl.getUniformLocation(program, 'u_tex8'),
        tex9:         gl.getUniformLocation(program, 'u_tex9'),
        tex10:        gl.getUniformLocation(program, 'u_tex10'),
        tex11:        gl.getUniformLocation(program, 'u_tex11'),
        invert:        gl.getUniformLocation(program, 'u_invert'),
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
      var fontFamily     = v.u_font_family  || 'Barlow Condensed';
      var fontSize       = v.u_font_size    != null ? v.u_font_size    : 300;
      var textEnabled    = 1.0;
      var outlineEnabled = v.outlineEnabled ? true : false;
      var outlineWidth   = v.outlineWidth   != null ? v.outlineWidth   : 12;
      var borderWidth    = (v.u_border_width != null ? v.u_border_width : 10) / 1000;
      var borderColor    = v.u_border_color || [1.0, 1.0, 1.0];
      var outerBorder    = v.u_outer_border != null ? v.u_outer_border : 0.0;
      var outlineColor   = v.u_outline_color || [0.0, 0.0, 0.0];
      var palA           = v.u_a             || [0.5, 0.5, 0.5];
      var palB           = v.u_b             || [0.5, 0.5, 0.5];
      var palC           = v.u_c             || [1.0, 1.0, 1.0];
      var palD           = v.u_d             || [0.0, 0.33, 0.67];
      var aspect         = h > 0 ? w / h : 1.0;
      var GRID_ASPECT    = v.u_grid_aspect != null ? v.u_grid_aspect : 0.8;

      var letters     = word.slice(0, 11).split('').filter(Boolean);
      var letterCount = Math.max(1, letters.length);

      var texUnits    = [
        gl.TEXTURE0, gl.TEXTURE1, gl.TEXTURE2, gl.TEXTURE3, gl.TEXTURE4,
        gl.TEXTURE5, gl.TEXTURE6, gl.TEXTURE7, gl.TEXTURE8, gl.TEXTURE9, gl.TEXTURE10,
      ];
      var texUniforms = [u.tex1, u.tex2, u.tex3, u.tex4, u.tex5, u.tex6, u.tex7, u.tex8, u.tex9, u.tex10, u.tex11];

      var perLetterSize = v.perLetterSizeEnabled ? true : false;
      var perLetterSizes = [
        perLetterSize && v.u_font_size_1  != null ? v.u_font_size_1  : fontSize,
        perLetterSize && v.u_font_size_2  != null ? v.u_font_size_2  : fontSize,
        perLetterSize && v.u_font_size_3  != null ? v.u_font_size_3  : fontSize,
        perLetterSize && v.u_font_size_4  != null ? v.u_font_size_4  : fontSize,
        perLetterSize && v.u_font_size_5  != null ? v.u_font_size_5  : fontSize,
        perLetterSize && v.u_font_size_6  != null ? v.u_font_size_6  : fontSize,
        perLetterSize && v.u_font_size_7  != null ? v.u_font_size_7  : fontSize,
        perLetterSize && v.u_font_size_8  != null ? v.u_font_size_8  : fontSize,
        perLetterSize && v.u_font_size_9  != null ? v.u_font_size_9  : fontSize,
        perLetterSize && v.u_font_size_10 != null ? v.u_font_size_10 : fontSize,
        perLetterSize && v.u_font_size_11 != null ? v.u_font_size_11 : fontSize,
      ];

      for (var i = 0; i < 11; i++) {
        var letter    = textEnabled ? (letters[i] || '') : '';
        var letterSz  = perLetterSizes[i];
        var ca        = getCellCa(i + 1, letterCount, GRID_ASPECT);
        var key       = letter + '|' + fontFamily + '|' + letterSz + '|' + outlineEnabled + '|' + outlineWidth + '|' + letterCount + '|' + ca;
        if (key !== u._lastLetterKeys[i]) {
          drawLetter(u._texCtxs[i], letter, fontFamily, letterSz, outlineEnabled, outlineWidth, ca);
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
      gl.uniform1f(u.gridAspect,   GRID_ASPECT);
      gl.uniform3fv(u.outlineColor, outlineColor);
      gl.uniform1f(u.textEnabled,  textEnabled);
      gl.uniform3fv(u.palA,        palA);
      gl.uniform3fv(u.palB,        palB);
      gl.uniform3fv(u.palC,        palC);
      gl.uniform3fv(u.palD,        palD);
      var colorMode = v.u_color_mode != null ? parseFloat(v.u_color_mode) : 0.0;
      gl.uniform1f(u.colorMode,  colorMode);
      gl.uniform3fv(u.textColor, v.u_text_color || [1.0, 1.0, 1.0]);
      gl.uniform3fv(u.color0,    v.u_color0     || [1.0, 0.2, 0.4]);
      gl.uniform3fv(u.color1,    v.u_color1     || [1.0, 0.8, 0.0]);
      gl.uniform3fv(u.color2,    v.u_color2     || [0.0, 0.8, 1.0]);
      gl.uniform3fv(u.color3,    v.u_color3     || [0.67, 0.0, 1.0]);
      gl.uniform1f(u.invert,        v.u_invert ? 1.0 : 0.0);
      gl.uniform1f(u.opacity,       v.u_opacity        != null ? v.u_opacity        : 1.0);
      gl.uniform1f(u.distress,      v.u_distress       != null ? v.u_distress       : 0.0);
      gl.uniform1f(u.distressScale, v.u_distress_scale != null ? v.u_distress_scale : 80.0);
    },
  });
}());
