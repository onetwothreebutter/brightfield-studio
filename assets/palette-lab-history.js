/**
 * Palette lab — working-state history and session persistence.
 *
 * Two small pieces, both DOM-free:
 *
 *   createHistory({ keyOf, limit, coalesceMs })
 *     A bounded undo/redo stack over opaque state objects. `record` is meant
 *     to be called on *every* change the lab redraws for — slider drags
 *     included — so it dedupes a state identical to the one it is on (an
 *     editor remount re-emits the palette it was given) and merges a burst of
 *     records inside `coalesceMs` into one step, which is what turns a drag
 *     into a single undo instead of forty.
 *
 *   createSession({ storage, key })
 *     Saves and reloads the working state so a reload does not throw away an
 *     unsaved palette. Storage is optional and every access is guarded, the
 *     same as the collection store.
 *
 * States are deep-copied on the way in and on the way out, so neither the
 * caller's live object nor a later edit can reach into a kept step.
 */
(function () {
  'use strict';

  var SESSION_KEY = 'brightfield-palette-lab-session';

  function clone(v) { return v == null ? null : JSON.parse(JSON.stringify(v)); }

  function createHistory(opts) {
    opts = opts || {};
    var keyOf = typeof opts.keyOf === 'function' ? opts.keyOf : function (s) { return JSON.stringify(s); };
    var limit = typeof opts.limit === 'number' && opts.limit >= 2 ? Math.floor(opts.limit) : 100;
    // A burst of records inside this window is one step. 0 disables merging.
    var coalesceMs = typeof opts.coalesceMs === 'number' && opts.coalesceMs >= 0 ? opts.coalesceMs : 500;

    var stack = [];     // [{ key, state }]
    var index = -1;     // the step the lab is currently on
    var lastAt = -Infinity;   // when the top step was last written by record()

    function current() { return index >= 0 ? stack[index] : null; }

    var api = {
      // Returns true when a step was added or merged, false when the state is
      // the one the history is already on. `now` is passed in rather than read
      // off the clock so merging is deterministic under test.
      record: function (state, now) {
        var key = keyOf(state);
        var cur = current();
        if (cur && cur.key === key) return false;
        now = typeof now === 'number' ? now : 0;
        // Drop the redo tail: a new edit after an undo is a new branch.
        stack.length = index + 1;
        // The base step (index 0) is never merged into — it is what the first
        // undo returns to — and neither is a step reached by undo/redo, which
        // reset lastAt.
        var merge = index > 0 && coalesceMs > 0 && now - lastAt < coalesceMs;
        if (merge) {
          stack[index] = { key: key, state: clone(state) };
        } else {
          stack.push({ key: key, state: clone(state) });
          index = stack.length - 1;
          if (stack.length > limit) {
            stack.shift();
            index--;
          }
        }
        lastAt = now;
        return true;
      },
      canUndo: function () { return index > 0; },
      canRedo: function () { return index >= 0 && index < stack.length - 1; },
      // Both return a copy of the step landed on, or null when there is none.
      // Landing on a step by undo/redo ends any merge window: the next edit is
      // a fresh step, never folded into the one just restored.
      undo: function () {
        if (!api.canUndo()) return null;
        index--;
        lastAt = -Infinity;
        return clone(stack[index].state);
      },
      redo: function () {
        if (!api.canRedo()) return null;
        index++;
        lastAt = -Infinity;
        return clone(stack[index].state);
      },
      // Steps behind and ahead of the current one, for a readout.
      depth: function () { return { back: Math.max(0, index), forward: Math.max(0, stack.length - 1 - index) }; },
      size: function () { return stack.length; },
      clear: function () { stack = []; index = -1; lastAt = -Infinity; }
    };
    return api;
  }

  function createSession(opts) {
    opts = opts || {};
    var storage = opts.storage || null;
    var key = opts.key || SESSION_KEY;
    return {
      save: function (state) {
        if (!storage) return false;
        try { storage.setItem(key, JSON.stringify(state)); return true; } catch (e) { return false; }
      },
      load: function () {
        if (!storage) return null;
        try {
          var raw = storage.getItem(key);
          var parsed = raw ? JSON.parse(raw) : null;
          return parsed && typeof parsed === 'object' ? parsed : null;
        } catch (e) { return null; }
      },
      clear: function () {
        if (!storage) return;
        try { storage.removeItem(key); } catch (e) { /* private mode */ }
      }
    };
  }

  window.PaletteLabHistory = {
    SESSION_KEY: SESSION_KEY,
    createHistory: createHistory,
    createSession: createSession
  };
})();
