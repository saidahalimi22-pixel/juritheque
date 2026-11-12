/**
 * جلب البيانات من Backend أو من البيانات التجريبية (للمعاينة بدون خادم)
 */
const PUBLIC_API = localStorage.getItem('API_BASE') || (
  (typeof location !== 'undefined' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1')
    ? (location.origin + '/api')
    : 'http://localhost:4000/api'
);

async function fetchAPI(path) {
  try {
    const res = await fetch(PUBLIC_API + path);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch (err) {
    console.warn('API غير متاح — استخدام بيانات المعاينة:', err.message);
    return getDemoResponse(path);
  }
}

function getDemoResponse(path) {
  const demo = window.DEMO_DATA || {};
  const p = path.split('?')[0];

  if (p === '/laws') return { data: demo.laws || [], meta: { total: (demo.laws || []).length } };
  if (p === '/jurisprudence') return { data: demo.jurisprudence || [], meta: { total: (demo.jurisprudence || []).length } };
  if (p === '/books') return { data: demo.books || [], meta: { total: (demo.books || []).length } };
  if (p === '/theses') return { data: demo.theses || [], meta: { total: (demo.theses || []).length } };
  if (p === '/articles') return { data: demo.articles || [], meta: { total: (demo.articles || []).length } };
  if (p === '/lectures') return { data: demo.lectures || [], meta: { total: (demo.lectures || []).length } };
  if (p === '/announcements') return { data: demo.announcements || [], meta: { total: (demo.announcements || []).length } };
  return { data: [], meta: { total: 0 } };
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(d) {
  if (!d) return '';
  return String(d).substring(0, 10);
}

window.PublicAPI = { fetchAPI, escapeHtml, formatDate, PUBLIC_API };
