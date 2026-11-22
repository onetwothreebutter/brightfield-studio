// Product page: the in-house design assistant, an internal tool that only
// opens after ?new-inhouse-design has been visited in this browser.

// ── In-house design assistant ─────────────────────────────────────────────────
// Internal tool for building in-house design product listings. Its markup is
// only ever created here in JS (never server-rendered) and only past the gate
// below, so the deploy instructions it contains don't ship in the page's HTML
// for ordinary shoppers, crawlers, or text-extraction tools to find.
(function (cfg) {
  var LS_KEY = 'inhouse-design-assistant-enabled';
  if (new URLSearchParams(location.search).has('new-inhouse-design')) {
    localStorage.setItem(LS_KEY, '1');
  }
  if (!localStorage.getItem(LS_KEY)) return;

  var reopenBtn = document.createElement('button');
  reopenBtn.id = 'inhouse-reopen-btn';
  reopenBtn.className = 'inhouse-assistant__reopen inhouse-assistant__reopen--hidden';
  reopenBtn.setAttribute('aria-label', 'Reopen design assistant');
  reopenBtn.textContent = 'Design Assistant';

  var modal = document.createElement('div');
  modal.id = 'inhouse-assistant';
  modal.className = 'inhouse-assistant inhouse-assistant--hidden';
  modal.innerHTML =
    '<div class="inhouse-assistant__box">' +
      '<div class="inhouse-assistant__header">' +
        '<span class="inhouse-assistant__title">In-House Design</span>' +
        '<button class="inhouse-assistant__close" id="inhouse-assistant-close" aria-label="Close">&times;</button>' +
      '</div>' +
      '<div class="inhouse-assistant__body">' +
        '<ol class="inhouse-assistant__steps">' +
          '<li>Tune the shader using the controls panel</li>' +
          '<li>Click <strong>Copy</strong> below and paste into<br><code>snippets/shader-controls-' + cfg.shader + '.liquid</code></li>' +
          '<li>Replace each control\'s <code>value:</code> field with the copied values</li>' +
          '<li>Run <code>npm run push</code> to deploy</li>' +
          '<li>Verify on the live page (no <code>?new-inhouse-design</code>)</li>' +
        '</ol>' +
        '<div class="inhouse-assistant__values-header">' +
          '<span class="inhouse-assistant__values-label">Current values</span>' +
          '<button id="inhouse-copy-btn" class="btn btn--outline btn--sm">Copy</button>' +
        '</div>' +
        '<pre id="inhouse-values" class="inhouse-assistant__values"></pre>' +
        '<div class="inhouse-assistant__footer">' +
          '<button id="inhouse-turnoff-btn" class="btn btn--outline btn--sm inhouse-assistant__turnoff">Turn off Design Assistant</button>' +
        '</div>' +
      '</div>' +
    '</div>';

  document.body.appendChild(modal);
  document.body.appendChild(reopenBtn);

  var closeBtn   = document.getElementById('inhouse-assistant-close');
  var valuesEl   = document.getElementById('inhouse-values');
  var copyBtn    = document.getElementById('inhouse-copy-btn');
  var turnoffBtn = document.getElementById('inhouse-turnoff-btn');

  // window._shaderState.values stores literal colors in linear space (see
  // srgbToLinear/PALETTE_COEFF_KEYS in shader-color-utils.liquid) — toHex
  // converts back to sRGB so the copied hex matches what belongs in a
  // control's `value:` field.
  function getFormattedValues() {
    if (!window._shaderState) return '// shader not loaded yet';
    var vals = window._shaderState.values;
    return Object.keys(vals).map(function (k) {
      var v = vals[k];
      var display = Array.isArray(v) ? ("'" + toHex(v, k) + "'")
                  : typeof v === 'string' ? ("'" + v + "'")
                  : v;
      return k + ': ' + display;
    }).join('\n');
  }

  function refresh() {
    if (valuesEl) valuesEl.textContent = getFormattedValues();
  }

  function open() {
    refresh();
    modal.classList.remove('inhouse-assistant--hidden');
    reopenBtn.classList.add('inhouse-assistant__reopen--hidden');
  }

  function close() {
    modal.classList.add('inhouse-assistant--hidden');
    reopenBtn.classList.remove('inhouse-assistant__reopen--hidden');
  }

  function turnOff() {
    localStorage.removeItem(LS_KEY);
    modal.classList.add('inhouse-assistant--hidden');
    reopenBtn.classList.add('inhouse-assistant__reopen--hidden');
  }

  closeBtn.addEventListener('click', close);
  reopenBtn.addEventListener('click', open);
  if (turnoffBtn) turnoffBtn.addEventListener('click', turnOff);

  copyBtn.addEventListener('click', function () {
    if (!valuesEl) return;
    navigator.clipboard.writeText(valuesEl.textContent).then(function () {
      copyBtn.textContent = 'Copied!';
      setTimeout(function () { copyBtn.textContent = 'Copy'; }, 2000);
    });
  });

  setInterval(function () {
    if (!modal.classList.contains('inhouse-assistant--hidden')) refresh();
  }, 1000);

  open();
}(window.BFProduct));
