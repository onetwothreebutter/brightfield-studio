// Shader control panel — the GUI builder shared by test-shaders.html and
// palette-lab.html.
//
//   ShaderGUI.build(el, ShaderDefs.SHADERS['echo-text'], { values: v, onChange: fn });
//
// Reads a control array from `shader-defs.js` and renders it, including the
// show/hide dependency rules (paletteDependent, stopDependent, grainDependent,
// quadDependent, wordDependent, …). Self-contained: it injects its own
// stylesheet, so a host page only has to hand it a container.
//
// Controls are initialised from `opts.values`, not from the control defaults,
// so a host that has already decided some values — the palette lab forces the
// color mode — gets a panel that agrees with what is on screen.
(function () {
  'use strict';

  var Defs = window.ShaderDefs;

  var CSS = [
    '.shader-control__section-header{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#666;',
    'margin:14px 0 6px;padding-bottom:4px;border-bottom:1px solid #2a2a2a;}',
    '.shader-control__section-header:first-child{margin-top:0;}',
    '.shader-control{display:flex;align-items:center;gap:8px;margin-bottom:5px;min-height:26px;}',
    '.shader-control--indented{padding-left:20px;}',
    // Owned by the host (the palette drives it) — rendered so the dependency
    // rules can still read its state, but never shown. !important so it wins
    // over the inline display the visibility passes write.
    '.shader-control--owned{display:none!important;}',
    '.shader-control__label{flex:0 0 110px;color:#aaa;font-size:11px;white-space:nowrap;overflow:hidden;',
    'text-overflow:ellipsis;}',
    '.shader-control__range-wrap{display:flex;align-items:center;gap:6px;flex:1;}',
    '.shader-control__range{flex:1;accent-color:#0cf;cursor:pointer;}',
    '.shader-control__value{color:#0cf;font-size:10px;min-width:36px;text-align:right;}',
    '.shader-control__toggle{padding:3px 10px;border:1px solid #444;border-radius:3px;background:#222;',
    'color:#888;cursor:pointer;font-family:inherit;font-size:11px;}',
    '.shader-control__toggle.is-on{background:#003344;border-color:#0cf;color:#0cf;}',
    '.shader-control__color{width:40px;height:24px;border:1px solid #444;border-radius:3px;padding:1px 2px;',
    'background:#222;cursor:pointer;}',
    '.shader-control__text-input{flex:1;background:#222;border:1px solid #444;border-radius:3px;color:#eee;',
    'font-family:inherit;font-size:11px;padding:3px 6px;}',
    '.shader-control__text-input:focus{outline:1px solid #0cf;}',
    '.shader-control__select{flex:1;background:#222;border:1px solid #444;border-radius:3px;color:#eee;',
    'font-family:inherit;font-size:11px;padding:3px 4px;cursor:pointer;}',
    '.shader-control__action,.shader-control__randomize-btn{display:block;width:100%;margin-bottom:8px;',
    'padding:6px;background:#003344;border:1px solid #0cf;border-radius:3px;color:#0cf;font-family:inherit;',
    'font-size:11px;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;}',
    '.shader-control__action:hover,.shader-control__randomize-btn:hover{background:#004455;}',
    '.shader-tip-btn{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;',
    'border-radius:50%;border:1px solid #555;background:transparent;color:#666;font-size:9px;cursor:pointer;',
    'margin-left:3px;vertical-align:middle;}',
    '.shader-tip__popup{position:fixed;z-index:999;background:#222;border:1px solid #0cf;border-radius:4px;',
    'padding:6px 10px;font-size:11px;color:#ccc;max-width:240px;line-height:1.4;}'
  ].join('');

  function injectStyles() {
    if (document.getElementById('shader-gui-styles')) return;
    var s = document.createElement('style');
    s.id = 'shader-gui-styles';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // What a control's widget should show, given the values object rather than
  // the control's own default. Colors are stored linear and angles in radians,
  // so both need converting back to what the widget speaks.
  function displayValue(ctrl, values) {
    var v = values ? values[ctrl.key] : undefined;
    if (v === undefined) return ctrl.value;
    if (ctrl.type === 'color') return Array.isArray(v) ? Defs.toHex(v, ctrl.key) : v;
    if (ctrl.type === 'range' && ctrl.toRadians) return v * 180 / Math.PI;
    return v;
  }

  function build(body, shader, opts) {
    injectStyles();
    opts = opts || {};
    var stateKey = opts.stateKey || '_shaderState';
    var values = opts.values || (window[stateKey] && window[stateKey].values) || {};
    var onChange = opts.onChange || function () {};
    var owned = {};
    (opts.hiddenKeys || []).forEach(function (k) { owned[k] = true; });

    // Definitions from shader-defs.js re-run their snippet against the real
    // container, which is how a snippet that appends its own DOM (chladni's
    // pattern randomizer) gets somewhere to put it. A plain `{ controls }`
    // object still works.
    var built = typeof shader.build === 'function' ? shader.build(body) : shader;
    var controls = built.controls;

    function write(ctrl, value) {
      values[ctrl.key] = value;
      // Text textures are cached against a per-shader textKey; this flag is the
      // other half of that contract, for hosts rendering through _shaderState.
      if (ctrl.textDirty && window[stateKey]) window[stateKey].textDirty = true;
      onChange(ctrl.key, ctrl);
    }

    // Tooltip
    var tipEl = document.createElement('div');
    tipEl.className = 'shader-tip__popup';
    tipEl.style.display = 'none';
    document.body.appendChild(tipEl);
    var activeTipBtn = null;
    function showTip(btn, text) {
      var rect = btn.getBoundingClientRect();
      tipEl.textContent = text; tipEl.style.display = 'block';
      tipEl.style.top = (rect.bottom+6)+'px'; tipEl.style.left = rect.left+'px';
      if (activeTipBtn) activeTipBtn.classList.remove('is-open');
      activeTipBtn = btn; btn.classList.add('is-open');
    }
    function hideTip() {
      tipEl.style.display='none';
      if(activeTipBtn){activeTipBtn.classList.remove('is-open');activeTipBtn=null;}
    }
    document.addEventListener('click', function(e){
      if(activeTipBtn&&!activeTipBtn.contains(e.target)) hideTip();
    });

    // Dependency tracking
    var paletteDependentRows   = [];
    var stopDependentRows      = [];
    var grainDependentRows     = [[], [], [], [], []];
    var quadDependentRows      = [];
    var oklchDependentRows     = [];
    var textColorDependentRows = [];
    var outlineDependentRows   = [];
    var wordDependentRows          = [];
    var perLetterSizeDependentRows = [];
    var colorModeBtn    = null;
    var colorModeSel    = null;
    var grainModeSel    = null;
    var useTextColorBtn = null;
    var outlineToggleBtn       = null;
    var wordToggleBtn          = null;
    var perLetterSizeToggleBtn = null;
    var controlEls = [];
    // Sections, so a header whose every row is hidden — by a dependency rule or
    // because the host owns them all — doesn't sit there labelling nothing.
    var sections = [];

    controls.forEach(function(ctrl) {
      if (ctrl.type === 'header') {
        var h = document.createElement('div');
        h.className = 'shader-control__section-header';
        h.textContent = ctrl.label;
        body.appendChild(h);
        sections.push({ header: h, rows: [] });
        return;
      }

      var row = document.createElement('div');
      row.className = 'shader-control';

      var label = document.createElement('label');
      label.className = 'shader-control__label';
      label.textContent = ctrl.label;
      if (ctrl.tip) {
        var tipBtn = document.createElement('button');
        tipBtn.type = 'button'; tipBtn.className = 'shader-tip-btn'; tipBtn.textContent = '?';
        tipBtn.addEventListener('click', (function(t){ return function(e){
          e.stopPropagation(); activeTipBtn===this ? hideTip() : showTip(this,t);
        }; })(ctrl.tip));
        label.appendChild(tipBtn);
      }
      row.appendChild(label);

      var shown = displayValue(ctrl, values);

      if (ctrl.type === 'range') {
        var wrap  = document.createElement('div'); wrap.className = 'shader-control__range-wrap';
        var input = document.createElement('input');
        input.type='range'; input.className='shader-control__range';
        input.min=ctrl.min; input.max=ctrl.max; input.step=ctrl.step; input.value=shown;
        input.dataset.paramKey = ctrl.key;
        var display = document.createElement('span');
        display.className='shader-control__value'; display.textContent=shown;
        input.addEventListener('input', (function(c,d){ return function(){
          var v=parseFloat(this.value); d.textContent=v;
          write(c, c.toRadians?v*Math.PI/180:v);
        }; })(ctrl,display));
        wrap.appendChild(input); wrap.appendChild(display); row.appendChild(wrap);
        controlEls.push({ctrl:ctrl,el:input});

      } else if (ctrl.type === 'toggle') {
        var isOn = shown===1;
        var btn  = document.createElement('button');
        btn.type='button'; btn.className='shader-control__toggle'+(isOn?' is-on':'');
        btn.textContent=isOn?'On':'Off'; btn.dataset.on=isOn?'1':'0';
        btn.dataset.paramKey = ctrl.key;
        btn.addEventListener('click', (function(c){ return function(){
          var wasOn=this.dataset.on==='1';
          this.dataset.on=wasOn?'0':'1'; this.textContent=wasOn?'Off':'On';
          this.classList.toggle('is-on',!wasOn);
          write(c, wasOn?0:1);
          applyAllVisibility();   // this toggle may gate other rows
        }; })(ctrl));
        if (ctrl.key==='u_color_mode')    colorModeBtn     = btn;
        if (ctrl.key==='u_use_text_color') useTextColorBtn = btn;
        if (ctrl.key==='outlineEnabled')  outlineToggleBtn = btn;
        if (ctrl.key==='wordEnabled')           wordToggleBtn          = btn;
        if (ctrl.key==='perLetterSizeEnabled')  perLetterSizeToggleBtn = btn;
        row.appendChild(btn); controlEls.push({ctrl:ctrl,el:btn});

      } else if (ctrl.type === 'color') {
        var picker = document.createElement('input');
        picker.type='color'; picker.className='shader-control__color';
        picker.value=shown; picker.dataset.paramKey=ctrl.key;
        picker.addEventListener('input', (function(c){ return function(){
          // Keyed, so cosine coefficients (u_a–u_d) pass through raw and round
          // trip against toHex — matching sections/main-product.liquid.
          write(c, Defs.hexToRgb(this.value, c.key));
        }; })(ctrl));
        row.appendChild(picker); controlEls.push({ctrl:ctrl,el:picker});

      } else if (ctrl.type === 'text') {
        var textInput = document.createElement('input');
        textInput.type='text'; textInput.className='shader-control__text-input';
        textInput.value=shown; textInput.placeholder='e.g. GLOW';
        textInput.addEventListener('input', (function(c){ return function(){
          values[c.key]=this.value;
          if (window[stateKey]) window[stateKey].textDirty = true;
          onChange(c.key, c);
        }; })(ctrl));
        row.appendChild(textInput);

      } else if (ctrl.type === 'select') {
        var sel = document.createElement('select');
        sel.className='shader-control__select'; sel.dataset.paramKey=ctrl.key;
        ctrl.options.forEach(function(opt){
          var option=document.createElement('option');
          option.value=opt.value; option.textContent=opt.label;
          if (String(opt.value)===String(shown)) option.selected=true;
          sel.appendChild(option);
        });
        sel.addEventListener('change', (function(c){ return function(){
          write(c, this.value);
        }; })(ctrl));
        if (ctrl.key === 'u_color_mode') colorModeSel = sel;
        if (ctrl.key === 'u_grain_mode') grainModeSel = sel;
        row.appendChild(sel); controlEls.push({ctrl:ctrl,el:sel});
      }

      if (ctrl.paletteDependent)   paletteDependentRows.push(row);
      if (ctrl.stopDependent)      stopDependentRows.push(row);
      if (ctrl.grainDependent != null) { grainDependentRows[ctrl.grainDependent].push(row); row.classList.add('shader-control--indented'); }
      if (ctrl.quadDependent)      quadDependentRows.push(row);
      if (ctrl.oklchDependent)     oklchDependentRows.push(row);
      if (ctrl.textColorDependent) textColorDependentRows.push(row);
      if (ctrl.outlineDependent)   outlineDependentRows.push(row);
      if (ctrl.wordDependent)           wordDependentRows.push(row);
      if (ctrl.perLetterSizeDependent)  perLetterSizeDependentRows.push(row);
      if (owned[ctrl.key])         row.classList.add('shader-control--owned');
      if (sections.length)         sections[sections.length - 1].rows.push(row);

      body.appendChild(row);
    });

    function applyHeaderVisibility() {
      sections.forEach(function (s) {
        var any = s.rows.some(function (r) {
          return !r.classList.contains('shader-control--owned') && r.style.display !== 'none';
        });
        s.header.style.display = any ? '' : 'none';
      });
    }

    // Visibility functions
    function applyPaletteVisibility() {
      var mode;
      if (colorModeSel) {
        mode = colorModeSel.value;
      } else if (colorModeBtn) {
        mode = colorModeBtn.dataset.on === '1' ? '1' : '0';
      } else {
        // No mode control in this shader's array at all — fall back to whatever
        // the host put in the values object.
        mode = String(values.u_color_mode != null ? values.u_color_mode : '0');
      }
      paletteDependentRows.forEach(function(r){ r.style.display=mode==='0'?'':'none'; });
      stopDependentRows.forEach(function(r){ r.style.display=mode==='1'?'':'none'; });
      // OKLCH and per-quadrant are both mode 2 — no shader offers both.
      quadDependentRows.forEach(function(r){ r.style.display=mode==='2'?'':'none'; });
      oklchDependentRows.forEach(function(r){ r.style.display=mode==='2'?'':'none'; });
    }
    function applyTextColorVisibility() {
      var on = useTextColorBtn && useTextColorBtn.dataset.on==='1';
      textColorDependentRows.forEach(function(r){ r.style.display=on?'':'none'; });
    }
    function applyOutlineVisibility() {
      var on = outlineToggleBtn && outlineToggleBtn.dataset.on==='1';
      outlineDependentRows.forEach(function(r){ r.style.display=on?'':'none'; });
    }
    function applyWordVisibility() {
      var on = wordToggleBtn && wordToggleBtn.dataset.on==='1';
      wordDependentRows.forEach(function(r){ r.style.display=on?'':'none'; });
    }
    var grainModeDefaults = [[], [], [], [], []];
    controlEls.forEach(function(item) {
      if (item.ctrl.grainDependent != null) grainModeDefaults[item.ctrl.grainDependent].push(item);
    });

    function applyGrainVisibility() {
      var mode = grainModeSel ? Math.round(parseFloat(grainModeSel.value)) : 0;
      grainDependentRows.forEach(function(rows, i) {
        rows.forEach(function(r) { r.style.display = i === mode ? '' : 'none'; });
      });
    }
    function applyPerLetterSizeVisibility() {
      var on = perLetterSizeToggleBtn && perLetterSizeToggleBtn.dataset.on==='1';
      perLetterSizeDependentRows.forEach(function(r){ r.style.display=on?'':'none'; });
    }

    // Headers go last: they read the row displays the other passes just wrote.
    function applyAllVisibility() {
      applyPaletteVisibility();
      applyGrainVisibility();
      applyTextColorVisibility();
      applyOutlineVisibility();
      applyWordVisibility();
      applyPerLetterSizeVisibility();
      applyHeaderVisibility();
    }

    if (colorModeBtn) colorModeBtn.addEventListener('click', applyAllVisibility);
    if (colorModeSel) colorModeSel.addEventListener('change', applyAllVisibility);
    if (grainModeSel) grainModeSel.addEventListener('change', function() {
      applyAllVisibility();
      var mode = Math.round(parseFloat(this.value));
      grainModeDefaults[mode].forEach(function(item) {
        item.el.value = item.ctrl.value;
        item.el.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });
    applyAllVisibility();

    // customAfterBuild wires this shader's preset dropdowns, which write colors
    // straight into the values object — so a host that owns the colors opts out.
    if (opts.customAfterBuild !== false && typeof built.customAfterBuild === 'function') {
      built.customAfterBuild(body);
    }

    // Randomize button (prepend). Math.random is fine here — this is a designer
    // pressing a button, not a reproducible render.
    if (opts.randomize !== false) {
      var randBtn = document.createElement('button');
      randBtn.type='button'; randBtn.className='shader-control__randomize-btn';
      randBtn.textContent='Randomize';
      randBtn.addEventListener('click', function(){
        controlEls.forEach(function(item){
          var ctrl=item.ctrl, el=item.el;
          if (ctrl.noRandomize || owned[ctrl.key]) return;
          if (ctrl.type==='range') {
            var lo=ctrl.randomMin!=null?ctrl.randomMin:ctrl.min;
            var hi=ctrl.randomMax!=null?ctrl.randomMax:ctrl.max;
            var raw;
            if (ctrl.gaussian) {
              var mean=(lo+hi)/2, stddev=(hi-lo)/6;
              var u=1-Math.random(), v=Math.random();
              raw=mean+stddev*Math.sqrt(-2*Math.log(u))*Math.cos(6.28318*v);
            } else {
              var steps=Math.round((hi-lo)/ctrl.step);
              raw=lo+Math.floor(Math.random()*(steps+1))*ctrl.step;
            }
            var val=Math.round((raw-ctrl.min)/ctrl.step)*ctrl.step+ctrl.min;
            val=parseFloat(Math.max(ctrl.min,Math.min(ctrl.max,val)).toFixed(10));
            el.value=val;
            var disp=el.parentNode.querySelector('.shader-control__value');
            if(disp) disp.textContent=val;
            write(ctrl, ctrl.toRadians?val*Math.PI/180:val);
          } else if (ctrl.type==='toggle') {
            var isOn=Math.random()<0.5;
            el.dataset.on=isOn?'1':'0'; el.textContent=isOn?'On':'Off';
            el.classList.toggle('is-on',isOn);
            write(ctrl, isOn?1:0);
          } else if (ctrl.type==='color') {
            var hex=Defs.vividHex(Math.random());
            el.value=hex; write(ctrl, Defs.hexToRgb(hex, ctrl.key));
          } else if (ctrl.type==='select') {
            var opts2=ctrl.options, chosen=opts2[Math.floor(Math.random()*opts2.length)];
            el.value=chosen.value; write(ctrl, chosen.value);
          }
        });
        applyAllVisibility();
        if (window[stateKey]) window[stateKey].textDirty=true;
      });
      body.insertBefore(randBtn, body.firstChild);
    }

    // Font preload
    (shader.fonts||[]).forEach(function(f){ document.fonts.load('700 48px "'+f+'"'); });
  }

  window.ShaderGUI = { build: build, displayValue: displayValue };
}());
