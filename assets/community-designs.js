(function () {
  var WORKER_URL = 'https://brightfield-mockup-worker.eric-d-johnson.workers.dev';
  var LIKED_KEY  = 'brightfield_liked';

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

  function renderStrip(container, designs, opts) {
    opts = opts || {};
    var getDeviceIdFn = (opts.getDeviceId && typeof opts.getDeviceId === 'function')
      ? opts.getDeviceId
      : getDeviceId;
    var onCardClick = opts.onCardClick || null;

    container.innerHTML = '';
    if (!designs || !designs.length) return;

    var likedSet = getLikedSet();

    var strip = document.createElement('div');
    strip.className = 'community-designs__strip';

    designs.forEach(function (design) {
      var card = document.createElement('div');
      card.className = 'community-designs__card';

      var img = document.createElement('img');
      img.src = design.mockupUrl;
      img.alt = (design.creatorName || 'Community') + ' design';
      img.className = 'community-designs__card-img';
      img.loading = 'lazy';

      var label = document.createElement('div');
      label.className = 'community-designs__card-label';

      var nameEl = document.createElement('span');
      nameEl.className = 'community-designs__card-name';
      nameEl.textContent = design.creatorName || 'Anonymous';

      var shaderEl = document.createElement('span');
      shaderEl.className = 'community-designs__card-shader';
      shaderEl.textContent = (design.shader || '').replace(/-/g, ' ');

      var timeEl = document.createElement('span');
      timeEl.className = 'community-designs__card-time';
      timeEl.textContent = timeAgo(design.timestamp);

      var isLiked = !!likedSet[design.id];
      var likeBtn = document.createElement('button');
      likeBtn.className = 'community-designs__like-btn' + (isLiked ? ' community-designs__like-btn--liked' : '');
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
      shareBtn.className = 'community-designs__share-btn';
      shareBtn.setAttribute('aria-label', 'Copy share link');
      shareBtn.textContent = '\uD83D\uDD17';

      label.appendChild(nameEl);
      label.appendChild(shaderEl);
      label.appendChild(timeEl);
      label.appendChild(likeBtn);
      label.appendChild(shareBtn);

      card.appendChild(img);
      card.appendChild(label);

      (function (d, likeButton, countEl, shareButton) {
        shareButton.addEventListener('click', function (e) {
          e.stopPropagation();
          var shareUrl = WORKER_URL + '/share/' + d.id;
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
      }(design, likeBtn, likeCount, shareBtn));

      strip.appendChild(card);
    });

    container.appendChild(strip);
  }

  window.CommunityDesigns = {
    fetchCommunityDesigns: fetchCommunityDesigns,
    toggleLike:            toggleLike,
    renderStrip:           renderStrip
  };
}());
