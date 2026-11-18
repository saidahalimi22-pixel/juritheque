/* تطبيق تخصيصات الموقع التي يحفظها المدير من لوحة الإدارة (الصور، النصوص، أحجام الخط، الأقسام) */
(function () {
  var API = (location.protocol === 'file:' ? 'http://localhost:3000' : location.origin) + '/api';
  function apply(s) {
    if (!s) return;
    if (s.logoVersion) {
      var src = API + '/site-logo?v=' + encodeURIComponent(s.logoVersion);
      document.querySelectorAll('img').forEach(function (im) {
        if ((im.getAttribute('src') || '').indexOf('logo-emblem') > -1) im.src = src;
      });
    }
    if (s.heroVersion) {
      var h = document.querySelector('.hero-bg');
      if (h) h.style.backgroundImage = 'url("' + API + '/hero-image?v=' + encodeURIComponent(s.heroVersion) + '")';
    }
    var texts = s.texts || {}, sizes = s.sizes || {};
    document.querySelectorAll('[data-t]').forEach(function (el) {
      var k = el.getAttribute('data-t');
      if (texts[k]) el.textContent = texts[k];
      if (sizes[k]) el.style.zoom = sizes[k] / 100;
    });
    (s.hiddenCards || []).forEach(function (k) {
      var c = document.querySelector('[data-card="' + k + '"]');
      if (c) c.style.display = 'none';
    });
    var grid = document.querySelector('.grid');
    if (grid && s.customCards && s.customCards.length) {
      grid.querySelectorAll('[data-custom]').forEach(function (n) { n.remove(); });
      s.customCards.forEach(function (c) {
        if (!/^https?:\/\//i.test(c.url || '')) return;
        var d = document.createElement('div');
        d.className = 'card'; d.setAttribute('data-custom', '1');
        var ic = document.createElement('div'); ic.className = 'card-icon';
        var i = document.createElement('i'); i.className = 'fas fa-' + (/^[a-z0-9-]+$/.test(c.icon || '') ? c.icon : 'star');
        ic.appendChild(i);
        var t = document.createElement('h3'); t.textContent = c.title || '';
        var p = document.createElement('p'); p.textContent = c.desc || '';
        d.appendChild(ic); d.appendChild(t); d.appendChild(p);
        d.addEventListener('click', function () { window.open(c.url, '_blank', 'noopener'); });
        grid.appendChild(d);
      });
    }
  }
  fetch(API + '/settings', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(apply)
    .catch(function () {});
})();
