import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { generate, OUTPUT } from '../scripts/build-line-circle.mjs';

// assets/line-circle.js is generated from assets/circle-on-line.js — same
// drift protection shader-defs.js has: edit the source or the transforms,
// regenerate, or this fails.
describe('line-circle.js generation', () => {
  it('committed assets/line-circle.js matches the generator output', () => {
    expect(readFileSync(OUTPUT, 'utf8')).toBe(generate());
  });

  it('the two deltas are present in the output', () => {
    const out = generate();
    // Vignette darkens color instead of fading alpha…
    expect(out).toContain('finalColor = finalColor * vigMask;');
    // …and the labels diagnostic stays circle-on-line-only.
    expect(out).not.toContain('Cohort labels');
  });
});
