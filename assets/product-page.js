// Product page behaviour shared by every product: tabs (and the view_item
// event), thumbnails, the size guide and the review form. Reads the section's
// Liquid values from window.BFProduct.
(function (cfg) {

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
}(window.BFProduct));
