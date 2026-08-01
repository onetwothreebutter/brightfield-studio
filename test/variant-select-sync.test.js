import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const liquid = readFileSync(join(__dirname, '../sections/main-product.liquid'), 'utf8');

// Extract the IIFE from the inline <script> block added for variant sync.
// Match the script tag that contains the variant-fieldset querySelector.
const scriptMatch = liquid.match(/<script>\s*(\(function\s*\(\)\s*\{[\s\S]*?variantSel[\s\S]*?\}\)\(\);)\s*<\/script>/);
if (!scriptMatch) throw new Error('Could not find variant sync script in main-product.liquid');
const variantSyncSrc = scriptMatch[1];

function buildForm(variants, { preselectFirst = true } = {}) {
  // variants: [{ id, options: ['Small', 'Red'], available: true }, ...]
  // options: array of unique option names, e.g. ['Size', 'Color']
  const optionNames = Object.keys(variants[0].options);

  const form = document.createElement('form');
  const wrapper = document.createElement('div');
  wrapper.id = 'product-order-form';

  // Radio fieldsets
  for (const optName of optionNames) {
    const uniqueValues = [...new Set(variants.map(v => v.options[optName]))];
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'variant-fieldset';
    for (const [i, val] of uniqueValues.entries()) {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `options[${optName}]`;
      radio.value = val;
      if (preselectFirst && i === 0) radio.checked = true; // first is selected by default
      label.appendChild(radio);
      fieldset.appendChild(label);
    }
    form.appendChild(fieldset);
  }

  // Error message (mirrors #variant-error in the real markup)
  const errorEl = document.createElement('p');
  errorEl.id = 'variant-error';
  errorEl.style.display = 'none';
  form.appendChild(errorEl);

  // Hidden variant select
  const select = document.createElement('select');
  select.name = 'id';
  select.className = 'variant-select visually-hidden';
  const blankOpt = document.createElement('option');
  blankOpt.value = '';
  if (!preselectFirst) blankOpt.selected = true;
  select.appendChild(blankOpt);
  for (const [i, v] of variants.entries()) {
    const opt = document.createElement('option');
    opt.value = String(v.id);
    opt.dataset.variantTitle = Object.values(v.options).join(' / ');
    if (!v.available) opt.disabled = true;
    if (preselectFirst && i === 0) opt.selected = true;
    select.appendChild(opt);
  }
  form.appendChild(select);
  wrapper.appendChild(form);
  document.body.appendChild(wrapper);
  return { form, select, wrapper, errorEl };
}

function runScript() {
  new Function(variantSyncSrc)(); // eslint-disable-line no-new-func
}

