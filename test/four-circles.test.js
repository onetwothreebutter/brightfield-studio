import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { make2DContextMock } from './helpers/webgl-mock.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../assets/four-circles.js'), 'utf8');

// GL mock for setup() — only needs getUniformLocation
function makeSetupGl() {
  return {
    getUniformLocation: vi.fn((_p, name) => ({ _loc: name })),
  };
}

// GL mock for render()
function makeRenderGl() {
  return {
    TEXTURE0: 33984,
    TEXTURE_2D:    3553,
    uniform1f:    vi.fn(),
    uniform2f:    vi.fn(),
    uniform1i:    vi.fn(),
    uniform3fv:   vi.fn(),
    activeTexture: vi.fn(),
    bindTexture:   vi.fn(),
  };
}

describe('four-circles.js', () => {
  let opts;

  beforeEach(() => {
    opts = null;
    window.ShaderBase = { create: vi.fn((o) => { opts = o; }) };
    new Function(src)(); // eslint-disable-line no-new-func
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Integration with ShaderBase ──────────────────────────────────────────────

  it('calls window.ShaderBase.create exactly once', () => {
    expect(window.ShaderBase.create).toHaveBeenCalledOnce();
  });

  // ── fragSrc ──────────────────────────────────────────────────────────────────

  it('fragSrc starts with #version 300 es (WebGL 2)', () => {
    const frag = Array.isArray(opts.fragSrc) ? opts.fragSrc.join('\n') : opts.fragSrc;
    expect(frag.trimStart()).toMatch(/^#version 300 es/);
  });

  it('fragSrc declares all expected uniforms', () => {
    const frag = Array.isArray(opts.fragSrc) ? opts.fragSrc.join('\n') : opts.fragSrc;
    [
      'u_resolution', 'u_aspect',
      'u_circle_size', 'u_tri_size', 'u_tri_angle', 'u_tri_apex',
      'u_offset_x', 'u_offset_y',
      'u_rot1', 'u_rot2', 'u_rot3', 'u_rot4',
      'u_global_grad',
      'u_a', 'u_b', 'u_c', 'u_d',
      'u_color_mode', 'u_color0', 'u_color1', 'u_color2', 'u_color3',
      'u_quad0', 'u_quad1', 'u_quad2', 'u_quad3',
      'u_word_texture', 'u_word_x', 'u_word_y',
      'u_text_color', 'u_use_text_color', 'u_outline_color',
      'u_opacity', 'u_distress', 'u_distress_scale',
    ].forEach((name) => {
      expect(frag, `missing uniform ${name}`).toContain(name);
    });
  });

  it('fragSrc uses 3-way color blend: step(0.5) for cosine/4-stop, step(1.5) for per-quadrant', () => {
    const frag = Array.isArray(opts.fragSrc) ? opts.fragSrc.join('\n') : opts.fragSrc;
    expect(frag).toContain('step(0.5, u_color_mode)');
    expect(frag).toContain('step(1.5, u_color_mode)');
    expect(frag).toContain('perQuadCol');
  });

  it('fragSrc uses max(baseAlpha, wordAlpha) so word bleeds outside circle shapes', () => {
    const frag = Array.isArray(opts.fragSrc) ? opts.fragSrc.join('\n') : opts.fragSrc;
    expect(frag).toContain('baseAlpha');
    expect(frag).toContain('wordAlpha');
    expect(frag).toContain('max(baseAlpha, wordAlpha)');
  });

  it('fragSrc applies gamma encoding before output', () => {
    const frag = Array.isArray(opts.fragSrc) ? opts.fragSrc.join('\n') : opts.fragSrc;
    expect(frag).toContain('1.0 / 2.2');
  });

  // ── setup() ──────────────────────────────────────────────────────────────────

  it('setup() returns an object with all required uniform keys', () => {
    const gl = makeSetupGl();
    const uniforms = opts.setup(gl, {});
    [
      'res', 'aspect',
      'circleSize', 'triSize', 'triAngle', 'triApex',
      'offsetX', 'offsetY', 'rot1', 'rot2', 'rot3', 'rot4',
      'globalGrad',
      'palA', 'palB', 'palC', 'palD',
      'colorMode', 'color0', 'color1', 'color2', 'color3',
      'quad0', 'quad1', 'quad2', 'quad3',
      'wordTex', 'wordX', 'wordY', 'textColor', 'useTextColor', 'outlineColor',
      'opacity', 'distress', 'distressScale',
    ].forEach((key) => {
      expect(uniforms, `setup() is missing key "${key}"`).toHaveProperty(key);
    });
  });

  it('every uniform key accessed by render() exists in the setup() return value', () => {
    const setupGl = makeSetupGl();
    const uniforms = opts.setup(setupGl, {});

    const accessed = new Set();
    const proxy = new Proxy(uniforms, {
      get(target, key) {
        if (typeof key === 'string') accessed.add(key);
        return target[key];
      },
    });

    opts.render(makeRenderGl(), proxy, {}, 500, 500, 0, {});

    accessed.forEach((key) => {
      expect(uniforms, `render() accessed "u.${key}" but setup() didn't return it`).toHaveProperty(key);
    });
  });

  // ── render() ─────────────────────────────────────────────────────────────────

  it('render() uploads u_aspect as w/h ratio', () => {
    const uniforms = opts.setup(makeSetupGl(), {});
    const renderGl = makeRenderGl();
    opts.render(renderGl, uniforms, {}, 600, 400, 0, {});
    const call = renderGl.uniform1f.mock.calls.find(([loc]) => loc === uniforms.aspect);
    expect(call).toBeDefined();
    expect(call[1]).toBeCloseTo(1.5);
  });

  it('render() parses u_color_mode as float — handles string values from select element', () => {
    const uniforms = opts.setup(makeSetupGl(), {});
    const renderGl = makeRenderGl();
    opts.render(renderGl, uniforms, { u_color_mode: '2' }, 500, 500, 0, {});
    const call = renderGl.uniform1f.mock.calls.find(([loc]) => loc === uniforms.colorMode);
    expect(call).toBeDefined();
    expect(call[1]).toBe(2.0);
  });

  it('render() binds word texture to TEXTURE0', () => {
    const uniforms = opts.setup(makeSetupGl(), {});
    const renderGl = makeRenderGl();
    opts.render(renderGl, uniforms, {}, 500, 500, 0, {});

    const activeSlots = renderGl.activeTexture.mock.calls.map(([slot]) => slot);
    expect(activeSlots).toContain(renderGl.TEXTURE0);

    // Word texture sampler must be assigned to unit 0
    const wordTexCall = renderGl.uniform1i.mock.calls.find(([loc]) => loc === uniforms.wordTex);
    expect(wordTexCall).toBeDefined();
    expect(wordTexCall[1]).toBe(0);
  });

  it('render() defaults: colorMode=0, opacity=1, distress=0, distressScale=80', () => {
    const uniforms = opts.setup(makeSetupGl(), {});
    const renderGl = makeRenderGl();
    opts.render(renderGl, uniforms, {}, 500, 500, 0, {});

    function find1f(loc) {
      const call = renderGl.uniform1f.mock.calls.find(([l]) => l === loc);
      return call ? call[1] : undefined;
    }

    expect(find1f(uniforms.colorMode)).toBe(0);
    expect(find1f(uniforms.opacity)).toBeCloseTo(1.0);
    expect(find1f(uniforms.distress)).toBeCloseTo(0.0);
    expect(find1f(uniforms.distressScale)).toBeCloseTo(80.0);
  });

  it('render() sends per-quadrant defaults when u_quad0–3 are not provided', () => {
    const uniforms = opts.setup(makeSetupGl(), {});
    const renderGl = makeRenderGl();
    opts.render(renderGl, uniforms, {}, 500, 500, 0, {});

    function find3fv(loc) {
      const call = renderGl.uniform3fv.mock.calls.find(([l]) => l === loc);
      return call ? call[1] : undefined;
    }

    // Defaults defined in four-circles.js render()
    expect(find3fv(uniforms.quad0)).toEqual([1.0, 0.08, 0.58]);
    expect(find3fv(uniforms.quad1)).toEqual([0.0, 0.45, 1.0]);
    expect(find3fv(uniforms.quad2)).toEqual([0.0, 0.90, 0.40]);
    expect(find3fv(uniforms.quad3)).toEqual([1.0, 0.55, 0.0]);
  });

  // ── textKey() ────────────────────────────────────────────────────────────────

  it('textKey() serializes all word overlay state', () => {
    const v = {
      u_text_enabled: 1, text: 'GLOW', textX: 0.5, textY: 0.5,
      textFontSize: 200, textFont: 'Montserrat',
      outlineEnabled: 0, outlineWidth: 8, u_outline_color: '#000000',
    };
    expect(opts.textKey(v)).toBe(
      JSON.stringify([1, 'GLOW', 0.5, 0.5, 200, 'Montserrat', 0, 8, '#000000'])
    );
  });

  it('textKey() changes when u_text_enabled toggles', () => {
    const base = { u_text_enabled: 0, text: 'GLOW', textX: 0.5, textY: 0.5, textFontSize: 200, textFont: 'Montserrat' };
    expect(opts.textKey(base)).not.toBe(opts.textKey({ ...base, u_text_enabled: 1 }));
  });

  it('textKey() changes when text changes', () => {
    const base = { u_text_enabled: 1, text: 'GLOW', textX: 0.5, textY: 0.5, textFontSize: 200, textFont: 'Montserrat' };
    expect(opts.textKey(base)).not.toBe(opts.textKey({ ...base, text: 'FIRE' }));
  });

  it('textKey() changes when outlineWidth changes', () => {
    const base = { u_text_enabled: 1, text: 'GLOW', outlineEnabled: true, outlineWidth: 8 };
    expect(opts.textKey(base)).not.toBe(opts.textKey({ ...base, outlineWidth: 16 }));
  });

  // ── drawText() ───────────────────────────────────────────────────────────────

  it('drawText() clears the canvas with black on every call', () => {
    const ctx = make2DContextMock();
    opts.drawText(ctx, 1024, { u_text_enabled: 0 });
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 1024, 1024);
    expect(ctx.fillStyle).toBe('#000000');
  });

  it('drawText() skips fillText when u_text_enabled is falsy', () => {
    const ctx = make2DContextMock();
    opts.drawText(ctx, 1024, { u_text_enabled: 0, text: 'GLOW' });
    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  it('drawText() skips fillText when text is empty even if u_text_enabled is truthy', () => {
    const ctx = make2DContextMock();
    opts.drawText(ctx, 1024, { u_text_enabled: 1, text: '' });
    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  it('drawText() uses red channel (rgb(255,0,0)) for text fill', () => {
    const ctx = make2DContextMock();
    opts.drawText(ctx, 1024, { u_text_enabled: 1, text: 'GLOW', textFontSize: 200 });
    expect(ctx.fillText).toHaveBeenCalledWith('GLOW', expect.any(Number), expect.any(Number));
    expect(ctx.fillStyle).toBe('rgb(255,0,0)');
  });

  it('drawText() uses green channel (rgb(0,255,0)) for outline stroke when outlineEnabled is on', () => {
    const ctx = make2DContextMock();
    opts.drawText(ctx, 1024, { u_text_enabled: 1, text: 'GLOW', outlineEnabled: true, outlineWidth: 8 });
    expect(ctx.strokeStyle).toBe('rgb(0,255,0)');
    expect(ctx.strokeText).toHaveBeenCalledWith('GLOW', expect.any(Number), expect.any(Number));
  });

  it('drawText() skips outline stroke when outlineEnabled is false', () => {
    const ctx = make2DContextMock();
    opts.drawText(ctx, 1024, { u_text_enabled: 1, text: 'GLOW', outlineEnabled: false, outlineWidth: 8 });
    expect(ctx.strokeText).not.toHaveBeenCalled();
  });

  it('drawText() positions text at textX/textY fraction of canvas size', () => {
    const ctx = make2DContextMock();
    opts.drawText(ctx, 1024, { u_text_enabled: 1, text: 'GLOW', textX: 0.25, textY: 0.75 });
    const [, cx, cy] = ctx.fillText.mock.calls[0];
    expect(cx).toBeCloseTo(0.25 * 1024);
    expect(cy).toBeCloseTo((1 - 0.75) * 1024); // canvas y is flipped
  });
});
