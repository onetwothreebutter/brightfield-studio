// "You may also like" — fetches this section's own markup from Shopify's
// Section Rendering API (data-url, set in sections/product-recommendations.liquid)
// and swaps the populated recommendations grid into the placeholder. A normal
// page render never has the `recommendations` object populated — only a
// request to that exact endpoint does — so this fetch is required, not
// optional. Any failure (network error, no recommendations returned) just
// leaves the section hidden; nothing broken is ever shown.
(function () {
  function swapIn(container) {
    var url = container.getAttribute('data-url');
    if (!url) return;

    fetch(url)
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (html) {
        if (!html) return;

        var doc = new DOMParser().parseFromString(html, 'text/html');
        var fetchedGrid = doc.querySelector('.product-recommendations__grid');
        var localGrid   = container.querySelector('.product-recommendations__grid');
        if (!fetchedGrid || !localGrid || !fetchedGrid.children.length) return;

        localGrid.innerHTML = fetchedGrid.innerHTML;
        container.style.display = '';
      })
      .catch(function () {});
  }

  function init() {
    var containers = document.querySelectorAll('.product-recommendations[data-url]');
    Array.prototype.forEach.call(containers, swapIn);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
