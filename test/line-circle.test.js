import { vi, describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { make2DContextMock } from './helpers/webgl-mock.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../assets/line-circle.js'), 'utf8');

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

describe('line-circle.js', () => {
  let opts;

  beforeEach(() => {
    opts = null;
    window.ShaderBase = { create: vi.fn((o) => { opts = o; }) };
    new Function(src)(); // eslint-disable-line no-new-func
  });

  // ── Integration with ShaderBase ───────────────────────────────────────────────

  it('calls window.ShaderBase.create exactly once', () => {
    expect(window.ShaderBase.create).toHaveBeenCalledOnce();
  });

  it('sets useDerivatives: true', () => {
    expect(opts.useDerivatives).toBe(true);
  });

  // ── fragSrc ───────────────────────────────────────────────────────────────────

  it('fragSrc starts with the OES_standard_derivatives extension directive', () => {
    const frag = Array.isArray(opts.fragSrc) ? opts.fragSrc.join('\n') : opts.fragSrc;
    expect(frag.trimStart()).toMatch(/^#extension GL_OES_standard_derivatives : enable/);
  });

  it('fragSrc uses fwidth() for antialiasing instead of hardcoded constants', () => {
    const frag = Array.isArray(opts.fragSrc) ? opts.fragSrc.join('\n') : opts.fragSrc;
    expect(frag).toContain('fwidth(');
    // Ensure the old fallback constants are gone
    expect(frag).not.toContain('aaCircle    = 0.002');
    expect(frag).not.toContain('aaLine   = 0.008');
    expect(frag).not.toContain('aaTriL = 0.002');
    expect(frag).not.toContain('aaCenter    = 0.002');
  });

  it('fragSrc declares all expected uniforms', () => {
    const frag = Array.isArray(opts.fragSrc) ? opts.fragSrc.join('\n') : opts.fragSrc;
    [
      'u_resolution', 'u_aspect', 'u_radius', 'u_line_count', 'u_power',
      'u_width_top', 'u_width_bot',
      'u_palette_a', 'u_palette_b', 'u_palette_c', 'u_palette_d',
      'u_text_color', 'u_use_text_color', 'u_outline_color',
      'u_text_x', 'u_text_y', 'u_text_texture',
      'u_tri_enabled', 'u_tri_rotation', 'u_tri_size', 'u_tri_width',
      'u_center_circle_enabled', 'u_center_circle_radius',
      'u_transparent_bg',
    ].forEach((name) => {
      expect(frag, `missing uniform ${name}`).toContain(name);
    });
  });

  // ── setup() ───────────────────────────────────────────────────────────────────

  it('setup() returns an object with all required uniform keys', () => {
    const gl = { getUniformLocation: vi.fn((_p, name) => ({ _loc: name })) };
    const uniforms = opts.setup(gl, {});
    [
      'res', 'aspect', 'radius', 'lineCount', 'power', 'widthTop', 'widthBot',
      'paletteA', 'paletteB', 'paletteC', 'paletteD',
      'textColor', 'useTextColor', 'outlineColor', 'textX', 'textY', 'textTex',
      'triEnabled', 'triRotation', 'triSize', 'triWidth',
      'centerCircleEnabled', 'centerCircleRadius', 'transparentBg',
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

    opts.render(makeRenderGl(), proxy, {}, 500, 500, 0, {});

    accessed.forEach((key) => {
      expect(uniforms, `render() accessed "u.${key}" but setup() didn't return it`).toHaveProperty(key);
    });
  });

  it('render() uploads u_aspect as w/h ratio', () => {
    const gl = { getUniformLocation: vi.fn((_p, name) => ({ _loc: name })) };
    const uniforms = opts.setup(gl, {});
    const renderGl = makeRenderGl();
    opts.render(renderGl, uniforms, {}, 600, 400, 0, {});
    // u_aspect should be 600/400 = 1.5
    const aspectCall = renderGl.uniform1f.mock.calls.find(
      ([loc]) => loc === uniforms.aspect
    );
    expect(aspectCall).toBeDefined();
    expect(aspectCall[1]).toBeCloseTo(1.5);
  });

  // ── textKey() ─────────────────────────────────────────────────────────────────

  it('textKey() serializes [text, textX, textY, textFontSize, textFont, outlineEnabled, outlineWidth]', () => {
    const v = {
      text: 'X', textX: 0.5, textY: 0.5, textFontSize: 120, textFont: 'IBM Plex Mono',
      outlineEnabled: true, outlineWidth: 8,
    };
    expect(opts.textKey(v)).toBe(
      JSON.stringify(['X', 0.5, 0.5, 120, 'IBM Plex Mono', true, 8])
    );
  });

  it('textKey() changes when outline width changes', () => {
    const base = { text: 'X', textX: 0.5, textY: 0.5, textFontSize: 120, textFont: 'IBM Plex Mono', outlineEnabled: true, outlineWidth: 8 };
    expect(opts.textKey(base)).not.toBe(opts.textKey({ ...base, outlineWidth: 16 }));
  });

  it('textKey() changes when outline enabled toggles', () => {
    const base = { text: 'X', textX: 0.5, textY: 0.5, textFontSize: 120, textFont: 'IBM Plex Mono', outlineEnabled: false, outlineWidth: 8 };
    expect(opts.textKey(base)).not.toBe(opts.textKey({ ...base, outlineEnabled: true }));
  });

  // ── drawText() ────────────────────────────────────────────────────────────────

  it('drawText() clears the canvas with black on every call', () => {
    const ctx = make2DContextMock();
    opts.drawText(ctx, 1024, { text: '' }, 500, 500);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 1024, 1024);
    expect(ctx.fillStyle).toBe('#000000');
  });

  it('drawText() uses red channel (rgb(255,0,0)) for text fill', () => {
    const ctx = make2DContextMock();
    opts.drawText(ctx, 1024, { text: 'X', textFontSize: 100 }, 500, 500);
    expect(ctx.fillText).toHaveBeenCalledWith('X', expect.any(Number), expect.any(Number));
    expect(ctx.fillStyle).toBe('rgb(255,0,0)');
  });

  it('drawText() uses green channel (rgb(0,255,0)) for outline stroke', () => {
    const ctx = make2DContextMock();
    opts.drawText(ctx, 1024, { text: 'X', outlineEnabled: true, outlineWidth: 8 }, 500, 500);
    expect(ctx.strokeStyle).toBe('rgb(0,255,0)');
    expect(ctx.strokeText).toHaveBeenCalledWith('X', expect.any(Number), expect.any(Number));
  });

  it('drawText() skips outline stroke when outlineEnabled is false', () => {
    const ctx = make2DContextMock();
    opts.drawText(ctx, 1024, { text: 'X', outlineEnabled: false, outlineWidth: 8 }, 500, 500);
    expect(ctx.strokeText).not.toHaveBeenCalled();
  });

  it('drawText() skips fillText when text is empty', () => {
    const ctx = make2DContextMock();
    opts.drawText(ctx, 1024, { text: '' }, 500, 500);
    expect(ctx.fillText).not.toHaveBeenCalled();
  });
});
