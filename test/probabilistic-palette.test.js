import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let PP;
let Demo;

beforeAll(() => {
  // Same load pattern as the other asset tests: execute the IIFE against jsdom's
  // window, then read the global it publishes.
  new Function(readFileSync(join(__dirname, '../assets/probabilistic-palette.js'), 'utf8'))(); // eslint-disable-line no-new-func
  new Function(readFileSync(join(__dirname, '../assets/probabilistic-palette-demo.js'), 'utf8'))(); // eslint-disable-line no-new-func
  PP = window.ProbabilisticPalette;
  Demo = window.ProbabilisticPaletteDemo;
});

const simple = () => ([
  { color: '#EFE6D2', weight: 0.39 },
  { color: '#4472E8', weight: 0.25 },
  { color: '#EF6045', weight: 0.17 },
  { color: '#E5AF3C', weight: 0.11 },
  { color: '#EF5A9D', weight: 0.06 },
  { color: '#69CDB5', weight: 0.02 }
]);

// Counts colors over many draws so distribution claims are measured, not assumed.
function sample(palette, n, seedPrefix = 's') {
  const counts = {};
  for (let i = 0; i < n; i++) {
    const c = PP.weightedRandomColor(palette, PP.makeRng(PP.deriveSeed(seedPrefix, i)));
    counts[c] = (counts[c] || 0) + 1;
  }
  return counts;
}

