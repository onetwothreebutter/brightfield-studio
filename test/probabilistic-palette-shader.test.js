import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let PP;
let PPS;
let SHADERS;

beforeAll(() => {
  // Same load pattern as the other asset tests: execute each classic script
  // against jsdom's window, then read the globals it publishes. The mapping
  // module is DOM-free by design, which is the whole reason it can be tested
  // here at all — WebGL cannot.
  ['../assets/probabilistic-palette.js', '../assets/shader-defs.js', '../assets/probabilistic-palette-shader.js']
    .forEach((f) => new Function(readFileSync(join(__dirname, f), 'utf8'))()); // eslint-disable-line no-new-func
  PP = window.ProbabilisticPalette;
  PPS = window.ProbabilisticPaletteShader;
  SHADERS = window.ShaderDefs.SHADERS;
});

const preset = (name = 'Brightfield / Black 01') => JSON.parse(JSON.stringify(PP.PRESETS[name]));
const names = () => Object.keys(SHADERS);

function map(shader, opts = {}) {
  return PPS.mapPalette(SHADERS[shader], {
    palette: opts.palette || preset(),
    seed: opts.seed || 'seed-1',
    variation: opts.variation != null ? opts.variation : 0.5
  });
}

describe('shader registry coverage', () => {
  it('knows all 13 product shaders', () => {
    expect(names()).toHaveLength(13);
    expect(names()).toContain('chladni');
    expect(names()).toContain('scribble-glyph');
  });

  it('yields a complete values object for every shader', () => {
    names().forEach((name) => {
      const { values } = map(name);
      const keys = SHADERS[name].controls.filter((c) => c.key).map((c) => c.key);
      keys.forEach((k) => {
        expect(values[k], `${name}.${k} is missing`).toBeDefined();
        if (typeof values[k] === 'number') {
          expect(Number.isFinite(values[k]), `${name}.${k} is not finite`).toBe(true);
        }
      });
    });
  });

  it('gives every shader at least one live color slot', () => {
    names().forEach((name) => {
      const { slots } = map(name);
      expect(slots.length, `${name} has no color slots`).toBeGreaterThan(0);
      slots.forEach((s) => {
        const ctrl = SHADERS[name].controls.find((c) => c.key === s.key);
        expect(ctrl, `${name}.${s.key} is not a control`).toBeDefined();
        expect(ctrl.type).toBe('color');
        // Values land in the shader as linear [r,g,b], never as a hex string.
        expect(Array.isArray(map(name).values[s.key])).toBe(true);
      });
    });
  });
});

describe('color mode selection', () => {
  it('prefers four-stop wherever a shader offers it', () => {
    names().forEach((name) => {
      const def = SHADERS[name];
      const stops = ['u_color0', 'u_color1', 'u_color2', 'u_color3'];
      const hasStops = stops.every((k) =>
        def.controls.some((c) => c.type === 'color' && c.key === k));
      const ctrl = def.controls.find((c) => c.key === 'u_color_mode');
      if (!hasStops || !ctrl) return;
      const mode = PPS.chooseColorMode(def);
      if (ctrl.type === 'select') {
        const opt = ctrl.options.find((o) => o.value === mode);
        expect(opt.label, `${name} chose ${opt.label}`).toMatch(/4[-\s]?(Stop|Color)/i);
      } else {
        expect(mode, `${name} toggle mode`).toBe(1);
      }
    });
  });

  it('reads the mode options rather than assuming a toggle', () => {
    // rise-shirt offers Cosine / 4-Stop / OKLCH as a select. Picking by option
    // label is what keeps this correct when a shader gains a mode.
    expect(PPS.chooseColorMode(SHADERS['rise-shirt'])).toBe('1');
    expect(map('rise-shirt').slots.map((s) => s.key))
      .toEqual(['u_color0', 'u_color1', 'u_color2', 'u_color3']);
  });

  it('handles chladni, which has no color mode at all', () => {
    expect(PPS.chooseColorMode(SHADERS['chladni'])).toBe(null);
    expect(map('chladni').slots.map((s) => s.key)).toEqual(['u_color1', 'u_color2']);
  });

  it('never assigns a palette color to a cosine curve coefficient', () => {
    names().forEach((name) => {
      const { slots } = map(name);
      slots.forEach((s) => {
        expect(window.ShaderDefs.PALETTE_COEFF_KEYS[s.key], `${name}.${s.key}`).toBeUndefined();
      });
    });
  });

  it('leaves outline colors at their default black — an outline is exposed shirt', () => {
    names().forEach((name) => {
      const { values } = map(name);
      Object.keys(values).forEach((k) => {
        if (/outline/.test(k) && Array.isArray(values[k])) {
          expect(values[k], `${name}.${k}`).toEqual([0, 0, 0]);
        }
      });
    });
  });

  it('skips slots that the chosen mode hides', () => {
    // four-circles is in four-stop mode, so its per-quadrant colors are dead
    // uniforms and must not eat a draw.
    const keys = map('four-circles').slots.map((s) => s.key);
    expect(keys).toContain('u_color0');
    expect(keys.some((k) => /^u_quad/.test(k))).toBe(false);
  });
});

