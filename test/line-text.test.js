import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { make2DContextMock } from './helpers/webgl-mock.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../assets/line-text.js'), 'utf8');

// 2D context mock — extends base mock with drawImage and filter for line-text
function makeCanvasCtxMock() {
  const ctx = make2DContextMock();
  ctx.drawImage = vi.fn();
  ctx.filter    = 'none';
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  ctx.canvas = canvas;
  return ctx;
}

// Spy on document.createElement so canvas elements get a working 2D context
function mockDocumentCreateCanvas() {
  const origCreateElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag) => {
    if (tag === 'canvas') return makeCanvasCtxMock().canvas;
    return origCreateElement(tag);
  });
}

// GL mock for setup()
function makeSetupGl() {
  return {
    getUniformLocation: vi.fn((_p, name) => ({ _loc: name })),
  };
}

// GL mock for render()
function makeRenderGl() {
  return {
    TEXTURE0:   33984,
    TEXTURE_2D: 3553,
    uniform1f:    vi.fn(),
    uniform2f:    vi.fn(),
    uniform1i:    vi.fn(),
    uniform3fv:   vi.fn(),
    activeTexture: vi.fn(),
    bindTexture:   vi.fn(),
  };
}

describe('line-text.js', () => {
  let opts;

  beforeEach(() => {
    opts = null;
    mockDocumentCreateCanvas();
    window.ShaderBase = { create: vi.fn((o) => { opts = o; }) };
    new Function(src)(); // eslint-disable-line no-new-func
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Integration with ShaderBase ────────────────────────────────────────────

  it('calls window.ShaderBase.create exactly once', () => {
    expect(window.ShaderBase.create).toHaveBeenCalledOnce();
  });

  // ── fragSrc ────────────────────────────────────────────────────────────────

  it('fragSrc starts with #version 300 es (WebGL 2)', () => {
    const frag = Array.isArray(opts.fragSrc) ? opts.fragSrc.join('\n') : opts.fragSrc;
    expect(frag.trimStart()).toMatch(/^#version 300 es/);
  });

  it('fragSrc declares all expected uniforms', () => {
    const frag = Array.isArray(opts.fragSrc) ? opts.fragSrc.join('\n') : opts.fragSrc;
    ['u_resolution', 'u_rows', 'u_base_thickness', 'u_text_thickness',
     'u_text_y', 'u_vignette_x', 'u_vignette_y',
     'u_a', 'u_b', 'u_c', 'u_d',
     'u_color_mode', 'u_color0', 'u_color1', 'u_color2', 'u_color3',
     'u_text_texture'].forEach((name) => {
      expect(frag, `missing uniform ${name}`).toContain(name);
    });
  });

  it('fragSrc uses fwidth for anti-aliasing', () => {
    const frag = Array.isArray(opts.fragSrc) ? opts.fragSrc.join('\n') : opts.fragSrc;
    expect(frag).toContain('fwidth');
  });

  it('fragSrc applies gamma encoding before output', () => {
    const frag = Array.isArray(opts.fragSrc) ? opts.fragSrc.join('\n') : opts.fragSrc;
    expect(frag).toContain('1.0 / 2.2');
  });

  // ── setup() ───────────────────────────────────────────────────────────────

  it('setup() returns an object with all required uniform keys', () => {
    const gl = makeSetupGl();
    const uniforms = opts.setup(gl, {});
    ['res', 'rows', 'baseThickness', 'textThickness', 'textY', 'vignetteX', 'vignetteY',
     'palA', 'palB', 'palC', 'palD',
     'colorMode', 'color0', 'color1', 'color2', 'color3',
     'textTex'].forEach((key) => {
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

    opts.render(makeRenderGl(), proxy, {}, 500, 500, 0, {});

    accessed.forEach((key) => {
      expect(uniforms, `render() accessed "u.${key}" but setup() didn't return it`).toHaveProperty(key);
    });
  });

  // ── render() ──────────────────────────────────────────────────────────────

  it('render() sets u_resolution to canvas dimensions', () => {
    const uniforms = opts.setup(makeSetupGl(), {});
    const renderGl = makeRenderGl();
    opts.render(renderGl, uniforms, {}, 400, 600, 0, {});
    const call = renderGl.uniform2f.mock.calls.find(([loc]) => loc === uniforms.res);
    expect(call).toBeDefined();
    expect(call[1]).toBe(400);
    expect(call[2]).toBe(600);
  });

  it('render() uses default values when values object is empty', () => {
    const uniforms = opts.setup(makeSetupGl(), {});
    const renderGl = makeRenderGl();
    opts.render(renderGl, uniforms, {}, 500, 500, 0, {});

    function find1f(loc) {
      return renderGl.uniform1f.mock.calls.find(([l]) => l === loc)?.[1];
    }
    expect(find1f(uniforms.rows)).toBe(80.0);
    expect(find1f(uniforms.baseThickness)).toBeCloseTo(0.02);
    expect(find1f(uniforms.textThickness)).toBeCloseTo(0.4);
    expect(find1f(uniforms.vignetteX)).toBeCloseTo(2.0);
    expect(find1f(uniforms.vignetteY)).toBeCloseTo(2.0);
    expect(find1f(uniforms.colorMode)).toBe(0.0);
  });

  it('render() passes supplied values to uniforms', () => {
    const uniforms = opts.setup(makeSetupGl(), {});
    const renderGl = makeRenderGl();
    opts.render(renderGl, uniforms, { u_rows: 120, u_base_thickness: 0.05, u_text_thickness: 0.3 }, 500, 500, 0, {});

    function find1f(loc) {
      return renderGl.uniform1f.mock.calls.find(([l]) => l === loc)?.[1];
    }
    expect(find1f(uniforms.rows)).toBe(120);
    expect(find1f(uniforms.baseThickness)).toBeCloseTo(0.05);
    expect(find1f(uniforms.textThickness)).toBeCloseTo(0.3);
  });

  it('render() binds text texture to TEXTURE0', () => {
    const uniforms = opts.setup(makeSetupGl(), {});
    const renderGl = makeRenderGl();
    const mockTex = { id: 'tex' };
    opts.render(renderGl, uniforms, {}, 500, 500, 0, mockTex);

    expect(renderGl.activeTexture).toHaveBeenCalledWith(renderGl.TEXTURE0);
    expect(renderGl.bindTexture).toHaveBeenCalledWith(renderGl.TEXTURE_2D, mockTex);

    const samplerCall = renderGl.uniform1i.mock.calls.find(([loc]) => loc === uniforms.textTex);
    expect(samplerCall).toBeDefined();
    expect(samplerCall[1]).toBe(0);
  });

  // ── drawText() ────────────────────────────────────────────────────────────

  it('drawText() fills with black background', () => {
    const ctx = makeCanvasCtxMock();
    opts.drawText(ctx, 1024, { text: 'HI', textFont: 'Montserrat', textFontSize: 600, textCapRadius: 0 });
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 1024, 1024);
  });

  it('drawText() calls fillText when text value is non-empty', () => {
    const ctx = makeCanvasCtxMock();
    opts.drawText(ctx, 1024, { text: 'HELLO', textFont: 'Montserrat', textFontSize: 600 });
    expect(ctx.fillText).toHaveBeenCalled();
  });

  it('drawText() does not call fillText when text is empty', () => {
    const ctx = makeCanvasCtxMock();
    opts.drawText(ctx, 1024, { text: '', textFont: 'Montserrat', textFontSize: 600 });
    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  it('drawText() does not use canvas blur APIs (blur is in GLSL)', () => {
    const ctx = makeCanvasCtxMock();
    opts.drawText(ctx, 1024, { text: 'HI', textFont: 'Montserrat', textFontSize: 300, textCapRadius: 20 });
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  // ── textKey() ────────────────────────────────────────────────────────────

  it('textKey() returns a string', () => {
    expect(typeof opts.textKey({})).toBe('string');
  });

  it('textKey() changes when text changes', () => {
    const k1 = opts.textKey({ text: 'HELLO' });
    const k2 = opts.textKey({ text: 'WORLD' });
    expect(k1).not.toBe(k2);
  });

  it('textKey() changes when font changes', () => {
    const k1 = opts.textKey({ text: 'HI', textFont: 'Montserrat' });
    const k2 = opts.textKey({ text: 'HI', textFont: 'Oswald' });
    expect(k1).not.toBe(k2);
  });

  it('textKey() changes when fontSize changes', () => {
    const k1 = opts.textKey({ text: 'HI', textFontSize: 400 });
    const k2 = opts.textKey({ text: 'HI', textFontSize: 600 });
    expect(k1).not.toBe(k2);
  });

  it('textKey() is unaffected by capRadius (blur is a shader uniform, not baked into texture)', () => {
    const k1 = opts.textKey({ text: 'HI', textCapRadius: 0 });
    const k2 = opts.textKey({ text: 'HI', textCapRadius: 20 });
    expect(k1).toBe(k2);
  });

  it('textKey() changes when textY changes', () => {
    const k1 = opts.textKey({ text: 'HI', textY: 0.5 });
    const k2 = opts.textKey({ text: 'HI', textY: 0.8 });
    expect(k1).not.toBe(k2);
  });

  it('textKey() is stable for the same inputs', () => {
    const v = { text: 'TEST', textFont: 'Montserrat', textFontSize: 600, textCapRadius: 20, textY: 0.5 };
    expect(opts.textKey(v)).toBe(opts.textKey(v));
  });
});
