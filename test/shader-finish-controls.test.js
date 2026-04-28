/**
 * Ensures every shader has the standard Finish section controls
 * (u_pos_x, u_pos_y, u_scale) wired up in both the Liquid snippet
 * and the corresponding JS asset.
 *
 * Add a new shader? It will automatically be included here — no changes needed.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const REQUIRED_CONTROLS = ['u_pos_x', 'u_pos_y', 'u_scale'];

const baseSrc = readFileSync(join(ROOT, 'snippets', 'shader-controls-base.liquid'), 'utf8');

function getShaderNames() {
  return readdirSync(join(ROOT, 'snippets'))
    .filter(f => f.startsWith('shader-controls-') && f.endsWith('.liquid') && f !== 'shader-controls-base.liquid')
    .map(f => f.replace('shader-controls-', '').replace('.liquid', ''));
}

function hasControlWithNoRandomize(src, key) {
  // Each control is typically one line; check that key and noRandomize appear together.
  if (src.split('\n').some(line => line.includes(`'${key}'`) && line.includes('noRandomize'))) {
    return true;
  }
  // Controls may be delegated to FINISH_CONTROLS / FINISH_CONTROLS_POST in the base snippet.
  if (src.includes('FINISH_CONTROLS')) {
    return baseSrc.split('\n').some(line => line.includes(`'${key}'`) && line.includes('noRandomize'));
  }
  return false;
}

describe('Shader Finish section controls', () => {
  const shaders = getShaderNames();

  describe('Liquid snippets — all shaders have pos/scale controls with noRandomize', () => {
    for (const shader of shaders) {
      const snippetPath = join(ROOT, 'snippets', `shader-controls-${shader}.liquid`);
      const src = readFileSync(snippetPath, 'utf8');

      for (const key of REQUIRED_CONTROLS) {
        it(`${shader}: has '${key}' with noRandomize: true`, () => {
          expect(
            hasControlWithNoRandomize(src, key),
            `snippets/shader-controls-${shader}.liquid is missing '${key}' with noRandomize: true`
          ).toBe(true);
        });
      }
    }
  });

  describe('JS assets — all shaders declare and bind pos/scale uniforms', () => {
    for (const shader of shaders) {
      const jsPath = join(ROOT, 'assets', `${shader}.js`);
      if (!existsSync(jsPath)) continue;

      const src = readFileSync(jsPath, 'utf8');

      it(`${shader}: declares u_pos_x, u_pos_y, u_scale as GLSL uniforms`, () => {
        expect(src).toMatch(/uniform\s+float\s+u_pos_x/);
        expect(src).toMatch(/uniform\s+float\s+u_pos_y/);
        expect(src).toMatch(/uniform\s+float\s+u_scale/);
      });

      it(`${shader}: applies UV transform in main()`, () => {
        expect(src).toContain('u_pos_x');
        expect(src).toContain('u_scale');
        // The transform line shifts and zooms uv
        expect(src).toMatch(/u_scale.*u_pos_x|u_pos_x.*u_scale/);
      });

      it(`${shader}: binds u_pos_x, u_pos_y, u_scale in render()`, () => {
        expect(src).toContain("'u_pos_x'");
        expect(src).toContain("'u_pos_y'");
        expect(src).toContain("'u_scale'");
      });
    }
  });
});
