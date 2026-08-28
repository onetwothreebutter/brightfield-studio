import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
let PP, UI;

beforeAll(() => {
  new Function(readFileSync(join(__dirname, '../assets/probabilistic-palette.js'), 'utf8'))();
  new Function(readFileSync(join(__dirname, '../assets/probabilistic-palette-ui.js'), 'utf8'))();
  PP = window.ProbabilisticPalette;
  UI = window.ProbabilisticPaletteUI;
});

function mountLab() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const changes = [];
  const api = UI.mount(host, { onChange: (p) => changes.push(JSON.parse(JSON.stringify(p))) });
  const btn = (label) => Array.from(host.querySelectorAll('button')).find((b) => b.textContent === label);
  return { host, api, changes, btn, ta: () => host.querySelector('.pp-import textarea') };
}

describe('import panel', () => {
  it('toggles open, parses live, replaces and emits', () => {
    const lab = mountLab();
    const panel = lab.host.querySelector('.pp-import');
    expect(panel.classList.contains('pp-open')).toBe(false);
    lab.btn('Import').dispatchEvent(new window.Event('click'));
    expect(panel.classList.contains('pp-open')).toBe(true);

    expect(lab.btn('Replace palette').disabled).toBe(true);
    const ta = lab.ta();
    ta.value = 'https://coolors.co/palette/606c38-283618-fefae0-dda15e-bc6c25';
    ta.dispatchEvent(new window.Event('input'));
    expect(lab.host.querySelectorAll('.pp-swatches i').length).toBe(5);
    expect(lab.host.querySelector('.pp-import .pp-hint').textContent).toBe('5 colors found');
    expect(lab.btn('Replace palette').disabled).toBe(false);

    const before = lab.changes.length;
    lab.btn('Replace palette').dispatchEvent(new window.Event('click'));
    expect(lab.changes.length).toBeGreaterThan(before);
    const p = lab.api.getPalette();
    expect(p.colors.map((c) => c.color))
      .toEqual(['#606C38', '#283618', '#FEFAE0', '#DDA15E', '#BC6C25']);
    expect(p.colors[4].spark).toBe(true);
    // Rows rendered with names and a SPARK badge.
    expect(lab.host.querySelectorAll('.pp-color').length).toBe(5);
    expect(lab.host.querySelector('.pp-color[data-tier=spark]')).toBeTruthy();
    // Panel comes back closed and empty.
    expect(lab.host.querySelector('.pp-import').classList.contains('pp-open')).toBe(false);
    expect(lab.ta().value).toBe('');
  });

  it('keeps the size grouping settings across Replace', () => {
    const lab = mountLab();
    const current = lab.api.getPalette();
    current.sizeGroups = { enabled: true, mode: 'clusters', minGap: 0.001, maxGroups: 4, dropElements: true };
    lab.api.setPalette(current);
    const ta = lab.ta();
    ta.value = '606c38 283618 fefae0';
    ta.dispatchEvent(new window.Event('input'));
    lab.btn('Replace palette').dispatchEvent(new window.Event('click'));
    const p = lab.api.getPalette();
    expect(p.colors).toHaveLength(3);
    expect(p.sizeGroups).toEqual({ enabled: true, mode: 'clusters', minGap: 0.001, maxGroups: 4, dropElements: true });
    // And the rebuilt panel agrees with it.
    const group = Array.from(lab.host.querySelectorAll('input[type=checkbox]'))
      .find((c) => /Group by size/.test(c.parentNode.textContent));
    expect(group.checked).toBe(true);
  });

  it('reports prose and single colors, and cancel clears', () => {
    const lab = mountLab();
    const ta = lab.ta();
    ta.value = 'a warm olive palette with abc and cafe in it';
    ta.dispatchEvent(new window.Event('input'));
    expect(lab.host.querySelector('.pp-import .pp-hint').textContent).toBe('No hex codes found');
    expect(lab.btn('Add to palette').disabled).toBe(true);

    ta.value = '#606c38';
    ta.dispatchEvent(new window.Event('input'));
    expect(lab.host.querySelector('.pp-import .pp-hint').textContent).toBe('Only 1 color found');

    lab.btn('Cancel').dispatchEvent(new window.Event('click'));
    expect(lab.ta().value).toBe('');
    expect(lab.host.querySelectorAll('.pp-swatches i').length).toBe(0);
  });

  it('appends only new colors at the bottom of the hierarchy', () => {
    const lab = mountLab();
    const original = lab.api.getPalette().colors.map((c) => JSON.parse(JSON.stringify(c)));
    const minWeight = Math.min(...original.map((c) => c.weight));

    const ta = lab.ta();
    ta.value = '#606c38, #283618, ' + original[0].color;
    ta.dispatchEvent(new window.Event('input'));
    lab.btn('Add to palette').dispatchEvent(new window.Event('click'));

    const p = lab.api.getPalette();
    expect(p.colors.length).toBe(original.length + 2);
    expect(p.colors.slice(0, original.length)).toEqual(original);
    const added = p.colors.slice(original.length);
    expect(added.map((c) => c.color)).toEqual(['#606C38', '#283618']);
    added.forEach((c) => {
      expect(c.weight).toBe(Math.max(0.5, Math.round(minWeight * 0.75 * 10) / 10));
      expect(c.spark).toBeUndefined();
      expect(c.conditions).toBeUndefined();
      expect(c.sizeCurve).toEqual(PP.SIZE_CURVE_PRESETS.small);
    });
    expect(new Set(p.colors.map((c) => c.id)).size).toBe(p.colors.length);
  });

  it('re-reads saved palettes on rebuild so the Load list is not stale', () => {
    const lab = mountLab();
    window.localStorage.setItem(UI.STORAGE_KEY, JSON.stringify({
      'Zed Test': PP.paletteFromHexList('#606c38 #283618', { name: 'Zed Test' })
    }));
    lab.api.refresh();
    const opts = Array.from(lab.host.querySelectorAll('option')).map((o) => o.value);
    expect(opts).toContain('saved:Zed Test');
    window.localStorage.removeItem(UI.STORAGE_KEY);
  });
});
