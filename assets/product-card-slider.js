// Click/swipe image slider for product cards rendered with `enable_slider: true`
// (see snippets/product-card.liquid). Each `[data-product-slider]` wrapper contains
// stacked <img> slides, prev/next arrow buttons, and dot indicators; this wires them
// up plus touch-swipe gestures on the image itself.
(function () {
  var SWIPE_THRESHOLD = 40;

  function initSlider(wrap) {
    var slides = Array.prototype.slice.call(wrap.querySelectorAll('.product-card__slide'));
    var dots = Array.prototype.slice.call(wrap.querySelectorAll('[data-slider-dot]'));
    var prevBtn = wrap.querySelector('[data-slider-prev]');
    var nextBtn = wrap.querySelector('[data-slider-next]');
    var mediaLink = wrap.querySelector('.product-card__media-link');
    if (slides.length < 2 || !mediaLink) return;

    var current = 0;

    function goTo(index) {
      current = (index + slides.length) % slides.length;
      slides.forEach(function (slide, i) {
        slide.classList.toggle('is-active', i === current);
      });
      dots.forEach(function (dot, i) {
        dot.classList.toggle('is-active', i === current);
      });
    }

    function stop(e) {
      e.preventDefault();
      e.stopPropagation();
    }

    if (prevBtn) {
      prevBtn.addEventListener('click', function (e) {
        stop(e);
        goTo(current - 1);
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', function (e) {
        stop(e);
        goTo(current + 1);
      });
    }
    dots.forEach(function (dot) {
      dot.addEventListener('click', function (e) {
        stop(e);
        goTo(parseInt(dot.getAttribute('data-slide-index'), 10));
      });
    });

    // Swipe support. deltaX also doubles as a "was this a drag?" flag so the
    // trailing click on the <a> (which fires after touchend) doesn't navigate.
    var startX = 0;
    var startY = 0;
    var deltaX = 0;

    mediaLink.addEventListener('touchstart', function (e) {
      var t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      deltaX = 0;
    }, { passive: true });

    mediaLink.addEventListener('touchmove', function (e) {
      var t = e.touches[0];
      deltaX = t.clientX - startX;
      var deltaY = t.clientY - startY;
      if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
        e.preventDefault();
      }
    }, { passive: false });

    mediaLink.addEventListener('touchend', function () {
      if (Math.abs(deltaX) > SWIPE_THRESHOLD) {
        goTo(current + (deltaX < 0 ? 1 : -1));
      }
    });

    mediaLink.addEventListener('click', function (e) {
      if (Math.abs(deltaX) > 10) {
        stop(e);
      }
      deltaX = 0;
    });
  }

  function init() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-product-slider]'), initSlider);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
