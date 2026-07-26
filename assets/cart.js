(function () {
  'use strict';

  // Progressive enhancement over sections/main-cart.liquid's classic
  // <form action="/cart" method="post"> + updates[] inputs. With JS active,
  // quantity +/-, direct qty edits, and remove all go through /cart/change.js
  // with optimistic UI; the cart note autosaves via /cart/update.js. Without
  // JS the form still works: updates[] + note submit on "Update Cart".

  var config = window._cartConfig || {};
  var MONEY_FORMAT = config.moneyFormat || '${{amount}}';
  var DEBOUNCE_MS = 300;

  var cartForm   = document.querySelector('[data-cart-form]');
  var itemsRoot  = document.querySelector('[data-cart-items]');
  var emptyState = document.querySelector('[data-cart-empty-js]');
  var statusEl   = document.querySelector('[data-cart-status]');
  var errorEl    = document.querySelector('[data-cart-error]');
  var subtotalEl = document.querySelector('[data-cart-subtotal]');
  var noteField  = document.querySelector('[data-cart-note]');
  var noteStatus = document.querySelector('[data-cart-note-status]');

  if (!cartForm || !itemsRoot) return; // cart is empty, or section markup absent

  var lines = {}; // key -> line state

  // ── Money formatting ──────────────────────────────────────────────────────
  // Mirrors the `money` filter using the shop's actual money_format setting
  // (same approach as homepage-shader-demo.liquid) instead of assuming "$X.XX".
  function formatMoney(cents, format) {
    var amount = (cents / 100).toFixed(2);
    var withComma = amount.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    var placeholder = /\{\{\s*(amount|amount_no_decimals|amount_with_comma_separator)\s*\}\}/;
    var match = format && format.match(placeholder);
    if (!match) return '$' + amount;
    var value = match[1] === 'amount_no_decimals' ? Math.round(cents / 100)
      : match[1] === 'amount_with_comma_separator' ? withComma
      : amount;
    return format.replace(placeholder, value);
  }

  function announce(message) {
    if (statusEl) statusEl.textContent = message;
  }

  function showError(message) {
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  function clearError() {
    if (!errorEl) return;
    errorEl.hidden = true;
    errorEl.textContent = '';
  }

  function postJSON(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) {
          var err = new Error((data && (data.description || data.message)) || 'Request failed');
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  // ── Cart-level totals ──────────────────────────────────────────────────────

  function updateSubtotal(cart) {
    if (subtotalEl && typeof cart.total_price === 'number') {
      subtotalEl.textContent = formatMoney(cart.total_price, MONEY_FORMAT);
    }
  }

  // Header cart badge lives in a separately-rendered section, but it's already
  // in the DOM on this page load — keep it in sync defensively (no-op if absent).
  function updateCartBadge(cart) {
    var countEl = document.querySelector('.cart-count');
    var iconEl  = document.querySelector('.cart-icon');
    if (countEl) {
      if (cart.item_count > 0) {
        countEl.textContent = cart.item_count;
        countEl.hidden = false;
      } else {
        countEl.hidden = true;
      }
    }
    if (iconEl) {
      iconEl.setAttribute('aria-label', 'Cart (' + cart.item_count + ' items)');
    }
  }

  function showEmptyState() {
    cartForm.hidden = true;
    if (emptyState) {
      emptyState.hidden = false;
      var link = emptyState.querySelector('a');
      if (link) link.focus();
    }
  }

  // ── Per-line state ───────────────────────────────────────────────────────

  function buildLineState(container) {
    var key = container.getAttribute('data-key');
    var input = container.querySelector('[data-qty-input]');
    var priceEl = container.querySelector('[data-item-price]');
    if (!key || !input) return null;

    return {
      key: key,
      container: container,
      input: input,
      priceEl: priceEl,
      title: container.getAttribute('data-item-title') || '',
      committedQty: parseInt(input.value, 10) || 0,
      committedPrice: priceEl ? (parseInt(priceEl.getAttribute('data-line-price'), 10) || 0) : 0,
      desired: null,
      inFlight: false,
      timer: null
    };
  }

  function setOptimistic(state, newQty) {
    state.input.value = newQty;
    if (state.priceEl && state.committedQty > 0) {
      var perUnit = state.committedPrice / state.committedQty;
      state.priceEl.textContent = formatMoney(Math.round(perUnit * newQty), MONEY_FORMAT);
    }
  }

  function rollback(state) {
    state.input.value = state.committedQty;
    if (state.priceEl) {
      state.priceEl.textContent = formatMoney(state.committedPrice, MONEY_FORMAT);
      state.priceEl.setAttribute('data-line-price', state.committedPrice);
    }
  }

  function setBusy(state, busy) {
    state.container.classList.toggle('cart-item--busy', !!busy);
    state.container.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  function focusAfterRemoval(container) {
    var next = container.nextElementSibling || container.previousElementSibling;
    if (next) {
      var target = next.querySelector('[data-qty-decrease], [data-remove-item]');
      if (target) { target.focus(); return; }
    }
    var heading = document.querySelector('.cart-page__title');
    if (heading) {
      if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
      heading.focus();
    }
  }

  function removeLine(state, cart) {
    var container = state.container;
    delete lines[state.key];
    focusAfterRemoval(container);
    if (container.parentNode) container.parentNode.removeChild(container);
    announce(state.title + ' removed from cart.');
    if (cart.item_count === 0) showEmptyState();
  }

  function reconcile(state, cart, requestedQty) {
    var updated = null;
    for (var i = 0; i < cart.items.length; i++) {
      if (cart.items[i].key === state.key) { updated = cart.items[i]; break; }
    }

    if (!updated || requestedQty === 0) {
      removeLine(state, cart);
    } else {
      state.committedQty = updated.quantity;
      state.committedPrice = updated.final_line_price;
      state.input.value = updated.quantity;
      if (state.priceEl) {
        state.priceEl.textContent = formatMoney(updated.final_line_price, MONEY_FORMAT);
        state.priceEl.setAttribute('data-line-price', updated.final_line_price);
      }
      announce(state.title + ' quantity updated to ' + updated.quantity + '.');
    }

    updateSubtotal(cart);
    updateCartBadge(cart);
  }

  function runNext(state) {
    var qty = state.desired;
    if (qty == null) return;
    state.desired = null;
    state.inFlight = true;
    setBusy(state, true);
    clearError();

    postJSON('/cart/change.js', { id: state.key, quantity: qty })
      .then(function (cart) {
        reconcile(state, cart, qty);
      })
      .catch(function () {
        rollback(state);
        showError('Couldn’t update your cart. Please try again.');
      })
      .then(function () {
        state.inFlight = false;
        // Guard: the line may have been removed while the request was in flight.
        if (lines[state.key]) {
          setBusy(state, false);
          if (state.desired != null) runNext(state);
        }
      });
  }

  function scheduleChange(state, qty, immediate) {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    state.desired = qty;
    if (immediate) {
      if (!state.inFlight) runNext(state);
      return;
    }
    state.timer = setTimeout(function () {
      state.timer = null;
      if (!state.inFlight) runNext(state);
    }, DEBOUNCE_MS);
  }

  function wireLine(container, state) {
    var decBtn = container.querySelector('[data-qty-decrease]');
    var incBtn = container.querySelector('[data-qty-increase]');
    var removeBtn = container.querySelector('[data-remove-item]');

    if (decBtn) {
      decBtn.addEventListener('click', function () {
        var current = parseInt(state.input.value, 10);
        if (isNaN(current)) current = state.committedQty;
        var next = Math.max(0, current - 1);
        setOptimistic(state, next);
        scheduleChange(state, next, false);
      });
    }

    if (incBtn) {
      incBtn.addEventListener('click', function () {
        var current = parseInt(state.input.value, 10);
        if (isNaN(current)) current = state.committedQty;
        var next = current + 1;
        setOptimistic(state, next);
        scheduleChange(state, next, false);
      });
    }

    state.input.addEventListener('change', function () {
      var next = parseInt(state.input.value, 10);
      if (isNaN(next) || next < 0) next = state.committedQty;
      setOptimistic(state, next);
      scheduleChange(state, next, true);
    });

    if (removeBtn) {
      removeBtn.addEventListener('click', function (e) {
        e.preventDefault(); // otherwise the <a href="{{ item.url_to_remove }}"> no-JS fallback navigates
        setOptimistic(state, 0);
        scheduleChange(state, 0, true);
      });
    }
  }

  function initLines() {
    var containers = Array.prototype.slice.call(itemsRoot.querySelectorAll('[data-cart-item]'));
    containers.forEach(function (container) {
      var state = buildLineState(container);
      if (!state) return;
      lines[state.key] = state;
      wireLine(container, state);
    });
  }

  // ── Cart note ────────────────────────────────────────────────────────────

  function wireNote() {
    if (!noteField) return;
    var noteTimer = null;
    var lastSaved = noteField.value;

    function save() {
      var value = noteField.value;
      if (value === lastSaved) return;
      postJSON('/cart/update.js', { note: value })
        .then(function () {
          lastSaved = value;
          if (noteStatus) {
            noteStatus.textContent = 'Note saved.';
            setTimeout(function () {
              if (noteStatus.textContent === 'Note saved.') noteStatus.textContent = '';
            }, 3000);
          }
        })
        .catch(function () {
          if (noteStatus) {
            noteStatus.textContent = 'Couldn’t save note — it will still be sent when you update the cart.';
          }
        });
    }

    noteField.addEventListener('blur', save);
    noteField.addEventListener('input', function () {
      if (noteTimer) clearTimeout(noteTimer);
      noteTimer = setTimeout(save, 800);
    });
  }

  initLines();
  wireNote();
}());
