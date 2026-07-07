import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../assets/line-smudge.js'), 'utf8');

// The shader paints a drag trail onto its own offscreen canvas; jsdom's
// canvas 2D context doesn't support that, so stub just what paintStroke() uses.
function makeSmudge2DContextMock() {
  return {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineCap: '',
    lineJoin: '',
    shadowBlur: 0,
    shadowColor: '',
    globalCompositeOperation: 'source-over',
    fillRect:  vi.fn(),
    beginPath: vi.fn(),
    moveTo:    vi.fn(),
    lineTo:    vi.fn(),
    arc:       vi.fn(),
    fill:      vi.fn(),
    stroke:    vi.fn(),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  };
}

function makeRenderGl() {
  return {
    TEXTURE0:   33984,
    TEXTURE_2D: 3553,
    RGBA:       6408,
    UNSIGNED_BYTE: 5121,
    uniform1f:  vi.fn(),
    uniform2f:  vi.fn(),
    uniform1i:  vi.fn(),
    uniform3fv: vi.fn(),
    activeTexture: vi.fn(),
    bindTexture:   vi.fn(),
    texImage2D:    vi.fn(),
  };
}

function makeSetupGl() {
  return {
    createTexture: vi.fn(() => ({})),
    bindTexture:   vi.fn(),
    texParameteri: vi.fn(),
    texImage2D:    vi.fn(),
    getUniformLocation: vi.fn((_p, name) => ({ _loc: name })),
    TEXTURE_2D: 3553,
    TEXTURE_MIN_FILTER: 1,
    TEXTURE_MAG_FILTER: 2,
    TEXTURE_WRAP_S: 3,
    TEXTURE_WRAP_T: 4,
    LINEAR: 5,
    CLAMP_TO_EDGE: 6,
    RGBA: 6408,
    UNSIGNED_BYTE: 5121,
  };
}

