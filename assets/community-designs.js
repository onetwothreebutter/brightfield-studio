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
      body:    JSON.stringify({ id: id, deviceId: deviceId })
    })
      .then(function (r) { return r.json(); })
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

  // ── Shader grouping ──────────────────────────────────────────────────────────
  // Reads data-shader on each .community-card and wraps groups in labelled divs.

  function formatShaderName(shader) {
    return (shader || 'Unknown').replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function groupByShader(container) {
    if (!container) return;

    var cards = Array.prototype.slice.call(container.querySelectorAll('.community-card'));
    if (!cards.length) return;

    // Collect groups preserving order
    var groups = {};
    var order = [];
    cards.forEach(function (card) {
      var shader = card.getAttribute('data-shader') || 'unknown';
      if (!groups[shader]) { groups[shader] = []; order.push(shader); }
      groups[shader].push(card);
    });

    // Only wrap if there are multiple shaders
    if (order.length <= 1) return;

    container.innerHTML = '';
    order.forEach(function (shader) {
      var group = document.createElement('div');
      group.className = 'community-card-group';

      var heading = document.createElement('h3');
      heading.className = 'community-card-group__heading';
      heading.textContent = formatShaderName(shader);
      group.appendChild(heading);

      var grid = document.createElement('div');
      grid.className = 'product-grid';
      groups[shader].forEach(function (card) { grid.appendChild(card); });
      group.appendChild(grid);

      container.appendChild(group);
    });
  }

  // ── Fetch ────────────────────────────────────────────────────────────────────

  function fetchCommunityDesigns(shader) {
    var url = WORKER_URL + '/community/list' + (shader ? '?shader=' + encodeURIComponent(shader) : '');
    return fetch(url)
      .then(function (r) { return r.json(); })
      .catch(function () { return []; });
  }

  // ── Filmstrip render ─────────────────────────────────────────────────────────
  // Dynamically builds community design cards into a horizontal filmstrip.
  // opts: { getDeviceId, onCardClick }

  function renderStrip(container, designs, opts) {
    container.innerHTML = '';
    if (!designs || !designs.length) return;

    opts = opts || {};
    var likedSet = getLikedSet();

    var strip = document.createElement('div');
    strip.className = 'recent-designs__strip';

    designs.forEach(function (design) {
      var shaderLabel = (design.shader || '').replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
      var productUrl  = design.shopifyProductHandle ? '/products/' + design.shopifyProductHandle : '#';

      var card = document.createElement('article');
      card.className = 'product-card community-card recent-designs__card';
      card.setAttribute('data-shader', design.shader || '');

      var imgWrap = document.createElement('div');
      imgWrap.className = 'recent-designs__card-img-wrap';

      var img = document.createElement('img');
      img.src = design.mockupUrl || '';
      img.alt = shaderLabel + ' by ' + (design.creatorName || 'Anonymous');
      img.className = 'recent-designs__card-img';
      img.loading = 'lazy';
      imgWrap.appendChild(img);

      var label = document.createElement('div');
      label.className = 'recent-designs__card-label';
      var nameEl = document.createElement('span');
      nameEl.className = 'recent-designs__card-name';
      nameEl.textContent = design.creatorName || 'Anonymous';
      label.appendChild(nameEl);

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
          var deviceId = opts.getDeviceId ? opts.getDeviceId() : getDeviceId();
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

      card.appendChild(imgWrap);
      card.appendChild(label);
      card.appendChild(actions);

      card.addEventListener('click', function () {
        if (opts.onCardClick) opts.onCardClick(design);
      });

      strip.appendChild(card);
    });

    var scrollWrap = document.createElement('div');
    scrollWrap.className = 'recent-designs__scroll';
    scrollWrap.appendChild(strip);
    container.appendChild(scrollWrap);
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
    renderStrip:           renderStrip,
    hydrateInteractions:   hydrateInteractions,
    groupByShader:         groupByShader,
    toggleLike:            toggleLike,
    getDeviceId:           getDeviceId,
    getLikedSet:           getLikedSet,
    setLikedSet:           setLikedSet,
  };
}());
