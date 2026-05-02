(function () {
  var WORKER_URL = 'https://brightfield-mockup-worker.eric-d-johnson.workers.dev';
  var LIKED_KEY  = 'brightfield_liked';

  // ── Buy modal (singleton) ─────────────────────────────────────────────────
  var _buyModal        = null;
  var _buyDesign       = null;

  function ensureBuyModal() {
    if (_buyModal) return _buyModal;

    var modal = document.createElement('div');
    modal.className = 'mockup-modal mockup-modal--hidden';

    var backdrop = document.createElement('div');
    backdrop.className = 'mockup-modal__backdrop';

    var box = document.createElement('div');
    box.className = 'mockup-modal__box';

    var header = document.createElement('div');
    header.className = 'mockup-modal__header';
    var titleEl = document.createElement('span');
    titleEl.className = 'mockup-modal__title';
    titleEl.textContent = 'Order Design';
    var closeBtn = document.createElement('button');
    closeBtn.className = 'mockup-modal__close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '×';
    header.appendChild(titleEl);
    header.appendChild(closeBtn);

    var body = document.createElement('div');
    body.className = 'mockup-modal__body';
    var img = document.createElement('img');
    img.className = 'mockup-modal__img';
    img.alt = 'Shirt preview';
    body.appendChild(img);

    var footer = document.createElement('div');
    footer.className = 'mockup-modal__footer';

    var sizeDiv = document.createElement('div');
    sizeDiv.className = 'mockup-modal__size';
    var sizeLabel = document.createElement('label');
    sizeLabel.className = 'mockup-modal__size-label';
    sizeLabel.textContent = 'Size';
    sizeLabel.setAttribute('for', 'community-buy-size-select');
    var sizeSelect = document.createElement('select');
    sizeSelect.className = 'mockup-modal__size-select';
    sizeSelect.id = 'community-buy-size-select';
    sizeDiv.appendChild(sizeLabel);
    sizeDiv.appendChild(sizeSelect);

    var footerActions = document.createElement('div');
    footerActions.className = 'mockup-modal__footer-actions';
    var orderBtn = document.createElement('button');
    orderBtn.className = 'btn btn--primary btn--sm';
    orderBtn.textContent = 'Order This Design';
    footerActions.appendChild(orderBtn);

    footer.appendChild(sizeDiv);
    footer.appendChild(footerActions);

    box.appendChild(header);
    box.appendChild(body);
    box.appendChild(footer);
    modal.appendChild(backdrop);
    modal.appendChild(box);
    document.body.appendChild(modal);

    function closeModal() {
      modal.classList.add('mockup-modal--hidden');
      document.body.style.overflow = '';
    }

    closeBtn.addEventListener('click', closeModal);
    backdrop.addEventListener('click', closeModal);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modal.classList.contains('mockup-modal--hidden')) closeModal();
    });

    orderBtn.addEventListener('click', function () {
      if (!_buyDesign) return;
      var variantId = sizeSelect.value;
      if (!variantId) { alert('Please select a size.'); return; }

      orderBtn.disabled    = true;
      orderBtn.textContent = 'Saving…';

      fetch('/cart/add.js', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id:       Number(variantId),
          quantity: 1,
          properties: {
            '_design_url':    _buyDesign.mockupUrl,
            '_mockup_url':    _buyDesign.mockupUrl,
            'Customization':  'Community Design',
            'Design Type':    'Community Design',
            'Designer':       _buyDesign.creatorName || 'Anonymous'
          }
        })
      })
      .then(function (r) {
        if (!r.ok) {
          return r.text().then(function (text) {
            var msg = 'Cart error (' + r.status + ')';
            try { msg = JSON.parse(text).description || msg; } catch (e) {}
            throw new Error(msg);
          });
        }
        window.location.href = '/cart';
      })
      .catch(function (err) {
        alert('Could not add to cart: ' + err.message);
        orderBtn.disabled    = false;
        orderBtn.textContent = 'Order This Design';
      });
    });

    _buyModal = { modal: modal, img: img, sizeDiv: sizeDiv, sizeSelect: sizeSelect, orderBtn: orderBtn };
    return _buyModal;
  }

  function openBuyModal(design) {
    var m = ensureBuyModal();
    _buyDesign = design;

    m.img.src            = design.mockupUrl;
    m.orderBtn.disabled  = false;
    m.orderBtn.textContent = 'Order This Design';
    m.sizeDiv.style.display = '';

    m.sizeSelect.innerHTML = '';
    var placeholder = document.createElement('option');
    placeholder.textContent = 'Loading sizes…';
    placeholder.disabled    = true;
    placeholder.selected    = true;
    m.sizeSelect.appendChild(placeholder);

    fetch('/products/' + design.productHandle + '.js')
      .then(function (r) { return r.json(); })
      .then(function (product) {
        m.sizeSelect.innerHTML = '';
        var variants = product.variants || [];
        if (variants.length <= 1) {
          m.sizeDiv.style.display = 'none';
        }
        variants.forEach(function (v) {
          var opt = document.createElement('option');
          opt.value       = v.id;
          opt.textContent = v.title;
          opt.disabled    = !v.available;
          m.sizeSelect.appendChild(opt);
        });
      })
      .catch(function () {
        m.sizeSelect.innerHTML = '';
        var opt = document.createElement('option');
        opt.textContent = 'Error loading sizes';
        opt.disabled    = true;
        m.sizeSelect.appendChild(opt);
      });

    m.modal.classList.remove('mockup-modal--hidden');
    document.body.style.overflow = 'hidden';
  }
  // ─────────────────────────────────────────────────────────────────────────

  function getDeviceId() {
    // Delegate to RecentDesigns if available, otherwise generate locally
    if (window.RecentDesigns && window.RecentDesigns.getDeviceId) {
      return window.RecentDesigns.getDeviceId();
    }
    var DEVICE_KEY = 'brightfield_device_id';
    var id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0;
        var v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  }

  function getLikedSet() {
    try {
      var raw = localStorage.getItem(LIKED_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function setLikedSet(set) {
    try {
      localStorage.setItem(LIKED_KEY, JSON.stringify(set));
    } catch (e) {}
  }

  function timeAgo(timestamp) {
    var diff = Math.floor((Date.now() - timestamp * 1000) / 1000);
    if (diff < 60) return diff + 's ago';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }

  function fetchCommunityDesigns(shader) {
    var url = WORKER_URL + '/community/list';
    if (shader) url += '?shader=' + encodeURIComponent(shader);
    return fetch(url)
      .then(function (r) { return r.json(); })
      .catch(function () { return []; });
  }

  function toggleLike(id, deviceId) {
    return fetch(WORKER_URL + '/community/like', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id: id, deviceId: deviceId })
    })
      .then(function (r) { return r.json(); })
      .catch(function () { return null; });
  }

  function fallbackCopy(text, onSuccess) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); onSuccess(); } catch (e) {}
    document.body.removeChild(ta);
  }

  function formatShaderName(shader) {
    return (shader || 'Unknown').replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function buildCard(design, likedSet, getDeviceIdFn, onCardClick) {
    var card = document.createElement('article');
    card.className = 'product-card community-card';

    var media = document.createElement('div');
    media.className = 'product-card__media';

    var img = document.createElement('img');
    img.src = design.mockupUrl;
    img.alt = (design.creatorName || 'Community') + ' design';
    img.className = 'product-card__image';
    img.loading = 'lazy';

    var glow = document.createElement('div');
    glow.className = 'product-card__glow';
    glow.setAttribute('aria-hidden', 'true');

    media.appendChild(img);
    media.appendChild(glow);

    var info = document.createElement('div');
    info.className = 'product-card__info';

    var nameEl = document.createElement('h3');
    nameEl.className = 'product-card__title';
    nameEl.textContent = design.creatorName || 'Anonymous';

    var metaEl = document.createElement('p');
    metaEl.className = 'community-card__meta';
    metaEl.textContent = timeAgo(design.timestamp);

    info.appendChild(nameEl);
    info.appendChild(metaEl);

    var actions = document.createElement('div');
    actions.className = 'product-card__actions';

    var buyBtn = document.createElement('a');
    buyBtn.className = 'btn btn--primary btn--sm';
    buyBtn.textContent = 'Buy';

    var customizeBtn = document.createElement('a');
    customizeBtn.className = 'btn btn--outline btn--sm';
    customizeBtn.textContent = 'Customize';

    actions.appendChild(buyBtn);
    actions.appendChild(customizeBtn);

    var isLiked = !!likedSet[design.id];
    var likeBtn = document.createElement('button');
    likeBtn.className = 'btn btn--outline btn--sm community-designs__like-btn' + (isLiked ? ' community-designs__like-btn--liked' : '');
    likeBtn.dataset.id = design.id;
    likeBtn.setAttribute('aria-label', 'Like');

    var likeIcon = document.createElement('span');
    likeIcon.className = 'community-designs__like-icon';
    likeIcon.textContent = '\u2665';

    var likeCount = document.createElement('span');
    likeCount.className = 'community-designs__like-count';
    likeCount.textContent = design.likes || 0;

    likeBtn.appendChild(likeIcon);
    likeBtn.appendChild(likeCount);

    var shareBtn = document.createElement('button');
    shareBtn.className = 'btn btn--outline btn--sm community-designs__share-btn';
    shareBtn.setAttribute('aria-label', 'Copy share link');
    shareBtn.textContent = '\uD83D\uDD17';

    actions.appendChild(likeBtn);
    actions.appendChild(shareBtn);

    card.appendChild(media);
    card.appendChild(info);
    card.appendChild(actions);

    (function (d, likeButton, countEl, shareButton, buyButton, customizeButton) {
      buyButton.addEventListener('click', function (e) {
        e.stopPropagation();
        openBuyModal(d);
      });

      customizeButton.addEventListener('click', function (e) {
        e.stopPropagation();
        var RESTORE_KEY = 'brightfield_restore';
        localStorage.setItem(RESTORE_KEY, JSON.stringify({
          values: d.values,
          shader: d.shader,
          creatorName: d.creatorName || null
        }));
        window.location.href = '/products/' + d.productHandle + '#shader';
      });

      shareButton.addEventListener('click', function (e) {
        e.stopPropagation();
        var shareUrl = 'https://share.brightfield.studio/' + d.id;
        function showCopied() {
          shareButton.textContent = '\u2713';
          setTimeout(function () { shareButton.textContent = '\uD83D\uDD17'; }, 1500);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(shareUrl).then(showCopied).catch(function () {
            fallbackCopy(shareUrl, showCopied);
          });
        } else {
          fallbackCopy(shareUrl, showCopied);
        }
      });

      likeButton.addEventListener('click', function (e) {
        e.stopPropagation();
        var deviceId = getDeviceIdFn();
        toggleLike(d.id, deviceId).then(function (result) {
          if (!result) return;
          countEl.textContent = result.likes;
          var liked = result.liked;
          likeButton.classList.toggle('community-designs__like-btn--liked', liked);
          var set = getLikedSet();
          if (liked) {
            set[d.id] = 1;
          } else {
            delete set[d.id];
          }
          setLikedSet(set);
        });
      });

      card.addEventListener('click', function () {
        if (onCardClick) {
          onCardClick(d, card);
        } else {
          var RESTORE_KEY = 'brightfield_restore';
          localStorage.setItem(RESTORE_KEY, JSON.stringify({
            values: d.values,
            shader: d.shader,
            creatorName: d.creatorName || null
          }));
          window.location.href = '/products/' + d.productHandle + '#shader';
        }
      });
    }(design, likeBtn, likeCount, shareBtn, buyBtn, customizeBtn));

    return card;
  }

  function renderStrip(container, designs, opts) {
    opts = opts || {};
    var getDeviceIdFn = (opts.getDeviceId && typeof opts.getDeviceId === 'function')
      ? opts.getDeviceId
      : getDeviceId;
    var onCardClick = opts.onCardClick || null;

    container.innerHTML = '';
    if (!designs || !designs.length) return;

    var likedSet = getLikedSet();

    // Group by shader, preserving first-seen order
    var groups = {};
    var order = [];
    designs.forEach(function (design) {
      var key = design.shader || 'unknown';
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(design);
    });

    order.forEach(function (shader) {
      var group = document.createElement('div');
      group.className = 'community-card-group';

      var heading = document.createElement('h3');
      heading.className = 'community-card-group__heading';
      heading.textContent = formatShaderName(shader);
      group.appendChild(heading);

      var grid = document.createElement('div');
      grid.className = 'product-grid';
      groups[shader].forEach(function (design) {
        grid.appendChild(buildCard(design, likedSet, getDeviceIdFn, onCardClick));
      });
      group.appendChild(grid);

      container.appendChild(group);
    });
  }

  window.CommunityDesigns = {
    fetchCommunityDesigns: fetchCommunityDesigns,
    toggleLike:            toggleLike,
    renderStrip:           renderStrip
  };
}());
