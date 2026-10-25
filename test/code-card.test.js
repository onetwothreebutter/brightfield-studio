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

// Opacity of one line's highlight at loop phase `p`, read off the generated
// keyframes the way a browser would — the keyframes are the implementation,
// so this evaluates them rather than restating the maths. Eased segments are
// only checked at their ends, where every easing agrees.
function keyframeStops(css) {
  return [...css.matchAll(/([\d.]+)%\{opacity:([\d.]+)(?:;animation-timing-function:([\w-]+))?\}/g)]
    .map((m) => ({ at: +m[1] / 100, v: +m[2], ease: m[3] }));
}
function opacityAt(stops, p) {
  p = ((p % 1) + 1) % 1;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    if (p < a.at || p > b.at) continue;
    if (a.ease === 'step-end') return p < b.at ? a.v : b.v;
    if (a.v === b.v) return a.v;
    return p === a.at ? a.v : p === b.at ? b.v : null;   // mid-ease: not asserted
  }
  return stops[stops.length - 1].v;
}

describe('line highlight', () => {
  const o = { rows: 30, band: 1, soft: 1.5 };
  const t = () => CC.highlightTiming(o);

  it('loops without a seam: 0% and 100% are the same lit keyframe', () => {
    const stops = keyframeStops(CC.highlightKeyframes('hl', t()));
    expect(stops[0]).toMatchObject({ at: 0, v: 1 });
    expect(stops[stops.length - 1]).toMatchObject({ at: 1, v: 1 });
    stops.slice(1).forEach((s, i) => expect(s.at).toBeGreaterThanOrEqual(stops[i].at));
  });

  it('peaks every line once per loop, top to bottom, with the band off-screen at the seam', () => {
    const peaks = [...Array(30).keys()].map((r) => t().peak(r));
    peaks.slice(1).forEach((p, i) => expect(p).toBeGreaterThan(peaks[i]));
    // At phase 0 the band is above the first line and clear of it, and at
    // phase 1 it has cleared the last one: no line is lit at the seam.
    const stops = keyframeStops(CC.highlightKeyframes('hl', t()));
    peaks.forEach((p) => {
      expect(opacityAt(stops, 0 - p)).toBe(0);
      expect(opacityAt(stops, 1 - p)).toBe(0);
    });
  });

  it('holds a line lit for the band and dark beyond its falloff', () => {
    const tm = t();
    const stops = keyframeStops(CC.highlightKeyframes('hl', tm));
    const period = 30 + 1 + 3;
    // Phase at which the band's centre is on line 10.
    const p = tm.peak(10);
    expect(opacityAt(stops, p - tm.peak(10))).toBe(1);
    expect(opacityAt(stops, p - tm.peak(14))).toBe(0);           // 4 lines away: past band/2 + soft
    expect(tm.plateau).toBeCloseTo(0.5 / period);
    expect(tm.fall).toBeCloseTo(1.5 / period);
  });

  it('steps one line at a time with no falloff', () => {
    const tm = CC.highlightTiming({ rows: 30, band: 1, soft: 0 });
    const stops = keyframeStops(CC.highlightKeyframes('hl', tm));
    expect(stops.some((s) => s.ease === 'step-end')).toBe(true);
    for (let i = 0; i < 300; i++) {
      const phase = (i + 0.37) / 300;
      const lit = [...Array(30).keys()].filter((r) => opacityAt(stops, phase - tm.peak(r)) === 1);
      expect(lit.length).toBeLessThanOrEqual(1);
    }
  });
});

describe('buildHtml', () => {
  // Built lazily: describe bodies run before beforeAll has loaded the module.
  let layout;
  let base;
  beforeAll(() => {
    layout = CC.fitLayout({ cols: 20, rows: 3, width: 1000, height: 1200, padding: 0.1, lineHeight: 1.5, advance: 0.6 });
    base = {
      width: 1000, height: 1200, layout, font: 'JetBrains Mono', weight: '500',
      ghost: 0.18, restInk: 0.35, hiWhite: 0.92, lineBar: 0.06, background: '#000000',
      loop: 12, band: 1, soft: 1.5, title: 'Card <test>'
    };
  });
  const red = [200, 40, 30];
  const lines = [
    { text: 'if (a < b && c) {', colors: [red, red, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null] },
    { text: '', colors: [] },
    { text: 'x', colors: [null] }
  ];
  const html = () => CC.buildHtml(Object.assign({ lines }, base));

  it('sets the text as escaped, real text with one row per line, empty lines kept', () => {
    const { markup } = html();
    expect(markup).toContain('(a &lt; b &amp;&amp; c) {');
    expect(markup).not.toContain('a < b');
    expect(markup.match(/class="bf-cc__row"/g)).toHaveLength(3);
    expect(markup).toContain('<span class="bf-cc__rest"> </span>');
  });

  it('puts nothing between rows — inside a <pre>, a newline there is an extra blank line', () => {
    expect(html().markup).not.toMatch(/<\/span>\s+<span class="bf-cc__row">/);
  });

  it('merges identically inked characters into one run and leaves bare text bare', () => {
    expect(html().markup).toContain('<i style="--c:200 40 30">if</i> (a');
  });

  it('duplicates each line into a highlight layer hidden from assistive tech, delayed to its peak', () => {
    const { markup } = html();
    const delays = [...markup.matchAll(/aria-hidden="true" style="animation-delay:(-[\d.]+)s"/g)].map((m) => +m[1]);
    expect(delays).toHaveLength(3);
    const tm = CC.highlightTiming({ rows: 3, band: 1, soft: 1.5 });
    delays.forEach((d, r) => {
      expect(d).toBeCloseTo(-(1 - tm.peak(r)) * 12, 3);
      expect(d).toBeLessThan(0);
      expect(d).toBeGreaterThan(-12);
    });
  });

  it('sizes everything as a share of the card width, so any width is the same card', () => {
    const { css } = html();
    expect(css).toContain('container-type:inline-size');
    expect(css).toContain('aspect-ratio:1000/1200');
    expect(css).toContain('font-size:' + +(layout.fontSize / 10).toFixed(4) + 'cqw');
    expect(css).toContain('padding-left:' + +(layout.x / 10).toFixed(4) + '%');
    expect(css).toContain('animation:bf-cc-hl 12s linear infinite');
    expect(css).toContain('prefers-reduced-motion');
  });

  it('wraps the snippet in a standalone page with the font and an escaped title', () => {
    const { page, snippet } = CC.buildHtml(Object.assign({ lines, fontHref: 'https://fonts.example/css?a=1&b=2' }, base));
    expect(page).toContain(snippet);
    expect(page).toContain('<title>Card &lt;test&gt;</title>');
    expect(page).toContain('href="https://fonts.example/css?a=1&amp;b=2"');
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
