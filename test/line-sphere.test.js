import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../assets/line-sphere.js'), 'utf8');

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

describe('line-sphere.js', () => {
  let opts;

  beforeEach(() => {
    opts = null;
    document.body.innerHTML = '<canvas id="shader-canvas"></canvas>';
    window._shaderState = { values: {} };
    window.ShaderBase = { create: vi.fn((o) => { opts = o; }), commonGLSL: '' };

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
      'u_sphere_pos', 'u_sphere_closeness', 'u_sphere_radius',
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

  it('fragSrc pushes uv radially away from the sphere, scaled by closeness and falloff radius', () => {
    const frag = Array.isArray(opts.fragSrc) ? opts.fragSrc.join('\n') : opts.fragSrc;
    expect(frag).toContain('vec2 toSphere = uv - u_sphere_pos;');
    expect(frag).toContain('1.0 - smoothstep(0.0, u_sphere_radius, sphereDist)');
    expect(frag).toContain('uv -= pushDir * influence * u_sphere_closeness;');
  });

  it('setup() returns an object with all required uniform keys', () => {
    const uniforms = opts.setup(makeSetupGl(), {});
    [
      'res', 'lineCount', 'lineWidth', 'colorMode',
      'palA', 'palB', 'palC', 'palD', 'color0', 'color1', 'color2', 'color3',
      'spherePos', 'sphereCloseness', 'sphereRadius',
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

  it('render() defaults sphere closeness and radius', () => {
    const uniforms = opts.setup(makeSetupGl(), {});
    const renderGl = makeRenderGl();
    opts.render(renderGl, uniforms, {}, 500, 500, 0);
    const closeness = renderGl.uniform1f.mock.calls.find(([loc]) => loc === uniforms.sphereCloseness);
    const radius = renderGl.uniform1f.mock.calls.find(([loc]) => loc === uniforms.sphereRadius);
    expect(closeness[1]).toBe(0.15);
    expect(radius[1]).toBe(0.25);
  });

  it('sphere position starts centered before any pointer interaction', () => {
    const uniforms = opts.setup(makeSetupGl(), {});
    const renderGl = makeRenderGl();
    opts.render(renderGl, uniforms, {}, 500, 500, 0);
    const call = renderGl.uniform2f.mock.calls.find(([loc]) => loc === uniforms.spherePos);
    expect(call[1]).toBe(0.5);
    expect(call[2]).toBe(0.5);
  });

  it('does not attach pointer listeners when #shader-canvas is missing', () => {
    document.body.innerHTML = '';
    window.ShaderBase = { create: vi.fn((o) => { opts = o; }), commonGLSL: '' };
    expect(() => new Function(src)()).not.toThrow(); // eslint-disable-line no-new-func
  });

  it('pointermove over the canvas updates the sphere position uniform', () => {
    const canvas = document.getElementById('shader-canvas');
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 });

    // clientX 80, clientY 20 -> x = 0.8, y = 1 - 0.2 = 0.8 (uv is bottom-up)
    canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 80, clientY: 20 }));

    const uniforms = opts.setup(makeSetupGl(), {});
    const renderGl = makeRenderGl();
    opts.render(renderGl, uniforms, {}, 500, 500, 0);
    const call = renderGl.uniform2f.mock.calls.find(([loc]) => loc === uniforms.spherePos);
    expect(call[1]).toBeCloseTo(0.8);
    expect(call[2]).toBeCloseTo(0.8);
  });
});
