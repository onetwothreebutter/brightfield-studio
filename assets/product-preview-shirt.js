// Product page, shader products only: Preview on Shirt and the custom-design
// add to cart. Liquid values come from window.BFProduct.

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

// ── Preview on Shirt ──────────────────────────────────────────────────────────
(function (cfg) {
  var btn           = document.getElementById('shader-preview-btn');
  var modal         = document.getElementById('mockup-modal');
  var modalImg      = document.getElementById('mockup-modal-img');
  var modalOrder    = document.getElementById('mockup-modal-order');
  var orderStatus   = document.getElementById('mockup-order-status');
  var modalSuccess  = document.getElementById('mockup-modal-success');
  var modalContinue = document.getElementById('mockup-modal-continue');
  var closeBtn      = document.getElementById('mockup-modal-close');
  var backdrop      = modal.querySelector('.mockup-modal__backdrop');
  if (!btn) return;

  var workerUrl    = btn.dataset.workerUrl;
  var printArea    = (btn.dataset.printArea || '0.20,0.15,0.60,0.68').split(',').map(Number);
  var _pendingDesign = null;

  // orderStatus doubles as both the polite progress announcer ("Uploading your
  // design…", "Finalizing your order…") and, on failure, an assertive inline
  // error message — replacing a blocking alert() that screen readers can't
  // associate with the flow. Routine progress updates just set .textContent
  // (see below); setOrderError() flips the element to role="alert" so
  // assistive tech announces it immediately, and setOrderStatus() flips it
  // back to the polite default for the next attempt.
  function setOrderStatus(msg) {
    if (!orderStatus) return;
    orderStatus.setAttribute('role', 'status');
    orderStatus.setAttribute('aria-live', 'polite');
    orderStatus.classList.remove('mockup-modal__order-status--error');
    orderStatus.textContent = msg;
  }
  function setOrderError(msg) {
    if (!orderStatus) return;
    orderStatus.setAttribute('role', 'alert');
    orderStatus.setAttribute('aria-live', 'assertive');
    orderStatus.classList.add('mockup-modal__order-status--error');
    orderStatus.textContent = msg;
  }

  // Wraps fetch with a hard timeout via AbortController. Without this, a stalled
  // worker call or Shopify Admin API request left the customer on "Adding…" forever
  // with a disabled button and no way to recover except abandoning the page — the
  // timeout instead rejects so callers' existing .catch handlers (which already
  // reset the UI) fire.
  function fetchWithTimeout(url, options, timeoutMs) {
    var controller = new AbortController();
    var timedOut   = false;
    var timer = setTimeout(function () { timedOut = true; controller.abort(); }, timeoutMs);
    var opts = Object.assign({}, options, { signal: controller.signal });
    return fetch(url, opts).then(function (r) {
      clearTimeout(timer);
      return r;
    }, function (err) {
      clearTimeout(timer);
      if (timedOut) {
        var timeoutErr = new Error('Request timed out');
        timeoutErr.isTimeout = true;
        throw timeoutErr;
      }
      throw err;
    });
  }

  // Preload shirt template so compositing is instant on click
  var shirtImg = new Image();
  shirtImg.crossOrigin = 'anonymous';
  shirtImg.src = btn.dataset.shirtTemplate || '';

  btn.addEventListener('click', function () {
    if (!window._shaderExport) {
      alert('Switch to the Shader tab first.');
      return;
    }

    window.bfTrack('product_preview_on_shirt', { shader: cfg.shader });
    modalImg.src    = '';   // clear stale image before compositing starts
    btn.disabled    = true;
    btn.textContent = 'Compositing…';

    window._shaderExport(1800, 2400, function (base64png) {
      var canvas = document.createElement('canvas');
      var ctx    = canvas.getContext('2d');

      var designImg = new Image();
      designImg.onerror = function () {
        btn.disabled    = false;
        btn.textContent = 'Preview on Shirt';
      };
      designImg.onload = function () {
        var srcW = designImg.naturalWidth;
        var srcH = designImg.naturalHeight;
        var designAspect = srcW / srcH;
        var areaAspect   = printArea[2] / printArea[3];
        function doComposite() {
          var shirtNW = shirtImg.naturalWidth  || 669;
          var shirtNH = shirtImg.naturalHeight || 669;

          // Size the canvas so the design renders at its native resolution,
          // then scale the shirt template up to fill.
          var tW, tH;
          if (designAspect > areaAspect) {
            tW = Math.round(srcW / printArea[2]);
            tH = Math.round(tW * shirtNH / shirtNW);
          } else {
            tH = Math.round(srcH / printArea[3]);
            tW = Math.round(tH * shirtNW / shirtNH);
          }

          canvas.width  = tW;
          canvas.height = tH;

          if (shirtImg.complete && shirtImg.naturalWidth) {
            ctx.drawImage(shirtImg, 0, 0, tW, tH);
          }

          var px = Math.round(printArea[0] * tW);
          var py = Math.round(printArea[1] * tH);
          var pw = Math.round(printArea[2] * tW);
          var ph = Math.round(printArea[3] * tH);

          // Contain the design within the print area preserving the export aspect ratio
          // (1800×2400 = 0.75); without this, drawImage would stretch to fill pw×ph.
          var drawW, drawH, drawX, drawY;
          if (designAspect > areaAspect) {
            // design wider relative to area → constrain by width
            drawW = pw;
            drawH = pw / designAspect;
            drawX = px;
            drawY = py + Math.round((ph - drawH) / 2);
          } else {
            // design taller relative to area → constrain by height
            drawH = ph;
            drawW = ph * designAspect;
            drawX = px + Math.round((pw - drawW) / 2);
            drawY = py;
          }
          ctx.drawImage(designImg, drawX, drawY, drawW, drawH);

          var compositeDataUrl = canvas.toDataURL('image/png');
          var snapshotValues = JSON.parse(JSON.stringify(window._shaderState ? window._shaderState.values : {}));

          // Create checkout image at display resolution (600×600) — full print res is
          // wasteful for a checkout thumbnail and allocates ~17 MB of bitmap memory.
          var checkoutCanvas = document.createElement('canvas');
          checkoutCanvas.width  = 600;
          checkoutCanvas.height = 600;
          var checkoutCtx = checkoutCanvas.getContext('2d');
          checkoutCtx.fillStyle = '#000';
          checkoutCtx.fillRect(0, 0, 600, 600);
          var coAspect = designImg.naturalWidth / designImg.naturalHeight;
          var coW, coH, coX, coY;
          if (coAspect > 1) {
            coW = 600; coH = Math.round(600 / coAspect); coX = 0; coY = Math.round((600 - coH) / 2);
          } else {
            coH = 600; coW = Math.round(600 * coAspect); coX = Math.round((600 - coW) / 2); coY = 0;
          }
          checkoutCtx.drawImage(designImg, coX, coY, coW, coH);
          var base64CheckoutPng = checkoutCanvas.toDataURL('image/png').split(',')[1];

          // Show modal immediately — no waiting for API
          modalImg.src = compositeDataUrl;
          modal.classList.remove('mockup-modal--hidden');
          document.body.style.overflow = 'hidden';

          var communityForm    = document.getElementById('community-form');
          var communitySuccess = document.getElementById('community-success');
          var communityError   = document.getElementById('community-error');
          var communitySubmit  = document.getElementById('community-submit');
          if (communityForm)    communityForm.style.display = 'none';
          if (communitySuccess) communitySuccess.style.display = 'none';
          if (communityError)   communityError.style.display = 'none';
          if (communitySubmit)  { communitySubmit.disabled = false; communitySubmit.textContent = 'Submit'; }

          // Reset the post-add-to-cart success/gallery panel back to the primary
          // Add to Cart state in case this modal was already completed once before
          // (e.g. shopper goes back and re-customizes without leaving the page).
          modalOrder.style.display = '';
          modalOrder.disabled      = false;
          modalOrder.textContent   = 'Add to Cart';
          if (modalSuccess) modalSuccess.style.display = 'none';

          // Immediately add to Recent Designs strip — id filled in after upload
          var pendingDetail = {
            mockupUrl:     compositeDataUrl,
            shader:        cfg.shader,
            productHandle: cfg.productHandle,
            values:        snapshotValues,
            timestamp:     Math.floor(Date.now() / 1000),
            id:            null
          };
          document.dispatchEvent(new CustomEvent('brightfield:design-saved', { detail: pendingDetail }));

          // Upload design + composite to R2 in the background. Wrapped in a function
          // (rather than a bare promise) so a failed attempt can be retried from the
          // Add to Cart click — see _pendingDesign.getUploadPromise() below.
          var SAVE_PREVIEW_TIMEOUT_MS = 20000;
          function startUpload() {
            return fetchWithTimeout(workerUrl + '/save-preview', {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify({
                designImage:   base64png,
                checkoutImage: base64CheckoutPng,
                mockupImage:   compositeDataUrl.split(',')[1],
                deviceId:      window.RecentDesigns ? window.RecentDesigns.getDeviceId() : null,
                shader:        cfg.shader,
                productHandle: cfg.productHandle,
                values:        snapshotValues
              })
            }, SAVE_PREVIEW_TIMEOUT_MS)
            .then(function (r) { return r.json(); })
            .then(function (data) {
              if (!data.design_url) throw new Error(data.error || 'Upload failed');
              // First-claim device token (#544) — persist it so later
              // /delete-design and /community/like calls can prove ownership
              // of this deviceId. See RecentDesigns.setDeviceToken.
              if (data.deviceToken && window.RecentDesigns) window.RecentDesigns.setDeviceToken(data.deviceToken);
              // Upgrade the strip card: swap data URL → stable R2 URL, enable delete
              pendingDetail.id = data.id || null;
              pendingDetail.mockupUrl = data.mockup_url;
              var stripContainer = document.getElementById('product-recent-designs-container');
              if (stripContainer) {
                var firstImg = stripContainer.querySelector('.recent-designs__card-img');
                if (firstImg && firstImg.src.startsWith('data:')) firstImg.src = data.mockup_url;
              }
              return data;
            });
          }

          // Built as a local object, then assigned to _pendingDesign, so the retry
          // closure below captures this specific design via `thisDesign` instead of
          // the mutable _pendingDesign global. Without that indirection, a retry from
          // an old design's failed upload could resolve after the customer starts a
          // second "Preview on Shirt" and overwrite the NEW _pendingDesign's upload
          // promise with the OLD design's data.
          var thisDesign = {
            shader:        cfg.shader,
            productHandle: cfg.productHandle,
            values:        snapshotValues,
            // Sent to /create-product on every attempt for this design (including a
            // manual retry after a timeout) so the worker can recognize a repeat
            // request and return the product it already created instead of creating
            // a duplicate — see the idempotency guard in handleCreateProduct.
            createProductKey: (window.crypto && window.crypto.randomUUID)
              ? window.crypto.randomUUID()
              : ('key-' + Date.now() + '-' + Math.random().toString(36).slice(2)),
            uploadPromise: startUpload(),
            // Returns the in-flight/most recent upload attempt, retrying if the
            // last one failed (e.g. timed out) instead of re-surfacing the same
            // rejection on every subsequent Add to Cart / community-submit click.
            getUploadPromise: function () {
              return thisDesign.uploadPromise.catch(function () {
                thisDesign.uploadPromise = startUpload();
                return thisDesign.uploadPromise;
              });
            }
          };
          _pendingDesign = thisDesign;

          btn.disabled    = false;
          btn.textContent = 'Preview on Shirt';
        }

        // Wait for the shirt template if it hasn't loaded yet (race condition on first click).
        // On retry the image is cached and complete immediately.
        if (shirtImg.complete && shirtImg.naturalWidth) {
          doComposite();
        } else {
          shirtImg.onload  = doComposite;
          shirtImg.onerror = doComposite; // degrade gracefully: compose without shirt
        }
      };
      designImg.src = 'data:image/png;base64,' + base64png;
    });
  });

  modalOrder.addEventListener('click', function () {
    setOrderStatus(''); // clear any error/status left over from a previous attempt
    if (!_pendingDesign) {
      setOrderError('Generate a preview first.');
      return;
    }
    // Captured once at click time, then read exclusively from here on — not from
    // _pendingDesign — for the rest of this handler. The create-product call below
    // can take up to 45s, and the "Preview on Shirt" button re-enables as soon as
    // compositing finishes, well before that; without this local, a second preview
    // click during that window reassigns the global mid-flight and this handler's
    // .then() would read the NEW design's shader/values/createProductKey paired
    // with the OLD design's already-uploaded image.
    var orderDesign = _pendingDesign;

    // Read size from modal picker (multi-variant) or hidden form input (single-variant).
    var sizeSelect = document.getElementById('mockup-size-select');
    var variantEl  = document.querySelector('select[name="id"]') || document.querySelector('input[name="id"]');
    var shopifyVariantId = sizeSelect ? sizeSelect.value : (variantEl ? variantEl.value : null);
    if (!shopifyVariantId) {
      setOrderError('Please choose a size');
      return;
    }

    modalOrder.disabled = true;
    modalOrder.textContent = 'Adding… ';
    var sp = document.createElement('span');
    sp.className = 'btn-spinner';
    sp.setAttribute('aria-hidden', 'true');
    modalOrder.appendChild(sp);
    if (orderStatus) orderStatus.textContent = 'Uploading your design…';

    console.log('[add-to-cart] starting — shopifyVariantId:', shopifyVariantId);
    window.bfTrack('add_to_cart_start', { shader: cfg.shader });

    orderDesign.getUploadPromise()
      .then(function (data) {
        console.log('[add-to-cart] upload resolved:', { design_url: data.design_url, mockup_url: data.mockup_url, checkout_image_url: data.checkout_image_url });
        window.bfTrack('add_to_cart_upload_done', { shader: cfg.shader });
        if (orderStatus) orderStatus.textContent = 'Creating your product…';
        var cpBody = {
          designUrl:         data.design_url,
          mockupUrl:         data.mockup_url,
          checkoutImageUrl:  data.checkout_image_url || data.design_url,
          shader:            orderDesign.shader,
          productHandle:     orderDesign.productHandle,
          values:            orderDesign.values,
          variantId:         shopifyVariantId,
          createProductKey:  orderDesign.createProductKey
        };
        console.log('[create-product] POST', cpBody);
        var CREATE_PRODUCT_TIMEOUT_MS = 45000; // createShopifyProduct runs a couple of dozen sequential Admin API calls (two per size)
        return fetchWithTimeout(workerUrl + '/create-product', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cpBody)
        }, CREATE_PRODUCT_TIMEOUT_MS)
        .then(function (cpRes) {
          return cpRes.json().then(function (cpData) {
            console.log('[create-product] response', cpRes.status, cpData);
            var cartVariantId = (cpRes.ok && cpData.variantId) ? cpData.variantId : shopifyVariantId;
            // handle of the freshly created product — used to poll availability
            // before adding to cart. Null when falling back to the original
            // variant, which is long-published and needs no poll.
            var newHandle = (cpRes.ok && cpData.variantId && cpData.handle) ? cpData.handle : null;
            if (!cpRes.ok) console.error('[create-product] failed, falling back to original variant:', cpData);
            console.log('[add-to-cart] using cartVariantId:', cartVariantId);
            var cartProps = {
              '_design_url':     data.design_url,
              '_mockup_url':     data.mockup_url,
              '_checkout_image': data.checkout_image_url || data.design_url,
              'Customization': 'Custom Shader Design'
            };
            if (sizeSelect) {
              var selectedSizeOpt = sizeSelect.options[sizeSelect.selectedIndex];
              if (selectedSizeOpt) cartProps['Size'] = selectedSizeOpt.text;
            }
            var cartPayload = JSON.stringify({
              id:       Number(cartVariantId),
              quantity: 1,
              properties: cartProps
            });
            // A freshly created product takes a few seconds to propagate to the
            // storefront cache; POSTing /cart/add.js before then returns 404
            // "Cannot find variant". Rapid repeat POSTs from one IP trip
            // Shopify's platform-level bot protection (429 + challenge page,
            // served by Shopify's own CDN — not merchant-configurable, cannot
            // be bypassed by headers or merchant Cloudflare rules). So instead
            // of burst-retrying the POST, poll the same-origin product JSON
            // (a GET, which is not challenged) until the variant reports
            // available, then POST once. Fallback retries are few and widely
            // spaced so they never look like a bot burst.
            function waitForVariantAvailable() {
              if (!newHandle) return Promise.resolve();
              // ~30s typical (20 polls × 1.5s delay, each resolving quickly). Worst
              // case, if every poll itself times out, is ~190s (20 × 8s timeout +
              // 19 × 1.5s delay) before falling through to "adding anyway" below.
              var POLL_DELAY_MS = 1500, MAX_POLLS = 20, POLL_TIMEOUT_MS = 8000;
              function poll(n) {
                return fetchWithTimeout('/products/' + newHandle + '.js', { cache: 'no-store' }, POLL_TIMEOUT_MS)
                  .then(function (r) { return r.ok ? r.json() : null; })
                  .catch(function () { return null; })
                  .then(function (prod) {
                    var match = null;
                    if (prod && prod.variants) {
                      prod.variants.forEach(function (v) {
                        if (String(v.id) === String(cartVariantId)) match = v;
                      });
                    }
                    if (match && match.available) {
                      console.log('[add-to-cart] variant available after', n, 'poll(s)');
                      return;
                    }
                    if (n >= MAX_POLLS) {
                      console.warn('[add-to-cart] variant not available after', n, 'polls — adding anyway');
                      return;
                    }
                    return new Promise(function (resolve) { setTimeout(resolve, POLL_DELAY_MS); })
                      .then(function () { return poll(n + 1); });
                  });
              }
              return poll(1);
            }
            // A network error or timeout on /cart/add.js is ambiguous — the POST may
            // have already reached Shopify and added the item before the client gave
            // up waiting for a response. Retrying blindly risks a second line item or
            // a doubled quantity, so this checks the live cart (a safe, repeatable
            // GET) for a line matching this exact design before retrying or failing.
            var CART_CHECK_TIMEOUT_MS = 8000;
            function cartAlreadyHasItem() {
              return fetchWithTimeout('/cart.js', { cache: 'no-store' }, CART_CHECK_TIMEOUT_MS)
                .then(function (r) { return r.ok ? r.json() : null; })
                .catch(function () { return null; })
                .then(function (cart) {
                  if (!cart || !cart.items) return false;
                  return cart.items.some(function (item) {
                    return String(item.id) === String(cartVariantId) &&
                      item.properties && item.properties['_design_url'] === cartProps['_design_url'];
                  });
                });
            }
            var MAX_ADD_TO_CART_ATTEMPTS = 3;
            var ADD_RETRY_DELAY_MS = 8000;
            var ADD_TO_CART_TIMEOUT_MS = 15000;
            function addToCartWithRetry(attempt) {
              console.log('[add-to-cart] attempt', attempt, 'variantId:', cartVariantId);

              // A network failure, a request timeout, or a failure to read the response
              // body back are all ambiguous — the POST may have already reached Shopify
              // before the client gave up. All three route through this same check-the-
              // cart-before-retry path (see cartAlreadyHasItem above) rather than only
              // the fetch-level rejection, so a body-read failure doesn't fall straight
              // through to the final .catch and misreport a successful add as a failure.
              function handleAmbiguousOutcome(err) {
                console.warn('[add-to-cart] attempt', attempt, 'ambiguous outcome — checking cart before retry:', err.message);
                return cartAlreadyHasItem().then(function (alreadyAdded) {
                  if (alreadyAdded) {
                    console.log('[add-to-cart] item already in cart from a prior attempt — treating as success');
                    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
                  }
                  if (attempt < MAX_ADD_TO_CART_ATTEMPTS) {
                    return new Promise(function (resolve) {
                      if (orderStatus) orderStatus.textContent = 'Finalizing your order…';
                      setTimeout(function () { resolve(addToCartWithRetry(attempt + 1)); }, ADD_RETRY_DELAY_MS);
                    });
                  }
                  throw err;
                });
              }

              return fetchWithTimeout('/cart/add.js', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body: cartPayload
              }, ADD_TO_CART_TIMEOUT_MS).then(function (r) {
                if (!r.ok && attempt < MAX_ADD_TO_CART_ATTEMPTS) {
                  return r.text().then(function (text) {
                    var desc = '';
                    try { desc = JSON.parse(text).description || ''; } catch (e) {}
                    console.warn('[add-to-cart] attempt', attempt, 'failed — status:', r.status, 'desc:', desc);
                    var d = desc.toLowerCase();
                    // 429/503 are transient (bot challenge / unavailable, non-JSON
                    // body so desc is empty); cannot-find means the cart endpoint's
                    // cache still lags the availability poll above. The worker no
                    // longer creates a sold-out state (variants are untracked before
                    // they are stocked anywhere), so 'sold out' here is a defence
                    // against something outside the worker re-tracking the variant
                    // at quantity 0, not a window we expect to hit.
                    if (r.status === 429 || r.status === 503 ||
                        d.indexOf('cannot find') !== -1 ||
                        d.indexOf('sold out') !== -1) {
                      console.log('[add-to-cart] retrying in', ADD_RETRY_DELAY_MS, 'ms');
                      return new Promise(function (resolve) {
                        if (orderStatus) orderStatus.textContent = 'Finalizing your order…';
                        setTimeout(function () { resolve(addToCartWithRetry(attempt + 1)); }, ADD_RETRY_DELAY_MS);
                      });
                    }
                    // Different error — reconstruct a Response-like object to pass along
                    return new Response(text, { status: r.status, headers: { 'Content-Type': 'application/json' } });
                  }, handleAmbiguousOutcome);
                }
                console.log('[add-to-cart] attempt', attempt, 'result — status:', r.status);
                return r;
              }, handleAmbiguousOutcome);
            }
            if (orderStatus) orderStatus.textContent = 'Finalizing your order…';
            return waitForVariantAvailable().then(function () {
              if (orderStatus) orderStatus.textContent = 'Adding to cart…';
              return addToCartWithRetry(1);
            });
          });
        });
      })
      .then(function (r) {
        if (!r.ok) {
          return r.text().then(function (text) {
            console.error('[add-to-cart] final failure — status:', r.status, 'body:', text);
            var msg = 'Cart error (' + r.status + ')';
            try { msg = JSON.parse(text).description || msg; } catch (e) {}
            throw new Error(msg);
          });
        }
        // The item was already added server-side once r.ok is true — a body that
        // fails to parse (truncated response, proxy glitch) must not block the
        // redirect or misreport a successful add as a failure. Fall back to an
        // empty item so analytics is merely incomplete, not wrong.
        return r.json().catch(function () { return {}; }).then(function (item) {
          console.log('[add-to-cart] success — showing gallery-submission prompt before continuing to cart');
          window.bfTrack('add_to_cart_success', { shader: cfg.shader });
          // ── Analytics: GA4 standard ecommerce — add_to_cart ─────────────────
          window.bfTrack('add_to_cart', {
            currency: cfg.currency,
            value: (item.final_price || item.price || 0) / 100,
            items: [{
              item_id: item.variant_id || item.id,
              item_name: item.product_title || item.title,
              item_variant: item.variant_title,
              price: (item.final_price || item.price || 0) / 100,
              quantity: item.quantity || 1
            }]
          });
          if (orderStatus) orderStatus.textContent = '';
          modalOrder.style.display = 'none';
          if (modalSuccess) modalSuccess.style.display = '';
        });
      })
      .catch(function (err) {
        console.error('[add-to-cart] caught error:', err);
        window.bfTrack('add_to_cart_failure', { shader: cfg.shader, error: err.message, timeout: !!err.isTimeout });
        var msg = err.isTimeout
          ? 'This is taking longer than expected. Please try again.'
          : 'Could not add to cart: ' + err.message + ' — please try again or contact us.';
        setOrderError(msg);
        modalOrder.disabled = false;
        modalOrder.textContent = 'Add to Cart';
      });
  });

  if (modalContinue) {
    modalContinue.addEventListener('click', function () {
      window.location.href = '/cart';
    });
  }

  function closeModal() {
    modal.classList.add('mockup-modal--hidden');
    document.body.style.overflow = '';
  }

  closeBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', closeModal);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeModal();
  });

  // Reset modal state when page is restored from bfcache (browser back/forward)
  // to prevent a stale preview image from showing on the next "Preview on Shirt" click.
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) {
      modal.classList.add('mockup-modal--hidden');
      modalImg.src    = '';
      document.body.style.overflow = '';
      btn.disabled    = false;
      btn.textContent = 'Preview on Shirt';
    }
  });

  // ── Community submit form ───────────────────────────────────
  var communityToggle  = document.getElementById('community-toggle');
  var communityForm    = document.getElementById('community-form');
  var communitySuccess = document.getElementById('community-success');
  var communityError   = document.getElementById('community-error');
  var communitySubmit  = document.getElementById('community-submit');
  var communityName    = document.getElementById('community-name');
  var communityEmail   = document.getElementById('community-email');

  if (communityToggle && communityForm) {
    communityToggle.addEventListener('click', function () {
      communityForm.style.display = communityForm.style.display === 'none' ? '' : 'none';
    });
  }

  if (communitySubmit) {
    communitySubmit.addEventListener('click', function () {
      if (!_pendingDesign) return;
      // Captured once at click time (see the identical orderDesign capture in the
      // Add to Cart handler above) so a "Preview on Shirt" click during the ~20s
      // submit window can't pair a stale design's metadata with a fresh upload,
      // or vice versa.
      var submitDesign = _pendingDesign;
      var name  = communityName  ? communityName.value.trim()  : '';
      var email = communityEmail ? communityEmail.value.trim() : '';
      if (!name)  { communityName  && communityName.focus();  return; }
      if (!email) { communityEmail && communityEmail.focus(); return; }

      communitySubmit.disabled    = true;
      communitySubmit.textContent = 'Submitting…';
      if (communityError) communityError.style.display = 'none';

      var COMMUNITY_SUBMIT_TIMEOUT_MS = 20000;
      submitDesign.getUploadPromise()
        .then(function (data) {
          return fetchWithTimeout(workerUrl + '/community/submit', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
              shader:           submitDesign.shader,
              productHandle:    submitDesign.productHandle,
              designUrl:        data.design_url,
              mockupUrl:        data.mockup_url,
              checkoutImageUrl: data.checkout_image_url,
              values:           submitDesign.values,
              creatorName:      name,
              creatorEmail:     email
            })
          }, COMMUNITY_SUBMIT_TIMEOUT_MS);
        })
        .then(function (r) {
          if (!r.ok) throw new Error('Submit failed');
          if (communityForm)    communityForm.style.display    = 'none';
          if (communitySuccess) communitySuccess.style.display = '';
        })
        .catch(function () {
          communitySubmit.disabled    = false;
          communitySubmit.textContent = 'Submit';
          if (communityError) communityError.style.display = '';
        });
    });
  }
}(window.BFProduct));