describe('palette-owned keys', () => {
  // What a control panel hides: editing any of these would just be overwritten
  // on the next render.
  it('covers the color mode and every literal ink uniform of every shader', () => {
    names().forEach((name) => {
      const owned = PPS.paletteOwnedKeys(SHADERS[name]);
      const def = SHADERS[name];
      if (def.controls.some((c) => c.key === 'u_color_mode')) {
        expect(owned, `${name}`).toContain('u_color_mode');
      }
      // Every live slot in any mode has to be in the owned set, or the panel
      // would show a picker the palette is about to stomp on.
      map(name).slots.forEach((s) => expect(owned, `${name}.${s.key}`).toContain(s.key));
    });
  });

  it('leaves coefficients and outline colors editable', () => {
    names().forEach((name) => {
      const owned = PPS.paletteOwnedKeys(SHADERS[name]);
      SHADERS[name].controls.forEach((c) => {
        if (c.type !== 'color') return;
        if (window.ShaderDefs.PALETTE_COEFF_KEYS[c.key] || /outline/.test(c.key)) {
          expect(owned, `${name}.${c.key}`).not.toContain(c.key);
        }
      });
    });
  });

  it('is mode-independent, so a panel never reshuffles itself mid-edit', () => {
    // four-circles' per-quadrant colors are dead in four-stop mode but still
    // owned: flipping a toggle must not suddenly expose a palette-driven picker.
    expect(PPS.paletteOwnedKeys(SHADERS['four-circles'])).toContain('u_quad0');
    expect(map('four-circles').slots.map((s) => s.key)).not.toContain('u_quad0');
  });
});

describe('caller-supplied settings', () => {
  it('starts from opts.values instead of the control defaults', () => {
    const tuned = PPS.defaultValues(SHADERS['circle-on-line']);
    tuned.u_line_count = 60;
    const { values } = map('circle-on-line', { variation: 0 });
    expect(values.u_line_count).not.toBe(60);
    expect(PPS.mapPalette(SHADERS['circle-on-line'], {
      palette: preset(), seed: 'seed-1', variation: 0, values: tuned
    }).values.u_line_count).toBe(60);
  });

  it('never mutates the object it was handed', () => {
    const tuned = PPS.defaultValues(SHADERS['circle-on-line']);
    const before = JSON.parse(JSON.stringify(tuned));
    PPS.mapPalette(SHADERS['circle-on-line'], {
      palette: preset(), seed: 'seed-1', variation: 1, values: tuned
    });
    expect(tuned).toEqual(before);
  });

  it('drifts from the supplied value, not from the shader default', () => {
    // Anchoring on the default would drag a tuned setting back toward it on
    // every sample, which would quietly undo the panel.
    const def = SHADERS['circle-on-line'];
    const tuned = PPS.defaultValues(def);
    tuned.u_line_count = 60;
    const anchored = [];
    for (let i = 0; i < 40; i++) {
      anchored.push(PPS.mapPalette(def, {
        palette: preset(), seed: 'drift-' + i, variation: 0.2, values: tuned
      }).values.u_line_count);
    }
    const mean = anchored.reduce((a, b) => a + b, 0) / anchored.length;
    const ctrl = def.controls.find((c) => c.key === 'u_line_count');
    // A 20% drift toward a uniform draw over [min, max] pulls the mean toward
    // the midpoint by about that much — from 60, not from the default 20.
    const expected = 60 + ((ctrl.min + ctrl.max) / 2 - 60) * 0.2;
    expect(Math.abs(mean - expected)).toBeLessThan(6);
  });
});

