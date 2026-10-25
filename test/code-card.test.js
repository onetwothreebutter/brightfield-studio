import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let CC;
let SHADERS;

beforeAll(() => {
  ['../assets/shader-base.js', '../assets/shader-defs.js', '../assets/code-card.js']
    .forEach((f) => new Function(readFileSync(join(__dirname, f), 'utf8'))()); // eslint-disable-line no-new-func
  CC = window.CodeCard;
  SHADERS = window.ShaderDefs.SHADERS;
});

const design = { shader: 'three-square', values: { u_square_count: 3, u_offset: 0.2 } };
const b64 = (o) => btoa(JSON.stringify(o));

describe('parseDesign', () => {
  it('reads all four spellings of the restore payload', () => {
    expect(CC.parseDesign(JSON.stringify(design))).toEqual(design);
    expect(CC.parseDesign(JSON.stringify({ format: 'x', design }))).toEqual(design);
    expect(CC.parseDesign(b64(design))).toEqual(design);
    expect(CC.parseDesign('https://shop.example/products/square-dance?bfr=' + encodeURIComponent(b64(design)) + '#shader'))
      .toEqual(design);
  });

  it('refuses anything without a shader name and a values object', () => {
    ['', '   ', 'not a design', '{"shader":"x"}', '{"values":{}}', '{"shader":"x","values":[1]}', '{broken', b64({ a: 1 })]
      .forEach((t) => expect(CC.parseDesign(t)).toBeNull());
    expect(CC.parseDesign(null)).toBeNull();
  });
});

describe('source listing', () => {
  it('folds the shared commonGLSL block to one row and keeps real line numbers', () => {
    const shared = window.ShaderBase.commonGLSL;
    const n = shared.split('\n').length;
    const src = ['#version 300 es', 'uniform float u_a;', shared, 'void main() {', '}'].join('\n');
    const rows = CC.sourceRows(src, shared);
    expect(rows).toHaveLength(5);
    expect(rows[2]).toEqual({ shared: true, count: n });
    expect(rows[3]).toEqual({ line: 3 + n, text: 'void main() {' });
  });

  it('lists everything when the shared block is absent', () => {
    expect(CC.sourceRows('a\nb', window.ShaderBase.commonGLSL)).toEqual([
      { line: 1, text: 'a' }, { line: 2, text: 'b' }
    ]);
  });

  it('finds main() for the default excerpt', () => {
    expect(CC.mainLine('uniform float a;\n\nvoid main() {\n}')).toBe(3);
    expect(CC.mainLine('no entry point')).toBe(1);
  });
});

describe('excerpt', () => {
  const src = 'void f() {\n    float a = 1.0;   \n\n      a += 2.0;\n}';

  it('takes an inclusive 1-based range in either order, dedented and right-trimmed', () => {
    expect(CC.excerpt(src, 2, 4)).toBe('float a = 1.0;\n\n  a += 2.0;');
    expect(CC.excerpt(src, 4, 2)).toBe(CC.excerpt(src, 2, 4));
  });

  it('clamps a range past either end', () => {
    expect(CC.excerpt(src, 0, 99).split('\n')).toHaveLength(5);
  });

  it('expands tabs before measuring indent', () => {
    expect(CC.dedent('\tx\n\t\ty')).toBe('x\n  y');
  });
});

describe('settingsLine', () => {
  it('names the design from its own range controls, ahead of Finish', () => {
    const def = SHADERS['three-square'];
    const values = Object.assign({}, { u_square_count: 4, u_fill: 1, u_offset: 0.13, u_density: 26 });
    expect(CC.settingsLine(def, values)).toBe('// count 4 · fill 1 · diagonal offset 0.13 · column density 26');
  });

  it('rounds to the control step and falls back to the control default', () => {
    const def = { controls: [
      { key: 'u_w', label: 'Width', type: 'range', step: 0.01, value: 0.5 },
      { key: 'u_r', label: 'Rotation', type: 'range', step: 1, value: 90, toRadians: true },
      { type: 'header', label: 'Finish' },
      { key: 'u_scale', label: 'Scale', type: 'range', step: 0.05, value: 1 }
    ] };
    expect(CC.settingsLine(def, { u_w: 0.123456, u_r: Math.PI / 4 })).toBe('// width 0.12 · rotation 45');
    expect(CC.settingsLine(def, {})).toBe('// width 0.5 · rotation 90');
    expect(CC.settingsLine({ controls: [] }, {})).toBe('');
  });
});