describe('seeded RNG', () => {
  it('produces the same stream for the same seed', () => {
    const a = PP.makeRng('abc');
    const b = PP.makeRng('abc');
    for (let i = 0; i < 20; i++) expect(a()).toBe(b());
  });

  it('produces different streams for different seeds', () => {
    const a = PP.makeRng('abc');
    const b = PP.makeRng('abd');
    expect(a()).not.toBe(b());
  });

  it('stays inside [0, 1)', () => {
    const rng = PP.makeRng(42);
    for (let i = 0; i < 500; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('deriveSeed is stable and tag-sensitive', () => {
    expect(PP.deriveSeed('s', 'shape', 3)).toBe(PP.deriveSeed('s', 'shape', 3));
    expect(PP.deriveSeed('s', 'shape', 3)).not.toBe(PP.deriveSeed('s', 'shape', 4));
    expect(PP.deriveSeed('s', 'shape', 3)).not.toBe(PP.deriveSeed('s', 'print', 3));
  });
});

// The GPU path for per-element print density is a transcription of these two
// functions (see paletteRoll32 in shader-base.js). It can't be run under jsdom,
// so what is pinned here is the contract it has to reproduce: uint32 in, the
// same stream out, no float arithmetic anywhere in the derivation.
describe('per-element rolls', () => {
  // Lazily, not at describe scope: PP is only published once beforeAll has run.
  const base = () => PP.deriveSeed('s', 'element-print');
  const seed = base;

  it('is deterministic per (base, id)', () => {
    const base = seed();
    expect(PP.elementRoll(base, 7)).toBe(PP.elementRoll(base, 7));
    expect(PP.elementRoll(base, 7)).not.toBe(PP.elementRoll(base, 8));
    expect(PP.elementRoll(base, 7)).not.toBe(PP.elementRoll(base + 1, 7));
  });

  it('stays a uint32 the GLSL can hold, for ids far past any real element count', () => {
    const base = seed();
    [0, 1, 4095, 65535, 1e6].forEach((id) => {
      const s = PP.elementSeed(base, id);
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(0xFFFFFFFF);
    });
  });

  it('is the first draw of makeRng on the mixed seed — one generator, not two', () => {
    const base = seed();
    const full = PP.makeRng(PP.elementSeed(base, 12))();
    // Quantized to the 24 bits a fragment shader's float can actually hold, so
    // the GPU makes this decision rather than one 8 bits away from it.
    expect(PP.elementRoll(base, 12)).toBe(Math.floor(full * 16777216) / 16777216);
    expect(Math.abs(PP.elementRoll(base, 12) - full)).toBeLessThan(1 / 16777216);
  });

  it('quantizes to a value a 24-bit mantissa holds exactly', () => {
    for (let id = 0; id < 200; id++) {
      const r = PP.elementRoll(base(), id) * 16777216;
      expect(Number.isInteger(r)).toBe(true);
    }
  });

  it('holds print density across a run of neighbouring ids', () => {
    const base = seed();
    // Adjacent element ids are the common case (a grid, a row of lines), so a
    // hash that correlated on low bits would band the print pattern instead of
    // scattering it. 20% tolerance on 4000 rolls.
    [0.25, 0.6, 0.9].forEach((density) => {
      let printed = 0;
      for (let id = 0; id < 4000; id++) if (PP.elementRoll(base, id) < density) printed++;
      expect(Math.abs(printed / 4000 - density)).toBeLessThan(density * 0.2);
    });
  });

  it('weights the print chance by how much ink an element carries', () => {
    // Weight 1 must be exactly the density, or wiring a weight into one shader
    // would quietly shift every shader that never asked for one.
    expect(PP.elementPrintChance(0.68, 1)).toBeCloseTo(0.68, 12);
    expect(PP.elementPrintChance(0.68, undefined)).toBeCloseTo(0.68, 12);
    // Bigger than average ⇒ likelier to print; smaller ⇒ likelier to drop.
    expect(PP.elementPrintChance(0.68, 6)).toBeGreaterThan(0.9);
    expect(PP.elementPrintChance(0.68, 0.4)).toBeLessThan(0.4);
    // Both endpoints are fixed points, whatever the weight — otherwise density 0
    // would leak ink and density 1 would punch holes in a design asking for none.
    [0.05, 1, 6, 20].forEach((w) => {
      expect(PP.elementPrintChance(0, w)).toBe(0);
      expect(PP.elementPrintChance(1, w)).toBe(1);
    });
  });

  it('keeps the weighted chance a probability for absurd weights', () => {
    [-5, 0, 1e9, NaN, Infinity].forEach((w) => {
      const c = PP.elementPrintChance(0.5, w);
      expect(Number.isFinite(c), `weight ${w}`).toBe(true);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    });
  });

  it('never prints at density 0 and always prints at density 1', () => {
    const base = seed();
    for (let id = 0; id < 500; id++) {
      expect(PP.elementRoll(base, id) < 0).toBe(false);
      expect(PP.elementRoll(base, id) < 1).toBe(true);
    }
  });
});

describe('normalizeWeights', () => {
  it('normalizes weights that already sum to 1', () => {
    expect(PP.normalizeWeights([0.5, 0.5])).toEqual([0.5, 0.5]);
  });

  it('normalizes arbitrary scales identically — 39/25 and 0.39/0.25 are the same palette', () => {
    const a = PP.normalizeWeights([39, 25, 17, 11, 6, 2]);
    const b = PP.normalizeWeights([0.39, 0.25, 0.17, 0.11, 0.06, 0.02]);
    a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 12));
    expect(a.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 12);
  });

  it('treats negative, NaN and missing weights as zero', () => {
    const out = PP.normalizeWeights([1, -5, NaN, undefined, 1]);
    expect(out).toEqual([0.5, 0, 0, 0, 0.5]);
  });

  it('falls back to a uniform split when every weight is zero', () => {
    expect(PP.normalizeWeights([0, 0, 0, 0])).toEqual([0.25, 0.25, 0.25, 0.25]);
  });
});

describe('weightedRandomColor', () => {
  it('is deterministic for a given seed', () => {
    const p = simple();
    const first = PP.weightedRandomColor(p, PP.makeRng('seed-1'));
    for (let i = 0; i < 5; i++) {
      expect(PP.weightedRandomColor(p, PP.makeRng('seed-1'))).toBe(first);
    }
  });

  it('reproduces the declared distribution within tolerance over many draws', () => {
    const n = 20000;
    const counts = sample(simple(), n);
    expect(counts['#EFE6D2'] / n).toBeCloseTo(0.39, 1);
    expect(counts['#4472E8'] / n).toBeCloseTo(0.25, 1);
    expect(counts['#EF6045'] / n).toBeCloseTo(0.17, 1);
    // The 2% spark should be present but genuinely rare.
    expect(counts['#69CDB5'] / n).toBeGreaterThan(0.01);
    expect(counts['#69CDB5'] / n).toBeLessThan(0.035);
  });

  it('does not require weights to sum to 1', () => {
    const n = 8000;
    const counts = sample([{ color: '#a', weight: 30 }, { color: '#b', weight: 10 }], n);
    expect(counts['#a'] / n).toBeCloseTo(0.75, 1);
  });

  it('never returns a zero-weight color', () => {
    const p = [{ color: '#a', weight: 1 }, { color: '#b', weight: 0 }];
    for (let i = 0; i < 500; i++) {
      expect(PP.weightedRandomColor(p, PP.makeRng(i))).toBe('#a');
    }
  });

  it('returns null for an empty palette', () => {
    expect(PP.weightedRandomColor([], PP.makeRng(1))).toBeNull();
  });
});

describe('tier classification', () => {
  it('assigns a legible hierarchy to the Black 01 preset', () => {
    const rows = PP.describe(PP.PRESETS['Brightfield / Black 01']);
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(byName['Warm White'].tier).toBe('dominant');
    expect(byName['Blue'].tier).toBe('supporting');
    expect(byName['Vermilion'].tier).toBe('supporting');
    expect(byName['Gold'].tier).toBe('accent');
    expect(byName['Pink'].tier).toBe('accent');
    expect(byName['Mint'].tier).toBe('spark');
  });

  it('honors an explicit spark flag over the weight arithmetic', () => {
    expect(PP.classifyTier(0.5, { spark: true })).toBe('spark');
    expect(PP.classifyTier(0.5, {})).toBe('dominant');
  });
});

describe('generative weights', () => {
  const base = () => ([
    { id: 'ivory', color: '#EFE6D2', weight: 40 },
    { id: 'blue', color: '#4472E8', weight: 25 },
    { id: 'coral', color: '#EF6045', weight: 17 },
    { id: 'gold', color: '#E5AF3C', weight: 10 },
    { id: 'pink', color: '#EF5A9D', weight: 6 },
    { id: 'mint', color: '#69CDB5', weight: 2, variationScale: 0 }
  ]);

  it('returns the base shares when variation is 0', () => {
    const out = PP.applyGenerativeVariation(base(), 'seed', 0);
    expect(out).toEqual(PP.paletteShares(base()));
  });

  it('is deterministic from the seed', () => {
    const a = PP.applyGenerativeVariation(base(), 'artwork-7', 0.25);
    const b = PP.applyGenerativeVariation(base(), 'artwork-7', 0.25);
    expect(a).toEqual(b);
  });

  it('gives different seeds different weightings', () => {
    const a = PP.applyGenerativeVariation(base(), 'artwork-7', 0.25);
    const b = PP.applyGenerativeVariation(base(), 'artwork-8', 0.25);
    expect(a).not.toEqual(b);
  });

  it('always renormalizes to 1', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      const out = PP.applyGenerativeVariation(base(), seed, 0.5);
      expect(out.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 10);
    }
  });

  it('keeps the palette recognizable at 10% — the leader stays the leader', () => {
    for (let i = 0; i < 60; i++) {
      const out = PP.applyGenerativeVariation(base(), 'seed-' + i, 0.1);
      const maxIndex = out.indexOf(Math.max(...out));
      expect(maxIndex).toBe(0);
      // The example in the spec moves ivory 40 → 34–46; stay in that ballpark.
      expect(out[0]).toBeGreaterThan(0.3);
      expect(out[0]).toBeLessThan(0.52);
    }
  });

  it('holds locked colors at their exact base share', () => {
    const shares = PP.paletteShares(base());
    for (let i = 0; i < 40; i++) {
      const out = PP.applyGenerativeVariation(base(), 'seed-' + i, 0.5);
      expect(out[5]).toBeCloseTo(shares[5], 12);
    }
  });

  it('moves further at higher variation', () => {
    const shares = PP.paletteShares(base());
    const spread = (v) => {
      let total = 0;
      for (let i = 0; i < 40; i++) {
        const out = PP.applyGenerativeVariation(base(), 'seed-' + i, v);
        total += Math.abs(out[0] - shares[0]);
      }
      return total / 40;
    };
    expect(spread(0.5)).toBeGreaterThan(spread(0.25));
    expect(spread(0.25)).toBeGreaterThan(spread(0.1));
    expect(spread(0.1)).toBeGreaterThan(0);
  });
});

