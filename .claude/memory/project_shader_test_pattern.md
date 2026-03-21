---
name: shader vitest test pattern
description: How to write Vitest tests for shader JS files, including mocking document.createElement('canvas') for shaders that manage multiple letter-texture canvases in setup()
type: project
---

## Test file pattern
```javascript
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { make2DContextMock } from './helpers/webgl-mock.js';

const src = readFileSync(join(__dirname, '../assets/[name].js'), 'utf8');

beforeEach(() => {
  window.ShaderBase = { create: vi.fn((o) => { opts = o; }) };
  new Function(src)();
});

afterEach(() => { vi.restoreAllMocks(); });
```

## When setup() creates canvas elements (e.g. four-circles letter textures)

`document.createElement('canvas').getContext('2d')` returns null in jsdom (no native canvas). Must mock it:

```javascript
function makeCanvasCtxMock() {
  const ctx = make2DContextMock();
  ctx.measureText = vi.fn(() => ({ actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 2 }));
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  ctx.canvas = canvas;  // back-reference needed by drawLetter()
  return ctx;
}

function mockDocumentCreateCanvas() {
  const orig = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag) => {
    if (tag === 'canvas') return makeCanvasCtxMock().canvas;
    return orig(tag);
  });
}
```

Call `mockDocumentCreateCanvas()` in `beforeEach`, `vi.restoreAllMocks()` in `afterEach`.

## setup() GL mock (needs texture creation)
```javascript
function makeSetupGl() {
  return {
    TEXTURE_2D: 3553, UNPACK_FLIP_Y_WEBGL: 37440,
    TEXTURE_MIN_FILTER: 10241, TEXTURE_MAG_FILTER: 10240,
    TEXTURE_WRAP_S: 10242, TEXTURE_WRAP_T: 10243,
    LINEAR: 9729, CLAMP_TO_EDGE: 33071, RGBA: 6408, UNSIGNED_BYTE: 5121,
    createTexture: vi.fn(() => ({})), bindTexture: vi.fn(),
    pixelStorei: vi.fn(), texImage2D: vi.fn(), texParameteri: vi.fn(),
    getUniformLocation: vi.fn((_p, name) => ({ _loc: name })),
  };
}
```

## render() GL mock (needs TEXTURE0–4 for letter + word slots)
```javascript
function makeRenderGl() {
  return {
    TEXTURE0: 33984, TEXTURE1: 33985, TEXTURE2: 33986,
    TEXTURE3: 33987, TEXTURE4: 33988, TEXTURE_2D: 3553,
    // ... same texture params as setup GL ...
    uniform1f: vi.fn(), uniform2f: vi.fn(), uniform1i: vi.fn(), uniform3fv: vi.fn(),
    activeTexture: vi.fn(), bindTexture: vi.fn(),
    pixelStorei: vi.fn(), texImage2D: vi.fn(), texParameteri: vi.fn(),
  };
}
```

## Proxy pattern for render() uniform coverage
```javascript
const uniforms = opts.setup(makeSetupGl(), {});
const accessed = new Set();
const proxy = new Proxy(uniforms, {
  get(target, key) { if (typeof key === 'string') accessed.add(key); return target[key]; }
});
opts.render(makeRenderGl(), proxy, {}, 500, 500, 0, {});
accessed.forEach((key) => expect(uniforms).toHaveProperty(key));
```

## Reference implementations
- `test/line-circle.test.js` — simple setup (no canvas creation needed)
- `test/four-circles.test.js` — complex setup (4 letter-texture canvases + word texture)
