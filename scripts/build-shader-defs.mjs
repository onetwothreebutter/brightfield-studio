// Builds assets/shader-defs.js from the Liquid control snippets.
//
// The snippets are the source of truth — `sections/main-product.liquid` renders
// them straight into the product page. The dev pages (test-shaders.html,
// palette-lab.html) can't render Liquid, so they need the same arrays as a
// plain script. This script produces that script by *concatenation*, not by
// serialization: every control array and every `customAfterBuild` is the
// snippet's own source, closing over the base snippet's own globals. Nothing is
// retyped, so nothing can drift.
//
//   npm run build:shader-defs
//
// `test/shader-defs.test.js` rebuilds in memory and fails if the committed file
// no longer matches, so editing a snippet without regenerating is caught.

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SNIPPETS = join(ROOT, 'snippets');
export const OUTPUT = join(ROOT, 'assets', 'shader-defs.js');

// The only Liquid in any of these files is `{% render 'x' %}` — inline it.
function snippet(name) {
  const src = readFileSync(join(SNIPPETS, name + '.liquid'), 'utf8');
  return src.replace(/\{%-?\s*render\s+'([^']+)'\s*-?%\}/g, (_, inner) => snippet(inner));
}

export function shaderNames() {
  return readdirSync(SNIPPETS)
    .filter((f) => f.startsWith('shader-controls-') && f.endsWith('.liquid') && f !== 'shader-controls-base.liquid')
    .map((f) => f.slice('shader-controls-'.length, -'.liquid'.length))
    .sort();
}

function indent(src) {
  return src.split('\n').map((l) => (l ? '    ' + l : l)).join('\n');
}

export function generate() {
  const parts = [];

  parts.push(`// GENERATED FILE — do not edit by hand.
//
// Source: snippets/shader-controls-*.liquid (the same arrays the product page
// renders). Regenerate with \`npm run build:shader-defs\`; test/shader-defs.test.js
// fails if this file and the snippets disagree.
//
// Consumed by test-shaders.html and palette-lab.html, neither of which can
// render Liquid. \`ShaderDefs.SHADERS[name].controls\` is the control array;
// \`.build(container)\` re-runs the snippet against a real panel element, which
// is how a snippet that appends its own DOM (chladni's pattern randomizer) gets
// somewhere to put it.
(function () {
  'use strict';

    // Several snippets warm the web fonts they offer. Real browsers have the
    // Font Loading API; jsdom (where the tests evaluate this file) does not, and
    // a missing font is not a reason for a definitions file to throw.
    if (!document.fonts) {
      document.fonts = { load: function () {}, ready: Promise.resolve() };
    }

`);

  parts.push(indent(snippet('shader-controls-base')));

  parts.push(`
    var SHADERS = {};

    // Each snippet is re-run per call so its \`controls\` array and its
    // \`customAfterBuild\` closure belong to the panel being built. \`controls\`
    // is a lazy getter over a throwaway container, for callers that only want
    // the array (defaults, palette mapping, tests).
    function register(name, build) {
      var cached = null;
      function ensure() {
        if (!cached) cached = build(document.createElement('div'));
        return cached;
      }
      SHADERS[name] = {
        build: build,
        fonts: SHADER_FONTS,
        get controls() { return ensure().controls; },
        get customAfterBuild() { return ensure().customAfterBuild; }
      };
    }
`);

  for (const name of shaderNames()) {
    parts.push(`
    // ── ${name} ${'─'.repeat(Math.max(2, 66 - name.length))}
    register('${name}', function (body) {
${indent(indent(snippet('shader-controls-' + name)))}
      return {
        controls: controls,
        customAfterBuild: typeof customAfterBuild === 'function' ? customAfterBuild : null
      };
    });
`);
  }

  parts.push(`
    window.ShaderDefs = {
      SHADERS: SHADERS,
      SHADER_FONTS: SHADER_FONTS,
      COSINE_PRESETS: COSINE_PRESETS,
      FOUR_STOP_PRESETS: FOUR_STOP_PRESETS,
      FINISH_CONTROLS: FINISH_CONTROLS,
      FINISH_CONTROLS_PRE: FINISH_CONTROLS_PRE,
      FINISH_CONTROLS_POST: FINISH_CONTROLS_POST,
      PALETTE_COEFF_KEYS: PALETTE_COEFF_KEYS,
      srgbToLinear: srgbToLinear,
      linearToSrgb: linearToSrgb,
      hexToRgb: hexToRgb,
      toHex: toHex,
      vividHex: vividHex
    };
}());
`);

  return parts.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(OUTPUT, generate());
  console.log('Wrote ' + OUTPUT + ' from ' + shaderNames().length + ' snippets.');
}
