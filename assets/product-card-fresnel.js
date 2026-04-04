(function () {
  var vertSrc = [
    '#version 300 es',
    'in vec2 a_position;',
    'void main() {',
    '  gl_Position = vec4(a_position, 0.0, 1.0);',
    '}',
  ].join('\n');

  var fragSrc = [
    '#version 300 es',
    'precision mediump float;',
    '',
    'uniform sampler2D u_image;',
    'uniform vec2 u_resolution;',
    'uniform float u_opacity;',
    '',
    'out vec4 fragColor;',
    '',
    'bool isBackground(vec4 c) {',
    '  return c.r > 0.88 && c.g > 0.88 && c.b > 0.88;',
    '}',
    '',
    'void main() {',
    '  vec2 uv = gl_FragCoord.xy / u_resolution;',
    '  uv.y = 1.0 - uv.y;',
    '',
    '  vec4 texColor = texture(u_image, uv);',
    '',
    '  // Shirt pixel — transparent, let the <img> show through',
    '  if (!isBackground(texColor)) {',
    '    fragColor = vec4(0.0);',
    '    return;',
    '  }',
    '',
    '  // Background pixel — find distance to nearest shirt pixel',
    '  float glowRadius = 24.0;',
    '  float minDist = glowRadius;',
    '',
    '  for (int i = 0; i < 8; i++) {',
    '    float angle = float(i) * 0.7854;',
    '    for (float r = 2.0; r <= 24.0; r += 4.0) {',
    '      vec2 offset = vec2(cos(angle), -sin(angle)) * r / u_resolution;',
    '      if (!isBackground(texture(u_image, uv + offset))) {',
    '        minDist = min(minDist, r);',
    '        break;',
    '      }',
    '    }',
    '  }',
    '',
    '  if (minDist >= glowRadius) {',
    '    fragColor = vec4(0.0);',
    '    return;',
    '  }',
    '',
    '  float t = minDist / glowRadius;',
    '  float glow = pow(1.0 - t, 1.8);',
    '  vec3 color = mix(vec3(0.0, 1.0, 1.0), vec3(0.6, 0.0, 1.0), t);',
    '  fragColor = vec4(color * glow * 0.75, glow * u_opacity);',
    '}',
  ].join('\n');

  function compileShader(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  }

  function initCard(canvas, img) {
    var gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false });
    if (!gl) return null;

    var program = gl.createProgram();
    gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, vertSrc));
    gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, fragSrc));
    gl.linkProgram(program);
    gl.useProgram(program);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    var posLoc = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);

    var uRes = gl.getUniformLocation(program, 'u_resolution');
    var uOpacity = gl.getUniformLocation(program, 'u_opacity');
    var uImage = gl.getUniformLocation(program, 'u_image');

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(uImage, 0);

    var w = canvas.offsetWidth;
    var h = canvas.offsetHeight;
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
    gl.uniform2f(uRes, w, h);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    return { gl: gl, uOpacity: uOpacity };
  }

  document.addEventListener('DOMContentLoaded', function () {
    var cards = document.querySelectorAll('.product-card__media');

    cards.forEach(function (media) {
      var canvas = media.querySelector('.product-card__shader');
      var img = media.querySelector('.product-card__image');
      if (!canvas || !img || img.tagName !== 'IMG') return;

      var state = null; // lazy-init on first hover
      var opacity = 0;
      var target = 0;
      var rafId = null;

      function draw(ts) {
        var dt = 1 / 60;
        opacity += (target - opacity) * Math.min(dt * 16, 1); // ~250ms lerp

        state.gl.uniform1f(state.uOpacity, opacity);
        state.gl.drawArrays(state.gl.TRIANGLE_STRIP, 0, 4);

        if (Math.abs(opacity - target) > 0.005) {
          rafId = requestAnimationFrame(draw);
        } else {
          opacity = target;
          if (opacity === 0) {
            state.gl.uniform1f(state.uOpacity, 0);
            state.gl.drawArrays(state.gl.TRIANGLE_STRIP, 0, 4);
          }
          rafId = null;
        }
      }

      function startAnim() {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(draw);
      }

      function ensureInit(callback) {
        if (state) { callback(); return; }
        function doInit() {
          state = initCard(canvas, img);
          if (state) callback();
        }
        if (img.complete && img.naturalWidth > 0) {
          doInit();
        } else {
          img.addEventListener('load', doInit, { once: true });
        }
      }

      media.addEventListener('mouseenter', function () {
        target = 1;
        ensureInit(startAnim);
      });

      media.addEventListener('mouseleave', function () {
        target = 0;
        if (state) startAnim();
      });
    });
  });
})();