function pickRadio(form, optName, value) {
  const radios = form.querySelectorAll(`input[type="radio"][name="options[${optName}]"]`);
  for (const r of radios) {
    if (r.value === value) {
      r.checked = true;
      r.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
  }
  throw new Error(`Radio option ${optName}=${value} not found`);
}

beforeEach(() => {
  document.body.innerHTML = '';
});

// ── single-option products (e.g. Size only) ───────────────────────────────────

describe('single option (size only)', () => {
  const variants = [
    { id: 100, options: { Size: 'XS' }, available: true },
    { id: 101, options: { Size: 'S'  }, available: true },
    { id: 102, options: { Size: 'M'  }, available: true },
    { id: 103, options: { Size: 'L'  }, available: true },
  ];

  it('syncs select when a non-default size is chosen', () => {
    const { form, select } = buildForm(variants);
    runScript();
    pickRadio(form, 'Size', 'M');
    expect(select.value).toBe('102');
  });

  it('syncs select back to first variant when XS is re-selected', () => {
    const { form, select } = buildForm(variants);
    runScript();
    pickRadio(form, 'Size', 'L');
    pickRadio(form, 'Size', 'XS');
    expect(select.value).toBe('100');
  });

  it('syncs to each variant in sequence', () => {
    const { form, select } = buildForm(variants);
    runScript();
    for (const v of variants) {
      pickRadio(form, 'Size', v.options.Size);
      expect(select.value).toBe(String(v.id));
    }
  });

  it('leaves select unchanged when no matching variant exists', () => {
    const { form, select } = buildForm(variants);
    runScript();
    // Manually fire change on a radio that has no matching option in select
    const radio = form.querySelector('input[type="radio"]');
    radio.value = 'XXXL';
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    expect(select.value).toBe('100'); // unchanged
  });
});

// ── two-option products (e.g. Size + Color) ────────────────────────────────────

describe('two options (size + color)', () => {
  const variants = [
    { id: 200, options: { Size: 'S', Color: 'Black' }, available: true  },
    { id: 201, options: { Size: 'S', Color: 'White' }, available: true  },
    { id: 202, options: { Size: 'M', Color: 'Black' }, available: true  },
    { id: 203, options: { Size: 'M', Color: 'White' }, available: false },
  ];

  it('selects correct variant for Size=S, Color=White', () => {
    const { form, select } = buildForm(variants);
    runScript();
    pickRadio(form, 'Size', 'S');
    pickRadio(form, 'Color', 'White');
    expect(select.value).toBe('201');
  });

  it('selects correct variant for Size=M, Color=Black', () => {
    const { form, select } = buildForm(variants);
    runScript();
    pickRadio(form, 'Size', 'M');
    pickRadio(form, 'Color', 'Black');
    expect(select.value).toBe('202');
  });

  it('does not skip unavailable variants', () => {
    const { form, select } = buildForm(variants);
    runScript();
    pickRadio(form, 'Size', 'M');
    pickRadio(form, 'Color', 'White');
    expect(select.value).toBe('203');
  });
});

// ── submit validation (no size preselected) ─────────────────────────────────────

describe('submit validation', () => {
  const variants = [
    { id: 100, options: { Size: 'XS' }, available: true },
    { id: 101, options: { Size: 'S'  }, available: true },
    { id: 102, options: { Size: 'M'  }, available: true },
    { id: 103, options: { Size: 'L'  }, available: true },
  ];

  function submit(form) {
    const evt = new Event('submit', { bubbles: true, cancelable: true });
    const notCancelled = form.dispatchEvent(evt);
    return !notCancelled; // true if preventDefault() was called
  }

  it('blocks submission and shows the error when no size is selected', () => {
    const { form, errorEl } = buildForm(variants, { preselectFirst: false });
    runScript();
    expect(submit(form)).toBe(true);
    expect(errorEl.style.display).not.toBe('none');
    expect(form.querySelector('.variant-fieldset').classList.contains('variant-fieldset--invalid')).toBe(true);
  });

  it('allows submission once a size is selected', () => {
    const { form, errorEl } = buildForm(variants, { preselectFirst: false });
    runScript();
    pickRadio(form, 'Size', 'M');
    expect(submit(form)).toBe(false);
    expect(errorEl.style.display).toBe('none');
  });

  it('clears the error once a size is picked after a failed submit', () => {
    const { form, errorEl } = buildForm(variants, { preselectFirst: false });
    runScript();
    submit(form);
    expect(form.querySelector('.variant-fieldset').classList.contains('variant-fieldset--invalid')).toBe(true);

    pickRadio(form, 'Size', 'S');
    expect(errorEl.style.display).toBe('none');
    expect(form.querySelector('.variant-fieldset').classList.contains('variant-fieldset--invalid')).toBe(false);
  });
});

// ── script safety ─────────────────────────────────────────────────────────────

describe('script safety', () => {
  it('does not throw when #product-order-form is absent', () => {
    // No DOM setup — wrapper is never appended
    expect(() => runScript()).not.toThrow();
  });

  it('does not throw when variant-select is absent', () => {
    const wrapper = document.createElement('div');
    wrapper.id = 'product-order-form';
    const form = document.createElement('form');
    wrapper.appendChild(form);
    document.body.appendChild(wrapper);
    expect(() => runScript()).not.toThrow();
  });
});
