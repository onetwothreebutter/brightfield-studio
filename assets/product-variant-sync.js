// Product page: keeps the hidden variant <select> in sync with the option radios.
// Only loaded when the product has more than one variant. test/variant-select-sync.test.js
// executes this file directly.
(function () {
  var form        = document.querySelector('#product-order-form form');
  var variantSel  = form && form.querySelector('select.variant-select');
  var errorEl     = document.getElementById('variant-error');
  if (!form || !variantSel) return;

  function syncVariant() {
    var selectedOptions = [];
    form.querySelectorAll('.variant-fieldset').forEach(function (fs) {
      var checked = fs.querySelector('input[type="radio"]:checked');
      if (checked) selectedOptions.push(checked.value);
    });
    var title = selectedOptions.join(' / ');
    var options = variantSel.querySelectorAll('option');
    for (var i = 0; i < options.length; i++) {
      if (options[i].dataset.variantTitle === title) {
        variantSel.value = options[i].value;
        hideVariantError();
        return;
      }
    }
  }

  function showVariantError() {
    if (!errorEl) return;
    errorEl.style.display = '';
    errorEl.focus();
    form.querySelectorAll('.variant-fieldset').forEach(function (fs) {
      if (!fs.querySelector('input[type="radio"]:checked')) {
        fs.classList.add('variant-fieldset--invalid');
      }
    });
  }

  function hideVariantError() {
    if (!errorEl || errorEl.style.display === 'none') return;
    errorEl.style.display = 'none';
    form.querySelectorAll('.variant-fieldset').forEach(function (fs) {
      fs.classList.remove('variant-fieldset--invalid');
    });
  }

  form.querySelectorAll('input[type="radio"]').forEach(function (radio) {
    radio.addEventListener('change', syncVariant);
  });

  form.addEventListener('submit', function (e) {
    if (!variantSel.value) {
      e.preventDefault();
      showVariantError();
    }
  });
})();
