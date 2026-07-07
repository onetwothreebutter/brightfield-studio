import { vi, describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../assets/sdf-line.js'), 'utf8');

function makeRenderGl() {
  return {
    uniform1f:  vi.fn(),
    uniform2f:  vi.fn(),
    uniform3fv: vi.fn(),
  };
}

function makeSetupGl() {
  return {
    getUniformLocation: vi.fn((_p, name) => ({ _loc: name })),
  };
}

describe('sdf-line.js', () => {
  let opts;

  beforeEach(() => {
    opts = null;
    window._shaderState = { values: {} };
    window.ShaderBase = { create: vi.fn((o) => { opts = o; }), commonGLSL: '' };

    new Function(src)(); // eslint-disable-line no-new-func
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
      'u_resolution', 'u_aspect', 'u_line_angle', 'u_line_length', 'u_line_width',
      'u_repeat_enabled', 'u_line_spacing',
      'u_rings_enabled', 'u_ring_spacing', 'u_ring_width',
      'u_color_mode', 'u_a', 'u_b', 'u_c', 'u_d',
      'u_color0', 'u_color1', 'u_color2', 'u_color3',
      'u_opacity', 'u_distress', 'u_distress_scale', 'u_grain_mode', 'u_distress_falloff',
      'u_pos_x', 'u_pos_y', 'u_scale',
    ].forEach((name) => {
      expect(frag, `missing uniform ${name}`).toContain(name);
    });
  });

  it('fragSrc applies the position/scale transform before deriving the line SDF', () => {
    const frag = Array.isArray(opts.fragSrc) ? opts.fragSrc.join('\n') : opts.fragSrc;
    expect(frag).toContain('uv = (uv - 0.5) / u_scale + 0.5 + vec2(u_pos_x, u_pos_y)');
  });

  it('fragSrc computes IQ\'s capsule SDF (flattened to z=0) with a normalized h for palette lookup', () => {
    const frag = Array.isArray(opts.fragSrc) ? opts.fragSrc.join('\n') : opts.fragSrc;
    expect(frag).toContain('vec2 sdCapsuleH(vec3 p, vec3 a, vec3 b, float r)');
    expect(frag).toContain('length(pa - ba * h) - r');
    expect(frag).toContain('cosinePalette(h, u_a, u_b, u_c, u_d)');
  });

  it('fragSrc folds space along the perpendicular axis, gated by u_repeat_enabled, to repeat the capsule as a fence of parallel lines', () => {
    const frag = Array.isArray(opts.fragSrc) ? opts.fragSrc.join('\n') : opts.fragSrc;
    expect(frag).toContain('vec2  perp = vec2(-dir.y, dir.x);');
    expect(frag).toContain('mod(d + u_line_spacing * 0.5, u_line_spacing) - u_line_spacing * 0.5');
    expect(frag).toContain('vec2  pRep   = mix(p, p - perp * (d - dRep), u_repeat_enabled);');
  });

  it('fragSrc folds signed distance into concentric rings and mixes with the solid fill via u_rings_enabled', () => {
    const frag = Array.isArray(opts.fragSrc) ? opts.fragSrc.join('\n') : opts.fragSrc;
    expect(frag).toContain('float ringT    = dist / u_ring_spacing;');
    expect(frag).toContain('float ringDist = min(ringFrac, 1.0 - ringFrac) * u_ring_spacing;');
    expect(frag).toContain('float shapeMask = mix(lineMask, ringMask, u_rings_enabled);');
  });

  it('setup() returns an object with all required uniform keys', () => {
    const uniforms = opts.setup(makeSetupGl(), {});
    [
      'res', 'aspect', 'lineAngle', 'lineLength', 'lineWidth', 'repeatEnabled', 'lineSpacing',
      'ringsEnabled', 'ringSpacing', 'ringWidth', 'colorMode',
      'palA', 'palB', 'palC', 'palD', 'color0', 'color1', 'color2', 'color3',
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

  it('render() sets u_aspect from width/height', () => {
    const uniforms = opts.setup(makeSetupGl(), {});
    const renderGl = makeRenderGl();
    opts.render(renderGl, uniforms, {}, 1000, 500, 0);
    const call = renderGl.uniform1f.mock.calls.find(([loc]) => loc === uniforms.aspect);
    expect(call[1]).toBe(2);
  });

  it('render() defaults line angle, length, width, and spacing', () => {
    const uniforms = opts.setup(makeSetupGl(), {});
    const renderGl = makeRenderGl();
    opts.render(renderGl, uniforms, {}, 500, 500, 0);
    const angle   = renderGl.uniform1f.mock.calls.find(([loc]) => loc === uniforms.lineAngle);
    const length  = renderGl.uniform1f.mock.calls.find(([loc]) => loc === uniforms.lineLength);
    const width   = renderGl.uniform1f.mock.calls.find(([loc]) => loc === uniforms.lineWidth);
    const spacing = renderGl.uniform1f.mock.calls.find(([loc]) => loc === uniforms.lineSpacing);
    expect(angle[1]).toBe(0);
    expect(length[1]).toBe(1.4);
    expect(width[1]).toBe(0.02);
    expect(spacing[1]).toBe(0.2);
  });

  it('render() defaults u_repeat_enabled to off (single capsule)', () => {
    const uniforms = opts.setup(makeSetupGl(), {});
    const renderGl = makeRenderGl();
    opts.render(renderGl, uniforms, {}, 500, 500, 0);
    const call = renderGl.uniform1f.mock.calls.find(([loc]) => loc === uniforms.repeatEnabled);
    expect(call[1]).toBe(0);
  });

  it('render() defaults u_rings_enabled to off and sets ring spacing/width defaults', () => {
    const uniforms = opts.setup(makeSetupGl(), {});
    const renderGl = makeRenderGl();
    opts.render(renderGl, uniforms, {}, 500, 500, 0);
    const enabled = renderGl.uniform1f.mock.calls.find(([loc]) => loc === uniforms.ringsEnabled);
    const spacing = renderGl.uniform1f.mock.calls.find(([loc]) => loc === uniforms.ringSpacing);
    const width   = renderGl.uniform1f.mock.calls.find(([loc]) => loc === uniforms.ringWidth);
    expect(enabled[1]).toBe(0);
    expect(spacing[1]).toBe(0.03);
    expect(width[1]).toBe(0.006);
  });
});
