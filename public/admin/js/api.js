/**
 * Admin - API Client
 * يربط لوحة التحكم بالـ Backend الحقيقي
 */

const API_BASE = localStorage.getItem('API_BASE') || (
  (typeof location !== 'undefined' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1')
    ? (location.origin + '/api')
    : 'http://localhost:4000/api'
);

const api = {
  getToken() {
    return localStorage.getItem('token');
  },

  getUser() {
    try {
      return JSON.parse(localStorage.getItem('user') || 'null');
    } catch {
      return null;
    }
  },

  setAuth(token, user) {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
  },

  logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = 'login.html';
  },

  async request(method, path, body = null) {
    const headers = { 'Content-Type': 'application/json' };
    const token = this.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const options = { method, headers };
    if (body && method !== 'GET') options.body = JSON.stringify(body);

    const res = await fetch(`${API_BASE}${path}`, options);
    const data = await res.json().catch(() => ({}));

    if (res.status === 401) {
      this.logout();
      throw new Error('انتهت الجلسة، يرجى تسجيل الدخول مجدداً');
    }

    if (!res.ok) {
      throw new Error(data.error || data.details || `خطأ ${res.status}`);
    }
    return data;
  },


  /**
   * رفع ملف وإرجاع رابطه.
   * - حتى 3 ميغابايت: عبر الخادم مباشرة.
   * - أكبر من ذلك: رفع مباشر إلى Vercel Blob بتصريح من الخادم.
   */
  async uploadFile(file) {
    const SMALL = 3 * 1024 * 1024;
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'];
    if (!allowed.includes(file.type)) throw new Error('نوع الملف غير مسموح. المسموح: PDF, JPG, PNG, WEBP, MP4');
    if (file.size <= SMALL) {
      const b64 = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1]);
        r.onerror = () => reject(new Error('تعذّرت قراءة الملف'));
        r.readAsDataURL(file);
      });
      const out = await this.request('POST', '/upload', { filename: file.name, contentType: file.type, data: b64 });
      return out.url;
    }
    let mod;
    try {
      mod = await import('https://esm.sh/@vercel/blob/client');
    } catch (e) {
      throw new Error('تعذّر تحميل أداة الرفع للملفات الكبيرة. ارفع الملف على خدمة تخزين (مثل Google Drive) وضع رابطه في خانة الرابط.');
    }
    const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-60) || 'file';
    const blob = await mod.upload('uploads/' + Date.now() + '-' + safe, file, {
      access: 'public',
      handleUploadUrl: API_BASE + '/upload/token',
      clientPayload: this.getToken() || '',
    });
    return blob.url;
  },

  get: (path) => api.request('GET', path),
  post: (path, body) => api.request('POST', path, body),
  put: (path, body) => api.request('PUT', path, body),
  delete: (path) => api.request('DELETE', path),
};

/** حماية الصفحات: إعادة توجيه لصفحة الدخول إن لم يكن مسجلاً */
function requireAuth(roles = ['admin', 'editor']) {
  const user = api.getUser();
  const token = api.getToken();
  if (!token || !user) {
    window.location.href = 'login.html';
    return null;
  }
  if (roles.length && !roles.includes(user.role)) {
    alert('ليس لديك صلاحية الوصول لهذه الصفحة');
    window.location.href = 'login.html';
    return null;
  }
  return user;
}

/** عرض رسالة نجاح/خطأ */
function showAlert(message, type = 'success') {
  let el = document.getElementById('admin-alert');
  if (!el) {
    el = document.createElement('div');
    el.id = 'admin-alert';
    el.style.cssText = `
      position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
      padding: 12px 24px; border-radius: 8px; z-index: 9999;
      font-weight: 600; box-shadow: 0 4px 20px rgba(0,0,0,0.15);
    `;
    document.body.appendChild(el);
  }
  el.style.background = type === 'success' ? '#10B981' : '#EF4444';
  el.style.color = '#fff';
  el.textContent = message;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 3500);
}

/** تحديث شريط المستخدم في الأعلى */
function renderUserBar() {
  const user = api.getUser();
  const el = document.querySelector('.user-info');
  if (el && user) {
    el.innerHTML = `
      <div class="user-avatar">${user.fullName?.charAt(0) || 'أ'}</div>
      <span>${user.fullName || user.email}</span>
      <button onclick="api.logout()" class="btn btn-sm btn-outline" style="margin-right:8px">خروج</button>
    `;
  }
}

// تصدير للاستخدام العام
window.api = api;
window.requireAuth = requireAuth;
window.showAlert = showAlert;
window.renderUserBar = renderUserBar;

// قائمة جانبية متجاوبة للهاتف
document.addEventListener('DOMContentLoaded', function () {
  var bar = document.querySelector('.topbar');
  if (!bar || !document.querySelector('.sidebar')) return;
  var btn = document.createElement('button');
  btn.className = 'menu-toggle';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'القائمة');
  btn.innerHTML = '<i class="fas fa-bars"></i>';
  bar.insertBefore(btn, bar.firstChild);
  var ov = document.createElement('div');
  ov.className = 'sidebar-overlay';
  document.body.appendChild(ov);
  function toggle(open) { document.body.classList.toggle('nav-open', open); }
  btn.addEventListener('click', function () { toggle(!document.body.classList.contains('nav-open')); });
  ov.addEventListener('click', function () { toggle(false); });
});

