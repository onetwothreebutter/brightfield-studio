import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { generate, shaderNames, OUTPUT } from '../scripts/build-shader-defs.mjs';

// `assets/shader-defs.js` is generated from snippets/shader-controls-*.liquid so
// the dev pages and the product page cannot disagree about what a shader's
// controls are. They did once: the hand-maintained mirror this replaced had
// drifted on all thirteen shaders — rise-shirt was missing 26 keys, including
// the entire four-stop palette, so the palette lab was colouring uniforms the
// shader no longer had.
describe('assets/shader-defs.js is generated from the Liquid snippets', () => {
  it('matches a fresh build — run `npm run build:shader-defs` after editing a snippet', () => {
    expect(readFileSync(OUTPUT, 'utf8')).toBe(generate());
  });

  it('covers every control snippet', () => {
    const names = shaderNames();
    expect(names).toHaveLength(13);
    names.forEach((n) => {
      expect(generate()).toContain(`register('${n}',`);
    });
  });
});