describe('spatial probability', () => {
  it('maps each mode to a 0–1 field with the expected orientation', () => {
    expect(PP.spatialField('top-bottom', 0.5, 0)).toBe(0);
    expect(PP.spatialField('top-bottom', 0.5, 1)).toBe(1);
    expect(PP.spatialField('left-right', 0, 0.5)).toBe(0);
    expect(PP.spatialField('left-right', 1, 0.5)).toBe(1);
    expect(PP.spatialField('center-edge', 0.5, 0.5)).toBe(0);
    expect(PP.spatialField('center-edge', 0, 0.5)).toBe(1);
    expect(PP.spatialField('radial', 0.5, 0.5)).toBe(0);
    expect(PP.spatialField('radial', 0, 0)).toBeCloseTo(1, 6);
  });

  it('interpolates probabilities, not colors', () => {
    const palette = {
      spatial: { enabled: true, mode: 'top-bottom' },
      colors: [
        { color: '#ivory', weight: 40, spatial: [55, 20] },
        { color: '#blue', weight: 30, spatial: [30, 10] },
        { color: '#coral', weight: 20, spatial: [8, 35] },
        { color: '#gold', weight: 10, spatial: [5, 25] }
      ]
    };
    const top = PP.effectiveWeights(palette, { x: 0.5, y: 0, size: 0.5 }).weights;
    const mid = PP.effectiveWeights(palette, { x: 0.5, y: 0.5, size: 0.5 }).weights;
    const bottom = PP.effectiveWeights(palette, { x: 0.5, y: 1, size: 0.5 }).weights;

    expect(top[0]).toBeCloseTo(55 / 98, 6);
    expect(bottom[0]).toBeCloseTo(20 / 90, 6);
    // Mid-canvas sits between the ends for every color — a probability gradient.
    palette.colors.forEach((c, i) => {
      const lo = Math.min(top[i], bottom[i]);
      const hi = Math.max(top[i], bottom[i]);
      expect(mid[i]).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(mid[i]).toBeLessThanOrEqual(hi + 1e-9);
    });
    // Colors themselves are untouched — no RGB blending anywhere.
    expect(palette.colors.map((c) => c.color)).toEqual(['#ivory', '#blue', '#coral', '#gold']);
  });

  it('ignores spatial weights entirely when the toggle is off', () => {
    const colors = [
      { color: '#a', weight: 40, spatial: [90, 1] },
      { color: '#b', weight: 60, spatial: [1, 90] }
    ];
    const off = { spatial: { enabled: false, mode: 'top-bottom' }, colors };
    expect(PP.effectiveWeights(off, { x: 0.5, y: 0, size: 0.5 }).weights)
      .toEqual(PP.effectiveWeights(off, { x: 0.5, y: 1, size: 0.5 }).weights);
  });

  it('shifts the realized distribution across the canvas', () => {
    const palette = {
      printDensity: 1,
      inheritance: 0,
      spatial: { enabled: true, mode: 'top-bottom' },
      colors: [
        { color: '#ivory', weight: 40, spatial: [55, 20] },
        { color: '#coral', weight: 20, spatial: [8, 35] }
      ]
    };
    const countAt = (y) => {
      const a = PP.createAssigner(palette, { seed: 'spatial-test' });
      let ivory = 0;
      for (let i = 0; i < 3000; i++) {
        if (a.assign({ index: i, x: 0.5, y, size: 0.5 }).color === '#ivory') ivory++;
      }
      return ivory / 3000;
    };
    expect(countAt(0)).toBeCloseTo(55 / 63, 1);
    expect(countAt(1)).toBeCloseTo(20 / 55, 1);
    expect(countAt(0)).toBeGreaterThan(countAt(1));
  });
});

describe('geometry-aware color', () => {
  it('evaluates piecewise-linear curves and clamps outside the domain', () => {
    const curve = [[0, 0.2], [0.5, 1], [1, 2]];
    expect(PP.evalCurve(curve, 0)).toBeCloseTo(0.2, 10);
    expect(PP.evalCurve(curve, 0.25)).toBeCloseTo(0.6, 10);
    expect(PP.evalCurve(curve, 0.5)).toBeCloseTo(1, 10);
    expect(PP.evalCurve(curve, 0.75)).toBeCloseTo(1.5, 10);
    expect(PP.evalCurve(curve, 1)).toBeCloseTo(2, 10);
    expect(PP.evalCurve(curve, -3)).toBeCloseTo(0.2, 10);
    expect(PP.evalCurve(curve, 9)).toBeCloseTo(2, 10);
    expect(PP.evalCurve(null, 0.5)).toBe(1);
  });

  it('lets large and small shapes prefer different colors from one palette', () => {
    const palette = {
      colors: [
        { color: '#ivory', weight: 40, sizeCurve: PP.SIZE_CURVE_PRESETS.large },
        { color: '#gold', weight: 40, sizeCurve: PP.SIZE_CURVE_PRESETS.tiny }
      ]
    };
    const big = PP.effectiveWeights(palette, { x: 0.5, y: 0.5, size: 1 }).weights;
    const small = PP.effectiveWeights(palette, { x: 0.5, y: 0.5, size: 0 }).weights;
    expect(big[0]).toBeGreaterThan(big[1]);
    expect(small[1]).toBeGreaterThan(small[0]);
  });

  it('is disabled by geometryEnabled: false', () => {
    const colors = [
      { color: '#a', weight: 50, sizeCurve: PP.SIZE_CURVE_PRESETS.large },
      { color: '#b', weight: 50, sizeCurve: PP.SIZE_CURVE_PRESETS.tiny }
    ];
    const off = { geometryEnabled: false, colors };
    expect(PP.effectiveWeights(off, { size: 0 }).weights)
      .toEqual(PP.effectiveWeights(off, { size: 1 }).weights);
  });
});

describe('spark conditions', () => {
  const spark = (conditions) => ({ color: '#mint', weight: 2, spark: true, conditions });

  it('gates on shape size', () => {
    expect(PP.isEligible(spark({ maxSize: 0.3 }), { size: 0.2 }, null, 0)).toBe(true);
    expect(PP.isEligible(spark({ maxSize: 0.3 }), { size: 0.6 }, null, 0)).toBe(false);
    expect(PP.isEligible(spark({ minSize: 0.7 }), { size: 0.6 }, null, 0)).toBe(false);
  });

  it('gates on rectangular and radial regions', () => {
    expect(PP.isEligible(spark({ region: { yMax: 0.5 } }), { x: 0.5, y: 0.2 }, null, 0)).toBe(true);
    expect(PP.isEligible(spark({ region: { yMax: 0.5 } }), { x: 0.5, y: 0.8 }, null, 0)).toBe(false);
    expect(PP.isEligible(spark({ region: { rMax: 0.4 } }), { x: 0.5, y: 0.5 }, null, 0)).toBe(true);
    expect(PP.isEligible(spark({ region: { rMax: 0.4 } }), { x: 0, y: 0 }, null, 0)).toBe(false);
  });

  it('gates on the previously assigned color', () => {
    const stats = { previousColor: '#4472E8', used: [0], eligible: [0], expectedEligible: 0 };
    expect(PP.isEligible(spark({ afterColor: '#4472E8' }), { size: 0.5 }, stats, 0)).toBe(true);
    expect(PP.isEligible(spark({ afterColor: '#EF6045' }), { size: 0.5 }, stats, 0)).toBe(false);
  });

  it('caps a spark at a share of the shapes when the total is known', () => {
    const palette = {
      printDensity: 1,
      inheritance: 0,
      colors: [
        { color: '#ivory', weight: 50 },
        { color: '#mint', weight: 50, spark: true, conditions: { maxShare: 0.05 } }
      ]
    };
    const a = PP.createAssigner(palette, { seed: 'cap', totalShapes: 200 });
    let mint = 0;
    for (let i = 0; i < 200; i++) {
      if (a.assign({ index: i, x: 0.5, y: 0.5, size: 0.5 }).color === '#mint') mint++;
    }
    // Weighted at 50% but capped at 5% of 200 shapes.
    expect(mint).toBe(10);
  });

  it('falls back to the base hierarchy when every color is gated out', () => {
    const palette = {
      colors: [
        { color: '#a', weight: 70, conditions: { minSize: 0.9 } },
        { color: '#b', weight: 30, conditions: { minSize: 0.9 } }
      ]
    };
    const w = PP.effectiveWeights(palette, { x: 0.5, y: 0.5, size: 0.1 }).weights;
    expect(w[0]).toBeCloseTo(0.7, 10);
    expect(w[1]).toBeCloseTo(0.3, 10);
  });
});