// فلتر الحالة (منشور / مسودة) + نشر كل المسودات + عرض حتى 100 عنصر
(function () {
  var SECTION = (location.pathname.match(/\/admin\/([a-z]+)\.html/) || [])[1];
  var MAP = { laws: 'laws', jurisprudence: 'jurisprudence', books: 'books', theses: 'theses', articles: 'articles', reports: 'reports', lectures: 'lectures', announcements: 'announcements' };
  if (!MAP[SECTION] || !window.api) return;
  var origGet = api.get.bind(api);
  api.get = function (url) {
    if (typeof url === 'string' && url.indexOf('/' + SECTION) === 0 || (typeof url === 'string' && url.indexOf(SECTION + '?') === 0)) {
      url = url.replace('limit=50', 'limit=100');
      var sel = document.getElementById('status-filter');
      if (sel && sel.value && SECTION !== 'announcements') url += (url.indexOf('?') > -1 ? '&' : '?') + 'status=' + encodeURIComponent(sel.value);
    }
    return origGet(url);
  };
  document.addEventListener('DOMContentLoaded', function () {
    var box = document.querySelector('.filters');
    if (!box) return;
    var searchBtn = box.querySelector('button');
    if (SECTION !== 'announcements') {
      var sel = document.createElement('select');
      sel.id = 'status-filter';
      sel.innerHTML = '<option value="">كل الحالات</option><option value="published">المنشورة فقط</option><option value="draft">المسودات فقط</option>';
      box.appendChild(sel);
      sel.addEventListener('change', function () { if (searchBtn) searchBtn.click(); });
    }
    var user = api.getUser && api.getUser();
    if (user && user.role === 'admin') {
      var pb = document.createElement('button');
      pb.type = 'button';
      pb.className = 'btn btn-outline';
      pb.innerHTML = '<i class="fas fa-check-double"></i> نشر كل المسودات';
      pb.addEventListener('click', async function () {
        if (!confirm('سيتم نشر كل المسودات في هذا القسم وستظهر للزوار. هل راجعتَها وحذفتَ غير المناسب منها؟')) return;
        try {
          var r = await api.request('POST', '/admin/publish-drafts/' + SECTION);
          showAlert('تم نشر ' + r.published + ' عنصر', 'success');
          if (searchBtn) searchBtn.click();
        } catch (e) { showAlert(e.message, 'error'); }
      });
      box.appendChild(pb);
    }
  });
})();

// نقل مرجع إلى قسم آخر (نافذة اختيار القسم)
var MOVE_SECTIONS = { laws: 'القوانين', jurisprudence: 'الاجتهادات القضائية', books: 'الكتب', theses: 'الرسائل والأطروحات', articles: 'المقالات', reports: 'التقارير والدراسات', lectures: 'المحاضرات والعروض' };
function moveItem(section, id, title, done) {
  if (!MOVE_SECTIONS[section]) return;
  var ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  var opts = Object.keys(MOVE_SECTIONS).filter(function (k) { return k !== section; }).map(function (k) { return '<option value="' + k + '">' + MOVE_SECTIONS[k] + '</option>'; }).join('');
  var safe = String(title || '').replace(/[<>&"]/g, '');
  ov.innerHTML = '<div style="background:#fff;border-radius:14px;padding:22px;max-width:440px;width:100%;direction:rtl;font-family:inherit">' +
    '<h3 style="margin:0 0 6px">نقل إلى قسم آخر</h3>' +
    (safe ? '<p style="margin:0 0 12px;color:#6B7280;font-size:.9rem">' + safe + '</p>' : '') +
    '<label style="display:block;margin-bottom:6px;font-weight:700">القسم الجديد</label>' +
    '<select id="mv-to" style="width:100%;padding:10px;border:1px solid #D1D5DB;border-radius:8px">' + opts + '</select>' +
    '<p style="color:#92400E;font-size:.8rem;line-height:1.8;margin:12px 0 0">تُنقل البيانات المشتركة (العنوان، الملخص، الجهة، السنة، DOI، الروابط). وقد تُفقد بعض الحقول الخاصة بالقسم الأصلي، فراجع المرجع بعد النقل.</p>' +
    '<div style="display:flex;gap:8px;margin-top:16px"><button class="btn btn-primary" id="mv-ok">نقل</button><button class="btn btn-outline" id="mv-cancel">إلغاء</button></div></div>';
  document.body.appendChild(ov);
  ov.addEventListener('click', function (e) { if (e.target === ov) ov.remove(); });
  document.getElementById('mv-cancel').onclick = function () { ov.remove(); };
  document.getElementById('mv-ok').onclick = async function () {
    var btn = this; btn.disabled = true; btn.textContent = 'جارٍ النقل...';
    try {
      await api.post('/admin/move', { from: section, id: id, to: document.getElementById('mv-to').value });
      ov.remove(); showAlert('تم نقل المرجع', 'success'); if (done) done();
    } catch (e) { btn.disabled = false; btn.textContent = 'نقل'; showAlert(e.message, 'error'); }
  };
}
