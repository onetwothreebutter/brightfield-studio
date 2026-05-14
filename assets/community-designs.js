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
    hydrateInteractions: hydrateInteractions,
    groupByShader:       groupByShader,
    toggleLike:          toggleLike,
    getDeviceId:         getDeviceId,
    getLikedSet:         getLikedSet,
    setLikedSet:         setLikedSet,
  };
}());
