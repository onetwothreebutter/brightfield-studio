/**
 * Palette lab — comparison collection.
 *
 * A place to keep the best designs the sample grid turns up, and to compare
 * them side by side. An entry is a *snapshot*, not a picture: the source, the
 * seed, a deep copy of the palette and of the shader settings — everything the
 * lab needs to re-render the cell or to restore the whole lab to the state
 * that produced it. The thumbnail dataURL is a convenience for instant display
 * and is the first thing dropped when storage is tight.
 *
 * DOM-free and renderer-free: the store takes a storage object with
 * getItem/setItem (localStorage in the lab, a plain object in tests) and never
 * touches the page. The lab wires the drawer, the grid badges and the compare
 * overlay on top of it.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'brightfield-palette-lab-collection';

  function clone(v) { return v == null ? null : JSON.parse(JSON.stringify(v)); }

  // FNV-1a over a string — only used to keep a snapshot's identity key short.
  // Not a security hash and not the engine's RNG; equality is what matters.
  function hashString(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(36);
  }

  // What makes two snapshots the same design: same source, same seed, same
  // palette, same shader settings, same detail and drift. Thumbnails, ids and
  // timestamps are deliberately not part of it — re-adding a cell you already
  // kept is a no-op, however it was captured.
  function keyOf(snap) {
    return [
      snap.source,
      snap.seed,
      hashString(JSON.stringify(snap.palette || null)),
      hashString(JSON.stringify(snap.shaderValues || null)),
      snap.detail == null ? '' : snap.detail,
      snap.variation == null ? 0 : snap.variation
    ].join('|');
  }

  // Deep-copies everything the lab hands over so a later edit to the live
  // palette or the control panel cannot reach into a kept entry.
  function makeSnapshot(input) {
    return {
      source: String(input.source),
      seed: String(input.seed),
      palette: clone(input.palette),
      shaderValues: input.shaderValues ? clone(input.shaderValues) : null,
      detail: typeof input.detail === 'number' ? input.detail : null,
      variation: typeof input.variation === 'number' ? input.variation : 0,
      thumbnail: typeof input.thumbnail === 'string' ? input.thumbnail : null
    };
  }

  function createStore(opts) {
    opts = opts || {};
    var storage = opts.storage || null;
    var storageKey = opts.storageKey || STORAGE_KEY;
    var entries = [];
    var counter = 0;
    var listeners = [];

    function read() {
      if (!storage) return;
      try {
        var raw = storage.getItem(storageKey);
        var parsed = raw ? JSON.parse(raw) : null;
        if (!parsed || !Array.isArray(parsed.entries)) return;
        entries = parsed.entries.filter(function (e) {
          return e && typeof e.id === 'string' && typeof e.source === 'string' && typeof e.seed === 'string';
        }).map(function (e) {
          e.key = keyOf(e);
          e.selected = !!e.selected;
          return e;
        });
        counter = typeof parsed.counter === 'number' ? parsed.counter : entries.length;
      } catch (e) { /* corrupt or unavailable — start empty */ }
    }

    function serialize(withThumbs) {
      return JSON.stringify({
        counter: counter,
        entries: entries.map(function (e) {
          var out = {};
          Object.keys(e).forEach(function (k) {
            if (k === 'key') return;
            if (k === 'thumbnail' && !withThumbs) return;
            out[k] = e[k];
          });
          return out;
        })
      });
    }

    // Thumbnails are the bulk of an entry (a JPEG dataURL per design), so on a
    // quota error the snapshots are kept and the pictures let go — the lab can
    // re-render any entry from its snapshot, so nothing is actually lost.
    function write() {
      if (!storage) return true;
      try { storage.setItem(storageKey, serialize(true)); return true; } catch (e1) {
        try { storage.setItem(storageKey, serialize(false)); return true; } catch (e2) { return false; }
      }
    }

    function notify() { listeners.forEach(function (fn) { fn(api); }); }

    function find(id) {
      for (var i = 0; i < entries.length; i++) if (entries[i].id === id) return entries[i];
      return null;
    }

    function findByKey(key) {
      for (var i = 0; i < entries.length; i++) if (entries[i].key === key) return entries[i];
      return null;
    }

    var api = {
      // Newest first — that is the drawer's reading order.
      entries: function () { return entries.slice().reverse(); },
      size: function () { return entries.length; },
      get: find,
      has: function (snap) { return !!findByKey(keyOf(snap)); },
      // Returns the entry, existing or new. `now` is passed in rather than read
      // off the clock so the store stays deterministic under test.
      add: function (snap, now) {
        var s = makeSnapshot(snap);
        var key = keyOf(s);
        var existing = findByKey(key);
        if (existing) {
          // A later capture may carry the picture the first one lacked.
          if (!existing.thumbnail && s.thumbnail) { existing.thumbnail = s.thumbnail; write(); notify(); }
          return existing;
        }
        counter += 1;
        s.id = 'c' + counter.toString(36) + '-' + hashString(key);
        s.addedAt = typeof now === 'number' ? now : 0;
        s.selected = false;
        s.key = key;
        entries.push(s);
        write();
        notify();
        return s;
      },
      remove: function (id) {
        var before = entries.length;
        entries = entries.filter(function (e) { return e.id !== id; });
        if (entries.length === before) return false;
        write();
        notify();
        return true;
      },
      // Add if absent, remove if present. Returns true when the snapshot is in
      // the collection afterwards.
      toggle: function (snap, now) {
        var existing = findByKey(keyOf(snap));
        if (existing) { api.remove(existing.id); return false; }
        api.add(snap, now);
        return true;
      },
      setThumbnail: function (id, dataUrl) {
        var e = find(id);
        if (!e) return;
        e.thumbnail = dataUrl || null;
        write();
      },
      setSelected: function (id, on) {
        var e = find(id);
        if (!e || e.selected === !!on) return;
        e.selected = !!on;
        write();
        notify();
      },
      selected: function () {
        return api.entries().filter(function (e) { return e.selected; });
      },
      clear: function () {
        entries = [];
        write();
        notify();
      },
      onChange: function (fn) { listeners.push(fn); },
      reload: function () { read(); notify(); },
      // Exposed for tests: the exact string that goes to storage.
      serialize: serialize
    };

    read();
    return api;
  }

  // ── Export metadata ─────────────────────────────────────────────────────
  // The product page restores a design from `?bfr=<base64 JSON>` holding
  // exactly `{ shader, values }` (sections/main-product.liquid), so that is the
  // payload — same key names, same value shapes — rather than a lab-specific
  // format it would then have to translate. Everything else in the file is for
  // a human running the A/B test: what it is, where it came from, how to get
  // it back into the lab.
  var STORE_ORIGIN = 'https://brightfield-2.myshopify.com';

  function utf8Base64(str) {
    try { return btoa(str); } catch (e) {
      return btoa(unescape(encodeURIComponent(str)));
    }
  }

  function exportBaseName(entry) {
    return 'brightfield-' + entry.source + '-' + String(entry.seed).replace(/[^a-z0-9_-]/gi, '_');
  }

  // `opts.values` is the mapped shader values (mapPalette output) for a shader
  // entry — the caller renders from them, so they are the truth. `opts.handles`
  // maps shader name → product handle where known; `opts.image` describes the
  // PNG written alongside.
  function buildExportMeta(entry, opts) {
    opts = opts || {};
    var isShader = !!opts.values;
    var base = exportBaseName(entry);
    var out = {
      format: 'brightfield-lab-design/1',
      exportedAt: typeof opts.now === 'string' ? opts.now : null,
      family: isShader ? 'shader' : 'shapes',
      source: entry.source,
      seed: entry.seed,
      palette: { id: entry.palette && entry.palette.id, name: entry.palette && entry.palette.name },
      image: {
        file: base + '.png',
        width: opts.image ? opts.image.width : null,
        height: opts.image ? opts.image.height : null,
        background: '#000000'
      },
      // Everything the lab needs to re-render or restore this exact entry.
      labSnapshot: {
        source: entry.source, seed: entry.seed, palette: entry.palette,
        shaderValues: entry.shaderValues || null, detail: entry.detail, variation: entry.variation || 0
      }
    };
    if (!isShader) {
      out.product = null;
      out.productNote = 'A shape source is a lab generator with no product page; the image is the deliverable.';
      return out;
    }
    var design = { shader: entry.source, values: opts.values };
    var bfr = utf8Base64(JSON.stringify(design));
    var handle = opts.handles && opts.handles[entry.source];
    var grouped = !!(opts.values.u_group_mode);
    out.design = design;
    out.product = {
      shader: entry.source,
      handle: handle || null,
      bfr: bfr,
      url: handle ? STORE_ORIGIN + '/products/' + handle + '?bfr=' + encodeURIComponent(bfr) : null,
      note: handle
        ? 'Open url: the product page reads ?bfr= and loads these values into the design.'
        : 'No product handle is on file for this shader. Open the product tagged shader-' + entry.source
          + ' and append ?bfr=<bfr> to its URL.'
    };
    if (grouped) {
      out.product.sizeGroupsWarning = 'This design uses size groups (u_group_* uniforms). The product page '
        + 'only restores values that are controls, so it will show the ungrouped colouring.';
    }
    return out;
  }

  // ── Importing an exported design ────────────────────────────────────────
  // The inverse of buildExportMeta: given the JSON sidecar an export wrote (or
  // just its labSnapshot block, or a raw snapshot someone hand-built), return a
  // normalized snapshot the lab can restore or add to the collection — or null
  // if the text is not a design. Pure and forgiving on the way in, strict on
  // the way out: whatever parses is reduced to exactly the snapshot fields.
  function parseExportedDesign(text) {
    var raw;
    try { raw = typeof text === 'string' ? JSON.parse(text) : text; } catch (e) { return null; }
    if (!raw || typeof raw !== 'object') return null;
    // The sidecar wraps the snapshot; accept the snapshot bare as well.
    var snap = raw.labSnapshot || raw;
    if (typeof raw.format === 'string' && raw.format.indexOf('brightfield-lab-design/') !== 0) return null;
    if (!snap || typeof snap !== 'object') return null;
    if (typeof snap.source !== 'string' || !snap.source) return null;
    if (snap.seed == null || snap.seed === '') return null;
    var pal = snap.palette;
    if (!pal || typeof pal !== 'object' || !Array.isArray(pal.colors) || !pal.colors.length) return null;
    if (!pal.colors.every(function (c) { return c && typeof c.color === 'string'; })) return null;
    return makeSnapshot(snap);
  }

  window.PaletteLabCollection = {
    parseExportedDesign: parseExportedDesign,
    STORE_ORIGIN: STORE_ORIGIN,
    exportBaseName: exportBaseName,
    buildExportMeta: buildExportMeta,
    STORAGE_KEY: STORAGE_KEY,
    keyOf: keyOf,
    makeSnapshot: makeSnapshot,
    createStore: createStore,
    hashString: hashString
  };
})();
