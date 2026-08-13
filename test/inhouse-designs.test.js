// Coverage for assets/inhouse-designs.js — the pure half of "several in-house
// designs on one product". These functions decide which saved value set a
// shopper's Design selection maps to and how it lands in the live shader state;
// the failure modes worth guarding are all silent ones (wrong design rendered,
// junk keys written, a mistyped `shader` producing a hybrid look), so each gets
// an explicit test.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../assets/inhouse-designs.js'), 'utf8');

let pickDesign, mergeDesignValues, findDesignOption;

beforeEach(() => {
  delete window.InhouseDesigns;
  new Function(src)(); // eslint-disable-line no-new-func
  ({ pickDesign, mergeDesignValues, findDesignOption } = window.InhouseDesigns);
});

const DESIGNS = [
  { option: 'Chladni Bloom', shader: 'chladni', values: { u_freq: 7.5, u_a: [0.5, 0.5, 0.5] } },
  { option: 'Quiet Static',  shader: 'chladni', values: { u_freq: 2.0 } },
];

// ── pickDesign ───────────────────────────────────────────────────────────────

describe('pickDesign', () => {
  it('returns the entry matching the selected option value', () => {
    expect(pickDesign(DESIGNS, 'Quiet Static', 'chladni')).toBe(DESIGNS[1]);
  });

  it('returns null for an option value with no entry', () => {
    expect(pickDesign(DESIGNS, 'Not A Design', 'chladni')).toBeNull();
  });

  it('returns null when the entry is for a different shader', () => {
    // Applying a line-circle value set to a chladni product would write only
    // the keys the two shaders share and leave the rest at defaults.
    const mixed = [{ option: 'Wrong', shader: 'line-circle', values: { u_freq: 1 } }];
    expect(pickDesign(mixed, 'Wrong', 'chladni')).toBeNull();
  });

  it('accepts an entry with no shader field', () => {
    const bare = [{ option: 'Bare', values: { u_freq: 1 } }];
    expect(pickDesign(bare, 'Bare', 'chladni')).toBe(bare[0]);
  });

  it('returns null for malformed input rather than throwing', () => {
    expect(pickDesign(null, 'Chladni Bloom', 'chladni')).toBeNull();
    expect(pickDesign(undefined, 'Chladni Bloom', 'chladni')).toBeNull();
    expect(pickDesign({}, 'Chladni Bloom', 'chladni')).toBeNull();
    expect(pickDesign(DESIGNS, null, 'chladni')).toBeNull();
    expect(pickDesign([null, 'nope', 7], 'Chladni Bloom', 'chladni')).toBeNull();
  });

  it('returns null when the entry has no usable values object', () => {
    expect(pickDesign([{ option: 'A' }], 'A', 'chladni')).toBeNull();
    expect(pickDesign([{ option: 'A', values: null }], 'A', 'chladni')).toBeNull();
    expect(pickDesign([{ option: 'A', values: [1, 2] }], 'A', 'chladni')).toBeNull();
  });
});

// ── mergeDesignValues ────────────────────────────────────────────────────────

