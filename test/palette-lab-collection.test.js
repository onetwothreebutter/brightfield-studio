import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let Coll;
let PP;
let PPS;
let SHADERS;

beforeAll(() => {
  ['../assets/probabilistic-palette.js', '../assets/shader-defs.js',
    '../assets/probabilistic-palette-shader.js', '../assets/palette-lab-collection.js']
    .forEach((f) => new Function(readFileSync(join(__dirname, f), 'utf8'))()); // eslint-disable-line no-new-func
  Coll = window.PaletteLabCollection;
  PP = window.ProbabilisticPalette;
  PPS = window.ProbabilisticPaletteShader;
  SHADERS = window.ShaderDefs.SHADERS;
});

// A storage double with localStorage's shape, optionally refusing writes past
// a byte budget the way a full quota does.
function fakeStorage(limit = Infinity) {
  const map = {};
  return {
    map,
    getItem: (k) => (k in map ? map[k] : null),
    setItem: (k, v) => {
      if (v.length > limit) throw new Error('QuotaExceededError');
      map[k] = v;
    }
  };
}

const preset = () => JSON.parse(JSON.stringify(PP.PRESETS['Brightfield / Black 01']));

function snap(over = {}) {
  return Object.assign({
    source: 'rise-shirt', seed: 'sample-abc', palette: preset(),
    shaderValues: PPS.defaultValues(SHADERS['rise-shirt']), detail: null, variation: 0,
    thumbnail: 'data:image/jpeg;base64,AAAA'
  }, over);
}

describe('snapshot identity', () => {
  it('is the same key for the same design however it was captured', () => {
    const a = Coll.keyOf(Coll.makeSnapshot(snap()));
    const b = Coll.keyOf(Coll.makeSnapshot(snap({ thumbnail: null })));
    expect(a).toBe(b);
  });

  it('changes when the palette, settings, seed, source, detail or drift change', () => {
    const base = Coll.keyOf(snap());
    const p = preset(); p.colors[0].weight += 1;
    const v = PPS.defaultValues(SHADERS['rise-shirt']); v.u_cols = 99;
    expect(Coll.keyOf(snap({ palette: p }))).not.toBe(base);
    expect(Coll.keyOf(snap({ shaderValues: v }))).not.toBe(base);
    expect(Coll.keyOf(snap({ seed: 'sample-xyz' }))).not.toBe(base);
    expect(Coll.keyOf(snap({ source: 'line-circle' }))).not.toBe(base);
    expect(Coll.keyOf(snap({ variation: 0.5 }))).not.toBe(base);
    expect(Coll.keyOf(snap({ source: 'scatter', shaderValues: null, detail: 4 })))
      .not.toBe(Coll.keyOf(snap({ source: 'scatter', shaderValues: null, detail: 5 })));
  });

  it('deep-copies the palette and settings so later edits cannot reach the entry', () => {
    const input = snap();
    const s = Coll.makeSnapshot(input);
    input.palette.colors[0].color = '#123456';
    input.shaderValues.u_cols = -1;
    expect(s.palette.colors[0].color).not.toBe('#123456');
    expect(s.shaderValues.u_cols).not.toBe(-1);
  });
});

describe('store', () => {
  it('adds, dedupes, toggles and removes', () => {
    const store = Coll.createStore({ storage: fakeStorage() });
    const e = store.add(snap(), 1000);
    expect(store.size()).toBe(1);
    expect(store.has(snap({ thumbnail: null }))).toBe(true);
    expect(store.add(snap(), 2000)).toBe(e);          // same design → same entry
    expect(store.size()).toBe(1);
    expect(e.addedAt).toBe(1000);
    expect(store.toggle(snap())).toBe(false);          // present → removed
    expect(store.size()).toBe(0);
    expect(store.toggle(snap(), 3)).toBe(true);        // absent → added
    expect(store.remove('nope')).toBe(false);
  });

  it('lists newest first and tracks selection', () => {
    const store = Coll.createStore({ storage: fakeStorage() });
    const a = store.add(snap({ seed: 'a' }), 1);
    const b = store.add(snap({ seed: 'b' }), 2);
    expect(store.entries().map((e) => e.seed)).toEqual(['b', 'a']);
    store.setSelected(a.id, true);
    store.setSelected(b.id, true);
    expect(store.selected().map((e) => e.id)).toEqual([b.id, a.id]);
    store.setSelected(b.id, false);
    expect(store.selected()).toHaveLength(1);
  });

  it('round-trips through storage with snapshots, selection and ids intact', () => {
    const storage = fakeStorage();
    const first = Coll.createStore({ storage });
    const a = first.add(snap({ seed: 'a' }), 5);
    first.add(snap({ seed: 'b', source: 'scatter', shaderValues: null, detail: 4 }), 6);
    first.setSelected(a.id, true);

    const second = Coll.createStore({ storage });
    expect(second.size()).toBe(2);
    const ra = second.get(a.id);
    expect(ra.selected).toBe(true);
    expect(ra.palette).toEqual(a.palette);
    expect(ra.shaderValues).toEqual(a.shaderValues);
    expect(ra.thumbnail).toBe(a.thumbnail);
    expect(second.has(snap({ seed: 'a' }))).toBe(true);
    // New ids keep counting from where the previous session left off.
    const c = second.add(snap({ seed: 'c' }), 7);
    expect(c.id).not.toBe(a.id);
  });

  it('keeps the snapshots and drops the thumbnails when storage is full', () => {
    const withThumbs = Coll.createStore({ storage: fakeStorage() });
    withThumbs.add(snap(), 1);
    const full = withThumbs.serialize(true).length;
    const storage = fakeStorage(full - 1);            // one byte too small for the picture
    const store = Coll.createStore({ storage });
    const e = store.add(snap(), 1);
    expect(e.thumbnail).toBeTruthy();                   // in memory
    const reloaded = Coll.createStore({ storage });
    expect(reloaded.size()).toBe(1);
    expect(reloaded.get(e.id).thumbnail).toBeUndefined(); // on disk
    expect(reloaded.get(e.id).palette).toEqual(e.palette);
  });

  it('starts empty on corrupt storage and works without any storage at all', () => {
    const storage = fakeStorage();
    storage.map[Coll.STORAGE_KEY] = '{not json';
    expect(Coll.createStore({ storage }).size()).toBe(0);
    const bare = Coll.createStore();
    bare.add(snap(), 1);
    expect(bare.size()).toBe(1);
  });

  it('notifies listeners on every mutation', () => {
    const store = Coll.createStore({ storage: fakeStorage() });
    let n = 0;
    store.onChange(() => { n++; });
    const e = store.add(snap(), 1);
    store.setSelected(e.id, true);
    store.setSelected(e.id, true);   // no-op, no notify
    store.remove(e.id);
    store.clear();
    expect(n).toBe(4);
  });
});

