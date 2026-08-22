(function () {
  'use strict';

  // ThreeSquare port — faithful to the Three.js TSL original
  // Columns-in-squares shader with optional per-square letter masking,
  // cosine palette, and 4-stop gradient color modes.

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
      // Outline pass — pure green channel, drawn before fill.
      if (outlineEnabled && outlineWidth > 0) {
        ctx.strokeStyle = 'rgb(0,255,0)';
        ctx.lineWidth   = outlineWidth * 2;
        ctx.lineJoin    = 'round';
        ctx.strokeText(letter, CANVAS_SIZE / 2, y);
      }
      // Fill pass — pure red channel.
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
    'uniform float     u_square_size;',
    'uniform float     u_offset;',
    'uniform float     u_density;',
    'uniform float     u_col_width;',
    'uniform float     u_col_width_wide;',
    'uniform float     u_global_gradient;',
    'uniform float     u_square_count;',
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
    'uniform float     u_grain_mode;',
    'uniform float     u_distress_falloff;',
    'uniform float     u_pos_x;',
    'uniform float     u_pos_y;',
    'uniform float     u_scale;',
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
    'float sdBox2d(vec2 p, float s) {',
    '  return max(abs(p.x), abs(p.y)) - s;',
    '}',
    '',
    '// Compute one square layer: vertical columns masked by a letter texture.',
    '// Uniforms u_col_width, u_col_width_wide, u_density, u_square_size,',
    '// u_global_gradient, u_a/b/c/d, u_color_mode, u_color0-3, u_outline_color',
    '// are read directly as globals.',
    'void colLayer(',
    '  vec2 p, vec2 center,',
    '  sampler2D letterTex,',
    '  float globalPalT,',
    '  float layer,',
    '  out float outAlpha, out vec3 outCol',
    ') {',
    '  vec2  localUV       = (p - center + u_square_size) / (u_square_size * 2.0);',
    '  float scaledX       = localUV.x * u_density;',
    '  float cellX         = fract(scaledX) - 0.5;',
    '',
    '  vec4  texSample     = texture(letterTex, localUV);',
    '  float fillSample    = smoothstep(0.3, 0.7, texSample.r);',
    '  float outlineSample = smoothstep(0.3, 0.7, texSample.g);',
    '',
    '  float effWidth  = mix(u_col_width, u_col_width_wide, fillSample);',
    '  float colInside = 1.0 - step(0.0, abs(cellX) - effWidth);',
    '',
    '  float palT      = mix(localUV.x, globalPalT, u_global_gradient);',
    '',
    '  // Cosine palette',
    '  vec3 cosineCol = cosinePalette(palT, u_a, u_b, u_c, u_d);',
    '',
    '  // 4-stop linear gradient',
    '  float t01   = clamp(palT * 3.0, 0.0, 1.0);',
    '  float t12   = clamp((palT - 1.0 / 3.0) * 3.0, 0.0, 1.0);',
    '  float t23   = clamp((palT - 2.0 / 3.0) * 3.0, 0.0, 1.0);',
    '  vec3  lch0  = oklab_to_oklch(linear_rgb_to_oklab(u_color0));',
    '  vec3  lch1  = oklab_to_oklch(linear_rgb_to_oklab(u_color1));',
    '  vec3  lch2  = oklab_to_oklch(linear_rgb_to_oklab(u_color2));',
    '  vec3  lch3  = oklab_to_oklch(linear_rgb_to_oklab(u_color3));',
    '  vec3  seg01 = mix_oklch(lch0, lch1, t01);',
    '  vec3  seg12 = mix_oklch(lch1, lch2, t12);',
    '  vec3  seg23 = mix_oklch(lch2, lch3, t23);',
    '  vec3  blendedLch = mix(mix(seg01, seg12, step(1.0 / 3.0, palT)), seg23, step(2.0 / 3.0, palT));',
    '  vec3  gradCol = clamp(oklab_to_linear_rgb(oklch_to_oklab(blendedLch)), 0.0, 1.0);',
    '',
    '  vec3 col = mix(cosineCol, gradCol, u_color_mode);',
    '  // effWidth = mix(u_col_width, u_col_width_wide, fillSample), so fillSample',
    '  // is this column\'s normalized width: 0 = narrow field, 1 = inside a letter.',
    '  // The column is the element. floor(scaledX) is its index within this',
    '  // square, offset by the layer so the same column of two squares is two',
    '  // elements rather than one shared print roll. Every operand is highp: the',
    '  // layer offset alone reaches 3072, past where a mediump float still counts',
    '  // in ones, and declaring only the result highp converts a value that has',
    '  // already lost precision.',
    '  highp float colIndex = floor(scaledX);',
    '  highp float colLayer = layer;',
    '  highp float colId    = colLayer * 1024.0 + colIndex;',
    '  // One size for the whole column, sampled at its centre. colId is x-only,',
    '  // so a per-fragment fillSample made one column report two sizes and draw',
    '  // two cohort colours down its own length. effWidth above stays',
    '  // per-fragment — that is the geometry, and the column really does change',
    '  // width where it crosses the glyph.',
    '  float colCentreX = (colIndex + 0.5) / max(u_density, 1.0);',
    '  float colFill    = smoothstep(0.3, 0.7, texture(letterTex, vec2(colCentreX, 0.5)).r);',
    '  col = applyPaletteGroups(col, colFill, colId);',
    '',
    '  // Outline overlaid on top of columns.',
    '  outCol   = mix(col, u_outline_color, outlineSample);',
    '  outAlpha = min(colInside + outlineSample, 1.0);',
    '}',
    '',
    '// Evaluates the design color + alpha at any uv (post pos/scale transform).',
    'vec4 designEval(vec2 uv) {',
    '  vec2 centered = uv - 0.5;',
    '  vec2 p        = vec2(centered.x * u_aspect, centered.y);',
    '',
    '  // Square center positions: cx_i = (i - (n-1)/2) * offset, cy_i = -cx_i.',
    '  float halfN = (u_square_count - 1.0) * 0.5;',
    '  float c1x   = (0.0 - halfN) * u_offset;',
    '  float c2x   = (1.0 - halfN) * u_offset;',
    '  float c3x   = (2.0 - halfN) * u_offset;',
    '  float c4x   = (3.0 - halfN) * u_offset;',
    '  vec2  c1    = vec2(c1x, -c1x);',
    '  vec2  c2    = vec2(c2x, -c2x);',
    '  vec2  c3    = vec2(c3x, -c3x);',
    '  vec2  c4    = vec2(c4x, -c4x);',
    '',
    '  float sqMask1 = 1.0 - step(0.0, sdBox2d(p - c1, u_square_size));',
    '  float sqMask2 = 1.0 - step(0.0, sdBox2d(p - c2, u_square_size));',
    '  float sqMask3 = (1.0 - step(0.0, sdBox2d(p - c3, u_square_size))) * step(2.5, u_square_count);',
    '  float sqMask4 = (1.0 - step(0.0, sdBox2d(p - c4, u_square_size))) * step(3.5, u_square_count);',
    '',
    '  // Global gradient: left edge of c1 to right edge of outermost square.',
    '  float outerCX          = halfN * u_offset;',
    '  float gradientHalfWidth = outerCX + u_square_size;',
    '  float globalPalT       = (p.x + gradientHalfWidth) / max(gradientHalfWidth * 2.0, 0.001);',
    '',
    '  float a1; vec3 col1;',
    '  float a2; vec3 col2;',
    '  float a3; vec3 col3;',
    '  float a4; vec3 col4;',
    '  colLayer(p, c1, u_tex1, globalPalT, 0.0, a1, col1);',
    '  colLayer(p, c2, u_tex2, globalPalT, 1.0, a2, col2);',
    '  colLayer(p, c3, u_tex3, globalPalT, 2.0, a3, col3);',
    '  colLayer(p, c4, u_tex4, globalPalT, 3.0, a4, col4);',
    '',
    '  vec3  finalColor = vec3(0.0);',
    '  float finalAlpha = 0.0;',
    '',
    '  float sq1 = a1 * sqMask1;',
    '  finalColor = mix(finalColor, col1, sq1);',
    '  finalAlpha = mix(finalAlpha, 1.0, sq1);',
    '',
    '  float sq2 = a2 * sqMask2;',
    '  finalColor = mix(finalColor, col2, sq2);',
    '  finalAlpha = mix(finalAlpha, 1.0, sq2);',
    '',
    '  float sq3 = a3 * sqMask3;',
    '  finalColor = mix(finalColor, col3, sq3);',
    '  finalAlpha = mix(finalAlpha, 1.0, sq3);',
    '',
    '  float sq4 = a4 * sqMask4;',
    '  finalColor = mix(finalColor, col4, sq4);',
    '  finalAlpha = mix(finalAlpha, 1.0, sq4);',
    '',
    '  return vec4(finalColor, finalAlpha);',
    '}',
    '',
    'void main() {',
    '  vec2 uv = gl_FragCoord.xy / u_resolution;',
    '  uv = (uv - 0.5) / u_scale + 0.5 + vec2(u_pos_x, u_pos_y);',
    '  vec4 px = designEval(uv);',
    '  vec3 finalColor = px.rgb;',
    '  vec2 dUV = gl_FragCoord.xy / u_resolution;',
    '  float vigMask = computeVigMask(dUV);',
    '  float alpha;',
    '  if (u_grain_mode >= 3.5) {',
    '    // Half-tone: size each dot by design coverage over its cell (3x3',
    '    // supersample) so dots shrink toward square/letter edges instead of slicing.',
    '    vec2 cellFrag  = halftoneCellCenter(u_distress_scale);',
    '    float cellSize = max(2.0, u_distress_scale / 10.0);',
    '    float covSum = 0.0;',
    '    vec3  inkSum = vec3(0.0);',
    '    for (int i = -1; i <= 1; i++) {',
    '      for (int j = -1; j <= 1; j++) {',
    '        vec2 sFrag = cellFrag + vec2(float(i), float(j)) * (cellSize / 3.0);',
    '        vec2 sUV   = (sFrag / u_resolution - 0.5) / u_scale + 0.5 + vec2(u_pos_x, u_pos_y);',
    '        vec4 smp   = designEval(sUV);',
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
    instantKeys:    ['u_square_count', 'u_density', 'u_letters_enabled', 'u_opacity', 'u_distress_0', 'u_distress_scale_0', 'u_distress_1', 'u_distress_scale_1', 'u_distress_2', 'u_distress_scale_2', 'u_distress_3', 'u_distress_scale_3', 'u_grain_mode', 'u_halftone_shape', 'u_distress_falloff', 'u_vignette_top', 'u_vignette_bottom', 'u_vignette_left', 'u_vignette_right', 'u_vignette_anchor_x', 'u_vignette_anchor_y'],
    fragSrc: fragSrc,

    setup: function (gl, program) {
      // Create 4 letter canvases/textures managed outside ShaderBase's text system.
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
        squareSize:   gl.getUniformLocation(program, 'u_square_size'),
        offset:       gl.getUniformLocation(program, 'u_offset'),
        density:      gl.getUniformLocation(program, 'u_density'),
        colWidth:     gl.getUniformLocation(program, 'u_col_width'),
        colWidthWide: gl.getUniformLocation(program, 'u_col_width_wide'),
        globalGrad:   gl.getUniformLocation(program, 'u_global_gradient'),
        squareCount:  gl.getUniformLocation(program, 'u_square_count'),
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
        distress:        gl.getUniformLocation(program, 'u_distress'),
        distressScale:   gl.getUniformLocation(program, 'u_distress_scale'),
        grainMode:       gl.getUniformLocation(program, 'u_grain_mode'),
        distressFalloff: gl.getUniformLocation(program, 'u_distress_falloff'),
        halftoneAngle:   gl.getUniformLocation(program, 'u_halftone_angle'),
        halftoneLuma:    gl.getUniformLocation(program, 'u_halftone_luma'),
        halftoneShape:   gl.getUniformLocation(program, 'u_halftone_shape'),
        posX:            gl.getUniformLocation(program, 'u_pos_x'),
        posY:          gl.getUniformLocation(program, 'u_pos_y'),
        scale:         gl.getUniformLocation(program, 'u_scale'),
        vignetteTop:    gl.getUniformLocation(program, 'u_vignette_top'),
        vignetteBottom: gl.getUniformLocation(program, 'u_vignette_bottom'),
        vignetteLeft:   gl.getUniformLocation(program, 'u_vignette_left'),
        vignetteRight:  gl.getUniformLocation(program, 'u_vignette_right'),
        vignetteAnchorX:     gl.getUniformLocation(program, 'u_vignette_anchor_x'),
        vignetteAnchorY:     gl.getUniformLocation(program, 'u_vignette_anchor_y'),
        // Internal letter-texture state (not uniform locations).
        _texCanvases:    texCanvases,
        _texCtxs:        texCtxs,
        _glTextures:     glTextures,
        _lastLetterKeys: lastLetterKeys,
      };
    },

    render: function (gl, u, v, w, h) {
      var squareCount  = v.u_square_count     != null ? v.u_square_count     : 3;
      var fill         = v.u_fill             != null ? v.u_fill             : 0.85;
      var offset       = v.u_offset           != null ? v.u_offset           : 0.2;
      var density      = v.u_density          != null ? v.u_density          : 10;
      var colWidth     = v.u_col_width        != null ? v.u_col_width        : 0.35;
      var colWidthWide = v.u_col_width_wide   != null ? v.u_col_width_wide   : 0.45;
      var globalGrad   = v.u_global_gradient  != null ? v.u_global_gradient  : 0.0;
      var outlineColor = v.u_outline_color    || [0.0, 0.0, 0.0];
      var palA         = v.u_a                || [0.5, 0.5, 0.5];
      var palB         = v.u_b                || [0.5, 0.5, 0.5];
      var palC         = v.u_c                || [1.0, 1.0, 1.0];
      var palD         = v.u_d                || [0.0, 0.33, 0.67];
      var colorMode    = v.u_color_mode       != null ? parseFloat(v.u_color_mode) : 0.0;
      var color0       = v.u_color0           || [1.0, 0.2,  0.4];
      var color1       = v.u_color1           || [1.0, 0.8,  0.0];
      var color2       = v.u_color2           || [0.0, 0.8,  1.0];
      var color3       = v.u_color3           || [0.667, 0.0, 1.0];
      var lettersEnabled = v.u_letters_enabled != null ? v.u_letters_enabled : 1;
      var letters      = [
        lettersEnabled ? (v.u_letter1 != null ? v.u_letter1 : 'A') : '',
        lettersEnabled ? (v.u_letter2 != null ? v.u_letter2 : 'B') : '',
        lettersEnabled ? (v.u_letter3 != null ? v.u_letter3 : 'C') : '',
        lettersEnabled ? (v.u_letter4 != null ? v.u_letter4 : 'D') : '',
      ];
      var fontFamily     = v.u_font_family     || 'Montserrat';
      var fontSize       = v.u_font_size       != null ? v.u_font_size       : 300;
      var outlineEnabled = v.outlineEnabled ? true : false;
      var outlineWidth   = v.outlineWidth   != null ? v.outlineWidth   : 12;

      // Derived: squareSize from count, offset, fill, and aspect.
      // The constraint must hold on both axes in p-space:
      //   Y range: [-0.5, 0.5]  →  squareSize ≤ 0.5 - outerCenter
      //   X range: [-0.5*aspect, 0.5*aspect]  →  squareSize ≤ 0.5*aspect - outerCenter
      // Use whichever axis is narrower (min), so squares stay in frame on portrait canvases.
      var aspect      = h > 0 ? w / h : 1.0;
      var halfWidth   = 0.5 * Math.min(1.0, aspect);
      var outerCenter = ((squareCount - 1) / 2) * offset;
      var squareSize  = Math.max(0.01, halfWidth - outerCenter) * fill;

      // Re-draw and re-upload any letter texture whose key changed.
      var texUnits    = [gl.TEXTURE0, gl.TEXTURE1, gl.TEXTURE2, gl.TEXTURE3];
      var texUniforms = [u.tex1, u.tex2, u.tex3, u.tex4];
      for (var i = 0; i < 4; i++) {
        var key = letters[i] + '|' + fontFamily + '|' + fontSize + '|' + outlineEnabled + '|' + outlineWidth;
        gl.activeTexture(texUnits[i]);
        if (key !== u._lastLetterKeys[i]) {
          drawLetter(u._texCtxs[i], letters[i], fontFamily, fontSize, outlineEnabled, outlineWidth);
          uploadTex(gl, u._glTextures[i], u._texCanvases[i]);
          u._lastLetterKeys[i] = key;
        }
        gl.bindTexture(gl.TEXTURE_2D, u._glTextures[i]);
        gl.uniform1i(texUniforms[i], i);
      }

      gl.uniform2f(u.res,          w, h);
      gl.uniform1f(u.aspect,       aspect);
      gl.uniform1f(u.squareSize,   squareSize);
      gl.uniform1f(u.offset,       offset);
      gl.uniform1f(u.density,      density);
      gl.uniform1f(u.colWidth,     colWidth);
      gl.uniform1f(u.colWidthWide, colWidthWide);
      gl.uniform1f(u.globalGrad,   globalGrad);
      gl.uniform1f(u.squareCount,  squareCount);
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
      var _gm = Math.round(v.u_grain_mode != null ? parseFloat(v.u_grain_mode) : 0);
      gl.uniform1f(u.distress,      v['u_distress_' + _gm]       != null ? v['u_distress_' + _gm]       : (v.u_distress       != null ? v.u_distress       : 0.0));
      gl.uniform1f(u.distressScale, v['u_distress_scale_' + _gm] != null ? v['u_distress_scale_' + _gm] : (v.u_distress_scale != null ? v.u_distress_scale : 80.0));
      gl.uniform1f(u.grainMode,        v.u_grain_mode       != null ? parseFloat(v.u_grain_mode) : 0.0);
      gl.uniform1f(u.distressFalloff,  v.u_distress_falloff != null ? v.u_distress_falloff : 0.0);
      gl.uniform1f(u.halftoneAngle, (v.u_halftone_angle != null ? v.u_halftone_angle : 45.0) * Math.PI / 180.0);
      gl.uniform1f(u.halftoneLuma,  v.u_halftone_luma  != null ? v.u_halftone_luma  : 0.0);
      gl.uniform1f(u.halftoneShape, v.u_halftone_shape != null ? parseFloat(v.u_halftone_shape) : 0.0);
      gl.uniform1f(u.posX,             v.u_pos_x            != null ? v.u_pos_x            : 0.0);
      gl.uniform1f(u.posY,         v.u_pos_y      != null ? v.u_pos_y      : 0.0);
      gl.uniform1f(u.scale,        v.u_scale      != null ? v.u_scale      : 1.0);
      gl.uniform1f(u.vignetteTop,    v.u_vignette_top    != null ? v.u_vignette_top    : 0.0);
      gl.uniform1f(u.vignetteBottom, v.u_vignette_bottom != null ? v.u_vignette_bottom : 0.0);
      gl.uniform1f(u.vignetteLeft,   v.u_vignette_left   != null ? v.u_vignette_left   : 0.0);
      gl.uniform1f(u.vignetteRight,  v.u_vignette_right  != null ? v.u_vignette_right  : 0.0);
      gl.uniform1f(u.vignetteAnchorX, v.u_vignette_anchor_x != null ? v.u_vignette_anchor_x : 0.5);
      gl.uniform1f(u.vignetteAnchorY, v.u_vignette_anchor_y != null ? v.u_vignette_anchor_y : 0.5);
    },
  });
}());
