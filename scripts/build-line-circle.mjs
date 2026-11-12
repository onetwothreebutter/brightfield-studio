// Builds assets/line-circle.js from assets/circle-on-line.js.
//
// The two shaders share their geometry and their entire JS surface
// (setup/render/textKey/drawText); line-circle differs in exactly two
// deliberate ways, applied here as explicit transforms so the divergence is
// documented instead of copy-pasted:
//   1. Vignette as color darkening instead of alpha fade — preserves
//      line-circle's pre-refactor look (artwork stays opaque at the edges).
//   2. No cohort-labels debug block (that diagnostic is wired on
//      circle-on-line only, on purpose — see CLAUDE.md).
//
//   npm run build:line-circle
//
// test/line-circle-build.test.js rebuilds in memory and fails if the
// committed file no longer matches — the same drift protection
// shader-defs.js has. Edit circle-on-line.js (or the transforms here), then
// regenerate.

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'assets', 'circle-on-line.js');
export const OUTPUT = join(ROOT, 'assets', 'line-circle.js');

const BANNER = `// GENERATED FILE — do not edit by hand.
//
// Built from assets/circle-on-line.js by scripts/build-line-circle.mjs
// (npm run build:line-circle). The twins share everything except two
// deliberate deltas the build script applies: the vignette darkens color
// instead of fading alpha, and the cohort-labels debug block is absent.
// Edit circle-on-line.js (or the build script), then regenerate;
// test/line-circle-build.test.js fails if this file and the generator
// disagree.
`;

// Delta 1: vignette. circle-on-line fades alpha at the edges; line-circle
// keeps the artwork opaque and darkens the color instead.
const VIGNETTE_FROM =
  `    '    alpha = applyDistress(px.a, dUV, u_distress, u_distress_scale, u_grain_mode, u_distress_falloff, dot(finalColor, vec3(0.299, 0.587, 0.114)), vigMask) * u_opacity;',`;
const VIGNETTE_TO =
  `    '    // line-circle expresses the vignette as color darkening only (pre-refactor',
    '    // behavior: artwork stays opaque at the edges). Pass 1.0 so applyDistress',
    '    // does not also fade alpha — otherwise the vignette double-applies.',
    '    alpha = applyDistress(px.a, dUV, u_distress, u_distress_scale, u_grain_mode, u_distress_falloff, dot(finalColor, vec3(0.299, 0.587, 0.114)), 1.0) * u_opacity;',
    '    finalColor = finalColor * vigMask;',`;

// Delta 2: the cohort-labels debug block exists only on circle-on-line.
const LABELS_START = `\n    '',\n    '  // ── Cohort labels (diagnostic, u_group_debug = 0 in production)`;
const LABELS_END = `\n    '  fragColor = vec4(encoded * alpha, alpha);',`;

function applyOnce(src, from, to, what) {
  const first = src.indexOf(from);
  if (first === -1) throw new Error(`${what}: marker not found — circle-on-line.js changed shape; update the transform`);
  if (src.indexOf(from, first + 1) !== -1) throw new Error(`${what}: marker not unique`);
  return src.slice(0, first) + to + src.slice(first + from.length);
}

export function generate() {
  let src = readFileSync(SOURCE, 'utf8');

  src = applyOnce(src, VIGNETTE_FROM, VIGNETTE_TO, 'vignette delta');

  const labelsStart = src.indexOf(LABELS_START);
  if (labelsStart === -1) throw new Error('labels delta: start marker not found');
  const labelsEnd = src.indexOf(LABELS_END, labelsStart);
  if (labelsEnd === -1) throw new Error('labels delta: end marker not found after start');
  src = src.slice(0, labelsStart) + src.slice(labelsEnd);

  return BANNER + src;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(OUTPUT, generate());
  console.log('Wrote ' + OUTPUT + ' from ' + SOURCE);
}
