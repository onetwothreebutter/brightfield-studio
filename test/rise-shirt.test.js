import { vi, describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { make2DContextMock } from './helpers/webgl-mock.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../assets/rise-shirt.js'), 'utf8');

// Minimal GL mock with only the methods render() uses
function makeRenderGl() {
  return {
    TEXTURE0:   33984,
    TEXTURE_2D: 3553,
    uniform1f:  vi.fn(),
    uniform2f:  vi.fn(),
    uniform1i:  vi.fn(),
    uniform3fv: vi.fn(),
    activeTexture: vi.fn(),
    bindTexture:   vi.fn(),
  };
}

describe('rise-shirt.js', () => {
  let opts;

  beforeEach(() => {
    opts = null;
    // Stub ShaderBase.create to capture the options without running real WebGL code
    window.ShaderBase = { create: vi.fn((o) => { opts = o; }) };
    new Function(src)(); // eslint-disable-line no-new-func
  });

  // ── Integration with ShaderBase ───────────────────────────────────────────────

  it('calls window.ShaderBase.create exactly once', () => {
    expect(window.ShaderBase.create).toHaveBeenCalledOnce();
  });

  it('does not set useDerivatives', () => {
    expect(opts.useDerivatives).toBeFalsy();
  });

  // ── fragSrc ───────────────────────────────────────────────────────────────────

  it('fragSrc declares all expected uniforms', () => {
    const frag = Array.isArray(opts.fragSrc) ? opts.fragSrc.join('\n') : opts.fragSrc;
    [
      'u_time', 'u_resolution', 'u_rows', 'u_cols',
      'u_min_radius', 'u_max_radius', 'u_invert',
      'u_bg_color', 'u_top_margin', 'u_ratio',
      'u_text_texture', 'u_text_grid_cols', 'u_text_grid_rows',
      'u_text_blend', 'u_text_radius', 'u_text_ratio',
      'u_text_bg_color',
      'u_a', 'u_b', 'u_c', 'u_d',
      'u_color_mode', 'u_transparent_bg',
    ].forEach((name) => {
      expect(frag, `missing uniform ${name}`).toContain(name);
    });
  });

  it('fragSrc does not use OES_standard_derivatives extension', () => {
    const frag = Array.isArray(opts.fragSrc) ? opts.fragSrc.join('\n') : opts.fragSrc;
    expect(frag).not.toContain('#extension GL_OES_standard_derivatives');
    expect(frag).not.toContain('fwidth(');
  });

  // ── setup() ───────────────────────────────────────────────────────────────────

  it('setup() returns an object with all required uniform keys', () => {
    const gl = { getUniformLocation: vi.fn((_p, name) => ({ _loc: name })) };
    const uniforms = opts.setup(gl, {});
    [
      'time', 'res', 'rows', 'cols', 'minRadius', 'maxRadius', 'invert',
      'bgColor', 'topMargin', 'ratio',
      'textTex', 'textGridCols', 'textGridRows', 'textBlend', 'textRadius', 'textRatio',
      'textBgColor',
      'palA', 'palB', 'palC', 'palD',
      'colorMode', 'transparentBg',
    ].forEach((key) => {
      expect(uniforms, `setup() is missing key "${key}"`).toHaveProperty(key);
    });
  });

  it('every uniform key accessed by render() exists in the setup() return value', () => {
    const gl = { getUniformLocation: vi.fn((_p, name) => ({ _loc: name })) };
    const uniforms = opts.setup(gl, {});

    const accessed = new Set();
    const proxy = new Proxy(uniforms, {
      get(target, key) {
        if (typeof key === 'string') accessed.add(key);
        return target[key];
      },
    });

    opts.render(makeRenderGl(), proxy, {}, 500, 500, 1.0, {});

    accessed.forEach((key) => {
      expect(uniforms, `render() accessed "u.${key}" but setup() didn't return it`).toHaveProperty(key);
    });
  });

  // ── textKey() ─────────────────────────────────────────────────────────────────

  it('textKey() serializes [text, textX, textY, textFontSize, textFont]', () => {
    const v = { text: 'HELLO', textX: 0.5, textY: 0.8, textFontSize: 200, textFont: 'Anton', irrelevant: 42 };
    expect(opts.textKey(v)).toBe(JSON.stringify(['HELLO', 0.5, 0.8, 200, 'Anton', null]));
  });

  it('textKey() produces different values when text changes', () => {
    const base = { text: 'A', textX: 0.5, textY: 0.5, textFontSize: 100, textFont: 'IBM Plex Mono' };
    expect(opts.textKey(base)).not.toBe(opts.textKey({ ...base, text: 'B' }));
  });

  it('textKey() produces different values when font changes', () => {
    const base = { text: 'A', textX: 0.5, textY: 0.5, textFontSize: 100, textFont: 'IBM Plex Mono' };
    expect(opts.textKey(base)).not.toBe(opts.textKey({ ...base, textFont: 'Anton' }));
  });

  // ── drawText() ────────────────────────────────────────────────────────────────

  it('drawText() clears the canvas with black on every call', () => {
    const ctx = make2DContextMock();
    opts.drawText(ctx, 1024, { text: '' }, 500, 500);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 1024, 1024);
    expect(ctx.fillStyle).toBe('#000000');
  });

  it('drawText() draws white text when text is non-empty', () => {
    const ctx = make2DContextMock();
    opts.drawText(ctx, 1024, { text: 'GLOW', textFontSize: 100, textFont: 'IBM Plex Mono' }, 500, 500);
    expect(ctx.fillText).toHaveBeenCalledWith('GLOW', expect.any(Number), expect.any(Number));
    expect(ctx.fillStyle).toBe('rgb(255,255,255)');
  });

  it('drawText() skips fillText when text is empty', () => {
    const ctx = make2DContextMock();
    opts.drawText(ctx, 1024, { text: '' }, 500, 500);
    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  it('drawText() applies aspect-ratio correction via ctx.scale()', () => {
    const ctx = make2DContextMock();
    // canvas is 500×250 → aspect = 2.0 → ctx.scale(1/2, 1)
    opts.drawText(ctx, 1024, { text: 'X' }, 500, 250);
    expect(ctx.scale).toHaveBeenCalledWith(0.5, 1);
  });
});
