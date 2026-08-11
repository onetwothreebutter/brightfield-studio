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
      '../assets/probabilistic-palette-ui.js'
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
