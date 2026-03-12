(function () {
  var WORKER_URL = 'https://brightfield-mockup-worker.eric-d-johnson.workers.dev';
  var DEVICE_KEY = 'brightfield_device_id';
  var RESTORE_KEY = 'brightfield_restore';

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

  function renderFilmstrip(container, designs) {
    container.innerHTML = '';
    if (!designs || !designs.length) {
      var section = container.closest('.recent-designs-section');
      if (section) section.style.display = 'none';
      return;
    }

    var strip = document.createElement('div');
    strip.className = 'recent-designs__strip';

    designs.forEach(function (design) {
      var card = document.createElement('div');
      card.className = 'recent-designs__card';

      var img = document.createElement('img');
      img.src = design.mockupUrl;
      img.alt = design.shader + ' design';
      img.className = 'recent-designs__card-img';
      img.loading = 'lazy';

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
      card.appendChild(img);
      card.appendChild(label);

      (function (d) {
        card.addEventListener('click', function () {
          localStorage.setItem(RESTORE_KEY, JSON.stringify({
            values: d.values,
            shader: d.shader
          }));
          window.location.href = '/products/' + d.productHandle + '#shader';
        });
      }(design));

      strip.appendChild(card);
    });

    container.appendChild(strip);
  }

  window.RecentDesigns = {
    getDeviceId: getDeviceId,
    fetchDesigns: fetchDesigns,
    renderFilmstrip: renderFilmstrip
  };
}());