describe('print density', () => {
  it('leaves roughly (1 - density) of shapes unprinted', () => {
    const palette = { printDensity: 0.68, inheritance: 0, colors: simple() };
    const a = PP.createAssigner(palette, { seed: 'density' });
    let printed = 0;
    const n = 5000;
    for (let i = 0; i < n; i++) if (a.assign({ index: i, x: 0.5, y: 0.5, size: 0.5 }).printed) printed++;
    expect(printed / n).toBeCloseTo(0.68, 1);
  });

  it('returns no color at all for unprinted shapes — never black ink', () => {
    const palette = { printDensity: 0.5, inheritance: 0, colors: simple() };
    const a = PP.createAssigner(palette, { seed: 'transparent' });
    for (let i = 0; i < 400; i++) {
      const r = a.assign({ index: i, x: 0.5, y: 0.5, size: 0.5 });
      if (!r.printed) {
        expect(r.color).toBeNull();
        expect(r.colorIndex).toBe(-1);
      }
    }
  });

  it('prints everything at density 1 and nothing at density 0', () => {
    const all = PP.createAssigner({ printDensity: 1, colors: simple() }, { seed: 'x' });
    const none = PP.createAssigner({ printDensity: 0, colors: simple() }, { seed: 'x' });
    for (let i = 0; i < 200; i++) {
      expect(all.assign({ index: i }).printed).toBe(true);
      expect(none.assign({ index: i }).printed).toBe(false);
    }
  });

  it('does not change which shapes print when color settings change', () => {
    const printedSet = (p) => {
      const a = PP.createAssigner(p, { seed: 'stable' });
      const out = [];
      for (let i = 0; i < 300; i++) if (a.assign({ index: i, size: 0.5 }).printed) out.push(i);
      return out;
    };
    const base = { printDensity: 0.6, inheritance: 0, colors: simple() };
    const recolored = { printDensity: 0.6, inheritance: 0.9, colors: simple().reverse() };
    expect(printedSet(base)).toEqual(printedSet(recolored));
  });
});

describe('color inheritance', () => {
  const palette = (inheritance) => ({
    printDensity: 1,
    inheritance,
    colors: [
      { color: '#a', weight: 25 }, { color: '#b', weight: 25 },
      { color: '#c', weight: 25 }, { color: '#d', weight: 25 }
    ]
  });

  // Fraction of consecutive shapes that share a color — the readable proxy for
  // "confetti vs. large graphic regions".
  function runRatio(inheritance, n = 4000) {
    const a = PP.createAssigner(palette(inheritance), { seed: 'inherit' });
    let prev = null, same = 0;
    for (let i = 0; i < n; i++) {
      const c = a.assign({ index: i, x: 0.5, y: 0.5, size: 0.5 }).color;
      if (prev !== null && c === prev) same++;
      prev = c;
    }
    return same / (n - 1);
  }

  it('rises monotonically from confetti to large color regions', () => {
    const r0 = runRatio(0);
    const r50 = runRatio(0.5);
    const r65 = runRatio(0.65);
    const r95 = runRatio(0.95);
    expect(r0).toBeCloseTo(0.25, 1);      // pure chance for a 4-color even palette
    expect(r50).toBeGreaterThan(r0);
    expect(r65).toBeGreaterThan(r50);
    expect(r95).toBeGreaterThan(r65);
    expect(r95).toBeGreaterThan(0.9);
  });

  it('marks inherited assignments', () => {
    const a = PP.createAssigner(palette(1), { seed: 'inherit-flag' });
    const first = a.assign({ index: 0, size: 0.5 });
    const second = a.assign({ index: 1, size: 0.5 });
    expect(first.inherited).toBe(false);   // nothing to inherit from yet
    expect(second.inherited).toBe(true);
    expect(second.color).toBe(first.color);
  });

  it('prefers a parent shape over the previous shape', () => {
    const a = PP.createAssigner(palette(1), { seed: 'parent' });
    const root = a.assign({ index: 0, size: 0.5 });
    a.assign({ index: 1, size: 0.5 });
    a.assign({ index: 2, size: 0.5 });
    // Recolor index 3 from the root rather than from index 2.
    const child = a.assign({ index: 3, size: 0.5, parentIndex: 0 });
    expect(child.color).toBe(root.color);
    expect(child.inherited).toBe(true);
  });

  it('never inherits at 0', () => {
    const a = PP.createAssigner(palette(0), { seed: 'no-inherit' });
    for (let i = 0; i < 200; i++) {
      expect(a.assign({ index: i, size: 0.5, parentIndex: i > 0 ? 0 : null }).inherited).toBe(false);
    }
  });
});