describe('restoring a snapshot', () => {
  it('maps a shader to exactly the values the live cell was rendered with', () => {
    // The grid renders a cell with mapPalette over the live palette/settings;
    // the drawer re-renders it from the snapshot. Same inputs, same values —
    // which is what makes the stored design the same design.
    const s = Coll.makeSnapshot(snap({ seed: 'sample-q' }));
    const live = PPS.mapPalette(SHADERS['rise-shirt'], {
      palette: preset(), seed: 'sample-q', variation: 0, values: PPS.defaultValues(SHADERS['rise-shirt'])
    });
    const fromSnap = PPS.mapPalette(SHADERS[s.source], {
      palette: s.palette, seed: s.seed, variation: s.variation, values: s.shaderValues
    });
    expect(fromSnap.values).toEqual(live.values);
  });
});

describe('hygiene', () => {
  it('never calls Math.random', () => {
    const src = readFileSync(join(__dirname, '../assets/palette-lab-collection.js'), 'utf8');
    expect(src).not.toMatch(/Math\s*\.\s*random\s*\(/);
  });

  it('is loaded by the lab after the engine and adapter', () => {
    const html = readFileSync(join(__dirname, '../palette-lab.html'), 'utf8');
    const lab = html.indexOf('assets/palette-lab-collection.js');
    expect(lab).toBeGreaterThan(html.indexOf('assets/probabilistic-palette-shader.js'));
    expect(html).not.toMatch(/Math\s*\.\s*random\s*\(/);
  });
});

describe('export metadata', () => {
  const entry = () => Object.assign(Coll.makeSnapshot(snap({ seed: 'sample-q' })), { id: 'c1', addedAt: 1 });

  it('carries the product page restore payload and a ?bfr= link where the handle is known', () => {
    const values = PPS.mapPalette(SHADERS['rise-shirt'], {
      palette: preset(), seed: 'sample-q', variation: 0, values: PPS.defaultValues(SHADERS['rise-shirt'])
    }).values;
    const meta = Coll.buildExportMeta(entry(), {
      values, handles: { 'rise-shirt': 'dot-rise' }, image: { width: 1800, height: 2400 }, now: 'T'
    });
    expect(meta.format).toBe('brightfield-lab-design/1');
    expect(meta.family).toBe('shader');
    expect(meta.design).toEqual({ shader: 'rise-shirt', values });
    // Exactly what main-product.liquid does with the param.
    expect(JSON.parse(atob(meta.product.bfr))).toEqual({ shader: 'rise-shirt', values });
    expect(meta.product.url).toBe(
      Coll.STORE_ORIGIN + '/products/dot-rise?bfr=' + encodeURIComponent(meta.product.bfr));
    expect(meta.image).toEqual({ file: 'brightfield-rise-shirt-sample-q.png', width: 1800, height: 2400, background: '#000000' });
    expect(meta.labSnapshot.palette).toEqual(entry().palette);
    expect(meta.product.sizeGroupsWarning).toBeUndefined();
  });

  it('still exports the payload with instructions when no handle is on file', () => {
    const meta = Coll.buildExportMeta(entry(), { values: { u_cols: 1 }, handles: {} });
    expect(meta.product.handle).toBeNull();
    expect(meta.product.url).toBeNull();
    expect(meta.product.bfr).toBeTruthy();
    expect(meta.product.note).toMatch(/shader-rise-shirt/);
  });

  it('warns when the design depends on size groups the product page cannot restore', () => {
    const p = preset(); p.sizeGroups = { enabled: true, mode: 'bands', maxGroups: 3 };
    const values = PPS.mapPalette(SHADERS['rise-shirt'], {
      palette: p, seed: 'sample-q', variation: 0, values: PPS.defaultValues(SHADERS['rise-shirt'])
    }).values;
    expect(values.u_group_mode).toBe(1);
    const meta = Coll.buildExportMeta(entry(), { values, handles: {} });
    expect(meta.product.sizeGroupsWarning).toMatch(/size groups/);
  });

  it('describes a shape entry as image-only', () => {
    const e = Object.assign(Coll.makeSnapshot(snap({ source: 'scatter', shaderValues: null, detail: 5 })), { id: 'c2' });
    const meta = Coll.buildExportMeta(e, {});
    expect(meta.family).toBe('shapes');
    expect(meta.product).toBeNull();
    expect(meta.design).toBeUndefined();
    expect(meta.labSnapshot.detail).toBe(5);
  });

  it('makes a filesystem-safe base name', () => {
    expect(Coll.exportBaseName({ source: 'line-circle', seed: 'a/b c' })).toBe('brightfield-line-circle-a_b_c');
  });
});