describe('fitLayout', () => {
  const base = { width: 1000, height: 1200, padding: 0.1, lineHeight: 1.5, advance: 0.6 };

  it('never lets the longest line or the last row leave the padded box', () => {
    [[80, 10], [10, 80], [40, 40], [1, 1]].forEach(([cols, rows]) => {
      const l = CC.fitLayout(Object.assign({ cols, rows }, base));
      expect(l.x).toBeGreaterThanOrEqual(100 - 1e-9);
      expect(l.y).toBeGreaterThanOrEqual(100 - 1e-9);
      expect(l.x + cols * l.cellW).toBeLessThanOrEqual(900 + 1e-9);
      expect(l.y + rows * l.cellH).toBeLessThanOrEqual(1100 + 1e-9);
    });
  });

  it('fills one axis and centres the block on the other', () => {
    const wide = CC.fitLayout(Object.assign({ cols: 80, rows: 10 }, base));
    expect(wide.x).toBeCloseTo(100);
    expect(wide.y).toBeCloseTo((1200 - 10 * wide.cellH) / 2);
    const tall = CC.fitLayout(Object.assign({ cols: 10, rows: 80 }, base));
    expect(tall.y).toBeCloseTo(100);
    expect(tall.x).toBeCloseTo((1000 - 10 * tall.cellW) / 2);
  });
});

describe('highlightWeight', () => {
  const o = { rows: 30, band: 1, soft: 1.5 };
  const rows = [...Array(30).keys()];

  it('loops without a seam: phase 1 is phase 0, and nothing is lit there', () => {
    rows.forEach((r) => {
      expect(CC.highlightWeight(r, 1, o)).toBeCloseTo(CC.highlightWeight(r, 0, o), 12);
      expect(CC.highlightWeight(r, 0, o)).toBe(0);
    });
  });

  it('lights every row fully once per loop, in order from the top', () => {
    const peaks = rows.map((r) => {
      let best = 0, at = -1;
      for (let i = 0; i < 2000; i++) {
        const w = CC.highlightWeight(r, i / 2000, o);
        if (w > best) { best = w; at = i; }
      }
      expect(best).toBe(1);
      return at;
    });
    peaks.slice(1).forEach((p, i) => expect(p).toBeGreaterThan(peaks[i]));
  });

  it('stays between 0 and 1 and falls off with distance from the band', () => {
    for (let i = 0; i <= 100; i++) {
      rows.forEach((r) => {
        const w = CC.highlightWeight(r, i / 100, o);
        expect(w).toBeGreaterThanOrEqual(0);
        expect(w).toBeLessThanOrEqual(1);
      });
    }
    const period = 30 + 1 + 3;
    const phaseAt = (row) => (row + 0.5 + 0.5 + 1.5) / period;   // band centred on `row`
    const p = phaseAt(10);
    expect(CC.highlightWeight(10, p, o)).toBe(1);
    expect(CC.highlightWeight(11, p, o)).toBeGreaterThan(CC.highlightWeight(12, p, o));
    expect(CC.highlightWeight(14, p, o)).toBe(0);
  });

  it('steps one line at a time with no falloff', () => {
    const hard = { rows: 30, band: 1, soft: 0 };
    for (let i = 0; i < 300; i++) {
      const lit = rows.filter((r) => CC.highlightWeight(r, (i + 0.37) / 300, hard) === 1);
      expect(lit.length).toBeLessThanOrEqual(1);
      rows.forEach((r) => expect([0, 1]).toContain(CC.highlightWeight(r, (i + 0.37) / 300, hard)));
    }
  });
});

describe('sampleCell', () => {
  // 4×2 image: left half black, right half two different inks.
  const data = new Uint8ClampedArray([
    0, 0, 0, 255,   0, 0, 0, 255,   200, 100, 0, 255,   100, 50, 0, 255,
    0, 0, 0, 255,   10, 10, 10, 255, 200, 100, 0, 255,  100, 50, 0, 255
  ]);

  it('reports the inked share, and the ink at full strength rather than a muddy mean', () => {
    const s = CC.sampleCell(data, 4, 2, { x: 0, y: 0, w: 4, h: 2 }, 24);
    expect(s.coverage).toBe(0.5);
    // Same hue as both inks; brightness of the solid one, not their 150/75 average.
    expect(s.color).toEqual([200, 100, 0]);
  });

  it('mixes the hue of different inks in one cell', () => {
    const two = new Uint8ClampedArray([200, 0, 0, 255, 0, 0, 200, 255]);
    expect(CC.sampleCell(two, 2, 1, { x: 0, y: 0, w: 2, h: 1 }, 24).color).toEqual([200, 0, 200]);
  });

  it('treats pixels at or under the floor as shirt', () => {
    expect(CC.sampleCell(data, 4, 2, { x: 0, y: 0, w: 2, h: 2 }, 24)).toEqual({ coverage: 0, color: null });
    expect(CC.sampleCell(data, 4, 2, { x: 0, y: 0, w: 2, h: 2 }, 5).coverage).toBe(0.25);
  });

  it('clips a cell that hangs off the image', () => {
    const s = CC.sampleCell(data, 4, 2, { x: 3, y: -1, w: 5, h: 5 }, 24);
    expect(s.coverage).toBe(1);
    expect(s.color).toEqual([100, 50, 0]);
  });
});
