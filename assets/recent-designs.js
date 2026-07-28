(function () {
  var WORKER_URL = 'https://brightfield-mockup-worker.eric-d-johnson.workers.dev';
  var DEVICE_KEY = 'brightfield_device_id';
  // Signed HMAC token for DEVICE_KEY, minted by the worker the first time this
  // deviceId saves a design (/generate-mockup or /save-preview response) and
  // required on /delete-design and /community/like from then on (#544 —
  // prevents spoofing another device's deviceId to delete its designs or
  // tamper with its likes).
  var TOKEN_KEY = 'brightfield_device_token';
  var RESTORE_KEY = 'brightfield_restore';

  var _confirmModal = null;
  var _confirmCallback = null;

  function getConfirmModal() {
    if (_confirmModal) return _confirmModal;

    var modal = document.createElement('div');
    modal.className = 'delete-confirm-modal delete-confirm-modal--hidden';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'delete-confirm-title');

    var backdrop = document.createElement('div');
    backdrop.className = 'delete-confirm-modal__backdrop';

    var box = document.createElement('div');
    box.className = 'delete-confirm-modal__box';

    var title = document.createElement('p');
    title.id = 'delete-confirm-title';
    title.className = 'delete-confirm-modal__title';
    title.textContent = 'Delete this design?';

    var actions = document.createElement('div');
    actions.className = 'delete-confirm-modal__actions';

    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn--ghost';
    cancelBtn.textContent = 'Cancel';

    var deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn--danger';
    deleteBtn.textContent = 'Delete';

    actions.appendChild(cancelBtn);
    actions.appendChild(deleteBtn);
    box.appendChild(title);
    box.appendChild(actions);
    modal.appendChild(backdrop);
    modal.appendChild(box);
    document.body.appendChild(modal);

    function close() {
      modal.classList.add('delete-confirm-modal--hidden');
      _confirmCallback = null;
    }

    backdrop.addEventListener('click', close);
    cancelBtn.addEventListener('click', close);
    deleteBtn.addEventListener('click', function () {
      if (_confirmCallback) _confirmCallback();
      close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modal.classList.contains('delete-confirm-modal--hidden')) close();
    });

    _confirmModal = modal;
    return modal;
  }

  function showDeleteConfirm(onConfirm) {
    _confirmCallback = onConfirm;
    getConfirmModal().classList.remove('delete-confirm-modal--hidden');
  }

  function getDeviceId() {
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

  function getDeviceToken() {
    try { return localStorage.getItem(TOKEN_KEY) || null; } catch (e) { return null; }
  }

  // Persists a deviceToken minted by the worker (returned from /generate-mockup,
  // /save-preview, /delete-design, or /community/like — see #544). Called
  // whenever a response includes one, so a legacy deviceId gets upgraded the
  // moment it's claimed.
  function setDeviceToken(token) {
    if (!token) return;
    try { localStorage.setItem(TOKEN_KEY, token); } catch (e) {}
  }

  function fetchDesigns(shader) {
    var deviceId = getDeviceId();
    var url = WORKER_URL + '/list-designs?deviceId=' + encodeURIComponent(deviceId);
    return fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (designs) {
        if (shader) {
          return designs.filter(function (d) { return d.shader === shader; });
        }
        return designs;
      })
      .catch(function () { return []; });
  }

  function timeAgo(timestamp) {
    var diff = Math.floor((Date.now() - timestamp * 1000) / 1000);
    if (diff < 60) return diff + 's ago';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }

  function deleteDesign(id) {
    var deviceId = getDeviceId();
    return fetch(WORKER_URL + '/delete-design', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id, deviceId: deviceId, deviceToken: getDeviceToken() }),
    })
      .then(function (r) { return r.json(); })
      .then(function (result) {
        if (result && result.deviceToken) setDeviceToken(result.deviceToken);
        return result;
      })
      .catch(function () { return { ok: false }; });
  }

  function formatShaderName(shader) {
    return (shader || 'Unknown').replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function buildGridCard(design) {
    var card = document.createElement('article');
    card.className = 'product-card recent-card';

    var media = document.createElement('div');
    media.className = 'product-card__media';

    var img = document.createElement('img');
    img.src = design.mockupUrl;
    img.alt = design.shader + ' design';
    img.className = 'product-card__image';
    img.loading = 'lazy';

    var glow = document.createElement('div');
    glow.className = 'product-card__glow';
    glow.setAttribute('aria-hidden', 'true');

    var deleteBtn = document.createElement('button');
    deleteBtn.className = 'recent-card__delete';
    deleteBtn.setAttribute('aria-label', 'Delete design');
    deleteBtn.textContent = '×';

    media.appendChild(img);
    media.appendChild(glow);
    media.appendChild(deleteBtn);

    var info = document.createElement('div');
    info.className = 'product-card__info';

    var metaEl = document.createElement('p');
    metaEl.className = 'community-card__meta';
    metaEl.textContent = timeAgo(design.timestamp);

    info.appendChild(metaEl);
    card.appendChild(media);
    card.appendChild(info);

    (function (d, c) {
      deleteBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        showDeleteConfirm(function () {
          deleteDesign(d.id).then(function (result) {
            if (!result || !result.ok) return;
            c.remove();
          });
        });
      });

      card.addEventListener('click', function () {
        localStorage.setItem(RESTORE_KEY, JSON.stringify({ values: d.values, shader: d.shader }));
        window.location.href = '/products/' + d.productHandle + '#shader';
      });
    }(design, card));

    return card;
  }

  function renderGrid(container, designs) {
    container.innerHTML = '';
    if (!designs || !designs.length) return;

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
        grid.appendChild(buildGridCard(design));
      });
      group.appendChild(grid);

      container.appendChild(group);
    });
  }

  function renderFilmstrip(container, designs, onCardClick) {
    container.innerHTML = '';
    if (!designs || !designs.length) {
      var section = container.closest('.recent-designs-section');
      if (section) section.style.display = 'none';
      return;
    }

    designs = designs.slice(0, 20);

    var strip = document.createElement('div');
    strip.className = 'recent-designs__strip';

    designs.forEach(function (design) {
      var card = document.createElement('div');
      card.className = 'recent-designs__card';

      var imgWrap = document.createElement('div');
      imgWrap.className = 'recent-designs__card-img-wrap';

      var img = document.createElement('img');
      img.src = design.mockupUrl;
      img.alt = design.shader + ' design';
      img.className = 'recent-designs__card-img';
      img.loading = 'lazy';

      var deleteBtn = document.createElement('button');
      deleteBtn.className = 'recent-designs__card-delete';
      deleteBtn.setAttribute('aria-label', 'Delete design');
      deleteBtn.textContent = '×';

      imgWrap.appendChild(img);
      imgWrap.appendChild(deleteBtn);

      var label = document.createElement('div');
      label.className = 'recent-designs__card-label';

      var name = document.createElement('span');
      name.className = 'recent-designs__card-name';
      name.textContent = design.shader.replace(/-/g, ' ');

      var time = document.createElement('span');
      time.className = 'recent-designs__card-time';
      time.textContent = timeAgo(design.timestamp);

      label.appendChild(name);
      label.appendChild(time);
      card.appendChild(imgWrap);
      card.appendChild(label);

      (function (d, c) {
        deleteBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          showDeleteConfirm(function () {
            deleteDesign(d.id).then(function (result) {
              if (!result || !result.ok) return;
              c.remove();
              if (!strip.querySelector('.recent-designs__card')) {
                var section = container.closest('.recent-designs-section');
                if (section) section.style.display = 'none';
              }
            });
          });
        });

        card.addEventListener('click', function () {
          if (onCardClick) {
            onCardClick(d, c);
          } else {
            localStorage.setItem(RESTORE_KEY, JSON.stringify({
              values: d.values,
              shader: d.shader
            }));
            window.location.href = '/products/' + d.productHandle + '#shader';
          }
        });
      }(design, card));

      strip.appendChild(card);
    });

    var scrollWrap = document.createElement('div');
    scrollWrap.className = 'recent-designs__scroll';
    scrollWrap.appendChild(strip);
    container.appendChild(scrollWrap);
  }

  window.RecentDesigns = {
    getDeviceId: getDeviceId,
    getDeviceToken: getDeviceToken,
    setDeviceToken: setDeviceToken,
    fetchDesigns: fetchDesigns,
    deleteDesign: deleteDesign,
    renderFilmstrip: renderFilmstrip,
    renderGrid: renderGrid,
  };
}());
