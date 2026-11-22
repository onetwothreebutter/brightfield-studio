// Product page, shader products only: layout around the Customize panel
// (mobile sticky canvas, scroll shadows, height lock) and the mockup modal's
// size select.

// ── Mockup modal size select ──────────────────────────────────────────────────
(function () {
  var sel   = document.getElementById('mockup-size-select');
  var price = document.getElementById('mockup-modal-price');
  if (!sel || !price) return;
  sel.addEventListener('change', function () {
    var opt = sel.options[sel.selectedIndex];
    if (opt && opt.dataset.price) price.textContent = opt.dataset.price;
  });
})();

// ── Mobile sticky-canvas fade for Customize controls ─────────────────────────
(function () {
  var guiBody = document.getElementById('shader-gui-body');
  if (!guiBody) return;

  var FADE_ZONE = 60;

  function resetRows() {
    var rows = guiBody.children;
    for (var i = 0; i < rows.length; i++) {
      rows[i].style.opacity       = '';
      rows[i].style.pointerEvents = '';
    }
  }

  function fadeRow(el, canvasBottom) {
    // Reset hidden rows so they show correctly when revealed
    if (el.style.display === 'none') {
      el.style.opacity       = '';
      el.style.pointerEvents = '';
      return;
    }
    var rect    = el.getBoundingClientRect();
    var rowMid  = (rect.top + rect.bottom) / 2;
    var dist    = rowMid - canvasBottom;
    var opacity = dist <= 0 ? 0 : dist < FADE_ZONE ? dist / FADE_ZONE : 1;
    el.style.opacity       = opacity;
    el.style.pointerEvents = opacity < 0.15 ? 'none' : '';
  }

  function applyFade() {
    if (window.innerWidth > 900) { resetRows(); return; }
    var productLayout = document.querySelector('.product-layout');
    if (!productLayout || !productLayout.classList.contains('shader-mode')) { resetRows(); return; }
    var mediaEl = document.querySelector('.product-media');
    if (!mediaEl) return;
    var canvasBottom = mediaEl.getBoundingClientRect().bottom;
    var rows = guiBody.children;
    for (var i = 0; i < rows.length; i++) {
      fadeRow(rows[i], canvasBottom);
    }
  }

  // Re-check after scroll settles to catch iOS momentum scroll finishing
  var settleTimer;
  function onScroll() {
    applyFade();
    clearTimeout(settleTimer);
    settleTimer = setTimeout(applyFade, 150);
  }

  // iOS momentum scroll can coast for ~1.5 s after touchend without firing
  // reliable scroll events. Poll via rAF so fade clears as the page settles.
  var pollRaf = null;
  document.addEventListener('touchend', function () {
    if (pollRaf) cancelAnimationFrame(pollRaf);
    var deadline = Date.now() + 1500;
    function poll() {
      applyFade();
      if (Date.now() < deadline) pollRaf = requestAnimationFrame(poll);
    }
    pollRaf = requestAnimationFrame(poll);
  }, { passive: true });

  document.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', applyFade);
  // Wait for DOM reflow before evaluating positions after tab switch
  window.addEventListener('product-shader-mode', function () {
    requestAnimationFrame(applyFade);
  });
}());

// ── Desktop: scroll shadows on shader-gui ─────────────────────────────────────
(function () {
  var el = document.getElementById('shader-gui');
  if (!el) return;
  function update() {
    el.classList.toggle('is-scrollable-top',    el.scrollTop > 4);
    el.classList.toggle('is-scrollable-bottom', el.scrollTop + el.clientHeight < el.scrollHeight - 4);
  }
  el.addEventListener('scroll', function onFirstScroll() {
    el.classList.add('has-scrolled');
    el.removeEventListener('scroll', onFirstScroll);
  }, { passive: true });
  el.addEventListener('scroll', update, { passive: true });
  if (window.ResizeObserver) { new ResizeObserver(update).observe(el); }
  update();
}());

// ── Desktop: lock shader-gui height to canvas height ──────────────────────────
(function () {
  if (!window.ResizeObserver) return;
  if (window.innerWidth <= 900) return;
  var canvas = document.getElementById('shader-canvas');
  var gui    = document.getElementById('shader-gui');
  if (!canvas || !gui) return;
  var isSquare = canvas.classList.contains('product-shader__canvas--square');
  var ratio    = isSquare ? 1 : 4 / 3;
  var media    = document.querySelector('.product-media');
  if (!media) return;
  new ResizeObserver(function (entries) {
    var w = entries[0].contentRect.width;
    gui.style.setProperty('--gui-max-h', (w * ratio) + 'px');
  }).observe(media);
}());
