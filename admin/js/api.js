/**
 * Jurithèque Admin - API Client
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

// زر القائمة على الهاتف
document.addEventListener('DOMContentLoaded', () => {
  const sidebar = document.querySelector('.sidebar');
  const topbar = document.querySelector('.topbar');
  if (!sidebar || !topbar) return;
  const btn = document.createElement('button');
  btn.className = 'menu-toggle';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'القائمة');
  btn.innerHTML = '<i class="fas fa-bars"></i>';
  btn.onclick = () => sidebar.classList.toggle('open');
  topbar.insertBefore(btn, topbar.firstChild);
  sidebar.addEventListener('click', (e) => { if (e.target.closest('a')) sidebar.classList.remove('open'); });
});