describe('seed determinism end to end', () => {
  const preset = () => JSON.parse(JSON.stringify(PP.PRESETS['Brightfield / Black 01']));

  function run(seed, palette, count = 150) {
    const shapes = Demo.generate('subdivision', { seed, depth: 5 });
    const a = PP.createAssigner(palette, { seed, totalShapes: shapes.length });
    return shapes.slice(0, count).map((s, i) =>
      a.assign({ index: i, x: s.x, y: s.y, size: s.size, parentIndex: s.parentIndex }));
  }

  it('reproduces an identical artwork for identical inputs', () => {
    expect(run('artwork-1', preset())).toEqual(run('artwork-1', preset()));
  });

  it('produces a different artwork for a different seed', () => {
    expect(run('artwork-1', preset())).not.toEqual(run('artwork-2', preset()));
  });

  it('produces a different artwork when the palette changes', () => {
    const changed = preset();
    changed.colors[0].weight = 5;
    expect(run('artwork-1', preset())).not.toEqual(run('artwork-1', changed));
  });

  it('generates identical geometry for the same seed and settings', () => {
    expect(Demo.generate('subdivision', { seed: 'g', depth: 5 }))
      .toEqual(Demo.generate('subdivision', { seed: 'g', depth: 5 }));
    expect(Demo.generate('scatter', { seed: 'g', count: 40 }))
      .toEqual(Demo.generate('scatter', { seed: 'g', count: 40 }));
  });

  it('never calls Math.random anywhere in the palette source', () => {
    const files = [
      '../assets/probabilistic-palette.js',
      '../assets/probabilistic-palette-demo.js',
      '../assets/probabilistic-palette-ui.js',
      '../assets/probabilistic-palette-shader.js'
    ];
    files.forEach((f) => {
      const src = readFileSync(join(__dirname, f), 'utf8');
      // Call sites only — the comments deliberately name Math.random to explain
      // why it isn't used.
      expect(src).not.toMatch(/Math\s*\.\s*random\s*\(/);
    });
  });
});

describe('geometry generators', () => {
  it('normalizes shape size to the 0–1 range within a composition', () => {
    ['subdivision', 'scatter'].forEach((algo) => {
      const shapes = Demo.generate(algo, { seed: 'norm', depth: 5, count: 60 });
      expect(shapes.length).toBeGreaterThan(4);
      const sizes = shapes.map((s) => s.size);
      expect(Math.min(...sizes)).toBeCloseTo(0, 6);
      expect(Math.max(...sizes)).toBeCloseTo(1, 6);
      shapes.forEach((s) => {
        expect(s.x).toBeGreaterThanOrEqual(0);
        expect(s.x).toBeLessThanOrEqual(1);
        expect(s.y).toBeGreaterThanOrEqual(0);
        expect(s.y).toBeLessThanOrEqual(1);
      });
    });
  });
});

describe('import', () => {
  const COOLORS = ['#606C38', '#283618', '#FEFAE0', '#DDA15E', '#BC6C25'];

  describe('parseHexList', () => {
    it('parses every separator a palette site produces', () => {
      expect(PP.parseHexList('#606c38, #283618, #fefae0, #dda15e, #bc6c25')).toEqual(COOLORS);
      expect(PP.parseHexList('#606c38\n#283618\n#fefae0\n#dda15e\n#bc6c25')).toEqual(COOLORS);
      expect(PP.parseHexList('#606c38 #283618 #fefae0 #dda15e #bc6c25')).toEqual(COOLORS);
      expect(PP.parseHexList('606c38-283618-fefae0-dda15e-bc6c25')).toEqual(COOLORS);
    });

    it('parses bare hex and normalizes case', () => {
      expect(PP.parseHexList('606c38 283618')).toEqual(['#606C38', '#283618']);
      expect(PP.parseHexList('#EfE6d2')).toEqual(['#EFE6D2']);
    });

    it('expands #abc shorthand but rejects bare abc', () => {
      expect(PP.parseHexList('#abc')).toEqual(['#AABBCC']);
      expect(PP.parseHexList('#f00 #0f0')).toEqual(['#FF0000', '#00FF00']);
      expect(PP.parseHexList('abc')).toEqual([]);
      expect(PP.parseHexList('cafe fad bed')).toEqual([]);
    });

    it('reads a full Coolors URL as exactly its slug colors', () => {
      expect(PP.parseHexList('https://coolors.co/palette/606c38-283618-fefae0-dda15e-bc6c25'))
        .toEqual(COOLORS);
    });

    it('collapses duplicates, keeping first-occurrence order', () => {
      expect(PP.parseHexList('#283618, #606c38, #283618, #606C38'))
        .toEqual(['#283618', '#606C38']);
    });

    it('returns an empty list for prose and non-strings, never throwing', () => {
      expect(PP.parseHexList('a warm olive palette I found on Pinterest')).toEqual([]);
      expect(PP.parseHexList('')).toEqual([]);
      expect(PP.parseHexList(null)).toEqual([]);
      expect(PP.parseHexList(undefined)).toEqual([]);
    });
  });

  describe('paletteFromHexList', () => {
    it('builds a decaying hierarchy in paste order with the last color as the spark', () => {
      const p = PP.paletteFromHexList(COOLORS);
      expect(p.colors.map((c) => c.color)).toEqual(COOLORS);
      for (let i = 1; i < p.colors.length; i++) {
        expect(p.colors[i].weight).toBeLessThan(p.colors[i - 1].weight);
      }
      const spark = p.colors[p.colors.length - 1];
      expect(spark.spark).toBe(true);
      expect(spark.variationScale).toBe(0);
      expect(spark.conditions).toBeTruthy();
      expect(Object.keys(spark.conditions).length).toBeGreaterThan(0);
      const shares = PP.paletteShares(p.colors);
      expect(shares[shares.length - 1]).toBeCloseTo(0.03, 2);
    });

    it('lands a 5-color import on a full dominant → spark spread', () => {
      expect(PP.classifyPalette(PP.paletteFromHexList(COOLORS).colors))
        .toEqual(['dominant', 'supporting', 'supporting', 'accent', 'spark']);
    });

    it('makes no spark below 4 colors', () => {
      const p = PP.paletteFromHexList(COOLORS.slice(0, 3));
      expect(p.colors.length).toBe(3);
      expect(p.colors.some((c) => c.spark)).toBe(false);
    });

    it('floors long lists at weight 0.5 so nothing becomes invisible', () => {
      const many = PP.parseHexList(
        '#606c38 #283618 #fefae0 #dda15e #bc6c25 #4472e8 #ef6045 #e5af3c #ef5a9d #69cdb5 #7b3b8c #8fd8f2');
      expect(many.length).toBe(12);
      const p = PP.paletteFromHexList(many);
      expect(p.colors.length).toBe(12);
      p.colors.forEach((c) => expect(c.weight).toBeGreaterThanOrEqual(0.5));
    });

    it('gives every entry a unique id, a name and a normalized hex', () => {
      const p = PP.paletteFromHexList(['#606c38', '#616c38', '#fefae0', '#dda15e']);
      const ids = p.colors.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
      p.colors.forEach((c) => {
        expect(c.color).toMatch(/^#[0-9A-F]{6}$/);
        expect(typeof c.name).toBe('string');
        expect(c.name.length).toBeGreaterThan(0);
        expect(c.spatial).toEqual([c.weight, c.weight]);
      });
    });

    it('names near-neutrals as materials and chromatics by hue', () => {
      expect(PP.hexColorName('#EFE6D2')).toBe('Bone');
      expect(PP.hexColorName('#FEFAE0')).toBe('Chalk');
      expect(PP.hexColorName('#4A4E58')).toBe('Slate');
      expect(PP.hexColorName('#4472E8')).toBe('Bright Blue');
      expect(PP.hexColorName('#283618')).toBe('Deep Green');
    });

    it('carries the black-tee defaults and an overridable name', () => {
      const p = PP.paletteFromHexList(COOLORS);
      expect(p.name).toBe('Imported Palette');
      expect(p.printDensity).toBe(0.68);
      expect(p.inheritance).toBe(0.65);
      expect(p.weightVariation).toBe(0.10);
      expect(p.generativeWeights).toBe(true);
      expect(p.spatial).toEqual({ enabled: false, mode: 'top-bottom' });
      expect(PP.paletteFromHexList(COOLORS, { name: 'Pinterest 1' }).name).toBe('Pinterest 1');
    });

    it('accepts a raw pasted string as well as a parsed list', () => {
      expect(PP.paletteFromHexList('#606c38, #283618, #fefae0'))
        .toEqual(PP.paletteFromHexList(['#606C38', '#283618', '#FEFAE0']));
    });

    it('is deterministic — same input, deep-equal palette', () => {
      expect(PP.paletteFromHexList(COOLORS)).toEqual(PP.paletteFromHexList(COOLORS));
    });

    it('returns an empty palette for an empty list', () => {
      const p = PP.paletteFromHexList([]);
      expect(p.colors).toEqual([]);
    });

    it('drives an assigner over a real composition', () => {
      const p = PP.paletteFromHexList(COOLORS);
      const shapes = Demo.generate('scatter', { seed: 'import', count: 2000 });
      const a = PP.createAssigner(p, { seed: 'import', totalShapes: shapes.length });
      const known = new Set(COOLORS);
      let printed = 0;
      shapes.forEach((s, i) => {
        const r = a.assign({ index: i, x: s.x, y: s.y, size: s.size, parentIndex: s.parentIndex });
        if (r.printed) { printed++; expect(known.has(r.color)).toBe(true); }
        else expect(r.color).toBeNull();
      });
      expect(printed / shapes.length).toBeCloseTo(0.68, 1);
      expect(a.tally().reduce((s, v) => s + v, 0)).toBeCloseTo(1, 6);
      // The imported spark is capped, so it stays a find even at 2000 shapes.
      expect(a.tally()[4]).toBeLessThan(0.06);
    });

    it('tracks its declared shares once the size curves are out of the way', () => {
      const p = PP.paletteFromHexList(COOLORS, { geometryEnabled: false });
      const shapes = Demo.generate('scatter', { seed: 'import', count: 2000 });
      const a = PP.createAssigner(p, { seed: 'import', totalShapes: shapes.length });
      shapes.forEach((s, i) =>
        a.assign({ index: i, x: s.x, y: s.y, size: s.size, parentIndex: s.parentIndex }));
      const tally = a.tally();
      const shares = a.shares();
      // Inheritance clusters the draws, so the observed mix is noisy around the
      // hierarchy rather than equal to it.
      shares.forEach((s, i) => expect(Math.abs(tally[i] - s)).toBeLessThan(0.1));
    });
  });
});

describe('presets', () => {
  it('ships Brightfield / Black 01 with the specified settings', () => {
    const p = PP.PRESETS['Brightfield / Black 01'];
    expect(p.printDensity).toBe(0.68);
    expect(p.inheritance).toBe(0.65);
    expect(p.weightVariation).toBe(0.10);
    expect(p.generativeWeights).toBe(true);
    const shares = PP.paletteShares(p.colors);
    const pct = shares.map((s) => Math.round(s * 100));
    expect(pct).toEqual([39, 25, 17, 11, 6, 2]);
    expect(p.colors.map((c) => c.color)).toEqual(
      ['#EFE6D2', '#4472E8', '#EF6045', '#E5AF3C', '#EF5A9D', '#69CDB5']);
  });

  it('registers additional presets under their name', () => {
    expect(Object.keys(PP.PRESETS).length).toBeGreaterThanOrEqual(3);
    Object.keys(PP.PRESETS).forEach((name) => {
      const p = PP.PRESETS[name];
      expect(p.name).toBe(name);
      expect(p.colors.length).toBeGreaterThan(1);
      p.colors.forEach((c) => expect(c.color).toMatch(/^#[0-9A-Fa-f]{6}$/));
    });
  });

  it('registerPreset adds a palette without touching the engine', () => {
    const added = PP.registerPreset(PP.createPalette({
      name: 'Test / Added', colors: [{ color: '#FFFFFF', weight: 1 }]
    }));
    expect(PP.PRESETS['Test / Added']).toBe(added);
    delete PP.PRESETS['Test / Added'];
  });

  it('clonePalette produces an independent copy', () => {
    const original = PP.PRESETS['Brightfield / Black 01'];
    const copy = PP.clonePalette(original, 'My Palette');
    copy.colors[0].weight = 99;
    expect(copy.name).toBe('My Palette');
    expect(original.colors[0].weight).toBe(39);
    expect(copy.id).not.toBe(original.id);
  });
});

// ── Size groups ──────────────────────────────────────────────────────────────
// A third kind of structure, next to geography (where a shape is) and
// inheritance (what it is next to): shapes of the same scale take one color,
// wherever they sit.

describe('size group boundaries', () => {
  it('splits at the widest gaps in the distribution', () => {
    // Three obvious tiers with empty bands between them.
    const sizes = [0, 0.02, 0.04, 0.5, 0.52, 0.54, 0.98, 1];
    const bounds = PP.sizeGroupBounds(sizes, { minGap: 0.06, maxGroups: 5 });
    expect(bounds).toHaveLength(2);
    expect(bounds[0]).toBeGreaterThan(0.04);
    expect(bounds[0]).toBeLessThan(0.5);
    expect(bounds[1]).toBeGreaterThan(0.54);
    expect(bounds[1]).toBeLessThan(0.98);
  });

  it('returns no split for a smooth distribution — one group is the honest answer', () => {
    const sizes = Array.from({ length: 50 }, (_, i) => i / 49);
    expect(PP.sizeGroupBounds(sizes, { minGap: 0.06, maxGroups: 5 })).toEqual([]);
  });

  it('keeps only the widest gaps when there are more candidates than groups', () => {
    // Gaps of 0.15, 0.30, 0.35, 0.20 — all above minGap, all distinct.
    const sizes = [0, 0.15, 0.45, 0.8, 1];
    const bounds = PP.sizeGroupBounds(sizes, { minGap: 0.05, maxGroups: 3 });
    expect(bounds).toHaveLength(2);
    // The two widest are 0.45→0.8 and 0.15→0.45; boundaries sit mid-gap.
    expect(bounds[0]).toBeCloseTo(0.3, 6);
    expect(bounds[1]).toBeCloseTo(0.625, 6);
  });

  it('is pure — same sizes in, same bounds out, in any input order', () => {
    const sizes = [0.9, 0.1, 0.5, 0.12, 0.88, 0.52];
    const a = PP.sizeGroupBounds(sizes, { minGap: 0.1, maxGroups: 4 });
    const b = PP.sizeGroupBounds(sizes.slice().reverse(), { minGap: 0.1, maxGroups: 4 });
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('assigns sizes to groups in ascending order', () => {
    const bounds = [0.3, 0.7];
    expect(PP.groupIndexOf(bounds, 0.0)).toBe(0);
    expect(PP.groupIndexOf(bounds, 0.29)).toBe(0);
    expect(PP.groupIndexOf(bounds, 0.31)).toBe(1);
    expect(PP.groupIndexOf(bounds, 1.0)).toBe(2);
  });
});

describe('size-grouped assignment', () => {
  const grouped = (overrides = {}) => {
    const p = JSON.parse(JSON.stringify(PP.PRESETS['Brightfield / Black 01']));
    p.printDensity = 1;             // isolate grouping from the print roll
    p.sizeGroups = { enabled: true, minGap: 0.06, maxGroups: 5 };
    return Object.assign(p, overrides);
  };

  // Three clean tiers, so grouping has something unambiguous to find.
  const tiered = () => {
    const shapes = [];
    for (let i = 0; i < 30; i++) {
      const tier = i % 3;
      shapes.push({ x: (i % 6) / 5, y: Math.floor(i / 6) / 4, size: tier * 0.5 + (i % 5) * 0.004 });
    }
    return shapes;
  };

  function run(palette, shapes, seed = 'g1') {
    const a = PP.createAssigner(palette, { seed, totalShapes: shapes.length, shapes });
    return { a, out: shapes.map((s, i) => a.assign({ index: i, x: s.x, y: s.y, size: s.size })) };
  }

  it('gives every shape in a cohort the same color', () => {
    const shapes = tiered();
    const { a, out } = run(grouped(), shapes);
    const bounds = a.groups().bounds;
    const byGroup = {};
    out.forEach((r, i) => {
      if (!r.printed || r.spark) return;   // sparks are deliberate exceptions
      const g = PP.groupIndexOf(bounds, shapes[i].size);
      byGroup[g] = byGroup[g] || new Set();
      byGroup[g].add(r.color);
    });
    Object.keys(byGroup).forEach((g) => {
      expect(byGroup[g].size, `group ${g} used ${[...byGroup[g]].join(', ')}`).toBe(1);
    });
    expect(Object.keys(byGroup).length).toBeGreaterThan(1);
  });

  it('reports the cohorts it found', () => {
    const { a } = run(grouped(), tiered());
    const g = a.groups();
    expect(g.bounds).toHaveLength(2);
    expect(g.colors).toHaveLength(3);
    g.colors.forEach((c) => expect(c.color).toMatch(/^#[0-9A-F]{6}$/i));
  });

  it('never exceeds maxGroups', () => {
    const shapes = Array.from({ length: 40 }, (_, i) => ({ x: 0.5, y: 0.5, size: i / 39 }));
    const p = grouped({ sizeGroups: { enabled: true, minGap: 0.005, maxGroups: 3 } });
    const { a } = run(p, shapes);
    expect(a.groups().bounds.length).toBeLessThanOrEqual(2);
  });

  it('stays inert when the caller does not pass shapes', () => {
    const shapes = tiered();
    const p = grouped();
    const withShapes = PP.createAssigner(p, { seed: 'x', totalShapes: shapes.length, shapes });
    const without = PP.createAssigner(p, { seed: 'x', totalShapes: shapes.length });
    expect(withShapes.groups()).not.toBeNull();
    expect(without.groups()).toBeNull();
  });

  it('reproduces an identical artwork for identical inputs', () => {
    const shapes = tiered();
    expect(run(grouped(), shapes, 'same').out).toEqual(run(grouped(), shapes, 'same').out);
    expect(run(grouped(), shapes, 'a').out).not.toEqual(run(grouped(), shapes, 'b').out);
  });

  it('keeps every element by default — grouping re-colours, it does not delete', () => {
    // Turning grouping on must not silently remove elements the design had a
    // moment earlier: that reads as grouping being broken rather than as density
    // doing its job.
    const shapes = tiered();
    const { out } = run(grouped({ printDensity: 0.5 }), shapes);
    expect(out.filter((r) => r.printed)).toHaveLength(shapes.length);
    out.forEach((r) => expect(r.color).not.toBeNull());
  });

  it('lets print density expose the shirt when the palette opts in', () => {
    const shapes = tiered();
    const p = grouped({ printDensity: 0.5 });
    p.sizeGroups.dropElements = true;
    const { out } = run(p, shapes);
    const printed = out.filter((r) => r.printed).length;
    expect(printed).toBeGreaterThan(0);
    expect(printed).toBeLessThan(shapes.length);
    out.filter((r) => !r.printed).forEach((r) => expect(r.color).toBeNull());
  });

  it('re-colours rather than reshuffles when that setting is flipped', () => {
    // The print roll is drawn either way, so every downstream stream stays put:
    // the elements that survive at dropElements:true must be coloured exactly as
    // they are when nothing is dropped.
    const shapes = tiered();
    const keep = grouped({ printDensity: 0.5 });
    const drop = grouped({ printDensity: 0.5 });
    drop.sizeGroups.dropElements = true;
    const a = run(keep, shapes).out;
    const b = run(drop, shapes).out;
    b.forEach((r, i) => { if (r.printed) expect(r.color, `shape ${i}`).toBe(a[i].color); });
  });

  // Swept across many seeds, not one: the single-seed version of this test
  // passed for months while sparks were in fact winning ~5% of cohorts, because
  // the hardcoded seed happened to miss. Every stock preset is covered, since
  // the two failure paths differed (spatial off read the frozen shares, spatial
  // on read the color's own `spatial` pair).
  it('never lets a spark win a size cohort, across every preset and 200 seeds', () => {
    Object.keys(PP.PRESETS).forEach((name) => {
      const shapes = tiered();
      const base = JSON.parse(JSON.stringify(PP.PRESETS[name]));
      const sparkIndex = base.colors.findIndex((c) => c.spark);
      expect(sparkIndex, `${name} has no spark`).toBeGreaterThanOrEqual(0);
      for (let i = 0; i < 200; i++) {
        const p = JSON.parse(JSON.stringify(base));
        p.printDensity = 1;
        p.sizeGroups = { enabled: true, minGap: 0.06, maxGroups: 5 };
        const a = PP.createAssigner(p, { seed: `${name}-${i}`, totalShapes: shapes.length, shapes });
        a.groups().colors.forEach((c, g) => {
          expect(c && c.colorIndex, `${name} seed ${i}: spark took cohort ${g}`).not.toBe(sparkIndex);
        });
      }
    });
  });

  it('still lets a spark land on individual shapes inside a group', () => {
    const shapes = tiered();
    const p = grouped();
    const sparkIndex = p.colors.findIndex((c) => c.spark);
    p.colors[sparkIndex].conditions = { maxShare: 0.2 };   // drop the size gate

    let sparkHits = 0, total = 0;
    for (let i = 0; i < 40; i++) {
      const { out } = run(p, shapes, 'spark-' + i);
      out.forEach((r) => { if (r.printed) { total++; if (r.colorIndex === sparkIndex) sparkHits++; } });
    }
    expect(sparkHits).toBeGreaterThan(0);
    expect(sparkHits / total).toBeLessThan(0.15);
  });
});

describe('size groups reject singleton tiers', () => {
  it('will not split off a lone outlier, however wide its gap', () => {
    // 40 shapes packed at the bottom, one stray at the top. The stray's gap is
    // by far the widest, but a group of one is not a color structure.
    const sizes = Array.from({ length: 40 }, (_, i) => i * 0.002).concat([1]);
    expect(PP.sizeGroupBounds(sizes, { minGap: 0.05, maxGroups: 4 })).toEqual([]);
  });

  it('still splits when both sides carry a real population', () => {
    const sizes = Array.from({ length: 20 }, (_, i) => i * 0.002)
      .concat(Array.from({ length: 20 }, (_, i) => 0.9 + i * 0.002));
    const bounds = PP.sizeGroupBounds(sizes, { minGap: 0.05, maxGroups: 4 });
    expect(bounds).toHaveLength(1);
    expect(bounds[0]).toBeGreaterThan(0.04);
    expect(bounds[0]).toBeLessThan(0.9);
  });

  it('honors minShare — lowering it lets smaller tiers through', () => {
    const sizes = Array.from({ length: 38 }, (_, i) => i * 0.002).concat([0.9, 0.92]);
    expect(PP.sizeGroupBounds(sizes, { minGap: 0.05, maxGroups: 4, minShare: 0.2 })).toEqual([]);
    expect(PP.sizeGroupBounds(sizes, { minGap: 0.05, maxGroups: 4, minShare: 0.05 })).toHaveLength(1);
  });

  it('produces groups that all carry members on a real composition', () => {
    const shapes = Demo.generate('scatter', { seed: 'pop', count: 160 });
    const bounds = PP.sizeGroupBounds(shapes.map((s) => s.size), { minGap: 0.06, maxGroups: 5 });
    const counts = new Array(bounds.length + 1).fill(0);
    shapes.forEach((s) => { counts[PP.groupIndexOf(bounds, s.size)]++; });
    counts.forEach((n, i) => {
      expect(n, `group ${i} of ${counts.length} is empty or a singleton`).toBeGreaterThan(1);
    });
  });
});

describe('fixed size bands', () => {
  it('cuts the range into equal slices, regardless of the distribution', () => {
    const smooth = Array.from({ length: 50 }, (_, i) => i / 49);
    const bounds = PP.sizeGroupBounds(smooth, { mode: 'bands', maxGroups: 4 });
    expect(bounds).toEqual([0.25, 0.5, 0.75]);
  });

  it('gives the asked-for count where clusters would find none', () => {
    // The smooth case clusters honestly reports as one group.
    const smooth = Array.from({ length: 50 }, (_, i) => i / 49);
    expect(PP.sizeGroupBounds(smooth, { mode: 'clusters', minGap: 0.06, maxGroups: 4 })).toEqual([]);
    expect(PP.sizeGroupBounds(smooth, { mode: 'bands', maxGroups: 4 })).toHaveLength(3);
  });

  it('ignores minGap and minShare — the count is the whole point', () => {
    const clumped = Array.from({ length: 40 }, (_, i) => i * 0.001).concat([1]);
    const bounds = PP.sizeGroupBounds(clumped, { mode: 'bands', maxGroups: 3, minGap: 0.5, minShare: 0.4 });
    expect(bounds).toEqual([1 / 3, 2 / 3]);
  });

  it('collapses to a single group at one band', () => {
    const sizes = [0, 0.5, 1];
    expect(PP.sizeGroupBounds(sizes, { mode: 'bands', maxGroups: 1 })).toEqual([]);
  });

  it('is pure and order-independent, like clusters', () => {
    const sizes = [0.9, 0.1, 0.5];
    expect(PP.sizeGroupBounds(sizes, { mode: 'bands', maxGroups: 5 }))
      .toEqual(PP.sizeGroupBounds(sizes.slice().reverse(), { mode: 'bands', maxGroups: 5 }));
  });

  it('drives the assigner: one color per band, on a composition clusters would not split', () => {
    const p = JSON.parse(JSON.stringify(PP.PRESETS['Brightfield / Black 01']));
    p.printDensity = 1;
    p.sizeGroups = { enabled: true, mode: 'bands', maxGroups: 4 };
    const shapes = Array.from({ length: 60 }, (_, i) => ({ x: 0.5, y: 0.5, size: i / 59 }));
    const a = PP.createAssigner(p, { seed: 'bands', totalShapes: shapes.length, shapes });
    const out = shapes.map((s, i) => a.assign({ index: i, x: s.x, y: s.y, size: s.size }));

    expect(a.groups().bounds).toEqual([0.25, 0.5, 0.75]);
    const byBand = {};
    out.forEach((r, i) => {
      if (!r.printed || r.spark) return;
      const g = PP.groupIndexOf(a.groups().bounds, shapes[i].size);
      byBand[g] = byBand[g] || new Set();
      byBand[g].add(r.color);
    });
    expect(Object.keys(byBand)).toHaveLength(4);
    Object.keys(byBand).forEach((g) => expect(byBand[g].size).toBe(1));
  });

  it('defaults to clusters when no mode is given', () => {
    const sizes = Array.from({ length: 50 }, (_, i) => i / 49);
    expect(PP.sizeGroupBounds(sizes, { minGap: 0.06, maxGroups: 4 })).toEqual([]);
    expect(PP.DEFAULT_SIZE_GROUPS.mode).toBe('clusters');
  });
});