describe('mergeDesignValues', () => {
  it('writes design values over the shader defaults', () => {
    const state = { u_freq: 1.0, u_scale: 1.0 };
    expect(mergeDesignValues(state, { u_freq: 7.5 })).toBe(1);
    expect(state).toEqual({ u_freq: 7.5, u_scale: 1.0 });
  });

  it('ignores keys the shader does not declare', () => {
    // A control renamed since the metafield was written must not inject a key.
    const state = { u_freq: 1.0 };
    expect(mergeDesignValues(state, { u_freq: 2.0, u_removed_control: 9 })).toBe(1);
    expect(state).toEqual({ u_freq: 2.0 });
    expect('u_removed_control' in state).toBe(false);
  });

  it('copies colour arrays rather than sharing them with the design entry', () => {
    const design = { u_a: [0.1, 0.2, 0.3] };
    const state = { u_a: [0, 0, 0] };
    mergeDesignValues(state, design);
    expect(state.u_a).toEqual([0.1, 0.2, 0.3]);

    state.u_a[0] = 0.9; // the GUI writes colours element-wise
    expect(design.u_a[0]).toBe(0.1); // design entry untouched
  });

  it('preserves value types verbatim (radians, strings, select values)', () => {
    const state = { u_rotation: 0, textFont: 'Montserrat', u_grain_mode: '0' };
    mergeDesignValues(state, { u_rotation: 0.7854, textFont: 'Anton', u_grain_mode: '3' });
    expect(state).toEqual({ u_rotation: 0.7854, textFont: 'Anton', u_grain_mode: '3' });
  });

  it('handles missing arguments without throwing', () => {
    expect(mergeDesignValues(null, { a: 1 })).toBe(0);
    expect(mergeDesignValues({ a: 1 }, null)).toBe(0);
  });
});

// ── findDesignOption ─────────────────────────────────────────────────────────

describe('findDesignOption', () => {
  const sizeOption = { name: 'Size', values: ['S', 'M', 'L'] };
  const designOption = { name: 'Design', values: ['Chladni Bloom', 'Quiet Static'] };

  it('finds the option whose values are all design names', () => {
    expect(findDesignOption([sizeOption, designOption], DESIGNS)).toBe(designOption);
  });

  it('finds it regardless of the option name', () => {
    const renamed = { name: 'Colorway', values: ['Chladni Bloom', 'Quiet Static'] };
    expect(findDesignOption([sizeOption, renamed], DESIGNS)).toBe(renamed);
  });

  it('ignores an option that only partially overlaps the design names', () => {
    // A Size option that happens to include a value named like a design must
    // not be mistaken for the design option.
    const collide = { name: 'Size', values: ['S', 'Chladni Bloom'] };
    expect(findDesignOption([collide], DESIGNS)).toBeNull();
  });

  it('returns null when there are no designs or no options', () => {
    expect(findDesignOption([sizeOption], [])).toBeNull();
    expect(findDesignOption([], DESIGNS)).toBeNull();
    expect(findDesignOption(null, DESIGNS)).toBeNull();
    expect(findDesignOption([sizeOption], null)).toBeNull();
  });

  it('tolerates malformed options', () => {
    expect(() => findDesignOption([null, { name: 'X' }, designOption], DESIGNS)).not.toThrow();
    expect(findDesignOption([null, { name: 'X' }, designOption], DESIGNS)).toBe(designOption);
  });
});

// ── Price markup contract ────────────────────────────────────────────────────
// The design switcher rewrites the price on every variant change. It must not
// write to the element that also holds the compare-at price: `textContent =`
// replaces every child node, so a sale product's <s> strikethrough would
// silently vanish the first time a shopper picked a design or size — and
// `data-price` only carries the current price, so nothing could restore it.
// These assert the two halves of that contract in main-product.liquid.

describe('product price markup', () => {
  const section = readFileSync(join(__dirname, '../sections/main-product.liquid'), 'utf8');

  it('renders the current price in its own element, separate from the compare-at price', () => {
    const priceBlock = section.match(/<p class="product-price">[\s\S]*?<\/p>/);
    expect(priceBlock).not.toBeNull();
    expect(priceBlock[0]).toContain('product-price__compare');
    expect(priceBlock[0]).toMatch(/<span class="product-price__current">/);
  });

  it('points the switcher\'s price write at the current-price element only', () => {
    expect(section).toMatch(/priceEl\s*=\s*document\.querySelector\('\.product-price__current'\)/);
    // The bare .product-price element is the flex wrapper — writing textContent
    // to it is what destroys the <s> sibling.
    expect(section).not.toMatch(/priceEl\s*=\s*document\.querySelector\('\.product-price'\)/);
  });
});
