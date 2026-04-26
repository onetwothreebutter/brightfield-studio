(function () {
  'use strict';

  // EchoText port — aspect-corrected text with ghost stamps, strip echo,
  // directional blur, and cosine / 4-stop palette.

  // Closure variables: computed in drawText(), consumed in render().
  var _palMin   = 0.0;
  var _palMax   = 1.0;
  var _stripUVH = 0.05;

  var fragSrc = [
    '#version 300 es',
    'precision mediump float;',
    '',
    'uniform vec2      u_resolution;',
    'uniform sampler2D u_text_texture;',
    'uniform float     u_aspect;',
    'uniform float     u_text_x;',
    'uniform float     u_text_y;',
    'uniform vec3      u_text_color;',
    'uniform vec3      u_outline_color;',
    '',
    '// Palette',
    'uniform float     u_color_mode;  // 0=flat, 1=4-stop, 2=cosine',
    'uniform vec3      u_a;',
    'uniform vec3      u_b;',
    'uniform vec3      u_c;',
    'uniform vec3      u_d;',
    'uniform vec3      u_color0;',
    'uniform vec3      u_color1;',
    'uniform vec3      u_color2;',
    'uniform vec3      u_color3;',
    'uniform float     u_snap_strips;',
    'uniform float     u_strip_uvh;',
    'uniform float     u_pal_min;',
    'uniform float     u_pal_max;',
    '',
    '// Directional blur',
    'uniform float     u_blur_angle;',
    'uniform float     u_blur_length;',
    'uniform float     u_blur_falloff;',
    'uniform float     u_blur_enabled;',
    'uniform float     u_opacity;',
    'uniform float     u_distress;',
    'uniform float     u_distress_scale;',
    'uniform float     u_pos_x;',
    'uniform float     u_pos_y;',
    'uniform float     u_scale;',
    'uniform float     u_vignette_top;',
    'uniform float     u_vignette_bottom;',
    'uniform float     u_vignette_left;',
    'uniform float     u_vignette_right;',
    '',
    window.ShaderBase.commonGLSL,
    '',
    'out vec4 fragColor;',
    '',
    'void main() {',
    '  vec2 uv = gl_FragCoord.xy / u_resolution;',
    '  uv = (uv - 0.5) / u_scale + 0.5 + vec2(u_pos_x, u_pos_y);',
    '',
    '  // Aspect-correct UV — maps square texture onto canvas without squishing.',
    '  vec2 anchor = vec2(u_text_x, u_text_y);',
    '  vec2 delta  = uv - anchor;',
    '  vec2 texUV  = vec2(delta.x * u_aspect, delta.y) + anchor;',
    '',
    '  // Directional blur: 8 samples along blur direction, max-weighted by falloff.',
    '  // Only sampled when blur is enabled — avoids 8× texture cost in the common (blur-off) path.',
    '  vec4  s0 = texture(u_text_texture, texUV);',
    '  float texR = s0.r;',
    '  float texG = s0.g;',
    '  if (u_blur_enabled > 0.5) {',
    '    vec2 dragDir = vec2(cos(u_blur_angle), sin(u_blur_angle)) * u_blur_length;',
    '    vec4 s1 = texture(u_text_texture, texUV + dragDir * (1.0 / 8.0));',
    '    vec4 s2 = texture(u_text_texture, texUV + dragDir * (2.0 / 8.0));',
    '    vec4 s3 = texture(u_text_texture, texUV + dragDir * (3.0 / 8.0));',
    '    vec4 s4 = texture(u_text_texture, texUV + dragDir * (4.0 / 8.0));',
    '    vec4 s5 = texture(u_text_texture, texUV + dragDir * (5.0 / 8.0));',
    '    vec4 s6 = texture(u_text_texture, texUV + dragDir * (6.0 / 8.0));',
    '    vec4 s7 = texture(u_text_texture, texUV + dragDir * (7.0 / 8.0));',
    '    float w1 = pow(u_blur_falloff, 1.0);',
    '    float w2 = pow(u_blur_falloff, 2.0);',
    '    float w3 = pow(u_blur_falloff, 3.0);',
    '    float w4 = pow(u_blur_falloff, 4.0);',
    '    float w5 = pow(u_blur_falloff, 5.0);',
    '    float w6 = pow(u_blur_falloff, 6.0);',
    '    float w7 = pow(u_blur_falloff, 7.0);',
    '    texR = max(s0.r, max(s1.r * w1, max(s2.r * w2, max(s3.r * w3,',
    '           max(s4.r * w4, max(s5.r * w5, max(s6.r * w6, s7.r * w7)))))));',
    '    texG = max(s0.g, max(s1.g * w1, max(s2.g * w2, max(s3.g * w3,',
    '           max(s4.g * w4, max(s5.g * w5, max(s6.g * w6, s7.g * w7)))))));',
    '  }',
    '',
    '  float fillAlpha    = smoothstep(0.05, 0.6, texR);',
    '  float outlineAlpha = smoothstep(0.05, 0.6, texG);',
    '',
    '  // Palette: normalize UV Y to content bounds, then compute color.',
    '  float palT      = clamp((uv.y - u_pal_min) / max(u_pal_max - u_pal_min, 0.001), 0.0, 1.0);',
    '  float snapT     = floor(palT / u_strip_uvh + 0.5) * u_strip_uvh;',
    '  float palTFinal = mix(palT, snapT, step(0.5, u_snap_strips));',
    '',
    '  vec3 cosineCol = cosinePalette(palTFinal, u_a, u_b, u_c, u_d);',
    '',
    '  float t01    = clamp(palTFinal * 3.0, 0.0, 1.0);',
    '  float t12    = clamp((palTFinal - 1.0 / 3.0) * 3.0, 0.0, 1.0);',
    '  float t23    = clamp((palTFinal - 2.0 / 3.0) * 3.0, 0.0, 1.0);',
    '  vec3  seg01  = mix(u_color0, u_color1, t01);',
    '  vec3  seg12  = mix(u_color1, u_color2, t12);',
    '  vec3  seg23  = mix(u_color2, u_color3, t23);',
    '  vec3  gradCol = mix(mix(seg01, seg12, step(1.0 / 3.0, palTFinal)), seg23, step(2.0 / 3.0, palTFinal));',
    '',
    '  // u_color_mode: 0=flat, 1=4-stop, 2=cosine',
    '  vec3 fillCol = mix(',
    '    mix(u_text_color, gradCol, step(0.5, u_color_mode)),',
    '    cosineCol,',
    '    step(1.5, u_color_mode)',
    '  );',
    '',
    '  vec3 color = vec3(0.0);',
    '  color = mix(color, u_outline_color, outlineAlpha);',
    '  color = mix(color, fillCol,         fillAlpha);',
    '',
    '  float inkAlpha = max(fillAlpha, outlineAlpha);',
    '  float alpha    = inkAlpha;',
    '  vec2 dUV = gl_FragCoord.xy / u_resolution;',
    '  float dist = clamp(length(dUV - 0.5) * 2.0, 0.0, 1.0);',
    '  float dn = 1.0;',
    '  if (u_distress > 0.0001) {',
    '    dn = distressNoise(dUV, u_distress_scale) * 0.67',
    '       + distressNoise(dUV, u_distress_scale * 2.73) * 0.33;',
    '  }',
    '  alpha = alpha * step(u_distress * dist, dn) * u_opacity;',
    '  vec2 vigCoord = dUV - 0.5;',
    '  float vigL = max(0.0, -vigCoord.x);',
    '  float vigR = max(0.0,  vigCoord.x);',
    '  float vigB = max(0.0, -vigCoord.y);',
    '  float vigT = max(0.0,  vigCoord.y);',
    '  float vigVal = vigL*vigL*u_vignette_left + vigR*vigR*u_vignette_right',
    '               + vigB*vigB*u_vignette_bottom + vigT*vigT*u_vignette_top;',
    '  alpha = alpha * (1.0 - smoothstep(0.0, 1.0, vigVal));',
    '  fragColor   = vec4(color, alpha);',
    '}'
  ].join('\n');

  window.ShaderBase.create({
    animateValues:  true,
    instantKeys:    ['u_opacity', 'u_distress', 'u_distress_scale', 'u_vignette_top', 'u_vignette_bottom', 'u_vignette_left', 'u_vignette_right'],
    fragSrc: fragSrc,

    setup: function (gl, program) {
      return {
        res:           gl.getUniformLocation(program, 'u_resolution'),
        textTex:       gl.getUniformLocation(program, 'u_text_texture'),
        aspect:        gl.getUniformLocation(program, 'u_aspect'),
        textX:         gl.getUniformLocation(program, 'u_text_x'),
        textY:         gl.getUniformLocation(program, 'u_text_y'),
textColor:     gl.getUniformLocation(program, 'u_text_color'),
        outlineColor:  gl.getUniformLocation(program, 'u_outline_color'),
        // Palette
        colorMode:     gl.getUniformLocation(program, 'u_color_mode'),
        palA:          gl.getUniformLocation(program, 'u_a'),
        palB:          gl.getUniformLocation(program, 'u_b'),
        palC:          gl.getUniformLocation(program, 'u_c'),
        palD:          gl.getUniformLocation(program, 'u_d'),
        color0:        gl.getUniformLocation(program, 'u_color0'),
        color1:        gl.getUniformLocation(program, 'u_color1'),
        color2:        gl.getUniformLocation(program, 'u_color2'),
        color3:        gl.getUniformLocation(program, 'u_color3'),
        snapStrips:    gl.getUniformLocation(program, 'u_snap_strips'),
        stripUVH:      gl.getUniformLocation(program, 'u_strip_uvh'),
        palMin:        gl.getUniformLocation(program, 'u_pal_min'),
        palMax:        gl.getUniformLocation(program, 'u_pal_max'),
        // Directional blur
        blurAngle:     gl.getUniformLocation(program, 'u_blur_angle'),
        blurLength:    gl.getUniformLocation(program, 'u_blur_length'),
        blurFalloff:   gl.getUniformLocation(program, 'u_blur_falloff'),
        blurEnabled:   gl.getUniformLocation(program, 'u_blur_enabled'),
        opacity:       gl.getUniformLocation(program, 'u_opacity'),
        distress:      gl.getUniformLocation(program, 'u_distress'),
        distressScale: gl.getUniformLocation(program, 'u_distress_scale'),
        posX:          gl.getUniformLocation(program, 'u_pos_x'),
        posY:          gl.getUniformLocation(program, 'u_pos_y'),
        scale:         gl.getUniformLocation(program, 'u_scale'),
        vignetteTop:    gl.getUniformLocation(program, 'u_vignette_top'),
        vignetteBottom: gl.getUniformLocation(program, 'u_vignette_bottom'),
        vignetteLeft:   gl.getUniformLocation(program, 'u_vignette_left'),
        vignetteRight:  gl.getUniformLocation(program, 'u_vignette_right'),
      };
    },

    render: function (gl, u, v, w, h, t, textTex) {
      var aspect      = (w > 0 && h > 0) ? w / h : 0.75;
      var colorMode   = v.u_color_mode != null ? parseFloat(v.u_color_mode) : 0.0;
      var palA        = v.u_a          || [0.5,   0.5,  0.5];
      var palB        = v.u_b          || [0.5,   0.5,  0.5];
      var palC        = v.u_c          || [1.0,   1.0,  1.0];
      var palD        = v.u_d          || [0.0,   0.33, 0.67];
      var color0      = v.u_color0     || [1.0,   0.2,  0.4];
      var color1      = v.u_color1     || [1.0,   0.8,  0.0];
      var color2      = v.u_color2     || [0.0,   0.8,  1.0];
      var color3      = v.u_color3     || [0.667, 0.0,  1.0];
      // u_blur_angle is stored as radians (toRadians: true in controls)
      var blurAngle   = v.u_blur_angle   != null ? v.u_blur_angle   : Math.PI;
      var blurLength  = v.u_blur_length  != null ? v.u_blur_length  : 0.08;
      var blurFalloff = v.u_blur_falloff != null ? v.u_blur_falloff : 0.6;
      var blurEnabled = (v.u_blur_enabled != null ? v.u_blur_enabled : 1) > 0.5 ? 1.0 : 0.0;

      gl.uniform2f(u.res,           w, h);
      gl.uniform1f(u.aspect,        aspect);
      gl.uniform1f(u.textX,         v.textX            != null ? v.textX            : 0.5);
      gl.uniform1f(u.textY,         v.textY            != null ? v.textY            : 0.5);
gl.uniform3fv(u.textColor,    v.u_text_color     || [1.0, 1.0, 1.0]);
      gl.uniform3fv(u.outlineColor, v.u_outline_color  || [0.0, 0.0, 0.0]);
      // Palette
      gl.uniform1f(u.colorMode,  colorMode);
      gl.uniform3fv(u.palA,      palA);
      gl.uniform3fv(u.palB,      palB);
      gl.uniform3fv(u.palC,      palC);
      gl.uniform3fv(u.palD,      palD);
      gl.uniform3fv(u.color0,    color0);
      gl.uniform3fv(u.color1,    color1);
      gl.uniform3fv(u.color2,    color2);
      gl.uniform3fv(u.color3,    color3);
      gl.uniform1f(u.snapStrips, v.u_snap_strips != null ? v.u_snap_strips : 0.0);
      gl.uniform1f(u.stripUVH,   _stripUVH);
      gl.uniform1f(u.palMin,     _palMin);
      gl.uniform1f(u.palMax,     _palMax);
      // Blur
      gl.uniform1f(u.blurAngle,   blurAngle);
      gl.uniform1f(u.blurLength,  blurLength);
      gl.uniform1f(u.blurFalloff, blurFalloff);
      gl.uniform1f(u.blurEnabled,   blurEnabled);
      gl.uniform1f(u.opacity,       v.u_opacity        != null ? v.u_opacity        : 1.0);
      gl.uniform1f(u.distress,      v.u_distress       != null ? v.u_distress       : 0.0);
      gl.uniform1f(u.distressScale, v.u_distress_scale != null ? v.u_distress_scale : 80.0);
      gl.uniform1f(u.posX,         v.u_pos_x      != null ? v.u_pos_x      : 0.0);
      gl.uniform1f(u.posY,         v.u_pos_y      != null ? v.u_pos_y      : 0.0);
      gl.uniform1f(u.scale,        v.u_scale      != null ? v.u_scale      : 1.0);
      gl.uniform1f(u.vignetteTop,    v.u_vignette_top    != null ? v.u_vignette_top    : 0.0);
      gl.uniform1f(u.vignetteBottom, v.u_vignette_bottom != null ? v.u_vignette_bottom : 0.0);
      gl.uniform1f(u.vignetteLeft,   v.u_vignette_left   != null ? v.u_vignette_left   : 0.0);
      gl.uniform1f(u.vignetteRight,  v.u_vignette_right  != null ? v.u_vignette_right  : 0.0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, textTex);
      gl.uniform1i(u.textTex, 0);
    },

    drawText: function (ctx, size, v, w, h) {
      var text           = v.text              || '';
      var fontFamily     = v.textFont          || 'Montserrat';
      var fontSize       = v.textFontSize      != null ? v.textFontSize      : 180;
var tx             = v.textX             != null ? v.textX             : 0.5;
      var ty             = v.textY             != null ? v.textY             : 0.32;
      var outlineEnabled = (v.u_outline_enabled != null ? v.u_outline_enabled : 0) > 0.5;
      var outlineWidth   = v.u_outline_width   != null ? v.u_outline_width   : 8;
      var repeatStrip    = (v.u_repeat_strip   != null ? v.u_repeat_strip    : 1) > 0.5;
      var stripFraction  = v.u_strip_fraction  != null ? v.u_strip_fraction  : 0.2;
      var stripSample    = v.u_strip_sample    != null ? v.u_strip_sample    : 0.0;
      var repeatCount    = v.u_repeat_count    != null ? v.u_repeat_count    : 10;
      var stripGap       = v.u_strip_gap       != null ? v.u_strip_gap       : 0;
      var solidEnabled   = (v.u_solid_enabled  != null ? v.u_solid_enabled   : 1) > 0.5;
      var solidHeight    = v.u_solid_height    != null ? v.u_solid_height    : 200;
      var solidSample    = v.u_solid_sample    != null ? v.u_solid_sample    : 0.2;
      var sectionGap     = v.u_section_gap     != null ? v.u_section_gap     : 0;
      var dragEnabled    = (v.u_drag_enabled   != null ? v.u_drag_enabled    : 1) > 0.5;
      var dragAngle      = v.u_drag_angle      != null ? v.u_drag_angle      : 180;
      var dragDistance   = v.u_drag_distance   != null ? v.u_drag_distance   : 120;
      var dragSteps      = v.u_drag_steps      != null ? v.u_drag_steps      : 8;
      var dragDecay      = v.u_drag_decay      != null ? v.u_drag_decay      : 0.7;

      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, size, size);

      if (!text) return;

      // Flip Y: textY is a UV coord (0=bottom), canvas Y increases downward.
      var cx  = tx * size;
      var cy  = (1 - ty) * size;
      ctx.font         = 'bold ' + fontSize + 'px "' + fontFamily + '", monospace';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';

      var metrics = ctx.measureText(text);
      var ascent  = metrics.actualBoundingBoxAscent;
      var descent = metrics.actualBoundingBoxDescent;
      var textH   = ascent + descent;

      // Draw main text.
      ctx.save();
      ctx.translate(cx, cy);
      if (outlineEnabled && outlineWidth > 0) {
        ctx.strokeStyle = 'rgb(0,255,0)';
        ctx.lineWidth   = outlineWidth * 2;
        ctx.lineJoin    = 'round';
        ctx.strokeText(text, 0, 0);
      }
      ctx.fillStyle = 'rgb(255,0,0)';
      ctx.fillText(text, 0, 0);
      ctx.restore();

      // Ghost stamps (canvas-side drag effect).
      if (dragEnabled && dragSteps > 0 && dragDistance > 0) {
        var dragRad = (dragAngle * Math.PI) / 180;
        var dx = Math.cos(dragRad) * dragDistance / dragSteps;
        var dy = Math.sin(dragRad) * dragDistance / dragSteps;

        for (var i = 1; i <= dragSteps; i++) {
          var alpha = Math.pow(dragDecay, i);
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.font = 'bold ' + fontSize + 'px "' + fontFamily + '", monospace';
          ctx.textAlign    = 'center';
          ctx.textBaseline = 'middle';
          ctx.translate(cx + dx * i, cy + dy * i);
          if (outlineEnabled && outlineWidth > 0) {
            ctx.strokeStyle = 'rgb(0,255,0)';
            ctx.lineWidth   = outlineWidth * 2;
            ctx.lineJoin    = 'round';
            ctx.strokeText(text, 0, 0);
          }
          ctx.fillStyle = 'rgb(255,0,0)';
          ctx.fillText(text, 0, 0);
          ctx.restore();
        }
      }

      var textTopY = Math.round(cy - ascent);
      var stripH   = Math.max(1, Math.round(textH * stripFraction));

      // Strip repeat: copy a slice from the text bounding box upward.
      if (repeatStrip && textH > 0) {
        var stripSampleY = Math.round(textTopY + textH * stripSample);
        var strip = ctx.getImageData(0, stripSampleY, size, stripH);
        for (var ri = 1; ri <= repeatCount; ri++) {
          ctx.putImageData(strip, 0, textTopY - ri * (stripH + stripGap));
        }
      }

      // Solid columns: dense single-row tiled above the echo strips.
      if (solidEnabled && textH > 0) {
        var solidRowH    = Math.max(1, Math.round(textH * 0.05));
        var solidCount   = Math.max(1, Math.round(solidHeight / solidRowH));
        var solidSampleY = Math.round(textTopY + textH * solidSample);
        var sourceRow    = ctx.getImageData(0, solidSampleY, size, 1);
        var totalH       = solidCount * solidRowH;
        var solidStartY  = repeatStrip
          ? textTopY - repeatCount * (stripH + stripGap) - stripH - sectionGap
          : textTopY - sectionGap;
        var filled = ctx.createImageData(size, totalH);
        for (var fi = 0; fi < totalH; fi++) {
          filled.data.set(sourceRow.data, fi * size * 4);
        }
        ctx.putImageData(filled, 0, solidStartY - totalH);
      }

      // Compute palette UV bounds so the gradient spans the full content height.
      var contentBottomCanvasY = cy + descent;
      var contentTopCanvasY;

      if (solidEnabled && textH > 0) {
        var solidRowH2   = Math.max(1, Math.round(textH * 0.05));
        var solidCount2  = Math.max(1, Math.round(solidHeight / solidRowH2));
        var solidStartY2 = repeatStrip
          ? textTopY - repeatCount * (stripH + stripGap) - stripH - sectionGap
          : textTopY - sectionGap;
        contentTopCanvasY = solidStartY2 - solidCount2 * solidRowH2;
        var contentH = contentBottomCanvasY - contentTopCanvasY;
        _stripUVH = contentH > 0 ? solidRowH2 / contentH : 0.05;
      } else if (repeatStrip && textH > 0) {
        contentTopCanvasY = textTopY - repeatCount * (stripH + stripGap);
        var contentH2 = contentBottomCanvasY - contentTopCanvasY;
        _stripUVH = contentH2 > 0 ? stripH / contentH2 : 0.05;
      } else {
        contentTopCanvasY = textTopY;
        _stripUVH = 0.05;
      }

      // Convert canvas Y (top=0) to UV Y (bottom=0) via 1 - canvasY/size.
      _palMin = 1 - contentBottomCanvasY / size;
      _palMax = 1 - contentTopCanvasY / size;
    },

    textKey: function (v) {
      return JSON.stringify([
        v.text, v.textFont, v.textFontSize, v.textX, v.textY,
        v.u_outline_enabled, v.u_outline_width,
        v.u_repeat_strip, v.u_strip_fraction, v.u_repeat_count, v.u_strip_gap,
        v.u_solid_enabled, v.u_solid_height, v.u_solid_sample, v.u_section_gap,
        v.u_strip_sample,
        v.u_drag_enabled, v.u_drag_angle, v.u_drag_distance, v.u_drag_steps, v.u_drag_decay,
      ]);
    },
  });
}());