describe('determinism', () => {
  it('reproduces an identical patch for identical inputs', () => {
    names().forEach((name) => {
      expect(map(name, { seed: 'abc' })).toEqual(map(name, { seed: 'abc' }));
    });
  });

  it('produces a different patch for a different seed', () => {
    expect(map('circle-on-line', { seed: 'abc' })).not.toEqual(map('circle-on-line', { seed: 'xyz' }));
  });

  it('produces a different patch when the palette changes', () => {
    const changed = preset();
    changed.colors[0].weight = 1;
    expect(map('circle-on-line', { seed: 'abc' }))
      .not.toEqual(map('circle-on-line', { seed: 'abc', palette: changed }));
  });

  it('never calls Math.random', () => {
    const src = readFileSync(join(__dirname, '../assets/probabilistic-palette-shader.js'), 'utf8');
    expect(src).not.toMatch(/Math\s*\.\s*random\s*\(/);
  });
});

describe('print density', () => {
  it('blacks out every slot at zero density — black is the shirt, never an ink', () => {
    const p = preset();
    p.printDensity = 0;
    names().forEach((name) => {
      const { slots, values } = map(name, { palette: p });
      slots.forEach((s) => {
        expect(s.printed).toBe(false);
        expect(s.hex).toBe('#000000');
        expect(values[s.key]).toEqual([0, 0, 0]);
      });
    });
  });

  it('inks every slot at full density', () => {
    const p = preset();
    p.printDensity = 1;
    names().forEach((name) => {
      map(name, { palette: p }).slots.forEach((s) => {
        expect(s.printed).toBe(true);
        expect(s.hex).not.toBe('#000000');
      });
    });
  });

  it('never introduces a color the palette does not contain', () => {
    const p = preset();
    const allowed = p.colors.map((c) => c.color.toUpperCase()).concat('#000000');
    names().forEach((name) => {
      for (let i = 0; i < 20; i++) {
        map(name, { palette: p, seed: 'ink-' + i }).slots.forEach((s) => {
          expect(allowed, `${name}: ${s.hex}`).toContain(s.hex.toUpperCase());
        });
      }
    });
  });
});

describe('spark rarity', () => {
  // Mint is the spark of Brightfield / Black 01 at 2% with variation locked off.
  // Rarity has to survive the jump to shaders: with only a handful of slots per
  // design it would be easy to accidentally hand every thumbnail one.
  function sparkShare(shader, samples = 50) {
    const p = preset();
    const sparkIndex = p.colors.findIndex((c) => c.spark);
    let hits = 0;
    for (let i = 0; i < samples; i++) {
      const { slots } = map(shader, { palette: p, seed: 'grid-' + i });
      if (slots.some((s) => s.colorIndex === sparkIndex)) hits++;
    }
    return hits / samples;
  }

  it('keeps the spark to a small minority of designs across 50 seeds', () => {
    const share = sparkShare('circle-on-line');
    expect(share).toBeLessThan(0.3);
  });

  it('still lets the spark through sometimes — size rules must not lock it out', () => {
    // The stock spark carries `maxSize: 0.35`, which a color slot could never
    // satisfy. Size rules are dropped for shaders precisely so the spark stays
    // reachable rather than silently impossible.
    let hits = 0;
    names().forEach((name) => {
      for (let i = 0; i < 40; i++) {
        const p = preset();
        const sparkIndex = p.colors.findIndex((c) => c.spark);
        if (map(name, { palette: p, seed: 'spark-' + i }).slots.some((s) => s.colorIndex === sparkIndex)) hits++;
      }
    });
    expect(hits).toBeGreaterThan(0);
  });

  it('honors maxShare — at most one spark slot in a single design', () => {
    const p = preset();
    const sparkIndex = p.colors.findIndex((c) => c.spark);
    p.colors[sparkIndex].weight = 400;   // try hard to flood it
    p.inheritance = 0;
    names().forEach((name) => {
      for (let i = 0; i < 10; i++) {
        const { slots } = map(name, { palette: p, seed: 'flood-' + i });
        const used = slots.filter((s) => s.colorIndex === sparkIndex).length;
        expect(used, `${name} placed ${used} sparks`).toBeLessThanOrEqual(1);
      }
    });
  });
});

describe('parameter variation', () => {
  it('leaves every non-color parameter at the shader default at zero variation', () => {
    names().forEach((name) => {
      const defaults = PPS.defaultValues(SHADERS[name]);
      const { values, slots } = map(name, { variation: 0 });
      const slotKeys = slots.map((s) => s.key);
      Object.keys(defaults).forEach((k) => {
        if (slotKeys.indexOf(k) >= 0 || k === 'u_color_mode') return;
        expect(values[k], `${name}.${k} drifted at variation 0`).toEqual(defaults[k]);
      });
    });
  });

  it('moves parameters once variation is turned up', () => {
    const still = map('chladni', { variation: 0 }).values;
    const moved = map('chladni', { variation: 1 }).values;
    expect(moved).not.toEqual(still);
  });

  it('respects noRandomize — the Finish section never drifts', () => {
    names().forEach((name) => {
      const defaults = PPS.defaultValues(SHADERS[name]);
      const { values, slots } = map(name, { variation: 1, seed: 'finish' });
      const slotKeys = slots.map((s) => s.key);
      SHADERS[name].controls.forEach((c) => {
        // A color slot is the palette's to set; noRandomize only says the
        // *parameter* must not drift, and a color is never a drifted parameter.
        if (!c.key || !c.noRandomize || slotKeys.indexOf(c.key) >= 0) return;
        expect(values[c.key], `${name}.${c.key} ignored noRandomize`).toEqual(defaults[c.key]);
      });
    });
  });

  it('leaves the text overlay alone — a grid is for judging color', () => {
    names().forEach((name) => {
      const defaults = PPS.defaultValues(SHADERS[name]);
      const { values } = map(name, { variation: 1, seed: 'text' });
      SHADERS[name].controls.forEach((c) => {
        if (!c.key) return;
        if (c.type === 'text' || c.textDirty || c.key.indexOf('text') === 0) {
          expect(values[c.key], `${name}.${c.key} was re-typeset`).toEqual(defaults[c.key]);
        }
      });
    });
  });

  it('keeps every varied range control on its own step and inside its bounds', () => {
    names().forEach((name) => {
      const { values } = map(name, { variation: 1, seed: 'bounds' });
      SHADERS[name].controls.forEach((c) => {
        if (c.type !== 'range' || !c.key) return;
        const v = c.toRadians ? values[c.key] * 180 / Math.PI : values[c.key];
        expect(v, `${name}.${c.key} below min`).toBeGreaterThanOrEqual(c.min - 1e-6);
        expect(v, `${name}.${c.key} above max`).toBeLessThanOrEqual(c.max + 1e-6);
        const steps = (v - c.min) / c.step;
        expect(Math.abs(steps - Math.round(steps)), `${name}.${c.key} is off-step`).toBeLessThan(1e-6);
      });
    });
  });
});

describe('size groups on a shader', () => {
  const grouped = (mode = 'bands', over = {}) => {
    const p = preset();
    p.sizeGroups = Object.assign({ enabled: true, mode, maxGroups: 4 }, over);
    return p;
  };

  it('is off unless the palette asks for it', () => {
    expect(map('rise-shirt').values.u_group_mode).toBe(0);
    expect(map('rise-shirt').groups).toBeNull();
  });

  it('emits bounds and one color per cohort', () => {
    const { values, groups } = map('rise-shirt', { palette: grouped() });
    expect(values.u_group_mode).toBe(1);
    expect(values.u_group_count).toBe(4);
    expect(values.u_group_bounds).toEqual([0.25, 0.5, 0.75]);
    expect(values.u_group_colors).toHaveLength(4);
    values.u_group_colors.forEach((rgb) => {
      expect(rgb).toHaveLength(3);
      rgb.forEach((c) => expect(Number.isFinite(c)).toBe(true));
    });
    expect(groups.cohorts).toHaveLength(4);
  });

  it('models a shader size field as continuous, so clusters honestly finds one group', () => {
    // A procedural shader sweeps size smoothly; there is no gap to split on.
    // This is exactly why fixed bands is the mode that does something here.
    const { values } = map('rise-shirt', { palette: grouped('clusters', { minGap: 0.02 }) });
    expect(values.u_group_count).toBe(1);
    expect(values.u_group_bounds).toEqual([]);
  });

  it('never exceeds the 8 cohorts the GLSL declares', () => {
    const { values } = map('rise-shirt', { palette: grouped('bands', { maxGroups: 8 }) });
    expect(values.u_group_count).toBeLessThanOrEqual(8);
    expect(values.u_group_bounds.length).toBeLessThanOrEqual(7);
  });

  it('does not thin the design out just because grouping is on', () => {
    // Grouping re-colours; it does not also delete. Density 1 makes every
    // element's roll pass, so a grouped design keeps every element it had.
    const p = grouped();
    p.printDensity = 0.4;
    const { values } = map('rise-shirt', { palette: p });
    expect(values.u_group_density).toBe(1);
  });

  it('hands print density to the GLSL when the palette opts in', () => {
    // The roll is per element, and only the shader knows how many elements there
    // are — so this layer sends the odds and the stream, not a verdict. A cohort
    // keeps its palette colour at any density.
    const p = grouped();
    p.printDensity = 0.4;
    p.sizeGroups.dropElements = true;
    const { values, groups } = map('rise-shirt', { palette: p });
    expect(values.u_group_density).toBe(0.4);
    expect(Number.isInteger(values.u_group_seed)).toBe(true);
    const allowed = p.colors.map((c) => c.color.toUpperCase());
    groups.cohorts.forEach((c) => {
      expect(c.printed).toBe(true);
      expect(allowed).toContain(c.hex.toUpperCase());
    });
    values.u_group_colors.forEach((rgb) => expect(rgb).not.toEqual([0, 0, 0]));
  });

  it('inks every cohort at full density, from the palette only', () => {
    const p = grouped();
    p.printDensity = 1;
    const allowed = p.colors.map((c) => c.color.toUpperCase());
    map('rise-shirt', { palette: p }).groups.cohorts.forEach((c) => {
      expect(c.printed).toBe(true);
      expect(allowed).toContain(c.hex.toUpperCase());
    });
  });

  it('gives the print stream its own tag, so grouping cannot shift the slot draws', () => {
    const p = grouped();
    const on = map('rise-shirt', { palette: p, seed: 'tag' });
    const off = map('rise-shirt', { palette: preset(), seed: 'tag' });
    expect(on.slots.map((s) => s.hex)).toEqual(off.slots.map((s) => s.hex));
    expect(on.values.u_group_seed).not.toBe(0);
  });

  it('solves for 8 cohorts rather than truncating a larger split', () => {
    // GROUP_MAX is a hard GLSL array size. A palette carrying maxGroups > 8
    // (the editor caps at 8, but stored/pasted JSON need not) must come back as
    // a genuine 8-band solution, not the first 7 boundaries of a 12-band one —
    // otherwise the top cohort spans a range nothing was drawn for and the
    // extra cohorts vanish along with their colors.
    const p = grouped('bands', { maxGroups: 12 });
    const { values } = map('rise-shirt', { palette: p });
    expect(values.u_group_count).toBe(8);
    expect(values.u_group_bounds).toHaveLength(7);
    values.u_group_bounds.forEach((b, i) => expect(b).toBeCloseTo((i + 1) / 8, 12));
    expect(values.u_group_colors).toHaveLength(8);
  });

  it('does not mutate the caller\'s palette when it clamps', () => {
    const p = grouped('bands', { maxGroups: 12 });
    map('rise-shirt', { palette: p });
    expect(p.sizeGroups.maxGroups).toBe(12);
  });

  it('stays deterministic', () => {
    const a = map('rise-shirt', { palette: grouped(), seed: 'g' });
    const b = map('rise-shirt', { palette: grouped(), seed: 'g' });
    expect(a).toEqual(b);
    expect(map('rise-shirt', { palette: grouped(), seed: 'h' })).not.toEqual(a);
  });

  it('emits the same uniforms for every shader — support is the GLSL’s to declare', () => {
    // The mapping is shader-agnostic on purpose; whether a shader *uses* the
    // uniforms is reported at runtime by shader-base from the linked program,
    // so this layer can never disagree with the GLSL.
    const ref = map('rise-shirt', { palette: grouped(), seed: 'same' }).values;
    names().forEach((name) => {
      const v = map(name, { palette: grouped(), seed: 'same' }).values;
      expect(v.u_group_count, name).toBe(ref.u_group_count);
      expect(v.u_group_bounds, name).toEqual(ref.u_group_bounds);
      expect(v.u_group_colors, name).toEqual(ref.u_group_colors);
    });
  });
});

describe('declared size fields', () => {
  const grouped = (mode = 'clusters', over = {}) => {
    const p = preset();
    p.sizeGroups = Object.assign({ enabled: true, mode, maxGroups: 5, minGap: 0.02, minShare: 0.06 }, over);
    return p;
  };

  it('ships with none declared, so every shader still gets the dense sample', () => {
    // The property that makes adding this hook a no-op: nothing declares a
    // field yet, so no shader's boundaries move.
    expect(Object.keys(PPS.SIZE_FIELDS)).toHaveLength(0);
    names().forEach((name) => {
      expect(PPS.sizeFieldFor(SHADERS[name], {}), name)
        .toHaveLength(PPS.SIZE_FIELD_SAMPLES);
    });
  });

  it('a shader def knows its own name, which is what the field is keyed on', () => {
    names().forEach((name) => expect(SHADERS[name].name).toBe(name));
  });

  it('lets a declared field replace the synthetic one', () => {
    // Four discrete sizes with real gaps — the case the dense sample cannot
    // represent, and the reason clusters collapses on a shader today.
    try {
      PPS.registerSizeField('rise-shirt', () => [0.05, 0.08, 0.5, 0.53, 0.95, 0.98]);
      const { values } = map('rise-shirt', { palette: grouped('clusters') });
      expect(values.u_group_count, 'clusters should find the gaps').toBeGreaterThan(1);
    } finally {
      delete PPS.SIZE_FIELDS['rise-shirt'];
    }
  });

  it('still collapses on a continuous field, which is the honest answer', () => {
    const { values } = map('rise-shirt', { palette: grouped('clusters') });
    expect(values.u_group_count).toBe(1);
  });

  it('reads the field from live values, not from the definition', () => {
    try {
      PPS.registerSizeField('rise-shirt', (v) => (v.u_rows > 10 ? [0, 0.9, 1] : [0, 0.02, 1]));
      expect(PPS.sizeFieldFor(SHADERS['rise-shirt'], { u_rows: 40 })).toEqual([0, 0.9, 1]);
      expect(PPS.sizeFieldFor(SHADERS['rise-shirt'], { u_rows: 2 })).toEqual([0, 0.02, 1]);
    } finally {
      delete PPS.SIZE_FIELDS['rise-shirt'];
    }
  });

  it('falls back rather than trusting a field it cannot use', () => {
    // A declared field is shader-authored data, so it is checked: too few
    // samples, a NaN, or a thrown error must not produce bounds nothing can be
    // grouped into.
    const bad = [() => [], () => [0.5], () => [0, NaN, 1], () => [0, undefined, 1],
      () => { throw new Error('boom'); }, () => null];
    bad.forEach((fn, i) => {
      try {
        PPS.registerSizeField('rise-shirt', fn);
        expect(PPS.sizeFieldFor(SHADERS['rise-shirt'], {}), `case ${i}`)
          .toHaveLength(PPS.SIZE_FIELD_SAMPLES);
      } finally {
        delete PPS.SIZE_FIELDS['rise-shirt'];
      }
    });
  });

  it('clamps a declared field into 0–1', () => {
    try {
      PPS.registerSizeField('rise-shirt', () => [-3, 0.5, 7]);
      expect(PPS.sizeFieldFor(SHADERS['rise-shirt'], {})).toEqual([0, 0.5, 1]);
    } finally {
      delete PPS.SIZE_FIELDS['rise-shirt'];
    }
  });

  it('every registered field names a real shader', () => {
    // The registry is the one thing here that is declared rather than detected,
    // so it is the one thing that can drift from the shader list.
    Object.keys(PPS.SIZE_FIELDS).forEach((n) => expect(names()).toContain(n));
  });
});

describe('shaders that opt into size groups', () => {
  const WIRED = ['rise-shirt', 'circle-on-line', 'line-circle', 'three-square'];

  // Two valid opt-in shapes, and the tests below have to accept both:
  //   applyPaletteGroups(col, size, id[, weight])   — the ordinary path
  //   paletteGroupedColor(col, size) + paletteElementPrinted(id, …)
  // The split form exists for a shader that post-processes the ink colour
  // before deciding whether ink lands at all: rise-shirt inverts its dots, and
  // inverting an already-masked colour turns "unprinted" into white ink.
  // One level of nesting, because rise-shirt passes paletteAt(mixFactor).
  const CALL = (fn) => new RegExp(fn + '\\(((?:[^()]|\\([^()]*\\))*)\\)');
  const argsOf = (m) => m[1].replace(/\([^()]*\)/g, '').split(',').map((a) => a.trim());
  const optIn = (src) => {
    const joint = src.match(CALL('applyPaletteGroups'));
    if (joint) return { form: 'joint', args: argsOf(joint) };
    const col = src.match(CALL('paletteGroupedColor'));
    const ink = src.match(CALL('paletteElementPrinted'));
    if (col && ink) {
      // Normalized to the joint form's shape: [col, size, elementId, weight?].
      // The colour call names the element itself once the spark is wired (so
      // the spark can land on it); the ink call supplies the id otherwise, and
      // its second argument is the weight when it is not the constant 1.0.
      const c = argsOf(col), k = argsOf(ink);
      const args = [c[0], c[1], c.length >= 3 ? c[2] : k[0]];
      if (k.length >= 2 && k[1] !== '1.0') args.push(k[1]);
      return { form: 'split', args };
    }
    return null;
  };

  it('call paletteGroupColor with a normalized element size', () => {
    WIRED.forEach((name) => {
      const src = readFileSync(join(__dirname, `../assets/${name}.js`), 'utf8');
      expect(optIn(src), `${name} does not opt in`).toBeTruthy();
    });
  });

  it('name the element they are coloring, so density rolls per element', () => {
    // The two-argument form still compiles, but a wired shader that used it
    // would silently go back to whole-cohort density — which is the limit this
    // wiring exists to remove. Three arguments, with a non-constant third.
    WIRED.forEach((name) => {
      const src = readFileSync(join(__dirname, `../assets/${name}.js`), 'utf8');
      const got = optIn(src);
      expect(got, `${name} does not opt in`).toBeTruthy();
      expect(got.args.length, `${name} passes no element id`).toBeGreaterThanOrEqual(3);
      expect(got.args.length, `${name} passes too many args`).toBeLessThanOrEqual(4);
      expect(got.args[2], `${name} passes a constant element id`).toMatch(/Id$/);
      if (got.args.length === 4) {
        expect(got.args[3], `${name} passes a constant weight`).toMatch(/W(gt|eight)$/);
      }
    });
  });

  it('shader-base declares the uniforms the shaders call', () => {
    const src = readFileSync(join(__dirname, '../assets/shader-base.js'), 'utf8');
    ['u_group_mode', 'u_group_count', 'u_group_bounds', 'u_group_colors',
      'u_group_seed', 'u_group_density', 'u_spark_color', 'u_spark_chance', 'u_spark_seed']
      .forEach((u) => expect(src).toContain(u));
    expect(src).toContain('vec3 paletteSparkOr(vec3 col, highp float elementId)');
    expect(src).toContain('vec3 paletteGroupedColor(vec3 col, float size, highp float elementId)');
    expect(src).toContain('vec3 paletteGroupColor(float size)');
    expect(src).toContain('vec3 applyPaletteGroups(vec3 col, float size)');
    expect(src).toContain('vec3 applyPaletteGroups(vec3 col, float size, highp float elementId)');
    expect(src).toContain('vec3 paletteGroupedColor(vec3 col, float size)');
  });

  it('qualifies the 32-bit path highp, which a fragment shader will not do for it', () => {
    // GLSL ES 3.00 defaults int/uint to mediump in a fragment shader — 16 bits
    // guaranteed — and every shader here declares only `precision mediump
    // float`. Left implicit, mulberry32 is exact on desktop and wrong on a
    // phone. The element ids the shaders build need the same treatment: past
    // 2048, a mediump float stops counting in ones and dots start sharing a roll.
    const src = readFileSync(join(__dirname, '../assets/shader-base.js'), 'utf8');
    expect(src).toContain('uniform highp uint  u_group_seed');
    expect(src).toContain('uniform highp float u_group_density');
    expect(src).toContain('highp uint paletteRoll32(highp uint a)');
    expect(src).toMatch(/highp float roll/);
    expect(src).not.toMatch(/'\s*uint t = a;/);
    WIRED.forEach((name) => {
      const s = readFileSync(join(__dirname, `../assets/${name}.js`), 'utf8');
      const id = optIn(s).args[2];
      expect(s, `${name} builds ${id} at default precision`)
        .toMatch(new RegExp(`highp float ${id}\\s*=`));
      // And every operand of that id, not just the result: GLSL evaluates an
      // expression at the precision of its operands, so `highp float id =
      // <mediump maths>` converts a value that already lost precision.
      const decl = s.match(new RegExp(`highp float ${id}\\s*=([^']*)`));
      (decl[1].match(/[A-Za-z_][A-Za-z0-9_]*/g) || [])
        .filter((tok) => /^(dot|col|line)[A-Za-z]*$/.test(tok) && tok !== id)
        .forEach((tok) => {
          expect(s, `${name}: ${id} mixes in ${tok}, which is not highp`)
            .toMatch(new RegExp(`highp float ${tok}\\s*=`));
        });
    });
  });

  it('masks rise-shirt after inverting, so a skipped dot is shirt and not white', () => {
    // applyPaletteGroups returns vec3(0) for an unprinted element, and
    // rise-shirt inverts its dots — so masking first printed pure white ink
    // exactly where the shirt was meant to show through.
    const src = readFileSync(join(__dirname, '../assets/rise-shirt.js'), 'utf8');
    const grouped = src.indexOf('paletteGroupedColor(');
    const invert = src.indexOf('1.0 - dotBase');
    const mask = src.indexOf('paletteElementPrinted(');
    expect(grouped).toBeGreaterThan(-1);
    expect(invert).toBeGreaterThan(grouped);
    expect(mask, 'the print mask must come after the invert').toBeGreaterThan(invert);
    // And it must not use the masking form, which would reintroduce the bug.
    expect(src).not.toMatch(/applyPaletteGroups\(/);
  });

  it('reads the word toggle a snippet actually defines', () => {
    // `wordEnabled` is defined by no snippet; four-circles ships
    // `u_text_enabled`. Keyed off the wrong name, the whole Word Overlay
    // section was permanently hidden and u_text_color never got a palette color.
    const gui = readFileSync(join(__dirname, '../assets/shader-gui.js'), 'utf8');
    const adapter = readFileSync(join(__dirname, '../assets/probabilistic-palette-shader.js'), 'utf8');
    expect(gui).not.toContain('wordEnabled');
    expect(adapter).not.toContain('wordEnabled');
    const def = SHADERS['four-circles'];
    const keys = def.controls.map((c) => c.key);
    expect(keys, 'four-circles lost its word toggle').toContain('u_text_enabled');
    const off = PPS.defaultValues(def);
    off.u_color_mode = PPS.chooseColorMode(def);
    expect(PPS.colorSlots(def, off)).not.toContain('u_text_color');
    const on = Object.assign({}, off, { u_text_enabled: 1 });
    expect(PPS.colorSlots(def, on)).toContain('u_text_color');
  });

  it('draws cohort labels on circle-on-line only, gated behind the debug flag', () => {
    // A diagnostic, scoped deliberately: the point is reading the tiering off
    // one shader while tuning it, not carrying an overlay everywhere.
    const col = readFileSync(join(__dirname, '../assets/circle-on-line.js'), 'utf8');
    expect(col).toContain('paletteGroupLabelMask(');
    expect(col).toMatch(/u_group_debug > 0\.5/);
    WIRED.filter((n) => n !== 'circle-on-line').forEach((name) => {
      const src = readFileSync(join(__dirname, `../assets/${name}.js`), 'utf8');
      expect(src, `${name} should not draw labels`).not.toContain('paletteGroupLabelMask');
    });
  });

  it('sizes circle-on-line per stripe, not per fragment', () => {
    // A stripe has exactly one thickness. Sampling the size where the fragment
    // happens to sit lets a cohort boundary fall inside a line and paint its top
    // half one colour and its bottom half another — measured at 24 split stripes
    // across 16 of 20 seeds before this, 0 after. It shows up when the bounds
    // bunch (clusters at a low minGap), which is exactly when it is hardest to
    // read as a bug rather than as the palette.
    const src = readFileSync(join(__dirname, '../assets/circle-on-line.js'), 'utf8');
    // The size handed to the palette must come from the stripe's own midpoint...
    expect(src).toMatch(/lineT\s*=\s*pow\(\(lineId \+ 0\.5\) \/ u_line_count, invP\)/);
    expect(src).toMatch(/lineWidthMid = mix\(u_width_top, u_width_bot, lineT\)/);
    expect(src).toMatch(/lineSize = lineSpan[\s\S]{0,120}lineWidthMid/);
    // ...and must NOT be derived from the per-fragment lineWidth, which is the
    // geometry and has to stay per-fragment for the stripe edges to be smooth.
    expect(src).not.toMatch(/lineSize = lineSpan[\s\S]{0,120}\(lineWidth -/);
    expect(src, 'lineMask must still use the per-fragment width')
      .toMatch(/smoothstep\(lineWidth - aaLine/);
  });

  it('keeps the label overlay out of the mapping, so a product render cannot get one', () => {
    // u_group_debug is the host's to set and is not a control, so it never
    // reaches _shaderState anywhere but the lab. If mapPalette ever emitted it,
    // a shirt could ship with numbers printed on it.
    const p = preset();
    p.sizeGroups = { enabled: true, mode: 'bands', maxGroups: 4 };
    const { values } = map('circle-on-line', { palette: p });
    expect(values.u_group_debug).toBeUndefined();
    expect(PPS.defaultValues(SHADERS['circle-on-line']).u_group_debug).toBeUndefined();
    const adapter = readFileSync(join(__dirname, '../assets/probabilistic-palette-shader.js'), 'utf8');
    expect(adapter).not.toContain('u_group_debug');
  });

  it('has a glyph for every cohort the GLSL can be asked to label', () => {
    // GROUP_MAX is 8, so paletteDigitBits must answer for 1–8. The final `return`
    // is the 8 case, hence seven explicit branches.
    const src = readFileSync(join(__dirname, '../assets/shader-base.js'), 'utf8');
    expect(src).toContain('uniform float u_group_debug');
    expect(src).toContain('float paletteGroupLabelMask(');
    for (let d = 1; d <= 7; d++) {
      expect(src, `digit ${d} has no branch`).toMatch(new RegExp(`if \\(d == ${d}\\) return 0x[0-9A-F]{4}u;`));
    }
    // Every pattern is 15 bits (3x5) — a wider value would spill into a
    // neighbouring row when shifted.
    const pats = src.match(/return 0x[0-9A-F]{4}u;/g) || [];
    expect(pats.length).toBe(8);
    pats.forEach((p) => {
      const v = parseInt(p.match(/0x([0-9A-F]{4})/)[1], 16);
      expect(v).toBeLessThan(1 << 15);
    });
  });

  it('transcribes the CPU generator rather than inventing a GPU one', () => {
    // The GLSL roll has to be mulberry32 over uints, the same generator
    // makeRng runs — a float hash would drift between drivers and break
    // same-seed-same-pixels. Pin the constants both sides share.
    const glsl = readFileSync(join(__dirname, '../assets/shader-base.js'), 'utf8');
    const cpu = readFileSync(join(__dirname, '../assets/probabilistic-palette.js'), 'utf8');
    expect(glsl).toContain('0x6D2B79F5u');
    expect(glsl).toContain('0x9E3779B1u');
    expect(cpu).toContain('0x6d2b79f5');
    expect(cpu).toContain('0x9E3779B1');
    // No float hashing in the roll — integer ops only.
    expect(glsl).not.toMatch(/fract\(sin\(/);
  });

  it('declares exactly as many cohort slots as the mapping can send', () => {
    const src = readFileSync(join(__dirname, '../assets/shader-base.js'), 'utf8');
    expect(src).toContain('uniform float u_group_bounds[7]');
    expect(src).toContain('uniform vec3  u_group_colors[8]');
  });
});

describe('per-element spark under size groups', () => {
  const grouped = (mutate) => {
    const p = preset();
    p.sizeGroups = { enabled: true, mode: 'bands', maxGroups: 4 };
    if (mutate) mutate(p);
    return p;
  };
  const sparkOf = (p) => p.colors.find((c) => c.spark);

  it('keeps the spark out of every cohort — that is the engine rule this exists for', () => {
    for (let i = 0; i < 40; i++) {
      const { groups } = map('rise-shirt', { palette: grouped(), seed: 's' + i, variation: 0 });
      groups.cohorts.forEach((c) => expect(c.hex.toUpperCase()).not.toBe(sparkOf(grouped()).color.toUpperCase()));
    }
  });

  it('sends the spark as a per-element roll instead: colour, chance and its own seed', () => {
    const p = grouped();
    const { values, groups } = map('rise-shirt', { palette: p, seed: 's1', variation: 0 });
    expect(values.u_spark_color).toEqual(window.ShaderDefs.hexToRgb(sparkOf(p).color, 'u_spark_color'));
    expect(values.u_spark_chance).toBeGreaterThan(0);
    expect(values.u_spark_chance).toBeLessThanOrEqual(1);
    expect(groups.spark).toEqual({ hex: sparkOf(p).color, colorIndex: p.colors.indexOf(sparkOf(p)), chance: values.u_spark_chance });
    // Distinct stream from the print roll, so a spark never moves a print decision.
    expect(values.u_spark_seed).toBe(PP.deriveSeed('s1', 'element-spark'));
    expect(values.u_spark_seed).not.toBe(values.u_group_seed);
  });

  it('caps the chance at maxShare, and it tracks the weight below that', () => {
    const capped = grouped((p) => { sparkOf(p).weight = 60; sparkOf(p).conditions.maxShare = 0.05; });
    expect(map('rise-shirt', { palette: capped, seed: 's1', variation: 0 }).values.u_spark_chance).toBeCloseTo(0.05, 12);
    const low = grouped((p) => { sparkOf(p).weight = 1; delete sparkOf(p).conditions.maxShare; });
    const high = grouped((p) => { sparkOf(p).weight = 30; delete sparkOf(p).conditions.maxShare; });
    const lc = map('rise-shirt', { palette: low, seed: 's1', variation: 0 }).values.u_spark_chance;
    const hc = map('rise-shirt', { palette: high, seed: 's1', variation: 0 }).values.u_spark_chance;
    expect(hc).toBeGreaterThan(lc);
    expect(hc).toBeCloseTo(30 / (39 + 25 + 17 + 11 + 6 + 30), 6);
  });

  it('is off — chance 0 — without a spark, or with grouping off', () => {
    const none = grouped((p) => { p.colors.forEach((c) => { delete c.spark; }); });
    const v = map('rise-shirt', { palette: none, seed: 's1', variation: 0 });
    expect(v.values.u_spark_chance).toBe(0);
    expect(v.groups.spark).toBeNull();
    const off = preset();
    expect(map('rise-shirt', { palette: off, seed: 's1', variation: 0 }).values.u_spark_chance).toBeUndefined();
  });

  it('lands the heaviest spark and adds the others to the odds', () => {
    const two = grouped((p) => {
      p.colors.push({ id: 'x', name: 'X', color: '#FF00FF', weight: 8, spark: true, variationScale: 0 });
      delete sparkOf(p).conditions.maxShare;
    });
    const { values, groups } = map('rise-shirt', { palette: two, seed: 's1', variation: 0 });
    expect(groups.spark.hex).toBe('#FF00FF');
    const total = two.colors.reduce((a, c) => a + c.weight, 0);
    expect(values.u_spark_chance).toBeCloseTo((8 + 2) / total, 6);
  });

  it('is what the wired shaders draw through', () => {
    const rise = readFileSync(join(__dirname, '../assets/rise-shirt.js'), 'utf8');
    expect(rise).toMatch(/paletteGroupedColor\([^;]*dotId\)/);
    ['circle-on-line', 'line-circle', 'three-square'].forEach((n) => {
      const src = readFileSync(join(__dirname, `../assets/${n}.js`), 'utf8');
      expect(src).toMatch(/applyPaletteGroups\(/);   // spark is inside that helper
    });
  });
});
