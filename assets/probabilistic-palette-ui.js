// Probabilistic palette editor — mountable UI component.
//
//   ProbabilisticPaletteUI.mount(el, { palette: ..., onChange: fn });
//
// Self-contained: injects its own stylesheet, owns its DOM, and hands back the
// edited palette object through onChange. Kept separate from the engine so the
// engine stays usable headlessly (tests, exports, worker-side rendering) and so
// this editor can later be dropped into a Shopify section as-is.
(function () {
  'use strict';

  var PP = window.ProbabilisticPalette;
  var STORAGE_KEY = 'brightfield.probabilisticPalettes';

  // ── Styles ────────────────────────────────────────────────────────────────
  // The tier colors are the load-bearing part: hierarchy has to be readable at
  // a glance, before anyone reads a single number.

  var CSS = [
    '.pp{--pp-bg:#141416;--pp-panel:#1c1c20;--pp-line:#2c2c32;--pp-text:#e8e8e6;--pp-dim:#8a8a92;',
    '--pp-dominant:#f2c14e;--pp-supporting:#6fb3f2;--pp-accent:#b98cf2;--pp-spark:#6fe0b8;',
    'color:var(--pp-text);font-family:"IBM Plex Mono",Menlo,monospace;font-size:12px;}',
    '.pp *{box-sizing:border-box;}',
    '.pp-section{border:1px solid var(--pp-line);border-radius:6px;background:var(--pp-panel);padding:14px;margin-bottom:14px;}',
    '.pp-section-title{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--pp-dim);margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:8px;}',
    '.pp-row{display:flex;align-items:center;gap:8px;margin-bottom:8px;}',
    '.pp-row:last-child{margin-bottom:0;}',
    '.pp-label{color:var(--pp-dim);min-width:130px;}',
    '.pp-val{min-width:74px;text-align:right;font-variant-numeric:tabular-nums;}',
    '.pp input[type=range]{flex:1;accent-color:#6fb3f2;min-width:80px;}',
    '.pp input[type=text],.pp input[type=number],.pp select{background:#0f0f11;border:1px solid var(--pp-line);',
    'color:var(--pp-text);border-radius:4px;padding:5px 7px;font-family:inherit;font-size:12px;min-width:0;}',
    '.pp input[type=color]{-webkit-appearance:none;appearance:none;width:34px;height:26px;padding:0;border:1px solid var(--pp-line);border-radius:4px;background:none;cursor:pointer;flex:none;}',
    '.pp input[type=color]::-webkit-color-swatch-wrapper{padding:2px;}',
    '.pp input[type=color]::-webkit-color-swatch{border:none;border-radius:2px;}',
    '.pp-btn{background:#26262c;border:1px solid var(--pp-line);color:var(--pp-text);border-radius:4px;',
    'padding:5px 10px;cursor:pointer;font-family:inherit;font-size:11px;}',
    '.pp-btn:hover{border-color:#6fb3f2;color:#fff;}',
    '.pp-btn.pp-danger:hover{border-color:#f2685a;color:#f2685a;}',
    '.pp-btn[disabled]{opacity:.38;cursor:not-allowed;border-color:var(--pp-line);color:var(--pp-dim);}',
    '.pp-btn-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px;}',
    '.pp-import{display:none;margin-top:12px;padding-top:11px;border-top:1px dashed var(--pp-line);}',
    '.pp-import.pp-open{display:block;}',
    '.pp-import textarea{width:100%;height:70px;resize:vertical;background:#0f0f11;border:1px solid var(--pp-line);',
    'color:var(--pp-text);border-radius:4px;padding:6px 7px;font-family:inherit;font-size:12px;}',
    '.pp-swatches{display:flex;flex-wrap:wrap;gap:4px;margin:8px 0 4px;min-height:18px;}',
    '.pp-swatches i{width:18px;height:18px;border-radius:3px;display:inline-block;border:1px solid var(--pp-line);}',
    '.pp-color{border:1px solid var(--pp-line);border-radius:5px;padding:8px;margin-bottom:6px;background:#17171a;',
    'border-left-width:3px;}',
    '.pp-color.pp-drag{opacity:.35;}',
    '.pp-color.pp-over{border-top:2px solid #6fb3f2;}',
    '.pp-color.pp-over-below{border-bottom:2px solid #6fb3f2;}',
    '.pp-color[data-tier=dominant]{border-left-color:var(--pp-dominant);}',
    '.pp-color[data-tier=supporting]{border-left-color:var(--pp-supporting);}',
    '.pp-color[data-tier=accent]{border-left-color:var(--pp-accent);}',
    '.pp-color[data-tier=spark]{border-left-color:var(--pp-spark);}',
    '.pp-color-head{display:flex;align-items:center;gap:7px;}',
    '.pp-grip{cursor:grab;color:#55555e;user-select:none;padding:0 2px;flex:none;}',
    '.pp-name{flex:1;min-width:60px;}',
    '.pp-weight{width:58px;text-align:right;flex:none;}',
    '.pp-pct{min-width:52px;text-align:right;color:var(--pp-dim);font-variant-numeric:tabular-nums;flex:none;}',
    '.pp-tier{font-size:9px;letter-spacing:.1em;text-transform:uppercase;padding:2px 5px;border-radius:3px;flex:none;',
    'min-width:78px;text-align:center;}',
    '.pp-tier[data-tier=dominant]{background:rgba(242,193,78,.16);color:var(--pp-dominant);}',
    '.pp-tier[data-tier=supporting]{background:rgba(111,179,242,.16);color:var(--pp-supporting);}',
    '.pp-tier[data-tier=accent]{background:rgba(185,140,242,.16);color:var(--pp-accent);}',
    '.pp-tier[data-tier=spark]{background:rgba(111,224,184,.16);color:var(--pp-spark);}',
    '.pp-color-bar{margin-top:7px;display:flex;align-items:center;gap:8px;}',
    '.pp-adv{margin-top:9px;padding-top:9px;border-top:1px dashed var(--pp-line);display:none;}',
    '.pp-adv.pp-open{display:block;}',
    '.pp-adv-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:7px 12px;}',
    '.pp-mini{display:flex;align-items:center;gap:6px;}',
    '.pp-mini label{color:var(--pp-dim);font-size:11px;white-space:nowrap;}',
    '.pp-mini input,.pp-mini select{flex:1;}',
    '.pp-strip{display:flex;height:34px;border-radius:4px;overflow:hidden;border:1px solid var(--pp-line);}',
    '.pp-strip-seg{position:relative;min-width:2px;}',
    '.pp-strip-labels{display:flex;margin-top:5px;font-size:10px;color:var(--pp-dim);}',
    '.pp-strip-label{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;padding-right:4px;}',
    '.pp-hint{color:var(--pp-dim);font-size:11px;line-height:1.5;}',
    '.pp-toggle{display:flex;align-items:center;gap:6px;cursor:pointer;color:var(--pp-dim);font-size:11px;}',
    '.pp-legend{display:flex;gap:12px;flex-wrap:wrap;font-size:10px;color:var(--pp-dim);margin-top:10px;}',
    '.pp-legend span{display:flex;align-items:center;gap:5px;}',
    '.pp-legend i{width:9px;height:9px;border-radius:2px;display:inline-block;}',
    '.pp-inert{opacity:.5;}',
    '.pp-inert-tag{font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:var(--pp-dim);',
    'border:1px solid var(--pp-line);border-radius:3px;padding:1px 4px;margin-left:6px;white-space:nowrap;}'
  ].join('');

  function injectStyles() {
    if (document.getElementById('pp-styles')) return;
    var s = document.createElement('style');
    s.id = 'pp-styles';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // ── Small DOM helpers ─────────────────────────────────────────────────────

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function input(type, value, attrs) {
    var n = document.createElement('input');
    n.type = type;
    // Attributes before value, not after: a range input validates and step-snaps
    // on assignment, so with min/max/step still at their defaults (0–100, step 1)
    // any fractional value snaps to 0 and then clamps to the real min once it
    // arrives. The thumb ends up parked on the floor while the readout — which
    // reads the variable, not the element — still shows the value that was
    // meant. Same trap for number inputs.
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (value != null) n.value = value;
    return n;
  }

  function select(options, value) {
    var n = document.createElement('select');
    options.forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      n.appendChild(opt);
    });
    n.value = value;
    return n;
  }

  function labeled(labelText, control) {
    var wrap = el('div', 'pp-mini');
    wrap.appendChild(el('label', null, labelText));
    wrap.appendChild(control);
    return wrap;
  }

  function num(v, fallback) {
    var n = parseFloat(v);
    return isFinite(n) ? n : fallback;
  }

  // Dims a control and badges it, for settings the engine honors but the host's
  // preview cannot express. The editor is not allowed to imply it is driving
  // something it isn't — an author tuning a dead slider learns the wrong lesson
  // about the palette.
  function markInert(node, why) {
    node.classList.add('pp-inert');
    node.title = why;
    node.appendChild(el('span', 'pp-inert-tag', 'engine-only'));
    return node;
  }

  // ── Copy for the sliders ──────────────────────────────────────────────────
  // The numbers alone don't tell an author what a setting *does* to the output,
  // so each slider names the regime it's currently in.

  function inheritanceLabel(v) {
    if (v < 0.2) return 'confetti — every shape decides alone';
    if (v < 0.45) return 'loose — small color echoes';
    if (v < 0.75) return 'balanced color clusters';
    if (v < 0.92) return 'strong regions';
    return 'large graphic color fields';
  }

  function variationLabel(v) {
    if (v <= 0.001) return 'fixed palette';
    if (v <= 0.12) return 'subtle variation';
    if (v <= 0.3) return 'noticeable variation';
    return 'highly generative';
  }

  // ── Storage ───────────────────────────────────────────────────────────────

  function loadSaved() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }

  function persist(map) {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map)); } catch (e) { /* private mode */ }
  }

  // ── Component ─────────────────────────────────────────────────────────────

  function mount(container, opts) {
    injectStyles();
    opts = opts || {};
    var palette = opts.palette
      ? JSON.parse(JSON.stringify(opts.palette))
      : PP.clonePalette(PP.PRESETS['Brightfield / Black 01']);
    var onChange = opts.onChange || function () {};
    // Set by hosts whose preview has no per-shape geometry — a fragment shader
    // colors uniforms, not shapes, so shape size has nothing to read. Pass a
    // string to replace the tooltip with something that tells the author where
    // the setting *does* work; a bare `true` gets the generic wording.
    var inertGeometry = !!opts.inertGeometry;
    var dragFrom = -1;   // row being dragged, for the drop indicator
    var INERT_WHY = typeof opts.inertGeometry === 'string' ? opts.inertGeometry
      : 'Shape size has no meaning in this preview — a shader has no per-shape hook. '
        + 'The engine still applies this wherever geometry exists.';
    // Authoring randomness is seeded too, so "Randomize weights" is replayable
    // and no Math.random call exists anywhere in the feature.
    var randomizeNonce = 0;
    var saved = loadSaved();

    container.classList.add('pp');
    var refreshers = [];   // derived readouts, re-run on every value change

    function emit() { onChange(palette); }

    function changed() { refreshers.forEach(function (f) { f(); }); emit(); }

    function rebuild() {
      refreshers = [];
      container.textContent = '';
      container.appendChild(buildIdentity());
      container.appendChild(buildPreview());
      container.appendChild(buildColors());
      container.appendChild(buildPrint());
      container.appendChild(buildGeography());
      changed();
    }

    // ── Identity / presets ──────────────────────────────────────────────────

    function buildIdentity() {
      // Re-read on every rebuild: a Save elsewhere in this session (or in
      // another tab) has to show up in the Load list without a page reload.
      saved = loadSaved();
      var sec = el('div', 'pp-section');
      var title = el('div', 'pp-section-title');
      title.appendChild(el('span', null, 'Palette'));
      sec.appendChild(title);

      var nameRow = el('div', 'pp-row');
      nameRow.appendChild(el('span', 'pp-label', 'Name'));
      var name = input('text', palette.name);
      name.style.flex = '1';
      name.addEventListener('input', function () { palette.name = this.value; emit(); });
      nameRow.appendChild(name);
      sec.appendChild(nameRow);

      var loadRow = el('div', 'pp-row');
      loadRow.appendChild(el('span', 'pp-label', 'Load'));
      var options = [{ label: '— select —', value: '' }]
        .concat(Object.keys(PP.PRESETS).map(function (k) { return { label: k, value: 'preset:' + k }; }))
        .concat(Object.keys(saved).map(function (k) { return { label: '★ ' + k, value: 'saved:' + k }; }));
      var loader = select(options, '');
      loader.style.flex = '1';
      loader.addEventListener('change', function () {
        var v = this.value;
        if (!v) return;
        var src = v.indexOf('preset:') === 0
          ? PP.PRESETS[v.slice(7)]
          : saved[v.slice(6)];
        if (!src) return;
        palette = JSON.parse(JSON.stringify(src));
        rebuild();
      });
      loadRow.appendChild(loader);
      sec.appendChild(loadRow);

      var btns = el('div', 'pp-btn-row');

      var dup = el('button', 'pp-btn', 'Duplicate palette');
      dup.addEventListener('click', function () {
        palette = PP.clonePalette(palette);
        rebuild();
      });
      btns.appendChild(dup);

      var save = el('button', 'pp-btn', 'Save');
      save.addEventListener('click', function () {
        var n = window.prompt('Save palette as:', palette.name);
        if (!n) return;
        palette.name = n;
        saved[n] = JSON.parse(JSON.stringify(palette));
        persist(saved);
        rebuild();
      });
      btns.appendChild(save);

      var del = el('button', 'pp-btn pp-danger', 'Delete saved');
      del.addEventListener('click', function () {
        if (!saved[palette.name]) { window.alert('“' + palette.name + '” is not a saved palette.'); return; }
        if (!window.confirm('Delete saved palette “' + palette.name + '”?')) return;
        delete saved[palette.name];
        persist(saved);
        rebuild();
      });
      btns.appendChild(del);

      var copy = el('button', 'pp-btn', 'Copy JSON');
      copy.addEventListener('click', function () {
        var json = JSON.stringify(palette, null, 2);
        if (navigator.clipboard) navigator.clipboard.writeText(json);
        copy.textContent = 'Copied';
        window.setTimeout(function () { copy.textContent = 'Copy JSON'; }, 900);
      });
      btns.appendChild(copy);

      var importBtn = el('button', 'pp-btn', 'Import');
      importBtn.title = 'Paste a list of hex codes';
      btns.appendChild(importBtn);

      sec.appendChild(btns);
      sec.appendChild(buildImport(importBtn));
      return sec;
    }

    // ── Import: paste a hex list ────────────────────────────────────────────
    // Inline rather than a window.prompt — the paste is multi-line, and the
    // parse readout is the thing that makes it trustworthy: you see the colors
    // that were found before committing to them.

    function buildImport(toggleBtn) {
      var panel = el('div', 'pp-import');

      var ta = document.createElement('textarea');
      ta.placeholder = '#606c38, #283618, #fefae0 …';
      ta.spellcheck = false;
      panel.appendChild(ta);

      var swatches = el('div', 'pp-swatches');
      panel.appendChild(swatches);

      var note = el('div', 'pp-hint', '');
      panel.appendChild(note);

      var actions = el('div', 'pp-btn-row');
      var replaceBtn = el('button', 'pp-btn', 'Replace palette');
      var addBtn = el('button', 'pp-btn', 'Add to palette');
      var cancelBtn = el('button', 'pp-btn', 'Cancel');
      actions.appendChild(replaceBtn);
      actions.appendChild(addBtn);
      actions.appendChild(cancelBtn);
      panel.appendChild(actions);

      var hexes = [];

      function parse() {
        hexes = PP.parseHexList(ta.value);
        swatches.textContent = '';
        hexes.forEach(function (h) {
          var sw = el('i');
          sw.style.background = h;
          sw.title = h;
          swatches.appendChild(sw);
        });
        if (!hexes.length) {
          note.textContent = ta.value.trim() ? 'No hex codes found' : 'Paste hex codes — commas, spaces, newlines or a Coolors URL all work.';
        } else if (hexes.length === 1) {
          note.textContent = 'Only 1 color found';
        } else if (hexes.length > 12) {
          note.textContent = hexes.length + ' colors found — above about 12 the tail ends up too rare to read.';
        } else {
          note.textContent = hexes.length + ' colors found';
        }
        replaceBtn.disabled = !hexes.length;
        addBtn.disabled = !hexes.length;
      }

      function close() {
        panel.classList.remove('pp-open');
        ta.value = '';
        parse();
      }

      ta.addEventListener('input', parse);
      parse();

      toggleBtn.addEventListener('click', function () {
        panel.classList.toggle('pp-open');
        if (panel.classList.contains('pp-open')) ta.focus();
      });

      replaceBtn.addEventListener('click', function () {
        if (!hexes.length) return;
        palette = PP.paletteFromHexList(hexes, { name: palette.name });
        rebuild();   // panel is rebuilt closed, with the palette in place
      });

      addBtn.addEventListener('click', function () {
        if (!hexes.length) return;
        var present = {};
        palette.colors.forEach(function (c) { present[String(c.color).toUpperCase()] = true; });
        var fresh = hexes.filter(function (h) { return !present[h]; });
        if (!fresh.length) { close(); return; }

        // Appended colors join at the bottom of the hierarchy — below whatever
        // is currently rarest — so an addition never reshuffles the palette.
        var existing = palette.colors
          .map(function (c) { return typeof c.weight === 'number' ? c.weight : 0; })
          .filter(function (w) { return w > 0; });
        var floor = existing.length ? Math.min.apply(null, existing) : 10;
        var w = Math.max(0.5, Math.round(floor * 0.75 * 10) / 10);

        var taken = {};
        palette.colors.forEach(function (c) { if (c.id) taken[c.id] = true; });

        PP.paletteFromHexList(fresh).colors.forEach(function (c) {
          delete c.spark;
          delete c.variationScale;
          delete c.conditions;
          c.weight = w;
          c.spatial = [w, w];
          c.sizeCurve = JSON.parse(JSON.stringify(PP.SIZE_CURVE_PRESETS.small));
          var id = c.id, k = 2;
          while (taken[id]) { id = c.id + '-' + k; k++; }
          taken[id] = true;
          c.id = id;
          palette.colors.push(c);
        });
        rebuild();
      });

      cancelBtn.addEventListener('click', close);

      return panel;
    }

    // ── Proportional preview strip ──────────────────────────────────────────

    function buildPreview() {
      var sec = el('div', 'pp-section');
      var title = el('div', 'pp-section-title');
      title.appendChild(el('span', null, 'Hierarchy'));
      var seedNote = el('span', null, '');
      title.appendChild(seedNote);
      sec.appendChild(title);

      var strip = el('div', 'pp-strip');
      var labels = el('div', 'pp-strip-labels');
      sec.appendChild(strip);
      sec.appendChild(labels);

      var legend = el('div', 'pp-legend');
      ['dominant', 'supporting', 'accent', 'spark'].forEach(function (t) {
        var s = el('span');
        var sw = el('i');
        sw.style.background = 'var(--pp-' + t + ')';
        s.appendChild(sw);
        s.appendChild(el('span', null, PP.TIERS[t].label));
        legend.appendChild(s);
      });
      sec.appendChild(legend);

      refreshers.push(function () {
        var rows = PP.describe(palette);
        strip.textContent = '';
        labels.textContent = '';
        rows.forEach(function (r) {
          var seg = el('div', 'pp-strip-seg');
          seg.style.background = r.color;
          seg.style.flexGrow = String(Math.max(r.share, 0.002));
          seg.title = r.name + ' · ' + r.percent + '% · ' + PP.TIERS[r.tier].label;
          strip.appendChild(seg);

          var lab = el('div', 'pp-strip-label', r.name + ' ' + r.percent + '%');
          lab.style.flexGrow = String(Math.max(r.share, 0.002));
          lab.style.flexBasis = '0';
          lab.style.color = r.color;
          labels.appendChild(lab);
        });
        var exposed = Math.round((1 - (palette.printDensity != null ? palette.printDensity : 1)) * 100);
        seedNote.textContent = exposed + '% shirt exposed';
      });

      return sec;
    }

    // ── Colors ──────────────────────────────────────────────────────────────

    function buildColors() {
      var sec = el('div', 'pp-section');
      var title = el('div', 'pp-section-title');
      title.appendChild(el('span', null, 'Colors'));
      title.appendChild(el('span', null, palette.colors.length + ' entries'));
      sec.appendChild(title);

      var list = el('div');
      sec.appendChild(list);
      palette.colors.forEach(function (c, i) { list.appendChild(buildColorRow(c, i, list)); });

      var btns = el('div', 'pp-btn-row');

      var add = el('button', 'pp-btn', '+ Add color');
      add.addEventListener('click', function () {
        palette.colors.push({
          id: 'color-' + palette.colors.length,
          name: 'New Color',
          color: '#CCCCCC',
          weight: 10
        });
        rebuild();
      });
      btns.appendChild(add);

      var rand = el('button', 'pp-btn', 'Randomize weights');
      rand.addEventListener('click', function () {
        // Log-uniform draws produce a real hierarchy (one clear lead, a long
        // tail) instead of the flat mush uniform draws give.
        var rng = PP.makeRng(PP.deriveSeed(palette.name, 'randomize-weights', randomizeNonce++));
        palette.colors.forEach(function (c) {
          c.weight = Math.round(Math.exp(rng() * 3.2) * 10) / 10;
        });
        normalizeToHundred();
        rebuild();
      });
      btns.appendChild(rand);

      var norm = el('button', 'pp-btn', 'Normalize');
      norm.addEventListener('click', function () { normalizeToHundred(); rebuild(); });
      btns.appendChild(norm);

      sec.appendChild(btns);
      sec.appendChild(el('div', 'pp-hint',
        'Weights normalize automatically — they never have to add up to 100. Normalize just rewrites them as percentages.'));
      return sec;
    }

    function normalizeToHundred() {
      var shares = PP.paletteShares(palette.colors);
      palette.colors.forEach(function (c, i) { c.weight = Math.round(shares[i] * 1000) / 10; });
    }

    function buildColorRow(c, index, list) {
      var row = el('div', 'pp-color');
      row.draggable = true;
      row.dataset.index = String(index);

      var head = el('div', 'pp-color-head');

      var grip = el('span', 'pp-grip', '⠿');
      grip.title = 'Drag to reorder';
      head.appendChild(grip);

      var swatch = input('color', c.color);
      swatch.addEventListener('input', function () { c.color = this.value.toUpperCase(); changed(); });
      head.appendChild(swatch);

      var name = input('text', c.name || '');
      name.className = 'pp-name';
      name.placeholder = 'Color name';
      name.addEventListener('input', function () { c.name = this.value; changed(); });
      head.appendChild(name);

      var tier = el('span', 'pp-tier');
      head.appendChild(tier);

      var pct = el('span', 'pp-pct');
      head.appendChild(pct);

      var advBtn = el('button', 'pp-btn', 'Rules');
      head.appendChild(advBtn);

      var dupBtn = el('button', 'pp-btn', 'Copy');
      dupBtn.title = 'Duplicate this color';
      dupBtn.addEventListener('click', function () {
        var copy = JSON.parse(JSON.stringify(c));
        copy.id = (copy.id || 'color') + '-copy';
        copy.name = (copy.name || 'Color') + ' copy';
        palette.colors.splice(index + 1, 0, copy);
        rebuild();
      });
      head.appendChild(dupBtn);

      var delBtn = el('button', 'pp-btn pp-danger', '×');
      delBtn.title = 'Remove this color';
      delBtn.addEventListener('click', function () {
        palette.colors.splice(index, 1);
        rebuild();
      });
      head.appendChild(delBtn);

      row.appendChild(head);

      // weight slider + numeric field
      var bar = el('div', 'pp-color-bar');
      var slider = input('range', c.weight, { min: '0', max: '100', step: '0.5' });
      var weightNum = input('number', c.weight, { min: '0', step: '0.5' });
      weightNum.className = 'pp-weight';
      slider.addEventListener('input', function () {
        c.weight = num(this.value, 0);
        weightNum.value = c.weight;
        changed();
      });
      weightNum.addEventListener('input', function () {
        c.weight = Math.max(0, num(this.value, 0));
        slider.value = Math.min(100, c.weight);
        changed();
      });
      bar.appendChild(slider);
      bar.appendChild(weightNum);
      row.appendChild(bar);

      // ── Advanced rules: geometry, spatial ends, spark conditions ──────────
      var adv = el('div', 'pp-adv');
      advBtn.addEventListener('click', function () { adv.classList.toggle('pp-open'); });
      var grid = el('div', 'pp-adv-grid');

      var curveKey = 'none';
      Object.keys(PP.SIZE_CURVE_PRESETS).forEach(function (k) {
        if (JSON.stringify(PP.SIZE_CURVE_PRESETS[k]) === JSON.stringify(c.sizeCurve || null)) curveKey = k;
      });
      var sizeSel = select([
        { label: 'Any size', value: 'none' },
        { label: 'Favor large', value: 'large' },
        { label: 'Favor medium', value: 'medium' },
        { label: 'Favor small', value: 'small' },
        { label: 'Favor tiny', value: 'tiny' },
        { label: 'Custom curve', value: 'custom' }
      ], c.sizeCurve && curveKey === 'none' ? 'custom' : curveKey);
      sizeSel.addEventListener('change', function () {
        if (this.value === 'custom') return;   // leave a hand-written curve alone
        var preset = PP.SIZE_CURVE_PRESETS[this.value];
        if (preset) c.sizeCurve = JSON.parse(JSON.stringify(preset));
        else delete c.sizeCurve;
        changed();
      });
      var sizeRow = labeled('Size bias', sizeSel);
      if (inertGeometry) markInert(sizeRow, INERT_WHY);
      grid.appendChild(sizeRow);

      var spatialNear = input('number', c.spatial ? c.spatial[0] : c.weight, { min: '0', step: '1' });
      var spatialFar = input('number', c.spatial ? c.spatial[1] : c.weight, { min: '0', step: '1' });
      function writeSpatial() {
        c.spatial = [Math.max(0, num(spatialNear.value, 0)), Math.max(0, num(spatialFar.value, 0))];
        changed();
      }
      spatialNear.addEventListener('input', writeSpatial);
      spatialFar.addEventListener('input', writeSpatial);
      grid.appendChild(labeled('Weight at start', spatialNear));
      grid.appendChild(labeled('Weight at end', spatialFar));

      var sparkChk = input('checkbox');
      sparkChk.checked = !!c.spark;
      sparkChk.addEventListener('change', function () {
        c.spark = this.checked;
        // A spark that drifts with the seed stops feeling rare — lock its share
        // by default when the flag goes on.
        if (this.checked && c.variationScale == null) c.variationScale = 0;
        changed();
      });
      grid.appendChild(labeled('Spark color', sparkChk));

      var lockChk = input('checkbox');
      lockChk.checked = c.variationScale === 0;
      lockChk.addEventListener('change', function () {
        if (this.checked) c.variationScale = 0; else delete c.variationScale;
        changed();
      });
      grid.appendChild(labeled('Lock weight', lockChk));

      var cond = c.conditions || {};
      function writeCond(key, value) {
        c.conditions = c.conditions || {};
        if (value == null || value === '' || !isFinite(value)) delete c.conditions[key];
        else c.conditions[key] = value;
        if (!Object.keys(c.conditions).length) delete c.conditions;
        changed();
      }

      var maxSize = input('number', cond.maxSize != null ? cond.maxSize : '', { min: '0', max: '1', step: '0.05', placeholder: 'any' });
      maxSize.addEventListener('input', function () { writeCond('maxSize', this.value === '' ? null : num(this.value, null)); });
      var maxSizeRow = labeled('Only size ≤', maxSize);
      if (inertGeometry) markInert(maxSizeRow, INERT_WHY);
      grid.appendChild(maxSizeRow);

      var minSize = input('number', cond.minSize != null ? cond.minSize : '', { min: '0', max: '1', step: '0.05', placeholder: 'any' });
      minSize.addEventListener('input', function () { writeCond('minSize', this.value === '' ? null : num(this.value, null)); });
      var minSizeRow = labeled('Only size ≥', minSize);
      if (inertGeometry) markInert(minSizeRow, INERT_WHY);
      grid.appendChild(minSizeRow);

      var maxShare = input('number', cond.maxShare != null ? cond.maxShare : '', { min: '0', max: '1', step: '0.01', placeholder: 'none' });
      maxShare.addEventListener('input', function () { writeCond('maxShare', this.value === '' ? null : num(this.value, null)); });
      grid.appendChild(labeled('Max share of shapes', maxShare));

      var afterSel = select([{ label: 'any', value: '' }].concat(palette.colors.map(function (o) {
        return { label: o.name || o.color, value: o.color };
      })), cond.afterColor || '');
      afterSel.addEventListener('change', function () {
        c.conditions = c.conditions || {};
        if (this.value) c.conditions.afterColor = this.value; else delete c.conditions.afterColor;
        if (!Object.keys(c.conditions).length) delete c.conditions;
        changed();
      });
      grid.appendChild(labeled('Only after', afterSel));

      var region = cond.region || {};
      var regionSel = select([
        { label: 'anywhere', value: '' },
        { label: 'top half', value: 'top' },
        { label: 'bottom half', value: 'bottom' },
        { label: 'left half', value: 'left' },
        { label: 'right half', value: 'right' },
        { label: 'center', value: 'center' },
        { label: 'outer ring', value: 'outer' }
      ], regionKeyOf(region));
      regionSel.addEventListener('change', function () {
        c.conditions = c.conditions || {};
        var r = REGION_PRESETS[this.value];
        if (r) c.conditions.region = JSON.parse(JSON.stringify(r)); else delete c.conditions.region;
        if (!Object.keys(c.conditions).length) delete c.conditions;
        changed();
      });
      grid.appendChild(labeled('Only in region', regionSel));

      adv.appendChild(grid);
      adv.appendChild(el('div', 'pp-hint',
        'Start/end weights apply when spatial probability is on — they are the weights at each end of the field. Conditions gate the color out entirely when unmet.'
        + (inertGeometry ? ' Size rules are marked engine-only: they still work anywhere shapes exist, but this preview has none.' : '')));
      row.appendChild(adv);

      // Drag reorder. splice(from,1) then splice(to,0) lands the row at index
      // `to` in both directions, which is the predictable rule — but relative to
      // the *row* under the cursor that means "above" when dragging up and
      // "below" when dragging down. The indicator has to say which, or a
      // downward drag looks like it missed by one. dataTransfer is unreadable
      // during dragover (by spec), so the source index is tracked here instead.
      row.addEventListener('dragstart', function (e) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(index));
        dragFrom = index;
        row.classList.add('pp-drag');
      });
      row.addEventListener('dragend', function () {
        row.classList.remove('pp-drag');
        dragFrom = -1;
      });
      row.addEventListener('dragover', function (e) {
        e.preventDefault();
        var below = dragFrom > -1 && dragFrom < index;
        row.classList.toggle('pp-over', !below);
        row.classList.toggle('pp-over-below', below);
      });
      row.addEventListener('dragleave', function () {
        row.classList.remove('pp-over', 'pp-over-below');
      });
      row.addEventListener('drop', function (e) {
        e.preventDefault();
        row.classList.remove('pp-over', 'pp-over-below');
        var from = parseInt(e.dataTransfer.getData('text/plain'), 10);
        var to = index;
        if (isNaN(from) || from === to) return;
        var moved = palette.colors.splice(from, 1)[0];
        palette.colors.splice(to, 0, moved);
        rebuild();
      });

      refreshers.push(function () {
        var shares = PP.paletteShares(palette.colors);
        var t = PP.classifyTier(shares[index], c);
        row.dataset.tier = t;
        tier.dataset.tier = t;
        tier.textContent = PP.TIERS[t].label;
        pct.textContent = (Math.round(shares[index] * 1000) / 10) + '%';
        swatch.value = c.color;
      });

      return row;
    }

    var REGION_PRESETS = {
      top:    { yMax: 0.5 },
      bottom: { yMin: 0.5 },
      left:   { xMax: 0.5 },
      right:  { xMin: 0.5 },
      center: { rMax: 0.45 },
      outer:  { rMin: 0.6 }
    };

    function regionKeyOf(region) {
      var keys = Object.keys(REGION_PRESETS);
      for (var i = 0; i < keys.length; i++) {
        if (JSON.stringify(REGION_PRESETS[keys[i]]) === JSON.stringify(region)) return keys[i];
      }
      return '';
    }

    // ── Print density & inheritance ─────────────────────────────────────────

    function buildPrint() {
      var sec = el('div', 'pp-section');
      var title = el('div', 'pp-section-title');
      title.appendChild(el('span', null, 'Ink & clustering'));
      sec.appendChild(title);

      sec.appendChild(slider('Print density', 'printDensity', 0, 1, 0.01, function (v) {
        return Math.round(v * 100) + '%';
      }, function (v) {
        return 'Black shirt exposed: ' + Math.round((1 - v) * 100) + '% — unprinted areas are left transparent, never inked black.';
      }));

      sec.appendChild(slider('Color inheritance', 'inheritance', 0, 1, 0.01, function (v) {
        return Math.round(v * 100) + '%';
      }, function (v) { return inheritanceLabel(v); }));

      return sec;
    }

    // ── Geography: spatial + generative weights ─────────────────────────────

    function buildGeography() {
      var sec = el('div', 'pp-section');
      var title = el('div', 'pp-section-title');
      title.appendChild(el('span', null, 'Geography & variation'));
      sec.appendChild(title);

      var spatialRow = el('div', 'pp-row');
      var spatialChk = input('checkbox');
      spatialChk.checked = !!(palette.spatial && palette.spatial.enabled);
      var spatialLabel = el('label', 'pp-toggle');
      spatialLabel.appendChild(spatialChk);
      spatialLabel.appendChild(el('span', null, 'Spatial probability'));
      spatialRow.appendChild(spatialLabel);

      var spatialModeSel = select(Object.keys(PP.SPATIAL_MODES).map(function (k) {
        return { label: PP.SPATIAL_MODES[k].label, value: k };
      }), (palette.spatial && palette.spatial.mode) || 'top-bottom');
      spatialModeSel.addEventListener('change', function () {
        palette.spatial = palette.spatial || {};
        palette.spatial.mode = this.value;
        changed();
      });
      spatialChk.addEventListener('change', function () {
        palette.spatial = palette.spatial || { mode: 'top-bottom' };
        palette.spatial.enabled = this.checked;
        changed();
      });
      spatialRow.appendChild(spatialModeSel);
      sec.appendChild(spatialRow);
      sec.appendChild(el('div', 'pp-hint',
        'Probabilities are interpolated across the canvas — not the colors themselves. Each shape stays a discrete palette color while the composition drifts between color families. Set each color’s start/end weights under Rules.'));

      // ── Size groups ───────────────────────────────────────────────────────
      var groupRow = el('div', 'pp-row');
      groupRow.style.marginTop = '10px';
      var groupChk = input('checkbox');
      groupChk.checked = !!(palette.sizeGroups && palette.sizeGroups.enabled);
      var groupLabel = el('label', 'pp-toggle');
      groupLabel.appendChild(groupChk);
      groupLabel.appendChild(el('span', null, 'Group by size'));
      groupChk.addEventListener('change', function () {
        palette.sizeGroups = palette.sizeGroups || {};
        palette.sizeGroups.enabled = this.checked;
        changed();
      });
      groupRow.appendChild(groupLabel);
      if (inertGeometry) markInert(groupRow, INERT_WHY);
      sec.appendChild(groupRow);

      sec.appendChild(el('div', 'pp-hint',
        'Every shape of roughly the same size takes one color, wherever it sits — a third kind of structure, '
        + 'next to geography (where a shape is) and inheritance (what it is next to).'));

      var bands = (palette.sizeGroups || {}).mode === 'bands';

      var modeRow = el('div', 'pp-row');
      modeRow.appendChild(el('span', 'pp-label', 'Grouping'));
      var groupModeSel = select([
        { label: 'Natural clusters', value: 'clusters' },
        { label: 'Fixed bands', value: 'bands' }
      ], bands ? 'bands' : 'clusters');
      groupModeSel.addEventListener('change', function () {
        palette.sizeGroups = palette.sizeGroups || {};
        palette.sizeGroups.mode = this.value;
        // Rebuild rather than patch: the labels, the hints and which rows apply
        // all differ between the two modes.
        rebuild();
      });
      modeRow.appendChild(groupModeSel);
      if (inertGeometry) markInert(modeRow, INERT_WHY);
      sec.appendChild(modeRow);

      sec.appendChild(el('div', 'pp-hint', bands
        ? 'Fixed bands cuts the size range into equal slices, so you always get the number of tiers you asked '
          + 'for. It will split where nothing actually changes, and on a lopsided composition most shapes can '
          + 'land in one band — check the swatch strip under the preview for the per-band counts.'
        : 'Natural clusters puts the splits at the widest gaps in the composition’s own size distribution, so a '
          + 'design with three real scales gets three groups and one with no break in scale honestly gets a '
          + 'single group. Switch to fixed bands if you would rather guarantee the count.'));

      if (!bands) {
        // Floors at the engine's 0.001, and steps in thousandths so that end of
        // the range is actually reachable — below a sampled field's own spacing
        // is where a smooth distribution can be forced to split at all.
        var gapWrap = slider('Min size gap', 'sizeGroups.minGap', 0.001, 0.3, 0.001, function (v) {
          return v.toFixed(3);
        }, function (v) {
          if (v <= 0.004) {
            return 'below the spacing of most size fields — a smooth distribution will split, but every '
              + 'candidate gap ties, so the cuts bunch rather than spread. Fixed bands imposes tiers more evenly.';
          }
          return v <= 0.012 ? 'splits on the faintest break — expect the maximum number of groups'
            : (v >= 0.06 ? 'only a dramatic jump in scale counts — most compositions collapse to one group'
              : 'splits on a clear step in scale');
        }, PP.DEFAULT_SIZE_GROUPS.minGap);
        if (inertGeometry) markInert(gapWrap, INERT_WHY);
        sec.appendChild(gapWrap);
      }

      var dropRow = el('div', 'pp-row');
      dropRow.style.marginTop = '10px';
      var dropChk = input('checkbox');
      dropChk.checked = !!(palette.sizeGroups && palette.sizeGroups.dropElements);
      var dropLabel = el('label', 'pp-toggle');
      dropLabel.appendChild(dropChk);
      dropLabel.appendChild(el('span', null, 'Print density may drop elements'));
      dropChk.addEventListener('change', function () {
        palette.sizeGroups = palette.sizeGroups || {};
        palette.sizeGroups.dropElements = this.checked;
        changed();
      });
      dropRow.appendChild(dropLabel);
      sec.appendChild(dropRow);
      sec.appendChild(el('div', 'pp-hint',
        'Off, grouping only re-colours: every element the design had without grouping is still there, '
        + 'just painted by its size cohort. On, print density also removes elements, so the shirt breaks '
        + 'through inside a cohort. The print/skip roll is drawn either way, so flipping this re-colours '
        + 'the composition rather than reshuffling it.'));

      var maxWrap = slider(bands ? 'Bands' : 'Max groups', 'sizeGroups.maxGroups', 1, 8, 1, function (v) {
        return String(Math.round(v));
      }, function (v) {
        var n = Math.round(v);
        if (n === 1) return 'one group — the whole print is a single color';
        return bands ? 'exactly ' + n + ' tiers, split at every ' + (1 / n).toFixed(2) + ' of the size range'
          : 'keeps the widest ' + (n - 1) + ' gaps at most';
      });
      if (inertGeometry) markInert(maxWrap, INERT_WHY);
      sec.appendChild(maxWrap);

      var geoRow = el('div', 'pp-row');
      geoRow.style.marginTop = '10px';
      var geoChk = input('checkbox');
      geoChk.checked = palette.geometryEnabled !== false;
      var geoLabel = el('label', 'pp-toggle');
      geoLabel.appendChild(geoChk);
      geoLabel.appendChild(el('span', null, 'Geometry-aware color (shape size)'));
      geoChk.addEventListener('change', function () { palette.geometryEnabled = this.checked; changed(); });
      geoRow.appendChild(geoLabel);
      if (inertGeometry) markInert(geoRow, INERT_WHY);
      sec.appendChild(geoRow);

      var genRow = el('div', 'pp-row');
      genRow.style.marginTop = '10px';
      var genChk = input('checkbox');
      genChk.checked = !!palette.generativeWeights;
      var genLabel = el('label', 'pp-toggle');
      genLabel.appendChild(genChk);
      genLabel.appendChild(el('span', null, 'Generative weights'));
      genChk.addEventListener('change', function () { palette.generativeWeights = this.checked; changed(); });
      genRow.appendChild(genLabel);
      sec.appendChild(genRow);

      sec.appendChild(slider('Weight variation', 'weightVariation', 0, 0.5, 0.01, function (v) {
        return Math.round(v * 100) + '%';
      }, function (v) { return variationLabel(v); }));

      return sec;
    }

    // Generic labeled slider bound to a palette key, or a dotted path into a
    // nested settings object (`sizeGroups.minGap`).
    function readPath(path) {
      return path.split('.').reduce(function (o, k) { return o == null ? undefined : o[k]; }, palette);
    }
    function writePath(path, value) {
      var parts = path.split('.');
      var last = parts.pop();
      var target = parts.reduce(function (o, k) {
        if (o[k] == null) o[k] = {};
        return o[k];
      }, palette);
      target[last] = value;
    }

    // `dflt` is what the row shows when the palette has not set this key yet.
    // It defaults to `min` only because most sliders have no other sensible
    // resting point; anything the engine defaults to something else must pass it,
    // or the panel will claim a value the engine is not using.
    function slider(labelText, key, min, max, step, fmt, hint, dflt) {
      var wrap = el('div');
      var row = el('div', 'pp-row');
      row.appendChild(el('span', 'pp-label', labelText));
      var stored = readPath(key);
      var value = stored != null ? stored : (dflt != null ? dflt : min);
      var ctrl = input('range', value, { min: String(min), max: String(max), step: String(step) });
      var out = el('span', 'pp-val', fmt(value));
      var note = el('div', 'pp-hint', hint ? hint(value) : '');
      ctrl.addEventListener('input', function () {
        writePath(key, num(this.value, min));
        var v = readPath(key);
        out.textContent = fmt(v);
        if (hint) note.textContent = hint(v);
        changed();
      });
      row.appendChild(ctrl);
      row.appendChild(out);
      wrap.appendChild(row);
      if (hint) wrap.appendChild(note);
      return wrap;
    }

    rebuild();

    return {
      getPalette: function () { return palette; },
      setPalette: function (p) { palette = JSON.parse(JSON.stringify(p)); rebuild(); },
      refresh: rebuild
    };
  }

  window.ProbabilisticPaletteUI = {
    mount: mount,
    STORAGE_KEY: STORAGE_KEY,
    inheritanceLabel: inheritanceLabel,
    variationLabel: variationLabel
  };
})();
