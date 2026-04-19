import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { makeWebGLMock } from './helpers/webgl-mock.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../assets/shader-base.js'), 'utf8');

// Minimal valid-enough fragSrc for the mock (compilation always succeeds via mock)
const DUMMY_FRAG = 'precision mediump float; void main() { gl_FragColor = vec4(0.0); }';

function loadShaderBase() {
  // Execute the IIFE in the global (jsdom window) scope so window.ShaderBase is set.
  new Function(src)(); // eslint-disable-line no-new-func
}

describe('shader-base.js', () => {
  let mockGl;
  let canvas;

  beforeEach(() => {
    // Insert a canvas element that shader-base looks up by ID
    document.body.innerHTML = '<canvas id="shader-canvas"></canvas>';
    canvas = document.getElementById('shader-canvas');

    // jsdom returns 0 for offset dimensions; fake non-zero so resize() proceeds
    Object.defineProperty(canvas, 'offsetWidth',  { get: () => 500, configurable: true });
    Object.defineProperty(canvas, 'offsetHeight', { get: () => 500, configurable: true });

    // Replace WebGL context with our mock.
    // The instance property on `canvas` takes precedence over the prototype spy,
    // so the spy only intercepts the internal text-texture canvas that shader-base
    // creates with document.createElement('canvas') — silencing jsdom's
    // "Not implemented: getContext('2d')" warnings.
    mockGl = makeWebGLMock();
    canvas.getContext = vi.fn((type) => (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') ? mockGl : null);
    const stub2D = { fillStyle: '', strokeStyle: '', fillRect: vi.fn(), fillText: vi.fn(), strokeText: vi.fn(), save: vi.fn(), restore: vi.fn(), scale: vi.fn(), font: '', textAlign: '', textBaseline: '', lineWidth: 0, lineJoin: '', createImageData: vi.fn((w, h) => ({ data: new Uint8ClampedArray(w * h * 4) })), putImageData: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (type) {
      if (type === '2d') return stub2D;
      return null;
    });
    // Default toDataURL so the offscreen canvas encode in _shaderExport doesn't return null
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAAA');

    // Prevent the animation loop from spinning during tests
    vi.stubGlobal('requestAnimationFrame', vi.fn());

    // Reset globals set by shader-base
    delete window.ShaderBase;
    delete window._shaderExport;
    window._shaderState = { values: {}, textDirty: false };

    loadShaderBase();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── API surface ─────────────────────────────────────────────────────────────

  it('exports window.ShaderBase.create as a function', () => {
    expect(typeof window.ShaderBase?.create).toBe('function');
  });

  // ── setup() contract ─────────────────────────────────────────────────────────

  it('calls opts.setup(gl, program) exactly once', () => {
    const setup = vi.fn(() => ({}));
    window.ShaderBase.create({ fragSrc: DUMMY_FRAG, setup, render: vi.fn() });
    expect(setup).toHaveBeenCalledOnce();
    expect(setup).toHaveBeenCalledWith(mockGl, expect.any(Object));
  });

  it('passes the object returned by setup() as uniforms to opts.render()', () => {
    const uniforms = { myUniform: { _loc: 'my_uniform' } };
    const render = vi.fn();
    window.ShaderBase.create({ fragSrc: DUMMY_FRAG, setup: () => uniforms, render });
    expect(render).toHaveBeenCalledWith(mockGl, uniforms, expect.any(Object), 500, 500, expect.any(Number), null);
  });

  // ── render() invocation ───────────────────────────────────────────────────────

  it('calls opts.render() on the initial frame', () => {
    const render = vi.fn();
    window.ShaderBase.create({ fragSrc: DUMMY_FRAG, setup: () => ({}), render });
    expect(render).toHaveBeenCalledOnce();
  });

  it('calls gl.drawArrays(TRIANGLE_STRIP, 0, 4) after opts.render()', () => {
    const callOrder = [];
    mockGl.drawArrays = vi.fn(() => callOrder.push('drawArrays'));
    window.ShaderBase.create({
      fragSrc: DUMMY_FRAG,
      setup: () => ({}),
      render: vi.fn(() => callOrder.push('render')),
    });
    expect(callOrder).toEqual(['render', 'drawArrays']);
    expect(mockGl.drawArrays).toHaveBeenCalledWith(mockGl.TRIANGLE_STRIP, 0, 4);
  });

  it('passes canvas dimensions (w, h) to opts.render()', () => {
    const render = vi.fn();
    window.ShaderBase.create({ fragSrc: DUMMY_FRAG, setup: () => ({}), render });
    const [, , , w, h] = render.mock.calls[0];
    expect(w).toBe(500);
    expect(h).toBe(500);
  });

  // ── _shaderExport ────────────────────────────────────────────────────────────

  it('sets window._shaderExport to a function', () => {
    window.ShaderBase.create({ fragSrc: DUMMY_FRAG, setup: () => ({}), render: vi.fn() });
    expect(typeof window._shaderExport).toBe('function');
  });

  it('_shaderExport resizes canvas, renders, then restores', () => {
    const render = vi.fn();
    window.ShaderBase.create({ fragSrc: DUMMY_FRAG, setup: () => ({}), render });
    canvas.toDataURL = vi.fn(() => 'data:image/png;base64,abc123');

    render.mockClear();
    window._shaderExport(1800, 2400, vi.fn());

    // Canvas should have been set to export dimensions during render
    expect(render).toHaveBeenCalled();
    // Canvas is restored afterwards
    expect(canvas.width).toBe(500);
    expect(canvas.height).toBe(500);
  });

  it('_shaderExport calls callback with base64 string (no data URL prefix)', () => {
    window.ShaderBase.create({ fragSrc: DUMMY_FRAG, setup: () => ({}), render: vi.fn() });
    // Export now uses gl.readPixels → offscreen 2D canvas → toDataURL
    // Mock toDataURL on HTMLCanvasElement.prototype to intercept the offscreen canvas call
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,iVBORw0KGgo=');
    const cb = vi.fn();
    window._shaderExport(100, 100, cb);
    expect(cb).toHaveBeenCalledWith('iVBORw0KGgo=');
  });

  it('_shaderExport applies exportValues overrides and restores them after', () => {
    window._shaderState = { values: { u_some_override: 0.0 }, textDirty: false };
    const capturedValues = [];
    window.ShaderBase.create({
      fragSrc: DUMMY_FRAG,
      setup: () => ({}),
      exportValues: { u_some_override: 1.0 },
      render: vi.fn(() => {
        capturedValues.push(window._shaderState.values.u_some_override);
      }),
    });
    capturedValues.length = 0; // discard the initial render call

    window._shaderExport(100, 100, vi.fn());

    expect(capturedValues).toContain(1.0);
    expect(window._shaderState.values.u_some_override).toBe(0.0);
  });

  // ── useDerivatives ───────────────────────────────────────────────────────────

  it('does not call gl.getExtension — fwidth is built-in in WebGL 2', () => {
    window.ShaderBase.create({ fragSrc: DUMMY_FRAG, setup: () => ({}), render: vi.fn() });
    expect(mockGl.getExtension).not.toHaveBeenCalled();
  });

  // ── drawText integration ─────────────────────────────────────────────────────

  it('passes null textTex to render when drawText is not provided', () => {
    const render = vi.fn();
    window.ShaderBase.create({ fragSrc: DUMMY_FRAG, setup: () => ({}), render });
    const textTex = render.mock.calls[0][6];
    expect(textTex).toBeNull();
  });

  it('calls drawText on the first frame and passes a non-null textTex to render', () => {
    const drawText = vi.fn();
    const render = vi.fn();
    window.ShaderBase.create({ fragSrc: DUMMY_FRAG, setup: () => ({}), render, drawText });
    expect(drawText).toHaveBeenCalledOnce();
    const textTex = render.mock.calls[0][6];
    expect(textTex).not.toBeNull();
  });

  it('passes (ctx, 1024, values, w, h) to drawText', () => {
    const drawText = vi.fn();
    window._shaderState = { values: { text: 'HI' }, textDirty: false };
    window.ShaderBase.create({ fragSrc: DUMMY_FRAG, setup: () => ({}), render: vi.fn(), drawText });
    const [ctx, size, values, w, h] = drawText.mock.calls[0];
    expect(size).toBe(1024);
    expect(values).toEqual(expect.objectContaining({ text: 'HI' }));
    expect(w).toBe(500);
    expect(h).toBe(500);
  });

  it('uses custom textKey when provided', () => {
    const drawText = vi.fn();
    const textKey = vi.fn(() => 'custom-key');
    window.ShaderBase.create({ fragSrc: DUMMY_FRAG, setup: () => ({}), render: vi.fn(), drawText, textKey });
    expect(textKey).toHaveBeenCalled();
  });
});
