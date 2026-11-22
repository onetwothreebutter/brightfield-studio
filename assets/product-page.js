// Product page: tabs, gallery, size guide, mockup size select, sticky
// controls, scroll shadows, height lock and the review form.
// Moved verbatim out of sections/main-product.liquid. Liquid values arrive as
// the #bf-product-config JSON, parsed here once into window.BFProduct; this
// file loads before the other product-*.js files, which read it from there.
window.BFProduct = JSON.parse(document.getElementById('bf-product-config').textContent);

(function () {
var cfg = window.BFProduct;

// ── Tab switcher ─────────────────────────────────────────────────────────────
(function () {
  var tabs          = document.querySelectorAll('[data-tab]');
  var panels        = document.querySelectorAll('.media-panel');
  var price         = document.querySelector('.product-price');
  var orderForm     = document.getElementById('product-order-form');
  var shaderGui       = document.getElementById('shader-gui');
  var shaderPreview   = document.querySelector('.shader-gui__preview');
  var customizeBtn    = document.querySelector('.product-customize-btn');
  var defaultDesc   = document.querySelector('.product-description');
  var productLayout = document.querySelector('.product-layout');

  // ── Analytics: GA4 standard ecommerce — view_item ─────────────────────────
  window.bfTrack('view_item', {
    currency: cfg.currency,
    value: cfg.variant.price,
    items: [{
      item_id: cfg.variant.id,
      item_name: cfg.productTitle,
      item_variant: cfg.variant.title,
      price: cfg.variant.price,
      quantity: 1
    }]
  });

  if (!tabs.length) return;

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      var target = this.dataset.tab;

      tabs.forEach(function (t) { t.classList.remove('is-active'); });
      panels.forEach(function (p) { p.classList.remove('is-active'); });

      this.classList.add('is-active');
      var panel = document.querySelector('[data-panel="' + target + '"]');
      if (panel) panel.classList.add('is-active');

      var isCustomize = target === 'shader';
      if (price)         price.style.display         = isCustomize ? 'none'  : '';
      if (orderForm)     orderForm.style.display     = isCustomize ? 'none'  : '';
      if (customizeBtn)  customizeBtn.style.display  = isCustomize ? 'none'  : '';
      if (shaderGui)     shaderGui.style.display     = isCustomize ? 'block' : 'none';
      if (shaderPreview) shaderPreview.style.display = isCustomize ? 'block' : 'none';
      if (defaultDesc)   defaultDesc.style.display   = isCustomize ? 'none'  : '';
      if (productLayout) productLayout.classList.toggle('shader-mode', isCustomize);

      if (isCustomize) {
        window.dispatchEvent(new Event('resize'));
        window.dispatchEvent(new CustomEvent('product-shader-mode'));
        history.replaceState(null, '', window.location.pathname + window.location.search + '#shader');
      } else {
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    });
  });
}());

// ── Auto-open Shader tab from URL hash ────────────────────────────────────────
if (window.location.hash === '#shader' || window.location.hash.indexOf('#s=') === 0 || window.location.hash.indexOf('#share=') === 0) {
  var shaderTab = document.querySelector('[data-tab="shader"]');
  if (shaderTab) shaderTab.click();
}

// ── Thumbnail switcher ────────────────────────────────────────────────────────
(function () {
  var mainImg = document.querySelector('.product-media__image');
  var thumbs  = document.querySelectorAll('.product-thumb');
  if (!mainImg || !thumbs.length) return;

  thumbs.forEach(function (thumb) {
    thumb.addEventListener('click', function () {
      mainImg.src = this.dataset.full;
      mainImg.alt = this.alt;
      thumbs.forEach(function (t) { t.classList.remove('is-active'); });
      this.classList.add('is-active');
    });
  });
}());

// ── Size guide modal ──────────────────────────────────────────────────────────
(function () {
  var trigger = document.getElementById('size-guide-trigger');
  var modal   = document.getElementById('size-guide-modal');
  var closeBtn = document.getElementById('size-guide-modal-close');
  if (!trigger || !modal || typeof modal.showModal !== 'function') return;

  function openModal(e) {
    e.preventDefault();
    document.body.style.overflow = 'hidden';
    modal.showModal();
  }

  function closeModal() {
    modal.close();
  }

  trigger.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);

  modal.addEventListener('close', function () {
    document.body.style.overflow = '';
  });

  // Click on the backdrop (outside the dialog's own box) closes it.
  modal.addEventListener('click', function (e) {
    var rect = modal.getBoundingClientRect();
    var inBox = e.clientX >= rect.left && e.clientX <= rect.right &&
                e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (!inBox) modal.close();
  });
})();

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

// ── Reviews: submission form ─────────────────────────────────────────────────
// Unlike the shader "Preview on Shirt" / community-submit flow above, this runs
// on every product page (reviews aren't shader-specific), so it's a small
// self-contained fetch call rather than reusing fetchWithTimeout/workerUrl from
// the shader-only IIFE, which never runs for non-shader products.
(function () {
  var toggle    = document.getElementById('review-form-toggle');
  var form      = document.getElementById('review-form');
  var success   = document.getElementById('review-success');
  var errorEl   = document.getElementById('review-error');
  var submitBtn = document.getElementById('review-submit');
  if (!toggle || !form || !submitBtn) return;

  var workerUrl = submitBtn.dataset.workerUrl;

  toggle.addEventListener('click', function () {
    var showing = form.style.display !== 'none';
    form.style.display = showing ? 'none' : '';
    toggle.setAttribute('aria-expanded', showing ? 'false' : 'true');
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (errorEl) errorEl.style.display = 'none';

    var ratingInput = form.querySelector('input[name="rating"]:checked');
    var rating      = ratingInput ? parseInt(ratingInput.value, 10) : null;
    var authorName  = form.querySelector('#review-name').value.trim();
    var reviewBody  = form.querySelector('#review-body').value.trim();
    var company     = form.querySelector('#review-company').value; // honeypot — left blank by real users

    if (!rating) {
      if (errorEl) {
        errorEl.textContent = 'Please choose a star rating.';
        errorEl.style.display = '';
      }
      return;
    }
    if (!authorName || !reviewBody) return; // covered by native `required`, but guard anyway

    submitBtn.disabled    = true;
    submitBtn.textContent = 'Submitting…';

    fetch(workerUrl + '/reviews/submit', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        productHandle: cfg.productHandle,
        rating:        rating,
        authorName:    authorName,
        body:          reviewBody,
        company:       company
      })
    })
      .then(function (r) {
        if (!r.ok) throw new Error('Submit failed');
        return r.json();
      })
      .then(function () {
        form.style.display   = 'none';
        toggle.style.display = 'none';
        if (success) success.style.display = '';
      })
      .catch(function () {
        submitBtn.disabled    = false;
        submitBtn.textContent = 'Submit Review';
        if (errorEl) {
          errorEl.textContent = 'Something went wrong submitting your review. Please try again.';
          errorEl.style.display = '';
        }
      });
  });
}());
}());
