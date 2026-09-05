(function () {
  var WORKER_URL = 'https://brightfield-mockup-worker.eric-d-johnson.workers.dev';
  var LIKED_KEY  = 'brightfield_liked';
  var RESTORE_KEY = 'brightfield_restore';

  // ── Device ID ────────────────────────────────────────────────────────────────

  function getDeviceId() {
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

  // Signed deviceId token (#544) — delegates to RecentDesigns when it's loaded
  // (the normal case, since recent-designs.js is the canonical owner of
  // brightfield_device_token) with a localStorage fallback so this module also
  // works standalone.
  function getDeviceToken() {
    if (window.RecentDesigns && window.RecentDesigns.getDeviceToken) {
      return window.RecentDesigns.getDeviceToken();
    }
    try { return localStorage.getItem('brightfield_device_token') || null; } catch (e) { return null; }
  }

  function setDeviceToken(token) {
    if (!token) return;
    if (window.RecentDesigns && window.RecentDesigns.setDeviceToken) {
      window.RecentDesigns.setDeviceToken(token);
      return;
    }
    try { localStorage.setItem('brightfield_device_token', token); } catch (e) {}
  }

  // ── Liked set ────────────────────────────────────────────────────────────────

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

  // ── Like API ─────────────────────────────────────────────────────────────────

  function toggleLike(id, deviceId) {
    return fetch(WORKER_URL + '/community/like', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id: id, deviceId: deviceId, deviceToken: getDeviceToken() })
    })
      .then(function (r) { return r.json(); })
      .then(function (result) {
        if (result && result.deviceToken) setDeviceToken(result.deviceToken);
        return result;
      })
      .catch(function () { return null; });
  }

  // ── Share helper ─────────────────────────────────────────────────────────────

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

  // ── Fetch ────────────────────────────────────────────────────────────────────

  function fetchCommunityDesigns(shader, productHandle) {
    var params = [];
    if (shader)        params.push('shader='        + encodeURIComponent(shader));
    if (productHandle) params.push('productHandle=' + encodeURIComponent(productHandle));
    var url = WORKER_URL + '/community/list' + (params.length ? '?' + params.join('&') : '');
    return fetch(url)
      .then(function (r) { return r.json(); })
      .catch(function () { return []; });
  }

  // ── Shared card actions builder ───────────────────────────────────────────────

  function buildCardActions(design, opts) {
    var likedSet    = getLikedSet();
    var productUrl  = design.shopifyProductHandle ? '/products/' + design.shopifyProductHandle : '#';

    var actions = document.createElement('div');
    actions.className = 'product-card__actions';

    var buyLink = document.createElement('a');
    buyLink.href = productUrl;
    buyLink.className = 'btn btn--primary btn--sm';
    buyLink.textContent = 'Buy';
    buyLink.addEventListener('click', function (e) { e.stopPropagation(); });
    actions.appendChild(buyLink);

    if (design.productHandle) {
      var customizeBtn = document.createElement('button');
      customizeBtn.className = 'btn btn--outline btn--sm community-card__customize-btn';
      customizeBtn.setAttribute('data-source-handle', design.productHandle);
      customizeBtn.setAttribute('data-shader', design.shader || '');
      customizeBtn.setAttribute('data-values', JSON.stringify(design.values || {}));
      customizeBtn.textContent = 'Customize';
      customizeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var values;
        try { values = JSON.parse(customizeBtn.getAttribute('data-values') || '{}'); } catch (err) { values = {}; }
        localStorage.setItem(RESTORE_KEY, JSON.stringify({ values: values, shader: design.shader }));
        window.location.href = '/products/' + encodeURIComponent(design.productHandle) + '#shader';
      });
      actions.appendChild(customizeBtn);
    }

    var likeBtn = document.createElement('button');
    likeBtn.className = 'btn btn--outline btn--sm community-designs__like-btn';
    likeBtn.setAttribute('data-submission-id', design.id);
    likeBtn.setAttribute('aria-label', 'Like');
    if (likedSet[design.id]) likeBtn.classList.add('community-designs__like-btn--liked');

    var likeIcon = document.createElement('span');
    likeIcon.className = 'community-designs__like-icon';
    likeIcon.innerHTML = '&#x2665;';

    var likeCount = document.createElement('span');
    likeCount.className = 'community-designs__like-count';
    likeCount.textContent = design.likes != null ? String(design.likes) : '–';

    likeBtn.appendChild(likeIcon);
    likeBtn.appendChild(likeCount);

    (function (d, btn, countEl) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var deviceId = opts && opts.getDeviceId ? opts.getDeviceId() : getDeviceId();
        toggleLike(d.id, deviceId).then(function (result) {
          if (!result) return;
          countEl.textContent = String(result.likes);
          btn.classList.toggle('community-designs__like-btn--liked', result.liked);
          var set = getLikedSet();
          if (result.liked) { set[d.id] = 1; } else { delete set[d.id]; }
          setLikedSet(set);
        });
      });
    }(design, likeBtn, likeCount));

    actions.appendChild(likeBtn);

    var shareBtn = document.createElement('button');
    shareBtn.className = 'btn btn--outline btn--sm community-designs__share-btn';
    var shareUrl = 'https://share.brightfield.studio/' + design.id;
    shareBtn.setAttribute('data-share-url', shareUrl);
    shareBtn.setAttribute('aria-label', 'Copy share link');
    shareBtn.innerHTML = '&#x1F517;';

    (function (btn, url) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        function showCopied() {
          btn.textContent = '✓';
          setTimeout(function () { btn.innerHTML = '&#x1F517;'; }, 1500);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(showCopied).catch(function () {
            fallbackCopy(url, showCopied);
          });
        } else {
          fallbackCopy(url, showCopied);
        }
      });
    }(shareBtn, shareUrl));

    actions.appendChild(shareBtn);
    return actions;
  }

  // ── Grid render ───────────────────────────────────────────────────────────────
  // Builds community design cards as full product-card grid items.
  // opts: { getDeviceId }

  function renderGrid(container, designs, opts) {
    container.innerHTML = '';
    if (!designs || !designs.length) return;

    opts = opts || {};

    var grid = document.createElement('div');
    grid.className = 'product-grid';

    designs.forEach(function (design) {
      var shaderLabel = (design.shader || '').replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
      var productUrl  = design.shopifyProductHandle ? '/products/' + design.shopifyProductHandle : '#';
      var creatorName = design.creatorName || 'Anonymous';

      var card = document.createElement('article');
      card.className = 'product-card community-card';
      card.setAttribute('data-shader', design.shader || '');

      var link = document.createElement('a');
      link.href = productUrl;
      link.className = 'product-card__link';
      link.setAttribute('aria-label', shaderLabel + ' by ' + creatorName);

      var media = document.createElement('div');
      media.className = 'product-card__media';

      var img = document.createElement('img');
      img.src = design.mockupUrl || '';
      img.alt = shaderLabel + ' by ' + creatorName;
      img.className = 'product-card__image';
      img.loading = 'lazy';
      media.appendChild(img);

      var glow = document.createElement('div');
      glow.className = 'product-card__glow';
      glow.setAttribute('aria-hidden', 'true');
      media.appendChild(glow);

      var info = document.createElement('div');
      info.className = 'product-card__info';

      var title = document.createElement('h3');
      title.className = 'product-card__title';
      title.textContent = creatorName;
      info.appendChild(title);

      var meta = document.createElement('p');
      meta.className = 'community-card__meta';
      meta.textContent = shaderLabel;
      info.appendChild(meta);

      link.appendChild(media);
      link.appendChild(info);
      card.appendChild(link);
      card.appendChild(buildCardActions(design, opts));

      grid.appendChild(card);
    });

    container.appendChild(grid);
  }

  // ── Hydration ────────────────────────────────────────────────────────────────
  // Fetches like counts for all visible submission IDs and wires button events.

  function hydrateInteractions() {
    var likeButtons = document.querySelectorAll('.community-designs__like-btn[data-submission-id]');
    var likedSet = getLikedSet();

    // Apply liked state from localStorage and fetch current counts
    Array.prototype.forEach.call(likeButtons, function (btn) {
      var id = btn.getAttribute('data-submission-id');
      var countEl = btn.querySelector('.community-designs__like-count');

      if (likedSet[id]) btn.classList.add('community-designs__like-btn--liked');

      // Fetch current like count
      fetch(WORKER_URL + '/community/design/' + encodeURIComponent(id))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (d && countEl) countEl.textContent = d.likes != null ? d.likes : '0';
        })
        .catch(function () {});

      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var deviceId = getDeviceId();
        toggleLike(id, deviceId).then(function (result) {
          if (!result) return;
          if (countEl) countEl.textContent = result.likes;
          btn.classList.toggle('community-designs__like-btn--liked', result.liked);
          var set = getLikedSet();
          if (result.liked) { set[id] = 1; } else { delete set[id]; }
          setLikedSet(set);
        });
      });
    });

    // Share buttons
    var shareButtons = document.querySelectorAll('.community-designs__share-btn[data-share-url]');
    Array.prototype.forEach.call(shareButtons, function (btn) {
      var shareUrl = btn.getAttribute('data-share-url');
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        function showCopied() {
          btn.textContent = '✓';
          setTimeout(function () { btn.textContent = '🔗'; }, 1500);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(shareUrl).then(showCopied).catch(function () {
            fallbackCopy(shareUrl, showCopied);
          });
        } else {
          fallbackCopy(shareUrl, showCopied);
        }
      });
    });

    // Customize buttons
    var customizeButtons = document.querySelectorAll('.community-card__customize-btn[data-source-handle]');
    Array.prototype.forEach.call(customizeButtons, function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var sourceHandle = btn.getAttribute('data-source-handle');
        var shader = btn.getAttribute('data-shader');
        var valuesRaw = btn.getAttribute('data-values') || '{}';
        var values;
        try { values = JSON.parse(valuesRaw); } catch (err) { values = {}; }
        localStorage.setItem(RESTORE_KEY, JSON.stringify({ values: values, shader: shader }));
        window.location.href = '/products/' + encodeURIComponent(sourceHandle) + '#shader';
      });
    });
  }

  window.CommunityDesigns = {
    fetchCommunityDesigns: fetchCommunityDesigns,
    renderGrid:            renderGrid,
    hydrateInteractions:   hydrateInteractions,
    toggleLike:            toggleLike,
    getDeviceId:           getDeviceId,
    getDeviceToken:        getDeviceToken,
    setDeviceToken:        setDeviceToken,
    getLikedSet:           getLikedSet,
    setLikedSet:           setLikedSet,
  };
}());