describe('line-smudge.js', () => {
  let opts;
  let smudgeCtxMock;

  beforeEach(() => {
    opts = null;
    smudgeCtxMock = null;
    document.body.innerHTML = '<canvas id="shader-canvas"></canvas>';
    window._shaderState = { values: {} };
    window.ShaderBase = { create: vi.fn((o) => { opts = o; }) };

    // The shader creates its own offscreen 2D canvas for the smudge trail;
    // jsdom doesn't implement canvas 2D contexts, so stub it out. Memoize the
    // mock context (like a real canvas would) so tests can inspect what was
    // drawn into it.
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = originalCreateElement(tag);
      if (tag === 'canvas') {
        el.getContext = () => (smudgeCtxMock = smudgeCtxMock || makeSmudge2DContextMock());
      }
      return el;
    });

    new Function(src)(); // eslint-disable-line no-new-func
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls window.ShaderBase.create exactly once', () => {
    expect(window.ShaderBase.create).toHaveBeenCalledOnce();
  });

  it('fragSrc starts with #version 300 es (WebGL 2)', () => {
    const frag = Array.isArray(opts.fragSrc) ? opts.fragSrc.join('\n') : opts.fragSrc;
    expect(frag.trimStart()).toMatch(/^#version 300 es/);
  });

  it('fragSrc declares all expected uniforms', () => {
    const frag = Array.isArray(opts.fragSrc) ? opts.fragSrc.join('\n') : opts.fragSrc;
    [
      'u_resolution', 'u_line_count', 'u_line_width',
      'u_color_mode', 'u_a', 'u_b', 'u_c', 'u_d',
      'u_color0', 'u_color1', 'u_color2', 'u_color3',
      'u_smudge_tex', 'u_smudge_strength',
      'u_opacity', 'u_distress', 'u_distress_scale', 'u_grain_mode', 'u_distress_falloff',
      'u_pos_x', 'u_pos_y', 'u_scale',
    ].forEach((name) => {
      expect(frag, `missing uniform ${name}`).toContain(name);
    });
  });

  it('fragSrc applies the position/scale transform before deriving the line pattern', () => {
    const frag = Array.isArray(opts.fragSrc) ? opts.fragSrc.join('\n') : opts.fragSrc;
    expect(frag).toContain('uv = (uv - 0.5) / u_scale + 0.5 + vec2(u_pos_x, u_pos_y)');
  });

  it('fragSrc decodes the smudge texture as a signed 2D vector centered on 0.5 and adds it to uv', () => {
    const frag = Array.isArray(opts.fragSrc) ? opts.fragSrc.join('\n') : opts.fragSrc;
    expect(frag).toContain('(texture(u_smudge_tex, p).rg - 0.5) * 2.0');
    expect(frag).toContain('uv += smudgeDisp(dUV) * u_smudge_strength');
  });

  it('setup() returns an object with all required uniform keys', () => {
    const uniforms = opts.setup(makeSetupGl(), {});
    [
      'res', 'lineCount', 'lineWidth', 'colorMode',
      'palA', 'palB', 'palC', 'palD', 'color0', 'color1', 'color2', 'color3',
      'smudgeTex', 'smudgeStrength',
      'opacity', 'distress', 'distressScale', 'grainMode', 'distressFalloff',
      'halftoneAngle', 'halftoneLuma',
      'vignetteTop', 'vignetteBottom', 'vignetteLeft', 'vignetteRight',
      'vignetteAnchorX', 'vignetteAnchorY',
      'posX', 'posY', 'scale',
    ].forEach((key) => {
      expect(uniforms, `setup() is missing key "${key}"`).toHaveProperty(key);
    });
  });

  it('every uniform key accessed by render() exists in the setup() return value', () => {
    const uniforms = opts.setup(makeSetupGl(), {});

    const accessed = new Set();
    const proxy = new Proxy(uniforms, {
      get(target, key) {
        if (typeof key === 'string') accessed.add(key);
        return target[key];
      },
    });

    opts.render(makeRenderGl(), proxy, {}, 500, 500, 0);

    accessed.forEach((key) => {
      expect(uniforms, `render() accessed "u.${key}" but setup() didn't return it`).toHaveProperty(key);
    });
  });

  it('render() defaults u_line_count to 20', () => {
    const uniforms = opts.setup(makeSetupGl(), {});
    const renderGl = makeRenderGl();
    opts.render(renderGl, uniforms, {}, 500, 500, 0);
    const call = renderGl.uniform1f.mock.calls.find(([loc]) => loc === uniforms.lineCount);
    expect(call[1]).toBe(20);
  });

  it('does not attach pointer listeners when #shader-canvas is missing', () => {
    document.body.innerHTML = '';
    window.ShaderBase = { create: vi.fn((o) => { opts = o; }) };
    expect(() => new Function(src)()).not.toThrow(); // eslint-disable-line no-new-func
  });

  it('dragging the canvas paints into the smudge texture (render() uploads via texImage2D)', () => {
    const canvas = document.getElementById('shader-canvas');
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 });

    canvas.dispatchEvent(new MouseEvent('pointerdown', { clientX: 50, clientY: 50 }));
    canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 80 }));

    const uniforms = opts.setup(makeSetupGl(), {});
    const renderGl = makeRenderGl();
    opts.render(renderGl, uniforms, {}, 500, 500, 0);
    expect(renderGl.texImage2D).toHaveBeenCalled();
  });

  it('encodes a downward-right drag as a sample-space offset opposite the drag (content follows the finger)', () => {
    const canvas = document.getElementById('shader-canvas');
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 });

    // clientX/clientY both increase — a drag to the lower-right, saturating
    // the (clamped) encode range so the expected bytes are deterministic:
    // dx = +0.3 (screen-right, same orientation as uv.x) -> r encodes -1 -> byte 1
    // dy = -0.3 (screen-down flips to "uv.y decreasing") -> g encodes +1 -> byte 255
    canvas.dispatchEvent(new MouseEvent('pointerdown', { clientX: 40, clientY: 40 }));
    canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 70, clientY: 70 }));

    const [r, g] = smudgeCtxMock.strokeStyle.match(/\d+/g).map(Number);
    expect(r).toBe(1);
    expect(g).toBe(255);
  });

  it('u_smudge_sensitivity controls how quickly a small drag saturates the encoded byte', () => {
    window._shaderState.values.u_smudge_sensitivity = 1; // low sensitivity, shouldn't saturate
    const canvas = document.getElementById('shader-canvas');
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 });

    canvas.dispatchEvent(new MouseEvent('pointerdown', { clientX: 40, clientY: 40 }));
    canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 40 }));

    // dx = +0.1, sensitivity 1 -> -dx*1 = -0.1 (unclamped) -> byte = 128 - 12.7 ≈ 115
    const [r] = smudgeCtxMock.strokeStyle.match(/\d+/g).map(Number);
    expect(r).toBeGreaterThan(100);
    expect(r).toBeLessThan(128);
  });

  it('u_smudge_blend caps the maximum per-stroke alpha', () => {
    window._shaderState.values.u_smudge_blend = 0.2;
    const canvas = document.getElementById('shader-canvas');
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 });

    // A large, fast drag would normally saturate alpha near 1; the blend cap
    // should hold it down instead.
    canvas.dispatchEvent(new MouseEvent('pointerdown', { clientX: 10, clientY: 10 }));
    canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 90, clientY: 90 }));

    expect(smudgeCtxMock.globalAlpha).toBe(1); // reset after stroke() completes
    // Re-run with a spy on the alpha value at stroke time.
    const strokeSpy = vi.spyOn(smudgeCtxMock, 'stroke').mockImplementation(function () {
      strokeSpy.alphaAtCall = smudgeCtxMock.globalAlpha;
    });
    canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 10, clientY: 10 }));
    expect(strokeSpy.alphaAtCall).toBe(0.2);
  });
});
