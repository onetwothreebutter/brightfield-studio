import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let H;

beforeAll(() => {
  new Function(readFileSync(join(__dirname, '../assets/palette-lab-history.js'), 'utf8'))(); // eslint-disable-line no-new-func
  H = window.PaletteLabHistory;
});

function fakeStorage(opts = {}) {
  const map = {};
  return {
    map,
    getItem: (k) => (k in map ? map[k] : null),
    setItem: (k, v) => { if (opts.full) throw new Error('QuotaExceededError'); map[k] = v; },
    removeItem: (k) => { delete map[k]; }
  };
}

const state = (n, extra = {}) => Object.assign({ seed: 's', palette: { colors: [{ weight: n }] } }, extra);

describe('history', () => {
  it('starts empty and cannot move', () => {
    const h = H.createHistory();
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
    expect(h.undo()).toBeNull();
    expect(h.redo()).toBeNull();
    expect(h.depth()).toEqual({ back: 0, forward: 0 });
  });

  it('undoes and redoes through recorded steps', () => {
    const h = H.createHistory({ coalesceMs: 0 });
    h.record(state(1), 0);
    h.record(state(2), 1000);
    h.record(state(3), 2000);
    expect(h.depth()).toEqual({ back: 2, forward: 0 });
    expect(h.undo().palette.colors[0].weight).toBe(2);
    expect(h.undo().palette.colors[0].weight).toBe(1);
    expect(h.canUndo()).toBe(false);
    expect(h.redo().palette.colors[0].weight).toBe(2);
    expect(h.depth()).toEqual({ back: 1, forward: 1 });
  });

  it('ignores a record of the state it is already on', () => {
    // An editor remount re-emits the palette it was mounted with; that must
    // not become a no-op undo step.
    const h = H.createHistory({ coalesceMs: 0 });
    expect(h.record(state(1), 0)).toBe(true);
    expect(h.record(state(1), 1000)).toBe(false);
    expect(h.record(JSON.parse(JSON.stringify(state(1))), 2000)).toBe(false);
    expect(h.size()).toBe(1);
  });

  it('merges a burst of records inside the coalesce window into one step', () => {
    // A slider drag fires input every few ms; undo should take the whole drag
    // back, not one pixel of it.
    const h = H.createHistory({ coalesceMs: 500 });
    h.record(state(1), 0);
    h.record(state(2), 10000);
    for (let i = 3; i < 40; i++) h.record(state(i), 10000 + i * 10);
    expect(h.size()).toBe(2);
    expect(h.depth().back).toBe(1);
    expect(h.undo().palette.colors[0].weight).toBe(1);
    expect(h.redo().palette.colors[0].weight).toBe(39);
  });

  it('never merges into the base step', () => {
    // The first edit after opening the lab must remain undoable back to what
    // was opened, however quickly it followed the base record.
    const h = H.createHistory({ coalesceMs: 500 });
    h.record(state(1), 0);
    h.record(state(2), 10);
    expect(h.size()).toBe(2);
    expect(h.undo().palette.colors[0].weight).toBe(1);
  });

  it('does not merge into a step reached by undo or redo', () => {
    const h = H.createHistory({ coalesceMs: 500 });
    h.record(state(1), 0);
    h.record(state(2), 1000);
    h.record(state(3), 2000);
    h.undo();                       // on 2
    h.record(state(4), 2001);       // immediately after — still a new step
    expect(h.size()).toBe(3);
    expect(h.undo().palette.colors[0].weight).toBe(2);
  });

  it('breakMerge makes the next record its own step inside the window', () => {
    // Browsing thumbnails at three a second must not collapse into one step.
    const h = H.createHistory({ coalesceMs: 500 });
    h.record(state(1), 0);
    h.record(state(2), 1000);
    h.breakMerge();
    h.record(state(3), 1010);
    expect(h.size()).toBe(3);
    // and the window reopens after it: a drag following the click still merges
    h.record(state(4), 1020);
    expect(h.size()).toBe(3);
    expect(h.undo().palette.colors[0].weight).toBe(2);
  });

  it('drops the redo tail when a new step is recorded after an undo', () => {
    const h = H.createHistory({ coalesceMs: 0 });
    h.record(state(1), 0);
    h.record(state(2), 1000);
    h.record(state(3), 2000);
    h.undo();
    h.undo();
    h.record(state(9), 3000);
    expect(h.canRedo()).toBe(false);
    expect(h.size()).toBe(2);
    expect(h.undo().palette.colors[0].weight).toBe(1);
    expect(h.redo().palette.colors[0].weight).toBe(9);
  });

  it('is bounded, dropping the oldest step', () => {
    const h = H.createHistory({ coalesceMs: 0, limit: 5 });
    for (let i = 0; i < 20; i++) h.record(state(i), i * 1000);
    expect(h.size()).toBe(5);
    expect(h.depth().back).toBe(4);
    let s = null;
    while (h.canUndo()) s = h.undo();
    expect(s.palette.colors[0].weight).toBe(15);
  });

  it('hands back copies, so a live edit cannot reach a kept step', () => {
    const h = H.createHistory({ coalesceMs: 0 });
    const live = state(1);
    h.record(live, 0);
    live.palette.colors[0].weight = 99;
    h.record(state(2), 1000);
    const back = h.undo();
    expect(back.palette.colors[0].weight).toBe(1);
    back.palette.colors[0].weight = 50;
    h.redo();
    expect(h.undo().palette.colors[0].weight).toBe(1);
  });

  it('uses the caller\'s identity function when given', () => {
    // The lab keys on the collection's keyOf, which ignores thumbnails and
    // ids — two captures of the same design are one step.
    const h = H.createHistory({ coalesceMs: 0, keyOf: (s) => s.seed });
    h.record(state(1), 0);
    expect(h.record(state(2), 1000)).toBe(false);
    expect(h.record(state(2, { seed: 't' }), 2000)).toBe(true);
  });

  it('clears', () => {
    const h = H.createHistory({ coalesceMs: 0 });
    h.record(state(1), 0);
    h.record(state(2), 1000);
    h.clear();
    expect(h.size()).toBe(0);
    expect(h.canUndo()).toBe(false);
  });
});

describe('session', () => {
  it('round-trips the working state', () => {
    const storage = fakeStorage();
    const s = H.createSession({ storage });
    const saved = { state: state(3), settings: { 'rise-shirt': { u_cols: 12 } } };
    expect(s.save(saved)).toBe(true);
    expect(H.createSession({ storage }).load()).toEqual(saved);
    s.clear();
    expect(s.load()).toBeNull();
  });

  it('is inert without storage and survives a full or corrupt one', () => {
    const none = H.createSession({ storage: null });
    expect(none.save({ a: 1 })).toBe(false);
    expect(none.load()).toBeNull();
    none.clear();

    const full = H.createSession({ storage: fakeStorage({ full: true }) });
    expect(full.save({ a: 1 })).toBe(false);

    const storage = fakeStorage();
    storage.map[H.SESSION_KEY] = '{not json';
    expect(H.createSession({ storage }).load()).toBeNull();
    storage.map[H.SESSION_KEY] = '"a string"';
    expect(H.createSession({ storage }).load()).toBeNull();
  });
});
