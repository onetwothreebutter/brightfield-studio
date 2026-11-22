// Product page, shader products only: the Customize control panel, plus
// randomize, share links and restoring saved or community designs. The
// control definitions come from window.BFShaderDef (rendered inline by the
// section); Liquid values from window.BFProduct.

// ── Shader GUI ────────────────────────────────────────────────────────────────
(function (cfg) {
  var def = window.BFShaderDef;
  if (!def) return;
  var body = def.body;
  var controls = def.controls;
  var customAfterBuild = def.customAfterBuild;
  var lib = def.lib;

  // Initialise shared state — shader.js reads this each frame
  var values = {};
  controls.forEach(function (c) {
    if (!c.key) return;
    values[c.key] = c.type === 'color' ? lib.hexToRgb(c.value, c.key) : (c.toRadians ? c.value * Math.PI / 180 : c.value);
  });
  window._shaderState = { values: values, textDirty: true };
  // A community design stays hidden until its saved values are restored.
  if (cfg.submissionId) window._shaderState.holdReveal = true;

  // Pre-populate restore key from ?bfr= share param (set by Worker share page)
  (function () {
    try {
      var bfr = new URLSearchParams(location.search).get('bfr');
      if (bfr) {
        localStorage.setItem('brightfield_restore', atob(bfr));
        history.replaceState(null, '', location.pathname + '#shader');
      }
    } catch (e) {}
  }());

  // Restore saved design if user clicked a gallery card
  (function () {
    var raw = localStorage.getItem('brightfield_restore');
    if (!raw) return;
    try {
      var saved = JSON.parse(raw);
      localStorage.removeItem('brightfield_restore');
      if (saved.shader !== cfg.shader) return;
      Object.keys(saved.values).forEach(function (k) {
        if (k in window._shaderState.values) {
          window._shaderState.values[k] = saved.values[k];
        }
      });
      window._shaderState.textDirty = true;
      if (saved.creatorName) {
        document.querySelectorAll('.product-title').forEach(function (titleEl) {
          var remixEl = document.createElement('p');
          remixEl.className = 'product-remixed-by';
          remixEl.textContent = 'Remixed by ' + saved.creatorName;
          titleEl.parentNode.insertBefore(remixEl, titleEl.nextSibling);
        });
      }
    } catch (e) {
      localStorage.removeItem('brightfield_restore');
    }
  }());

  // Shared tooltip for control tips
  var tipEl = document.createElement('div');
  tipEl.className    = 'shader-tip__popup';
  tipEl.style.display = 'none';
  document.body.appendChild(tipEl);
  var activeTipBtn = null;

  function showTip(btn, text) {
    var rect = btn.getBoundingClientRect();
    tipEl.textContent  = text;
    tipEl.style.display = 'block';
    tipEl.style.top    = (rect.bottom + 6) + 'px';
    tipEl.style.left   = rect.left + 'px';
    if (activeTipBtn) activeTipBtn.classList.remove('is-open');
    activeTipBtn = btn;
    btn.classList.add('is-open');
  }
  function hideTip() {
    tipEl.style.display = 'none';
    if (activeTipBtn) { activeTipBtn.classList.remove('is-open'); activeTipBtn = null; }
  }
  document.addEventListener('click', function (e) {
    if (activeTipBtn && !activeTipBtn.contains(e.target)) hideTip();
  });

  // Build controls
  var paletteDependentRows    = [];
  var stopDependentRows       = [];
  var grainDependentRows      = [[], [], [], [], []];
  var oklchDependentRows      = [];
  var quadDependentRows       = [];
  var textColorDependentRows  = [];
  var outlineDependentRows    = [];
  var wordDependentRows           = [];
  var perLetterSizeDependentRows  = [];
  var colorModeBtn     = null;
  var colorModeSel     = null;
  var grainModeSel     = null;
  var useTextColorBtn  = null;
  var outlineToggleBtn        = null;
  var wordToggleBtn           = null;
  var perLetterSizeToggleBtn  = null;
  var controlEls = []; // [{ctrl, el}] for randomisation

  controls.forEach(function (ctrl) {
    if (ctrl.type === 'header') {
      var h = document.createElement('div');
      h.className   = 'shader-control__section-header';
      h.textContent = ctrl.label;
      body.appendChild(h);
      return;
    }

    var row = document.createElement('div');
    row.className = 'shader-control';

    var label = document.createElement('label');
    label.className   = 'shader-control__label';
    label.textContent = ctrl.label;
    if (ctrl.tip) {
      var tipBtn       = document.createElement('button');
      tipBtn.type      = 'button';
      tipBtn.className = 'shader-tip-btn';
      tipBtn.textContent = '?';
      tipBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        activeTipBtn === this ? hideTip() : showTip(this, ctrl.tip);
      });
      label.appendChild(tipBtn);
    }
    row.appendChild(label);

    if (ctrl.type === 'range') {
      var wrap = document.createElement('div');
      wrap.className = 'shader-control__range-wrap';

      var input = document.createElement('input');
      input.type      = 'range';
      input.className = 'shader-control__range';
      input.min   = ctrl.min;
      input.max   = ctrl.max;
      input.step  = ctrl.step;
      input.value           = ctrl.value;
      input.dataset.paramKey = ctrl.key;

      var display = document.createElement('span');
      display.className   = 'shader-control__value';
      display.textContent = ctrl.value;

      input.addEventListener('input', function () {
        var v = parseFloat(this.value);
        display.textContent = v;
        window._shaderState.values[ctrl.key] = ctrl.toRadians ? v * Math.PI / 180 : v;
        if (ctrl.textDirty) window._shaderState.textDirty = true;
      });

      wrap.appendChild(input);
      wrap.appendChild(display);
      row.appendChild(wrap);
      controlEls.push({ ctrl: ctrl, el: input });

    } else if (ctrl.type === 'toggle') {
      var isOn = ctrl.value === 1;
      var btn  = document.createElement('button');
      btn.className   = 'shader-control__toggle' + (isOn ? ' is-on' : '');
      btn.textContent = isOn ? 'On' : 'Off';
      btn.dataset.on  = isOn ? '1' : '0';

      btn.addEventListener('click', function () {
        var wasOn = this.dataset.on === '1';
        this.dataset.on  = wasOn ? '0' : '1';
        this.textContent = wasOn ? 'Off' : 'On';
        this.classList.toggle('is-on', !wasOn);
        window._shaderState.values[ctrl.key] = wasOn ? 0 : 1;
        if (ctrl.textDirty) window._shaderState.textDirty = true;
      });

      if (ctrl.key === 'u_color_mode')    colorModeBtn     = btn;
      if (ctrl.key === 'u_use_text_color') useTextColorBtn  = btn;
      if (ctrl.key === 'outlineEnabled')   outlineToggleBtn = btn;
      if (ctrl.key === 'u_text_enabled')         wordToggleBtn           = btn;
      if (ctrl.key === 'perLetterSizeEnabled')  perLetterSizeToggleBtn  = btn;

      row.appendChild(btn);
      controlEls.push({ ctrl: ctrl, el: btn });

    } else if (ctrl.type === 'color') {
      var picker = document.createElement('input');
      picker.type             = 'text';
      picker.className        = 'shader-control__color';
      picker.value            = ctrl.value;
      picker.dataset.coloris  = '';
      picker.dataset.paramKey = ctrl.key;

      picker.addEventListener('input', function () {
        if (this.value.length < 7) return;
        window._shaderState.values[ctrl.key] = lib.hexToRgb(this.value, ctrl.key);
        if (ctrl.textDirty) window._shaderState.textDirty = true;
      });

      row.appendChild(picker);
      controlEls.push({ ctrl: ctrl, el: picker });

    } else if (ctrl.type === 'text') {
      var textInput       = document.createElement('input');
      textInput.type      = 'text';
      textInput.className = 'shader-control__text-input';
      textInput.dataset.paramKey = ctrl.key;
      textInput.value     = ctrl.value;
      textInput.placeholder = 'e.g. GLOW';

      textInput.addEventListener('input', function () {
        window._shaderState.values[ctrl.key] = this.value;
        window._shaderState.textDirty = true;
      });

      row.appendChild(textInput);
      controlEls.push({ ctrl: ctrl, el: textInput });

    } else if (ctrl.type === 'select') {
      var sel = document.createElement('select');
      sel.className = 'shader-control__select';
      sel.dataset.paramKey = ctrl.key;

      ctrl.options.forEach(function (opt) {
        var option = document.createElement('option');
        option.value       = opt.value;
        option.textContent = opt.label;
        if (opt.value === ctrl.value) option.selected = true;
        sel.appendChild(option);
      });

      sel.addEventListener('change', function () {
        window._shaderState.values[ctrl.key] = this.value;
        if (ctrl.textDirty) window._shaderState.textDirty = true;
      });

      if (ctrl.key === 'u_color_mode') colorModeSel = sel;
      if (ctrl.key === 'u_grain_mode') grainModeSel = sel;

      row.appendChild(sel);
      controlEls.push({ ctrl: ctrl, el: sel });

      // Palette/4-stop presets: render as tappable swatches instead of the
      // dropdown. `sel` stays in the DOM (hidden) as the source of truth —
      // randomize/restore/share all already set its value + dispatch
      // 'change', so the swatch UI just mirrors it instead of duplicating
      // that wiring.
      if (ctrl.swatchPreview) {
        sel.className += ' shader-control__select--swatch-source';
        sel.tabIndex = -1;
        sel.setAttribute('aria-hidden', 'true');

        var presetsMap  = ctrl.swatchPreview === 'fourstop' ? lib.FOUR_STOP_PRESETS : lib.COSINE_PRESETS;
        var gradientFor = ctrl.swatchPreview === 'fourstop' ? lib.fourStopPresetGradient : lib.cosinePresetGradient;

        var swatchScroll = document.createElement('div');
        swatchScroll.className = 'shader-control__swatch-scroll';

        var swatchBtns = {};
        ctrl.options.forEach(function (opt) {
          var preset = presetsMap[opt.value];
          if (!preset) return;

          var swatchBtn = document.createElement('button');
          swatchBtn.type = 'button';
          swatchBtn.className = 'shader-control__swatch';
          swatchBtn.style.background = gradientFor(preset);
          swatchBtn.title = opt.label;
          swatchBtn.setAttribute('aria-label', opt.label);
          swatchBtn.setAttribute('aria-pressed', opt.value === sel.value ? 'true' : 'false');
          swatchBtn.classList.toggle('is-selected', opt.value === sel.value);

          swatchBtn.addEventListener('click', function () {
            if (sel.value === opt.value) return;
            sel.value = opt.value;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
          });

          swatchBtns[opt.value] = swatchBtn;
          swatchScroll.appendChild(swatchBtn);
        });

        sel.addEventListener('change', function () {
          Object.keys(swatchBtns).forEach(function (v) {
            var isSelected = v === sel.value;
            swatchBtns[v].classList.toggle('is-selected', isSelected);
            swatchBtns[v].setAttribute('aria-pressed', isSelected ? 'true' : 'false');
          });
        });

        row.appendChild(swatchScroll);
      }
    }

    if (ctrl.paletteDependent)   paletteDependentRows.push(row);
    if (ctrl.stopDependent)      stopDependentRows.push(row);
    if (ctrl.grainDependent != null) { grainDependentRows[ctrl.grainDependent].push(row); row.classList.add('shader-control--indented'); }
    if (ctrl.oklchDependent)     oklchDependentRows.push(row);
    if (ctrl.quadDependent)      quadDependentRows.push(row);
    if (ctrl.textColorDependent) textColorDependentRows.push(row);
    if (ctrl.outlineDependent)   outlineDependentRows.push(row);
    if (ctrl.wordDependent)           wordDependentRows.push(row);
    if (ctrl.perLetterSizeDependent)  perLetterSizeDependentRows.push(row);

    body.appendChild(row);
  });

  // ── Analytics: generic control-change tracking (delegated, fires once per completed interaction) ──
  body.addEventListener('change', function (e) {
    var t = e.target;
    if (t.tagName !== 'SELECT' && t.tagName !== 'INPUT') return;
    window.bfTrack('product_shader_control_change', { shader: cfg.shader, control: t.dataset.paramKey || t.id });
  });

  // Show/hide palette-dependent rows based on Use Palette toggle
  function applyPaletteVisibility() {
    var mode;
    if (colorModeSel) {
      mode = colorModeSel.value;
    } else {
      mode = (colorModeBtn && colorModeBtn.dataset.on === '1') ? '1' : '0';
    }
    paletteDependentRows.forEach(function (r) {
      r.style.display = mode === '0' ? '' : 'none';
    });
    stopDependentRows.forEach(function (r) {
      r.style.display = mode === '1' ? '' : 'none';
    });
    oklchDependentRows.forEach(function (r) {
      r.style.display = mode === '2' ? '' : 'none';
    });
    quadDependentRows.forEach(function (r) {
      r.style.display = mode === '2' ? '' : 'none';
    });
  }
  if (colorModeBtn) colorModeBtn.addEventListener('click', applyPaletteVisibility);
  if (colorModeSel) colorModeSel.addEventListener('change', applyPaletteVisibility);
  applyPaletteVisibility();

  var grainModeDefaults = [[], [], [], [], []];
  controlEls.forEach(function (item) {
    if (item.ctrl.grainDependent != null) grainModeDefaults[item.ctrl.grainDependent].push(item);
  });

  function applyGrainVisibility() {
    var mode = grainModeSel ? Math.round(parseFloat(grainModeSel.value)) : 0;
    grainDependentRows.forEach(function (rows, i) {
      rows.forEach(function (r) { r.style.display = i === mode ? '' : 'none'; });
    });
  }
  if (grainModeSel) grainModeSel.addEventListener('change', function () {
    applyGrainVisibility();
    var mode = Math.round(parseFloat(this.value));
    grainModeDefaults[mode].forEach(function (item) {
      item.el.value = item.ctrl.value;
      item.el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });
  applyGrainVisibility();

  // Show/hide text-color row based on Custom Text Color toggle
  function applyTextColorVisibility() {
    var on = useTextColorBtn && useTextColorBtn.dataset.on === '1';
    textColorDependentRows.forEach(function (r) { r.style.display = on ? '' : 'none'; });
  }
  if (useTextColorBtn) useTextColorBtn.addEventListener('click', applyTextColorVisibility);
  applyTextColorVisibility();

  // Show/hide outline rows based on Outline toggle
  function applyOutlineVisibility() {
    var on = outlineToggleBtn && outlineToggleBtn.dataset.on === '1';
    outlineDependentRows.forEach(function (r) { r.style.display = on ? '' : 'none'; });
  }
  if (outlineToggleBtn) outlineToggleBtn.addEventListener('click', applyOutlineVisibility);
  applyOutlineVisibility();

  // Show/hide word overlay rows based on Word Enabled toggle
  function applyWordVisibility() {
    var on = wordToggleBtn && wordToggleBtn.dataset.on === '1';
    wordDependentRows.forEach(function (r) { r.style.display = on ? '' : 'none'; });
  }
  if (wordToggleBtn) wordToggleBtn.addEventListener('click', applyWordVisibility);
  applyWordVisibility();
  function applyPerLetterSizeVisibility() {
    var on = perLetterSizeToggleBtn && perLetterSizeToggleBtn.dataset.on === '1';
    perLetterSizeDependentRows.forEach(function (r) { r.style.display = on ? '' : 'none'; });
  }
  if (perLetterSizeToggleBtn) perLetterSizeToggleBtn.addEventListener('click', applyPerLetterSizeVisibility);
  applyPerLetterSizeVisibility();
  if (typeof customAfterBuild === 'function') customAfterBuild();

  // Auto-restore community design values — runs on load (if #shader) or when shader tab first opens
  (function () {
    var submissionId = cfg.submissionId;
    if (!submissionId) return;

    var restored = false;

    function tryRestore() {
      if (restored) return;
      if (localStorage.getItem('brightfield_restore')) return;
      restored = true;

      var ctrlByKey = {};
      controls.forEach(function (c) { if (c.key) ctrlByKey[c.key] = c; });

      fetch('https://brightfield-mockup-worker.eric-d-johnson.workers.dev/community/design/' + encodeURIComponent(submissionId))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (!data || !data.values || !window._shaderState) {
            if (window._shaderState) window._shaderState.holdReveal = false;
            return;
          }
          var colorPairs = [];
          Object.keys(data.values).forEach(function (k) {
            if (!(k in window._shaderState.values)) return;
            var val = data.values[k];
            if (Array.isArray(val)) {
              colorPairs.push([k, val]);
              return;
            }
            window._shaderState.values[k] = val;
            var inp = document.querySelector('[data-param-key="' + k + '"]');
            if (!inp) return;
            var ctrl = ctrlByKey[k];
            if (inp.type === 'range') {
              if (ctrl && ctrl.toRadians) return; // stored in radians; skip slider UI to avoid display mismatch
              inp.value = val;
              var disp = inp.parentNode && inp.parentNode.querySelector('.shader-control__value');
              if (disp) disp.textContent = parseFloat(val).toFixed(
                (inp.step || '1').indexOf('.') !== -1 ? (inp.step || '1').split('.')[1].length : 0
              );
            } else if (inp.classList.contains('shader-control__toggle')) {
              inp.dataset.on = val === 1 ? '1' : '0';
              inp.textContent = val === 1 ? 'On' : 'Off';
            } else if (inp.tagName === 'SELECT') {
              inp.value = val;
              inp.dispatchEvent(new Event('change', { bubbles: true }));
            }
          });
          if (colorPairs.length) lib.applyColors(colorPairs);
          window._shaderState.snapValues = true;
          window._shaderState.holdReveal = false;
          window._shaderState.textDirty = true;
        })
        .catch(function () { if (window._shaderState) window._shaderState.holdReveal = false; });
    }

    var h = window.location.hash;
    if (h === '#shader' || h.indexOf('#s=') === 0 || h.indexOf('#share=') === 0) {
      tryRestore();
    }
    window.addEventListener('product-shader-mode', function () { tryRestore(); });
  }());

  // Animation settings (exposed for browser debugging)
  window._animationSettings = {
    tweenDuration: 900,
    tweenDelay: 0,
    flyTranslateDuration: 900,
    flyTranslateEasing: 'cubic-bezier(0.25, 1, 0.5, 1)',
    flyScaleDuration: 700,
    flyScaleEasing: 'ease-in',
    glowDuration: 800,
    glowDelay: 0,
    glowEasing: 'ease-out',
    glowPeakOpacity: 0.5,
    glowBlur: 40,
    glowSpread: 10
  };

  // Load product-specific recent designs filmstrip
  document.addEventListener('DOMContentLoaded', function () {
    var rdContainer = document.getElementById('product-recent-designs-container');
    var rdSection   = document.getElementById('product-recent-designs');
    if (!rdContainer || !window.RecentDesigns) return;

    var toastEl = document.createElement('div');
    toastEl.className = 'anim-settings-toast';
    toastEl.textContent = 'Design applied';
    document.body.appendChild(toastEl);
    var toastTimer;
    function showToast() {
      clearTimeout(toastTimer);
      toastEl.classList.remove('anim-settings-toast--visible');
      void toastEl.offsetWidth;
      toastEl.classList.add('anim-settings-toast--visible');
      toastTimer = setTimeout(function () {
        toastEl.classList.remove('anim-settings-toast--visible');
      }, 2000);
    }
    var currentDesigns = [];
    function onCardClick(design, cardElement) {
        var startValues = JSON.parse(JSON.stringify(window._shaderState.values));
        var endValues = design.values;
        var duration = window._animationSettings.tweenDuration;
        var startTime;

        function updateControlsUI(key, val) {
          // Update the range/color/toggle inputs in the DOM
          var input = document.querySelector('[data-param-key="' + key + '"]');
          if (!input) return;

          if (input.type === 'range') {
            input.value = val;
            var display = input.parentNode.querySelector('.shader-control__value');
            if (display) display.textContent = val.toFixed((input.step || '1').includes('.') ? (input.step || '1').split('.')[1].length : 0);
          } else if (input.tagName === 'SELECT') {
            input.value = val;
          } else if (input.classList.contains('shader-control__toggle')) {
            var isOn = val === 1;
            input.dataset.on = isOn ? '1' : '0';
            input.textContent = isOn ? 'On' : 'Off';
            input.classList.toggle('is-on', isOn);
          } else if (input.classList.contains('shader-control__color')) {
            // val is [r,g,b]
            var hex = '#' + val.map(function(c) {
              var s = Math.round(c * 255).toString(16);
              return s.length === 1 ? '0' + s : s;
            }).join('');
            input.value = hex;
          } else if (input.classList.contains('shader-control__text-input')) {
            input.value = val;
            window._shaderState.values[key] = val;
            window._shaderState.textDirty = true;
          }
        }

        function startValuesAnimation() {
          var startTime = performance.now();
          function animate(now) {
            var elapsed = now - startTime;
            var progress = Math.min(elapsed / duration, 1);
            // Ease out cubic
            var e = 1 - Math.pow(1 - progress, 3);

            Object.keys(endValues).forEach(function (k) {
              if (!(k in startValues)) return;
              var start = startValues[k];
              var end = endValues[k];

              if (Array.isArray(start) && Array.isArray(end)) {
                // Color [r,g,b]
                window._shaderState.values[k] = [
                  start[0] + (end[0] - start[0]) * e,
                  start[1] + (end[1] - start[1]) * e,
                  start[2] + (end[2] - start[2]) * e
                ];
              } else if (typeof start === 'number' && typeof end === 'number') {
                window._shaderState.values[k] = start + (end - start) * e;
              } else {
                // String or boolean-ish
                if (progress === 1) window._shaderState.values[k] = end;
              }

              // Update UI at the end or occasionally
              if (progress === 1 || Math.random() > 0.8) {
                var displayVal = window._shaderState.values[k];
                // Convert back from radians if necessary for the UI input
                var ctrl = controls.find(function(c) { return c.key === k; });
                if (ctrl && ctrl.toRadians && typeof displayVal === 'number') {
                  displayVal = displayVal * 180 / Math.PI;
                }
                updateControlsUI(k, displayVal);
              }
            });

            window._shaderState.textDirty = true;

            if (progress < 1) {
              requestAnimationFrame(animate);
            } else {
              if (typeof applyPaletteVisibility === 'function') applyPaletteVisibility();
              showToast();
            }
          }
          requestAnimationFrame(animate);
        }

        var shaderTab = document.querySelector('[data-tab="shader"]');
        if (shaderTab && !shaderTab.classList.contains('is-active')) shaderTab.click();

        // Animate clicked image into the settings panel
        var img = cardElement ? cardElement.querySelector('img') : null;
        var target = document.getElementById('shader-canvas');
        var targetContainer = document.querySelector('.media-panel[data-panel="shader"]');

        function scheduleTween() {
          if (fa.tweenDelay <= 0) { startValuesAnimation(); }
          else { setTimeout(startValuesAnimation, fa.tweenDelay); }
        }

        if (!img || !target || !targetContainer) {
          scheduleTween();
          return;
        }

        var imgRect = img.getBoundingClientRect();
        var targetRect = target.getBoundingClientRect();

        var clone = img.cloneNode(true);
        clone.style.position = 'fixed';
        clone.style.left = imgRect.left + 'px';
        clone.style.top = imgRect.top + 'px';
        clone.style.width = imgRect.width + 'px';
        clone.style.height = imgRect.height + 'px';
        clone.style.zIndex = '9999';
        var fa = window._animationSettings;
        var tSec = (fa.flyTranslateDuration / 1000) + 's';
        var sSec = (fa.flyScaleDuration     / 1000) + 's';
        clone.style.transition = [
          'left '      + tSec + ' ' + fa.flyTranslateEasing,
          'top '       + tSec + ' ' + fa.flyTranslateEasing,
          'transform ' + sSec + ' ' + fa.flyScaleEasing,
          'opacity '   + sSec + ' ' + fa.flyScaleEasing
        ].join(', ');
        clone.style.borderRadius = '4px';
        clone.style.pointerEvents = 'none';

        document.body.appendChild(clone);

        // Force reflow
        clone.getBoundingClientRect();

        var targetCenterX = targetRect.left + targetRect.width / 2;
        var targetCenterY = targetRect.top + targetRect.height / 2;

        clone.style.left = (targetCenterX - imgRect.width / 2) + 'px';
        clone.style.top = (targetCenterY - imgRect.height / 2) + 'px';
        clone.style.transform = 'scale(0.1)';
        clone.style.opacity = '0';

        // Fly cleanup + glow: fires when the longer of the two fly animations ends
        setTimeout(function() {
          if (document.body.contains(clone)) document.body.removeChild(clone);
          var gs = window._animationSettings;
          var root = document.documentElement;
          root.style.setProperty('--glow-duration',     (gs.glowDuration    / 1000) + 's');
          root.style.setProperty('--glow-delay',        (gs.glowDelay       / 1000) + 's');
          root.style.setProperty('--glow-easing',        gs.glowEasing);
          root.style.setProperty('--glow-peak-opacity',  gs.glowPeakOpacity);
          root.style.setProperty('--glow-blur',          gs.glowBlur   + 'px');
          root.style.setProperty('--glow-spread',        gs.glowSpread + 'px');
          targetContainer.classList.add('shader-gui-glow');
          setTimeout(function() {
            targetContainer.classList.remove('shader-gui-glow');
          }, gs.glowDuration + gs.glowDelay);
        }, Math.max(fa.flyTranslateDuration, fa.flyScaleDuration));

        // Tween start: fires independently at tweenDelay ms after fly begins
        scheduleTween();
    }

    function renderStrip(designs) {
      currentDesigns = designs || [];
      if (!currentDesigns.length) return;
      rdSection.style.display = '';
      RecentDesigns.renderFilmstrip(rdContainer, currentDesigns, onCardClick);
    }

    RecentDesigns.fetchDesigns(cfg.shader).then(renderStrip);

    document.addEventListener('brightfield:design-saved', function (e) {
      renderStrip([e.detail].concat(currentDesigns));
    });

    // ── Product community designs strip ──────────────────────
    var communityContainer = document.getElementById('product-community-designs-container');
    var communitySection   = document.getElementById('product-community-designs');
    if (communityContainer && window.CommunityDesigns) {
      CommunityDesigns.fetchCommunityDesigns(cfg.shader, cfg.productHandle).then(function (designs) {
        if (!designs || !designs.length) return;
        communitySection.style.display = '';
        CommunityDesigns.renderGrid(communityContainer, designs, {
          getDeviceId: RecentDesigns.getDeviceId
        });
      });
    }
  });

  // Randomize button
  function randomizeAll() {
    controlEls.forEach(function (item) {
      var ctrl = item.ctrl;
      var el   = item.el;
      if (ctrl.noRandomize) return;

      if (ctrl.type === 'range') {
        var lo  = ctrl.randomMin != null ? ctrl.randomMin : ctrl.min;
        var hi  = ctrl.randomMax != null ? ctrl.randomMax : ctrl.max;
        var raw;
        if (ctrl.gaussian) {
          var mean   = (lo + hi) / 2;
          var stddev = (hi - lo) / 6;
          var u = 1 - Math.random();
          var v = Math.random();
          raw = mean + stddev * Math.sqrt(-2 * Math.log(u)) * Math.cos(6.28318 * v);
        } else {
          var steps = Math.round((hi - lo) / ctrl.step);
          raw = lo + Math.floor(Math.random() * (steps + 1)) * ctrl.step;
        }
        var val = Math.round((raw - ctrl.min) / ctrl.step) * ctrl.step + ctrl.min;
        val = parseFloat(Math.max(ctrl.min, Math.min(ctrl.max, val)).toFixed(10));
        el.value = val;
        var display = el.parentNode.querySelector('.shader-control__value');
        if (display) display.textContent = val;
        window._shaderState.values[ctrl.key] = ctrl.toRadians ? val * Math.PI / 180 : val;

      } else if (ctrl.type === 'toggle') {
        var isOn = Math.random() < 0.5;
        el.dataset.on  = isOn ? '1' : '0';
        el.textContent = isOn ? 'On' : 'Off';
        el.classList.toggle('is-on', isOn);
        window._shaderState.values[ctrl.key] = isOn ? 1 : 0;

      } else if (ctrl.type === 'color') {
        var hex = lib.vividHex(Math.random());
        el.value = hex;
        el.dispatchEvent(new Event('input', { bubbles: true }));

      } else if (ctrl.type === 'select' && ctrl.key !== '_palette_preset') {
        var opts   = ctrl.options;
        var chosen = opts[Math.floor(Math.random() * opts.length)];
        el.value = chosen.value;
        window._shaderState.values[ctrl.key] = chosen.value;
        if (ctrl.textDirty) window._shaderState.textDirty = true;
        el.dispatchEvent(new Event('change', { bubbles: true }));

      } else if (ctrl.type === 'text' && ctrl.randomOptions) {
        var picked = ctrl.randomOptions[Math.floor(Math.random() * ctrl.randomOptions.length)];
        el.value = picked;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    applyPaletteVisibility();
    window._shaderState.textDirty = true;
  }

  var randomizeBtn       = document.createElement('button');
  randomizeBtn.type      = 'button';
  randomizeBtn.className = 'shader-control__randomize-btn';
  randomizeBtn.textContent = 'Randomize';
  randomizeBtn.addEventListener('click', randomizeAll);
  body.insertBefore(randomizeBtn, body.firstChild);

  // Encode/decode _shaderState.values to/from base64 for URL sharing.
  // Colors are stored as [r,g,b] float arrays; convert to hex for compactness.
  function encodeState(values) {
    var out = {};
    Object.keys(values).forEach(function (k) {
      var v = values[k];
      out[k] = Array.isArray(v) ? lib.toHex(v, k) : v;
    });
    return btoa(JSON.stringify(out)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodeState(b64) {
    var padded = b64.replace(/-/g, '+').replace(/_/g, '/');
    while (padded.length % 4) padded += '=';
    var obj = JSON.parse(atob(padded));
    var result = {};
    controlEls.forEach(function (item) {
      var k = item.ctrl.key;
      if (!(k in obj)) return;
      result[k] = (item.ctrl.type === 'color') ? lib.hexToRgb(obj[k], k) : obj[k];
    });
    return result;
  }

  // Apply a pre-decoded state object to all controls
  function applyRestoredState(restored) {
    controlEls.forEach(function (item) {
      var ctrl = item.ctrl, el = item.el, k = ctrl.key;
      if (!(k in restored)) return;
      var v = restored[k];

      if (ctrl.type === 'range') {
        var displayVal = ctrl.toRadians ? parseFloat((v * 180 / Math.PI).toFixed(10)) : v;
        el.value = displayVal;
        var display = el.parentNode.querySelector('.shader-control__value');
        if (display) display.textContent = displayVal;
        window._shaderState.values[k] = v;

      } else if (ctrl.type === 'toggle') {
        var isOn = v === 1;
        el.dataset.on  = isOn ? '1' : '0';
        el.textContent = isOn ? 'On' : 'Off';
        el.classList.toggle('is-on', isOn);
        window._shaderState.values[k] = v;

      } else if (ctrl.type === 'color') {
        el.value = lib.toHex(v, k);
        window._shaderState.values[k] = v;

      } else {
        el.value = v;
        window._shaderState.values[k] = v;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    window._shaderState.textDirty = true;
    applyPaletteVisibility();
    applyTextColorVisibility();
    applyOutlineVisibility();
    applyWordVisibility();
    applyPerLetterSizeVisibility();
  }

  // Restore state from URL hash — supports #share=<id> (worker) and legacy #s=<base64>
  (function () {
    var hash = window.location.hash;
    var cleanUrl = window.location.pathname + window.location.search + '#shader';

    // Legacy: inline base64
    if (hash.indexOf('#s=') === 0) {
      var encoded = new URLSearchParams(hash.slice(1)).get('s');
      if (encoded) {
        try { applyRestoredState(decodeState(encoded)); } catch (e) {}
      }
      history.replaceState(null, '', cleanUrl);
      return;
    }

    // Short ID from worker
    if (hash.indexOf('#share=') === 0) {
      var shareId = hash.slice('#share='.length);
      fetch('https://brightfield-mockup-worker.eric-d-johnson.workers.dev/get-shader-state/' + shareId)
        .then(function (r) { return r.json(); })
        .then(function (state) {
          var restored = {};
          controlEls.forEach(function (item) {
            var k = item.ctrl.key;
            if (!(k in state)) return;
            restored[k] = (item.ctrl.type === 'color') ? lib.hexToRgb(state[k], k) : state[k];
          });
          applyRestoredState(restored);
          history.replaceState(null, '', cleanUrl);
        })
        .catch(function () { history.replaceState(null, '', cleanUrl); });
    }
  }());

  // Share button — captures canvas as JPEG, uploads image + state, copies share.brightfield.studio URL
  var shareBtn = document.createElement('button');
  shareBtn.type = 'button';
  shareBtn.className = 'shader-control__share-btn';
  shareBtn.textContent = '↑ Share';
  shareBtn.addEventListener('click', function () {
    var self = this;
    var canvas = document.getElementById('shader-canvas');
    if (!canvas) return;
    var base64jpeg;
    try { base64jpeg = canvas.toDataURL('image/jpeg', 0.9).split(',')[1]; }
    catch (e) { alert('Could not capture canvas: ' + e.message); return; }
    self.textContent = 'Generating\u2026';
    self.disabled = true;

    function showConfirm() {
      self.textContent = 'Copied!';
      self.disabled = false;
      setTimeout(function () { self.textContent = '↑ Share'; }, 1800);
    }
    function onError() {
      self.textContent = 'Failed';
      self.disabled = false;
      setTimeout(function () { self.textContent = '↑ Share'; }, 1800);
    }

    var urlPromise = fetch('https://brightfield-mockup-worker.eric-d-johnson.workers.dev/create-share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image:         base64jpeg,
        shader:        cfg.shader,
        productHandle: cfg.productHandle,
        values:        window._shaderState ? window._shaderState.values : {},
      }),
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data.url) throw new Error(data.error || 'No URL');
      return data.url;
    });

    // Safari requires clipboard.write() to be called synchronously within the
    // user gesture. Passing a Promise inside ClipboardItem satisfies that while
    // still resolving the URL asynchronously.
    if (navigator.clipboard && window.ClipboardItem) {
      navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': urlPromise.then(function (url) {
            return new Blob([url], { type: 'text/plain' });
          }),
        }),
      ])
      .then(showConfirm)
      .catch(onError);
    } else {
      // Fallback for browsers without ClipboardItem
      urlPromise
        .then(function (url) {
          var ta = document.createElement('textarea');
          ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); } catch (e) {}
          document.body.removeChild(ta);
          showConfirm();
        })
        .catch(onError);
    }
  });
  var secondaryActions = document.querySelector('.shader-secondary-actions');
  if (secondaryActions) {
    secondaryActions.appendChild(shareBtn);
  } else {
    randomizeBtn.insertAdjacentElement('afterend', shareBtn);
  }

  // Desktop popout — draggable floating panel (desktop only)
  var popoutBtn   = document.getElementById('shader-gui-popout');
  var shaderGuiEl = document.getElementById('shader-gui');
  var mobileBar   = document.querySelector('.shader-gui__mobile-bar');
  var dragging = false, dragOX = 0, dragOY = 0;

  if (popoutBtn) {
    popoutBtn.addEventListener('click', function () {
      if (window.innerWidth <= 900) return;
      var isFloating = shaderGuiEl.classList.toggle('shader-gui--floating');
      this.textContent = isFloating ? 'Dock' : 'Popout';
      if (isFloating) {
        shaderGuiEl.style.top    = '70px';
        shaderGuiEl.style.right  = '8px';
        shaderGuiEl.style.left   = 'auto';
        shaderGuiEl.style.bottom = 'auto';
      } else {
        shaderGuiEl.style.cssText = '';
      }
    });
  }

  if (mobileBar) {
    mobileBar.addEventListener('touchstart', function (e) {
      if (window.innerWidth <= 900) return;
      if (!shaderGuiEl.classList.contains('shader-gui--floating')) return;
      var touch = e.touches[0];
      var rect  = shaderGuiEl.getBoundingClientRect();
      dragging = true;
      dragOX   = touch.clientX - rect.left;
      dragOY   = touch.clientY - rect.top;
      e.preventDefault();
    }, { passive: false });

    document.addEventListener('touchmove', function (e) {
      if (!dragging) return;
      var touch = e.touches[0];
      shaderGuiEl.style.left   = (touch.clientX - dragOX) + 'px';
      shaderGuiEl.style.top    = (touch.clientY - dragOY) + 'px';
      shaderGuiEl.style.right  = 'auto';
      shaderGuiEl.style.bottom = 'auto';
      e.preventDefault();
    }, { passive: false });

    document.addEventListener('touchend', function () { dragging = false; });
  }

  // Load Coloris — replaces native <input type="color"> picker (too large on iOS)
  var clrLink  = document.createElement('link');
  clrLink.rel  = 'stylesheet';
  clrLink.href = 'https://cdn.jsdelivr.net/npm/@melloware/coloris@latest/dist/coloris.min.css';
  document.head.appendChild(clrLink);

  var clrScript    = document.createElement('script');
  clrScript.src    = 'https://cdn.jsdelivr.net/npm/@melloware/coloris@latest/dist/coloris.min.js';
  clrScript.onload = function () {
    Coloris({
      el:               '[data-coloris]',
      theme:            'default',
      themeMode:        'dark',
      format:           'hex',
      closeButton:      true,
      closeButtonLabel: 'Done'
    });
  };
  document.head.appendChild(clrScript);
}(window.BFProduct));
