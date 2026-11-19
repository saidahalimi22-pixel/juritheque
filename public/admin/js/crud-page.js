/**
 * مساعد مشترك لصفحات CRUD في لوحة التحكم
 * مع دعم رفع الملفات
 */
function createCrudPage(config) {
  const {
    endpoint,
    fields,
    columns,
    titleField = 'title',
  } = config;

  let cache = [];

  async function loadItems() {
    const tbody = document.getElementById('items-tbody');
    tbody.innerHTML = '<tr><td colspan="20" style="text-align:center;">جاري التحميل...</td></tr>';
    try {
      const q = (document.getElementById('search-q')?.value || '').trim();
      let url = endpoint + '?limit=50';
      if (q) url += '&q=' + encodeURIComponent(q);
      const res = await api.get(url);
      const totalEl = document.getElementById('total-count');
      if (totalEl) totalEl.textContent = (res.meta?.total || 0) + ' عنصر';
      cache = res.data || [];
      if (!cache.length) {
        tbody.innerHTML = '<tr><td colspan="20" style="text-align:center;color:#9CA3AF;">لا توجد نتائج</td></tr>';
        return;
      }
      tbody.innerHTML = cache.map(function(item) {
        let cells = columns.map(function(col) {
          let val = item[col.key];
          if (col.render) val = col.render(item);
          else if (val == null) val = '—';
          else if (col.type === 'date' && val) val = String(val).substring(0, 10);
          return '<td>' + escapeHtml(String(val)) + '</td>';
        }).join('');
        return '<tr>' + cells +
          '<td>' +
          (typeof MOVE_SECTIONS !== 'undefined' && MOVE_SECTIONS[endpoint.replace('/', '')] ? '<button class="btn btn-sm btn-outline" title="نقل إلى قسم آخر" onclick="window.__moveItem(\'' + item.id + '\')"><i class="fas fa-exchange-alt"></i></button> ' : '') +
          '<button class="btn btn-sm btn-outline" onclick="window.__editItem(\'' + item.id + '\')"><i class="fas fa-edit"></i></button> ' +
          '<button class="btn btn-sm btn-outline" style="color:#EF4444" onclick="window.__deleteItem(\'' + item.id + '\')"><i class="fas fa-trash"></i></button>' +
          '</td></tr>';
      }).join('');
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="20" style="color:#EF4444;text-align:center;">' + err.message + '</td></tr>';
    }
  }

  function openForm(item) {
    document.getElementById('form-card').style.display = 'block';
    document.getElementById('form-title').textContent = item ? 'تعديل' : 'إضافة جديد';
    document.getElementById('item-id').value = item ? item.id : '';
    fields.forEach(function(f) {
      const el = document.getElementById('f-' + f.name);
      if (!el) return;
      let val = item ? item[f.name] : (f.default || '');
      if (f.type === 'date' && val) val = String(val).substring(0, 10);
      if (f.type === 'checkbox') el.checked = !!val;
      else el.value = val != null ? val : '';
    });
    // reset file input
    const fileEl = document.getElementById('f-file');
    if (fileEl) fileEl.value = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function closeForm() {
    document.getElementById('form-card').style.display = 'none';
    document.getElementById('crud-form')?.reset();
    document.getElementById('item-id').value = '';
  }

  window.__editItem = function(id) {
    const item = cache.find(function(x) { return x.id === id; });
    if (item) openForm(item);
  };

  window.__moveItem = function(id) {
    const item = cache.find(function(x) { return x.id === id; });
    moveItem(endpoint.replace('/', ''), id, item ? (item[titleField] || '') : '', loadItems);
  };

  window.__deleteItem = async function(id) {
    if (!confirm('هل أنت متأكد من الحذف؟')) return;
    try {
      await api.delete(endpoint + '/' + id);
      showAlert('تم الحذف');
      loadItems();
    } catch (err) {
      showAlert(err.message, 'error');
    }
  };

  window.__openForm = function() { openForm(null); };
  window.__closeForm = closeForm;
  window.__loadItems = loadItems;

  // رفع ملف ثم حفظ
  async function uploadFileIfNeeded() {
    const fileEl = document.getElementById('f-file');
    if (!fileEl || !fileEl.files || !fileEl.files[0]) return null;
    return api.uploadFile(fileEl.files[0]);
  }

  document.getElementById('crud-form')?.addEventListener('submit', async function(e) {
    e.preventDefault();
    const btn = document.getElementById('save-btn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الحفظ...';
    try {
      const id = document.getElementById('item-id').value;
      const payload = {};
      fields.forEach(function(f) {
        const el = document.getElementById('f-' + f.name);
        if (!el) return;
        let val;
        if (f.type === 'checkbox') val = el.checked;
        else if (f.type === 'number') val = el.value ? Number(el.value) : null;
        else if (el.value === 'true' || el.value === 'false') val = el.value === 'true';
        else val = el.value.trim() || null;
        payload[f.name] = val;
      });

      // رفع الملف إن وُجد
      const uploadedPath = await uploadFileIfNeeded();
      if (uploadedPath) {
        payload.fileUrl = uploadedPath.startsWith('http') ? uploadedPath : uploadedPath;
      }

      if (id) {
        await api.put(endpoint + '/' + id, payload);
        showAlert('تم التحديث');
      } else {
        await api.post(endpoint, payload);
        showAlert('تم الإضافة');
      }
      closeForm();
      loadItems();
    } catch (err) {
      showAlert(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-save"></i> حفظ';
    }
  });

  function escapeHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return { loadItems, openForm, closeForm };
}
