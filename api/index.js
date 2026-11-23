/**
 * المرصد المغربي للدراسات والأبحاث القانونية — API — يعمل على Vercel (Serverless) + Neon (PostgreSQL) + Vercel Blob (الملفات)
 * ملف واحد يحتوي كل شيء: المصادقة، الأقسام، رفع الملفات، التحميل، الاستشارات، المساعد، الإعداد الأولي.
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { PrismaClient, Prisma } = require('@prisma/client');

const prisma = global.__prisma || new PrismaClient({ log: ['error'] });
global.__prisma = prisma;

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

/* ============================================================
 * أدوات عامة
 * ============================================================ */
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const httpError = (status, message) => Object.assign(new Error(message), { status });
const isStaff = (u) => !!u && ['admin', 'editor'].includes(u.role);
const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e || '');

function secret() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
    throw httpError(500, 'لم يتم ضبط JWT_SECRET في إعدادات Vercel (Environment Variables).');
  }
  return process.env.JWT_SECRET;
}
const signToken = (u) =>
  jwt.sign({ id: u.id, role: u.role }, secret(), { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

/* ============================================================
 * قراءة الجسم (JSON) — متوافقة مع Vercel
 * ============================================================ */
app.use((req, res, next) => {
  const ct = String(req.headers['content-type'] || '');
  if (!/json|urlencoded/i.test(ct)) return next();
  let pre;
  try {
    pre = req.body; // قد تكون Vercel قرأته مسبقاً
  } catch (e) {
    return next(httpError(400, 'صيغة البيانات المرسلة غير صحيحة'));
  }
  if (pre && typeof pre === 'object' && !Buffer.isBuffer(pre)) return next();
  if (typeof pre === 'string' && pre.length) {
    try {
      req.body = JSON.parse(pre);
    } catch (e) {
      req.body = {};
    }
    return next();
  }
  express.json({ limit: '4.4mb' })(req, res, (err) => {
    if (err) return next(httpError(400, 'صيغة البيانات المرسلة غير صحيحة أو الحجم كبير'));
    express.urlencoded({ extended: true, limit: '1mb' })(req, res, next);
  });
});

/* ============================================================
 * حماية أساسية: ترويسات أمان + تحديد عدد المحاولات
 * ============================================================ */
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  next();
});

const _hits = new Map();
/** يحدّ عدد الطلبات لكل عنوان IP في نافذة زمنية (يعمل داخل كل نسخة من الخادم) */
function limit(name, max, windowMs) {
  return (req, res, next) => {
    const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
    const key = name + ':' + ip;
    const now = Date.now();
    const arr = (_hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) {
      res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
      return next(httpError(429, 'محاولات كثيرة، يرجى الانتظار قليلاً ثم إعادة المحاولة.'));
    }
    arr.push(now);
    _hits.set(key, arr);
    if (_hits.size > 5000) for (const k of _hits.keys()) { _hits.delete(k); if (_hits.size < 2500) break; }
    next();
  };
}

/* ============================================================
 * المصادقة والصلاحيات
 * ============================================================ */
async function userFromToken(token) {
  if (!token) return null;
  try {
    const d = jwt.verify(token, secret());
    const u = await prisma.user.findUnique({
      where: { id: d.id },
      select: { id: true, fullName: true, email: true, role: true, isActive: true },
    });
    return u && u.isActive ? u : null;
  } catch (e) {
    return null;
  }
}
const bearer = (req) => {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
};

const authenticate = ah(async (req, res, next) => {
  const u = await userFromToken(bearer(req));
  if (!u) throw httpError(401, 'غير مصرح. يرجى تسجيل الدخول.');
  req.user = u;
  next();
});
const optionalAuth = ah(async (req, res, next) => {
  const t = bearer(req);
  if (t) req.user = await userFromToken(t);
  next();
});
const requireRole = (...roles) => (req, res, next) =>
  req.user && roles.includes(req.user.role)
    ? next()
    : next(httpError(403, 'ليس لديك صلاحية لتنفيذ هذا الإجراء.'));
const staffOnly = [authenticate, requireRole('admin', 'editor')];
const adminOnly = [authenticate, requireRole('admin')];

// حماية بسيطة ضد تخمين كلمات المرور (لكل نسخة تشغيل)
const fails = new Map();
function checkBlocked(key) {
  const f = fails.get(key);
  if (f && f.count >= 8 && Date.now() - f.last < 10 * 60 * 1000)
    throw httpError(429, 'محاولات كثيرة. حاول بعد عشر دقائق.');
}
function noteFail(key) {
  const f = fails.get(key) || { count: 0, last: 0 };
  fails.set(key, { count: f.count + 1, last: Date.now() });
}

const router = express.Router();

router.get('/health', (req, res) => res.json({ status: 'ok', service: 'Moroccan Observatory of Legal Studies and Research API', core: !!getCoreKey(), ai: !!process.env.AI_API_KEY, blob: !!process.env.BLOB_READ_WRITE_TOKEN }));

/* ============================================================
 * إعدادات المنصة: نص «من نحن» + بريد التواصل (قابلة للتعديل من لوحة الإدارة)
 * ============================================================ */
const SITE_NAME = 'المرصد المغربي للدراسات والأبحاث القانونية';
const DEFAULT_ABOUT_HTML = `<h4>من نحن</h4>
<p>المرصد المغربي للدراسات والأبحاث القانونية منصة رقمية تجمع في مكان واحد النصوص التشريعية والاجتهادات القضائية والكتب والأطروحات والمقالات العلمية والمحاضرات وإعلانات الندوات والمؤتمرات، مع التركيز على القانون المغربي والقانون المقارن، لتسهيل وصول الطلبة والباحثين والمهنيين إلى المراجع الموثوقة.</p>
<h4>رؤيتنا</h4>
<p>أن يكون المرصد بوابة عربية وفرنكوفونية مرجعية للمعرفة القانونية المفتوحة، تقرّب المراجع من كل من يحتاجها دون عوائق.</p>
<h4>أهدافنا</h4>
<ul>
<li>تجميع المراجع القانونية المتفرقة وتنظيمها في فهرس واضح وسهل البحث.</li>
<li>دعم طلبة الإجازة والماستر والدكتوراه بما يحتاجونه من نصوص وأبحاث ومحاضرات.</li>
<li>إبراز البحث القانوني المنشور في المستودعات الأكاديمية المفتوحة.</li>
<li>تتبّع المؤتمرات والندوات وفرص التكوين والمباريات.</li>
<li>تقديم توجيه أولي عبر المساعد الذكي وخدمة الاستشارة.</li>
</ul>
<h4>ماذا نقدّم</h4>
<ul>
<li><b>المكتبة القانونية:</b> قوانين، كتب، رسائل وأطروحات، مقالات، تقارير.</li>
<li><b>الاجتهادات:</b> قرارات وأحكام قضائية.</li>
<li><b>التكوينات:</b> محاضرات ودروس وورشات.</li>
<li><b>الإعلانات:</b> ندوات ومؤتمرات ومباريات.</li>
<li><b>المساعد الذكي والاستشارة:</b> إجابات مبنية على مصادر المنصة، وطلبات توجيه مباشرة للإدارة.</li>
</ul>
<h4>كيف نختار المراجع</h4>
<p>نعتمد على المصادر الرسمية والمستودعات الأكاديمية المفتوحة ومواقع الجامعات والمؤسسات. نحيل إلى الملف في موقعه الأصلي ولا ننسخه، وننسب كل مرجع إلى مؤلفه ومصدره. وتبقى حقوق الملكية الفكرية لأصحابها.</p>
<h4>حقوق المؤلف</h4>
<p>إن كنت صاحب مرجع وتريد تعديل بياناته أو إزالة رابطه، راسلنا عبر صفحة «تواصل معنا» وسنعالج الطلب بسرعة.</p>
<h4>تنبيه</h4>
<p>محتوى المنصة للإعلام والبحث العلمي، <b>ولا يشكل استشارة قانونية</b> ولا يغني عن محامٍ في القضايا التي تتطلب تمثيلاً قانونياً. تأكد دائماً من الصيغة المحيّنة للنصوص من الجريدة الرسمية.</p>`;

// تنظيف HTML: نسمح فقط بوسوم تنسيق بسيطة (يمنع إدخال سكربتات)
const ALLOWED_TAGS = new Set(['h4', 'p', 'ul', 'ol', 'li', 'b', 'strong', 'i', 'em', 'u', 'br', 'a', 'blockquote']);
function sanitizeHtml(input) {
  let html = String(input || '');
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  html = html.replace(/<(script|style|iframe|object|embed)[\s\S]*?<\/\1\s*>/gi, '');
  html = html.replace(/<(div|section)(\s[^>]*)?>/gi, '<p>').replace(/<\/(div|section)\s*>/gi, '</p>');
  // كل العناوين تُوحَّد في مستوى واحد حتى تتناسق أحجامها
  html = html.replace(/<h[1-6](\s[^>]*)?>/gi, '<h4>').replace(/<\/h[1-6]\s*>/gi, '</h4>');
  const out = [];
  let last = 0;
  const re = /<(\/?)([a-zA-Z0-9]+)([^>]*)>/g;
  let m;
  const text = (t) => t.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  while ((m = re.exec(html))) {
    out.push(text(html.slice(last, m.index)));
    last = re.lastIndex;
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) continue;
    if (closing) { out.push('</' + tag + '>'); continue; }
    if (tag === 'a') {
      const h = /href\s*=\s*("([^"]*)"|'([^']*)')/i.exec(m[3] || '');
      const url = h ? (h[2] || h[3] || '').trim() : '';
      out.push(/^(https?:\/\/|mailto:)/i.test(url)
        ? '<a href="' + url.replace(/"/g, '&quot;') + '" target="_blank" rel="noopener noreferrer">'
        : '<a>');
    } else out.push('<' + tag + '>');
  }
  out.push(text(html.slice(last)));
  return out.join('').trim();
}

function jsonSetting(v, dflt) {
  try { return v ? JSON.parse(v) : dflt; } catch (e) { return dflt; }
}

async function readSettings() {
  try {
    const rows = await prisma.setting.findMany({ where: { key: { notIn: ['heroImage', 'logoImage'] } } });
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  } catch (e) {
    return {}; // الجدول غير جاهز بعد: نستعمل القيم الافتراضية
  }
}

router.get(
  '/settings',
  ah(async (req, res) => {
    const st = await readSettings();
    res.set('Cache-Control', 'no-store');
    res.json({
      siteName: SITE_NAME,
      contactEmail: st.contactEmail || '',
      assistantEnabled: st.assistantEnabled !== '0',
      assistantAi: st.assistantAi === '1',
      aboutHtml: st.aboutHtml || DEFAULT_ABOUT_HTML,
      aboutIsDefault: !st.aboutHtml,
      heroVersion: st.heroVersion || '',
      logoVersion: st.logoVersion || '',
      texts: jsonSetting(st.siteTexts, {}),
      sizes: jsonSetting(st.siteSizes, {}),
      hiddenCards: jsonSetting(st.hiddenCards, []),
      customCards: jsonSetting(st.customCards, []),
      defaultAboutHtml: DEFAULT_ABOUT_HTML,
    });
  })
);

const imageRoute = (path, key) =>
  router.get(
    path,
    ah(async (req, res) => {
      let row = null;
      try { row = await prisma.setting.findUnique({ where: { key } }); } catch (e) {}
      const m = row && /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(row.value || '');
      if (!m) return res.status(404).end();
      res.set('Content-Type', m[1]);
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
      res.send(Buffer.from(m[2], 'base64'));
    })
  );
imageRoute('/hero-image', 'heroImage');
imageRoute('/site-logo', 'logoImage');

router.put(
  '/settings',
  ...adminOnly,
  ah(async (req, res) => {
    const b = req.body || {};
    const save = (key, value) =>
      prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
    if (b.contactEmail !== undefined) {
      const mail = String(b.contactEmail || '').trim().toLowerCase();
      if (mail && !emailOk(mail)) throw httpError(400, 'البريد الإلكتروني غير صحيح');
      await save('contactEmail', mail);
    }
    if (b.assistantEnabled !== undefined) await save('assistantEnabled', b.assistantEnabled ? '1' : '0');
    if (b.assistantAi !== undefined) await save('assistantAi', b.assistantAi ? '1' : '0');
    if (b.aboutHtml !== undefined) {
      const clean = sanitizeHtml(b.aboutHtml).slice(0, 60000);
      // نص فارغ = العودة إلى النص الافتراضي
      await save('aboutHtml', clean.replace(/<[^>]*>/g, '').trim() ? clean : '');
    }
    const saveImage = async (field, verKey, imgKey, maxLen) => {
      if (b[field] === undefined) return;
      if (b[field] === '') {
        await save(imgKey, '');
        await save(verKey, '');
        return;
      }
      const img = String(b[field]);
      if (img.length > maxLen || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(img))
        throw httpError(400, 'الصورة غير صالحة أو كبيرة جدًا (استعمل JPG أو PNG أو WEBP)');
      await save(imgKey, img);
      await save(verKey, String(Date.now()));
    };
    await saveImage('heroImage', 'heroVersion', 'heroImage', 3500000);
    await saveImage('logoImage', 'logoVersion', 'logoImage', 1500000);
    const KEY_RE = /^[a-z0-9_-]{1,40}$/;
    if (b.texts !== undefined) {
      const out = {};
      Object.entries(b.texts || {}).slice(0, 150).forEach(([k, v]) => {
        const t = String(v == null ? '' : v).trim().slice(0, 500);
        if (KEY_RE.test(k) && t) out[k] = t;
      });
      await save('siteTexts', JSON.stringify(out));
    }
    if (b.sizes !== undefined) {
      const out = {};
      Object.entries(b.sizes || {}).slice(0, 150).forEach(([k, v]) => {
        const n = Math.round(Number(v));
        if (KEY_RE.test(k) && n >= 50 && n <= 250 && n !== 100) out[k] = n;
      });
      await save('siteSizes', JSON.stringify(out));
    }
    if (b.hiddenCards !== undefined) {
      const arr = (Array.isArray(b.hiddenCards) ? b.hiddenCards : []).map(String).filter((k) => KEY_RE.test(k)).slice(0, 40);
      await save('hiddenCards', JSON.stringify(arr));
    }
    if (b.customCards !== undefined) {
      const arr = (Array.isArray(b.customCards) ? b.customCards : []).slice(0, 12).map((c) => ({
        title: String((c && c.title) || '').trim().slice(0, 60),
        desc: String((c && c.desc) || '').trim().slice(0, 120),
        url: String((c && c.url) || '').trim().slice(0, 300),
        icon: /^[a-z0-9-]{1,30}$/.test(String((c && c.icon) || '')) ? c.icon : 'star',
      })).filter((c) => c.title && /^https?:\/\//i.test(c.url));
      await save('customCards', JSON.stringify(arr));
    }
    const st = await readSettings();
    res.json({ ok: true, contactEmail: st.contactEmail || '', aboutHtml: st.aboutHtml || DEFAULT_ABOUT_HTML });
  })
);

router.post(
  '/auth/register',
  limit('register', 6, 60 * 60 * 1000),
  ah(async (req, res) => {
    const { fullName, email, password, phone } = req.body || {};
    const mail = String(email || '').trim().toLowerCase();
    if (!fullName || String(fullName).trim().length < 2) throw httpError(400, 'الاسم مطلوب');
    if (!emailOk(mail)) throw httpError(400, 'البريد الإلكتروني غير صحيح');
    if (!password || String(password).length < 8) throw httpError(400, 'كلمة المرور يجب ألا تقل عن 8 أحرف');
    if (await prisma.user.findUnique({ where: { email: mail } }))
      throw httpError(400, 'البريد الإلكتروني مستخدم مسبقاً');
    const user = await prisma.user.create({
      data: {
        fullName: String(fullName).trim().slice(0, 120),
        email: mail,
        passwordHash: await bcrypt.hash(String(password), 12),
        phone: phone ? String(phone).slice(0, 30) : null,
        role: 'subscriber',
      },
      select: { id: true, fullName: true, email: true, role: true },
    });
    res.status(201).json({ user, token: signToken(user) });
  })
);

router.post(
  '/auth/login',
  limit('login', 10, 15 * 60 * 1000),
  ah(async (req, res) => {
    const mail = String((req.body || {}).email || '').trim().toLowerCase();
    const password = String((req.body || {}).password || '');
    if (!mail || !password) throw httpError(400, 'البريد وكلمة المرور مطلوبان');
    const key = req.ip + '|' + mail;
    checkBlocked(key);
    const u = await prisma.user.findUnique({ where: { email: mail } });
    const ok = u && u.isActive && (await bcrypt.compare(password, u.passwordHash));
    if (!ok) {
      noteFail(key);
      throw httpError(401, 'بيانات الدخول غير صحيحة');
    }
    fails.delete(key);
    await prisma.user.update({ where: { id: u.id }, data: { lastLoginAt: new Date() } });
    res.json({
      user: { id: u.id, fullName: u.fullName, email: u.email, role: u.role },
      token: signToken(u),
    });
  })
);

router.get('/auth/me', authenticate, (req, res) => res.json(req.user));

/* ============================================================
 * أقسام المحتوى (CRUD عام)
 * ============================================================ */
const SECTIONS = {
  laws: { model: 'Law', search: ['title', 'officialNumber', 'summary'], order: { publicationDate: 'desc' } },
  jurisprudence: { model: 'Jurisprudence', search: ['decisionNumber', 'subject', 'summary', 'court'], order: { decisionDate: 'desc' } },
  books: { model: 'Book', search: ['title', 'subtitle', 'publisher'] },
  theses: { model: 'Thesis', search: ['title', 'university', 'faculty'] },
  articles: { model: 'Article', search: ['title', 'journalName', 'doi'] },
  reports: { model: 'Report', search: ['title', 'issuingBody'] },
  lectures: { model: 'Lecture', search: ['title', 'instructorName'] },
  announcements: { model: 'Announcement', search: ['title', 'organization'], publicWhere: { isPublished: true } },
  categories: { model: 'Category', search: ['nameAr', 'nameFr', 'slug'], order: { sortOrder: 'asc' }, publicWhere: { isActive: true } },
};

const MODELS = {};
Prisma.dmmf.datamodel.models.forEach((m) => {
  MODELS[m.name] = {};
  m.fields.forEach((f) => (MODELS[m.name][f.name] = f));
});
const ENUMS = {};
Prisma.dmmf.datamodel.enums.forEach((e) => (ENUMS[e.name] = e.values.map((v) => v.name)));
const hasField = (model, name) => !!MODELS[model][name];

const NEVER_SET = new Set(['id', 'createdAt', 'updatedAt', 'createdById', 'viewsCount', 'downloadsCount', 'passwordHash']);

/** تنظيف وتحويل البيانات القادمة من الواجهة إلى ما تقبله قاعدة البيانات */
function cleanData(model, body, isCreate) {
  const fields = MODELS[model];
  const out = {};
  Object.keys(body || {}).forEach((key) => {
    const f = fields[key];
    if (!f || f.kind === 'object' || NEVER_SET.has(key)) return;
    let v = body[key];
    if (f.isList) {
      if (Array.isArray(v)) out[key] = v.map(String).filter(Boolean);
      else if (typeof v === 'string') out[key] = v.split(/[,،\n]/).map((x) => x.trim()).filter(Boolean);
      return;
    }
    if (v === '' || v === undefined || v === null) {
      if (!f.isRequired) out[key] = null;
      return;
    }
    if (f.type === 'Int') {
      const n = parseInt(v, 10);
      out[key] = Number.isNaN(n) ? null : n;
    } else if (f.type === 'Float' || f.type === 'Decimal') {
      const n = parseFloat(v);
      out[key] = Number.isNaN(n) ? null : n;
    } else if (f.type === 'Boolean') {
      out[key] = v === true || v === 'true' || v === 'on' || v === 1 || v === '1';
    } else if (f.type === 'DateTime') {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) throw httpError(400, 'تاريخ غير صحيح في الحقل «' + key + '»');
      out[key] = d;
    } else {
      out[key] = String(v);
      if (f.kind === 'enum' && !ENUMS[f.type].includes(out[key]))
        throw httpError(400, 'قيمة غير مسموحة في الحقل «' + key + '»');
    }
  });
  if (isCreate) {
    Object.keys(fields).forEach((k) => {
      const f = fields[k];
      if (f.kind !== 'object' && f.isRequired && !f.hasDefaultValue && !f.isUpdatedAt && !NEVER_SET.has(k) && out[k] === undefined && !f.isList)
        throw httpError(400, 'الحقل «' + k + '» مطلوب');
    });
  }
  if (model === 'Announcement' && out.isPublished && !out.publishedAt) out.publishedAt = new Date();
  return out;
}

/** إخفاء روابط الملفات عن غير المسجلين (تظهر لهم علامة hasFile فقط) */
function shape(item, req, light) {
  const o = { ...item };
  o.hasFile = !!(o.fileUrl || o.videoUrl || o.hostedFileUrl || o.arFileUrl);
  o.hasAr = !!o.arFileUrl;
  o.hasHosted = !!o.hostedFileUrl;
  o.hasOrig = !!(o.fileUrl || o.videoUrl);
  if (light) delete o.fullText;
  if (!req.user) {
    delete o.fileUrl;
    delete o.videoUrl;
    delete o.hostedFileUrl;
    delete o.arFileUrl;
    delete o.fullText;
  }
  return o;
}

Object.keys(SECTIONS).forEach((path) => {
  const cfg = SECTIONS[path];
  const model = cfg.model;
  const delegate = () => prisma[lowerFirst(model)];
  const r = express.Router();

  r.get(
    '/',
    optionalAuth,
    ah(async (req, res) => {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
      const staff = isStaff(req.user);
      const where = {};
      if (!staff) {
        if (hasField(model, 'statusDoc')) where.statusDoc = 'published';
        if (cfg.publicWhere) Object.assign(where, cfg.publicWhere);
      } else if (req.query.status && hasField(model, 'statusDoc')) {
        where.statusDoc = String(req.query.status);
      }
      const q = String(req.query.q || '').trim().slice(0, 100);
      if (q) where.OR = cfg.search.filter((f) => hasField(model, f)).map((f) => ({ [f]: { contains: q, mode: 'insensitive' } }));
      if (req.query.categoryId && hasField(model, 'categoryId')) where.categoryId = String(req.query.categoryId);
      if (req.query.type && hasField(model, 'type')) {
        const t = String(req.query.type);
        if (ENUMS[MODELS[model].type.type] && ENUMS[MODELS[model].type.type].includes(t)) where.type = t;
      }
      const orderBy = cfg.order && hasField(model, Object.keys(cfg.order)[0])
        ? cfg.order
        : hasField(model, 'createdAt') ? { createdAt: 'desc' } : undefined;
      const [items, total] = await Promise.all([
        delegate().findMany({ where, orderBy, skip: (page - 1) * limit, take: limit }),
        delegate().count({ where }),
      ]);
      res.json({
        data: items.map((i) => shape(i, req, true)),
        meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    })
  );

  r.get(
    '/:id',
    optionalAuth,
    ah(async (req, res) => {
      const item = await delegate().findUnique({ where: { id: req.params.id } });
      if (!item) throw httpError(404, 'العنصر غير موجود');
      if (!isStaff(req.user)) {
        if (item.statusDoc && item.statusDoc !== 'published') throw httpError(404, 'العنصر غير موجود');
        if (item.isPublished === false) throw httpError(404, 'العنصر غير موجود');
      }
      res.json(shape(item, req, false));
    })
  );

  r.post(
    '/',
    ...staffOnly,
    ah(async (req, res) => {
      const data = cleanData(model, req.body, true);
      if (hasField(model, 'createdById')) data.createdById = req.user.id;
      res.status(201).json(await delegate().create({ data }));
    })
  );

  r.put(
    '/:id',
    ...staffOnly,
    ah(async (req, res) => {
      const data = cleanData(model, req.body, false);
      const body = req.body || {};
      if (hasField(model, 'linkVerified') && !('linkVerified' in body) && ['fileUrl', 'sourceUrl', 'videoUrl', 'arFileUrl'].some((k) => k in body)) data.linkVerified = false;
      res.json(await delegate().update({ where: { id: req.params.id }, data }));
    })
  );

  r.delete(
    '/:id',
    ...adminOnly,
    ah(async (req, res) => {
      await delegate().delete({ where: { id: req.params.id } });
      res.json({ message: 'تم الحذف بنجاح' });
    })
  );

  router.use('/' + path, r);
});

/* ============================================================
 * تحميل المراجع (للأعضاء المسجلين فقط)
 * ============================================================ */
router.get(
  '/files/:section/:id',
  authenticate,
  ah(async (req, res) => {
    const cfg = SECTIONS[req.params.section];
    if (!cfg) throw httpError(404, 'قسم غير معروف');
    const model = cfg.model;
    const item = await prisma[lowerFirst(model)].findUnique({ where: { id: req.params.id } });
    if (!item) throw httpError(404, 'المرجع غير موجود');
    const which = String(req.query.which || '');
    const url = which === 'ar' ? item.arFileUrl : which === 'hosted' ? item.hostedFileUrl : which === 'orig' ? (item.fileUrl || item.videoUrl) : (item.hostedFileUrl || item.fileUrl || item.videoUrl);
    if (!url) throw httpError(404, 'لا يوجد ملف مرفق بهذا المرجع بعد');
    if (hasField(model, 'downloadsCount')) {
      prisma[lowerFirst(model)].update({ where: { id: item.id }, data: { downloadsCount: { increment: 1 } } }).catch(() => {});
    }
    res.json({ url, hostedUrl: item.hostedFileUrl || null, origUrl: item.fileUrl || item.videoUrl || null, title: item.title || item.decisionNumber || '' });
  })
);

/* ============================================================
 * رفع الملفات (Vercel Blob)
 * ============================================================ */
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'];
const EXT = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'video/mp4': '.mp4', 'video/webm': '.webm' };
const NO_BLOB = 'مخزن الملفات غير مفعّل: في Vercel افتح تبويب Storage ثم أنشئ Blob وصِلْه بالمشروع، ثم أعد النشر (Redeploy).';

// ملفات صغيرة (حتى ~3 ميغابايت) تُرسل بصيغة base64 داخل JSON
router.post(
  '/upload',
  ...staffOnly,
  ah(async (req, res) => {
    if (!process.env.BLOB_READ_WRITE_TOKEN) throw httpError(500, NO_BLOB);
    const { contentType, data } = req.body || {};
    if (!ALLOWED_TYPES.includes(contentType)) throw httpError(400, 'نوع الملف غير مسموح. المسموح: PDF, JPG, PNG, WEBP, MP4');
    if (!data || typeof data !== 'string') throw httpError(400, 'لم يتم إرفاق ملف');
    const buffer = Buffer.from(data, 'base64');
    if (!buffer.length) throw httpError(400, 'الملف فارغ');
    if (buffer.length > 3.4 * 1024 * 1024) throw httpError(400, 'الملف أكبر من 3 ميغابايت لهذه الطريقة');
    const { put } = await import('@vercel/blob');
    const name = 'uploads/' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + EXT[contentType];
    const blob = await put(name, buffer, { access: 'public', contentType, addRandomSuffix: true });
    res.status(201).json({ url: blob.url, path: blob.url, size: buffer.length, mimetype: contentType });
  })
);

// ملفات كبيرة: المتصفح يرفع مباشرة إلى Blob بعد أن يمنحه الخادم تصريحاً
router.post(
  '/upload/token',
  ah(async (req, res) => {
    if (!process.env.BLOB_READ_WRITE_TOKEN) throw httpError(500, NO_BLOB);
    const { handleUpload } = await import('@vercel/blob/client');
    const json = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const u = await userFromToken(clientPayload);
        if (!isStaff(u)) throw new Error('غير مصرح بالرفع');
        return {
          allowedContentTypes: ALLOWED_TYPES,
          maximumSizeInBytes: 200 * 1024 * 1024,
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {},
    });
    res.json(json);
  })
);

/* ============================================================
 * طلبات الاستشارة
 * ============================================================ */
router.post(
  '/consultations',
  limit('consult', 8, 60 * 60 * 1000),
  ah(async (req, res) => {
    const b = req.body || {};
    if (b.website) return res.status(201).json({ ok: true }); // فخ للروبوتات
    const fullName = String(b.fullName || '').trim();
    const email = String(b.email || '').trim().toLowerCase();
    const topic = String(b.topic || '').trim();
    const body = String(b.body || '').trim();
    if (fullName.length < 2 || !emailOk(email) || !topic || body.length < 10)
      throw httpError(400, 'يرجى إكمال الاسم والبريد والمجال ونص السؤال (10 أحرف على الأقل).');
    await prisma.consultation.create({
      data: {
        fullName: fullName.slice(0, 120),
        email: email.slice(0, 160),
        phone: b.phone ? String(b.phone).slice(0, 30) : null,
        topic: topic.slice(0, 80),
        body: body.slice(0, 4000),
      },
    });
    res.status(201).json({ ok: true });
  })
);
router.get(
  '/consultations',
  ...staffOnly,
  ah(async (req, res) => {
    const data = await prisma.consultation.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
    res.json({ data, meta: { total: data.length } });
  })
);
router.put(
  '/consultations/:id',
  ...staffOnly,
  ah(async (req, res) => {
    const status = String((req.body || {}).status || '');
    if (!['new', 'in_progress', 'done'].includes(status)) throw httpError(400, 'حالة غير صحيحة');
    res.json(await prisma.consultation.update({ where: { id: req.params.id }, data: { status } }));
  })
);
router.delete(
  '/consultations/:id',
  ...adminOnly,
  ah(async (req, res) => {
    await prisma.consultation.delete({ where: { id: req.params.id } });
    res.json({ message: 'تم الحذف' });
  })
);

/* ============================================================
 * المستخدمون (للمدير)
 * ============================================================ */
const USER_SELECT = { id: true, fullName: true, email: true, role: true, phone: true, isActive: true, createdAt: true, lastLoginAt: true };
router.get(
  '/users',
  ...adminOnly,
  ah(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, parseInt(req.query.limit, 10) || 20);
    const q = String(req.query.q || '').trim();
    const where = q ? { OR: [{ fullName: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] } : {};
    const [data, total] = await Promise.all([
      prisma.user.findMany({ where, select: USER_SELECT, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      prisma.user.count({ where }),
    ]);
    res.json({ data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  })
);
router.post(
  '/users',
  ...adminOnly,
  ah(async (req, res) => {
    const b = req.body || {};
    const email = String(b.email || '').trim().toLowerCase();
    if (!b.fullName || !emailOk(email) || !b.password || String(b.password).length < 8)
      throw httpError(400, 'الاسم والبريد وكلمة مرور (8 أحرف على الأقل) مطلوبة');
    const role = ENUMS.UserRole.includes(b.role) ? b.role : 'subscriber';
    const u = await prisma.user.create({
      data: { fullName: String(b.fullName), email, passwordHash: await bcrypt.hash(String(b.password), 12), role },
      select: USER_SELECT,
    });
    res.status(201).json(u);
  })
);
router.put(
  '/users/:id',
  ...adminOnly,
  ah(async (req, res) => {
    const b = req.body || {};
    const data = {};
    if (b.fullName) data.fullName = String(b.fullName);
    if (b.phone !== undefined) data.phone = b.phone ? String(b.phone) : null;
    if (b.role) {
      if (!ENUMS.UserRole.includes(b.role)) throw httpError(400, 'دور غير صحيح');
      data.role = b.role;
    }
    if (b.isActive !== undefined) data.isActive = b.isActive === true || b.isActive === 'true';
    if (b.password) {
      if (String(b.password).length < 8) throw httpError(400, 'كلمة المرور يجب ألا تقل عن 8 أحرف');
      data.passwordHash = await bcrypt.hash(String(b.password), 12);
    }
    if (req.params.id === req.user.id && (data.role && data.role !== 'admin' || data.isActive === false))
      throw httpError(400, 'لا يمكنك تعطيل حسابك أو إزالة صلاحية الإدارة عن نفسك');
    res.json(await prisma.user.update({ where: { id: req.params.id }, data, select: USER_SELECT }));
  })
);
router.delete(
  '/users/:id',
  ...adminOnly,
  ah(async (req, res) => {
    if (req.params.id === req.user.id) throw httpError(400, 'لا يمكنك حذف حسابك');
    await prisma.user.delete({ where: { id: req.params.id } });
    res.json({ message: 'تم الحذف' });
  })
);

/** نشر كل المسودات في قسم واحد دفعة واحدة (للمدير فقط) */
router.post(
  '/admin/publish-drafts/:section',
  ...adminOnly,
  ah(async (req, res) => {
    const cfg = SECTIONS[req.params.section];
    if (!cfg || req.params.section === 'categories') throw httpError(404, 'قسم غير مدعوم');
    const delegate = prisma[lowerFirst(cfg.model)];
    let r;
    if (hasField(cfg.model, 'statusDoc')) r = await delegate.updateMany({ where: { statusDoc: 'draft' }, data: { statusDoc: 'published' } });
    else if (hasField(cfg.model, 'isPublished')) r = await delegate.updateMany({ where: { isPublished: false }, data: { isPublished: true, publishedAt: new Date() } });
    else throw httpError(400, 'هذا القسم لا يحتوي مسودات');
    res.json({ ok: true, published: r.count });
  })
);

/* ============================================================
 * فحص الروابط: يتحقق من أن روابط المراجع تعمل وأنها ليست مجرد صفحة رئيسية لموقع
 * ============================================================ */
const LINK_FIELDS = {
  laws: ['fileUrl', 'sourceUrl', 'arFileUrl'],
  jurisprudence: ['fileUrl', 'sourceUrl'],
  books: ['fileUrl'],
  theses: ['fileUrl'],
  articles: ['fileUrl'],
  reports: ['fileUrl'],
  lectures: ['fileUrl', 'videoUrl'],
  announcements: ['externalLink'],
};

function isPrivateHost(host) {
  const h = String(host || '').toLowerCase();
  return (
    !h || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') ||
    /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) ||
    h === '::1' || h.startsWith('[')
  );
}

async function probeUrl(url) {
  let u;
  try { u = new URL(url); } catch (e) { return { state: 'broken', note: 'رابط غير صالح' }; }
  if (!/^https?:$/.test(u.protocol) || isPrivateHost(u.hostname)) return { state: 'broken', note: 'رابط غير مسموح' };
  const generic = u.pathname.replace(/\/+$/, '') === '' || /^\/(index\.(html?|php)|home|ar|fr|en)\/?$/i.test(u.pathname);
  const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; ObservatoireLinkCheck/1.0)', Accept: '*/*' };
  const attempt = async (method) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    try {
      const r = await fetch(u.href, { method, headers: method === 'GET' ? { ...headers, Range: 'bytes=0-0' } : headers, redirect: 'follow', signal: ctrl.signal });
      try { r.body && r.body.cancel && r.body.cancel(); } catch (e) { /* ignore */ }
      return { status: r.status };
    } catch (e) {
      const code = (e && e.cause && e.cause.code) || '';
      if (e && e.name === 'AbortError') return { error: 'timeout' };
      if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return { error: 'dns' };
      return { error: 'unreachable' };
    } finally { clearTimeout(t); }
  };
  let r = await attempt('HEAD');
  if (r.error !== 'dns' && (r.error || [400, 401, 403, 404, 405, 501].includes(r.status))) {
    const r2 = await attempt('GET');
    if (!r2.error || !r.error) r = r2.error && r.status ? r : r2;
  }
  let state, note;
  if (r.error === 'dns') { state = 'broken'; note = 'النطاق غير موجود'; }
  else if (r.error === 'timeout') { state = 'warn'; note = 'لم يستجب الموقع للفحص الآلي (قد تحجب بعض المواقع الحكومية الفحص من خارج المغرب). افتح الرابط يدويًا، وإن كان صحيحًا وبعنوان المرجع فاضغط «✓ مؤكد»'; }
  else if (r.error) { state = 'warn'; note = 'تعذّر الاتصال بالموقع'; }
  else if (r.status === 404 || r.status === 410) { state = 'broken'; note = 'الصفحة غير موجودة (' + r.status + ')'; }
  else if (r.status >= 200 && r.status < 400) { state = 'ok'; note = ''; }
  else if ([401, 403, 429, 999].includes(r.status)) { state = 'warn'; note = 'الموقع يمنع الفحص الآلي (' + r.status + ') — افتحه يدوياً للتأكد'; }
  else { state = 'warn'; note = 'استجابة غير عادية (' + r.status + ')'; }
  if (state === 'ok' && generic) { state = 'generic'; note = 'رابط الصفحة الرئيسية للموقع وليس المرجع المباشر'; }
  return { state, note, status: r.status || null };
}

router.get(
  '/admin/check-links',
  ...staffOnly,
  ah(async (req, res) => {
    const section = String(req.query.section || '');
    const cfg = SECTIONS[section];
    const fields = LINK_FIELDS[section];
    if (!cfg || !fields) throw httpError(404, 'قسم غير مدعوم');
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const limit = Math.min(10, Math.max(1, parseInt(req.query.limit, 10) || 8));
    const delegate = prisma[lowerFirst(cfg.model)];
    const [total, items] = await Promise.all([
      delegate.count(),
      delegate.findMany({ orderBy: { id: 'asc' }, skip: offset, take: limit }),
    ]);
    const jobs = [];
    const results = [];
    items.forEach((it) => {
      if (it.linkVerified) { results.push({ id: it.id, section, field: fields[0], url: it[fields[0]] || '', title: it.title || it.subject || it.decisionNumber || '—', isDraft: false, state: 'verified', note: 'أكّدتَ هذا الرابط يدويًا' }); return; }
      fields.forEach((f) => {
        const url = it[f] && String(it[f]).trim();
        if (url && /^https?:\/\//i.test(url)) jobs.push({ it, f, url });
      });
    });
    let next = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const j = jobs[next++];
        const p = await probeUrl(j.url);
        const draft = it => (it.statusDoc ? it.statusDoc !== 'published' : it.isPublished === false);
        results.push({ id: j.it.id, section, field: j.f, url: j.url, title: j.it.title || j.it.subject || j.it.decisionNumber || '—', isDraft: draft(j.it), ...p });
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, jobs.length) }, worker));
    res.json({ total, offset, checked: items.length, nextOffset: offset + items.length < total ? offset + items.length : null, results });
  })
);

/* ============================================================
 * اقتراح رابط بديل والتحقق من وجود المرجع على الإنترنت
 * إضافة مستقلة: لا تعدّل أي بيانات، تقترح فقط، والاعتماد بيد المشرف.
 * ============================================================ */
function normTitle(s) {
  return String(s || '').toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}
function titleTokens(s) { return normTitle(s).split(' ').filter((w) => w.length >= 3); }
function titleSimilarity(a, b) {
  const A = new Set(titleTokens(a)), B = new Set(titleTokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach((w) => { if (B.has(w)) inter++; });
  return (2 * inter) / (A.size + B.size);
}
async function fetchJsonSafe(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 6000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'ObservatoireLinkCheck/1.0', Accept: 'application/json' }, signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; } finally { clearTimeout(t); }
}
const ALT_SOURCES = {
  Crossref: async (q) => {
    const j = await fetchJsonSafe('https://api.crossref.org/works?rows=5&select=title,URL,DOI,abstract,issued&query.bibliographic=' + q);
    return ((j && j.message && j.message.items) || []).map((it) => ({ title: (it.title || [])[0] || '', url: it.URL || '', doi: it.DOI || '', abstract: stripHtml(it.abstract), year: it.issued && it.issued['date-parts'] && it.issued['date-parts'][0] && it.issued['date-parts'][0][0] }));
  },
  OpenAlex: async (q) => {
    const j = await fetchJsonSafe('https://api.openalex.org/works?per-page=5&select=title,doi,publication_year,open_access,best_oa_location,abstract_inverted_index&search=' + q);
    return ((j && j.results) || []).map((w) => ({
      title: w.title || '',
      url: (w.open_access && w.open_access.oa_url) || w.doi || '',
      pdf: (w.best_oa_location && w.best_oa_location.pdf_url) || '',
      doi: bareDoi(w.doi), abstract: oaAbstractText(w.abstract_inverted_index), year: w.publication_year,
    }));
  },
  Zenodo: async (q) => {
    const j = await fetchJsonSafe('https://zenodo.org/api/records?size=5&q=' + q);
    return ((j && j.hits && j.hits.hits) || []).map((h) => {
      const files = Array.isArray(h.files) ? h.files : [];
      const f = files.find((x) => /\.pdf$/i.test(x.key || x.filename || ''));
      return {
        title: (h.metadata && h.metadata.title) || '',
        url: (h.links && (h.links.self_html || h.links.html)) || ('https://zenodo.org/records/' + h.id),
        pdf: f ? 'https://zenodo.org/records/' + h.id + '/files/' + encodeURIComponent(f.key || f.filename) + '?download=1' : '',
        doi: h.doi || (h.metadata && h.metadata.doi) || '', abstract: stripHtml(h.metadata && h.metadata.description),
        year: h.metadata && h.metadata.publication_date ? Number(String(h.metadata.publication_date).slice(0, 4)) : null,
      };
    });
  },
  HAL: async (q) => {
    const j = await fetchJsonSafe('https://api.archives-ouvertes.fr/search/?wt=json&rows=5&fl=title_s,uri_s,fileMain_s,doiId_s,abstract_s,producedDateY_i&q=' + q);
    return ((j && j.response && j.response.docs) || []).map((d) => ({ title: [].concat(d.title_s || [''])[0], url: d.uri_s || '', pdf: d.fileMain_s || '', doi: d.doiId_s || '', abstract: stripHtml([].concat(d.abstract_s || [''])[0]), year: d.producedDateY_i }));
  },
  CORE: async (q) => {
    if (!getCoreKey()) return [];
    try {
      const w = await coreSearch(decodeURIComponent(q), 5);
      return w.map((x) => ({ title: x.title || '', url: (x.sourceFulltextUrls || [])[0] || x.downloadUrl || '', pdf: x.downloadUrl || '', doi: x.doi || '', abstract: stripHtml(x.abstract), year: x.yearPublished }));
    } catch (e) { return []; }
  },
  DOAJ: async (q) => {
    const j = await fetchJsonSafe('https://doaj.org/api/search/articles/' + q + '?pageSize=5');
    return ((j && j.results) || []).map((r) => {
      const b = r.bibjson || {};
      const ft = (b.link || []).find((l) => l.type === 'fulltext');
      const doi = ((b.identifier || []).find((x) => x.type === 'doi') || {}).id || '';
      return { title: b.title || '', url: (ft && ft.url) || '', doi, abstract: stripHtml(b.abstract), year: b.year ? Number(b.year) : null };
    });
  },
};

/** يقرأ مفتاح CORE من متغيرات البيئة بتسامح مع اختلاف حالة الأحرف أو المسافات الزائدة في الاسم/القيمة */
function getCoreKey() {
  const names = Object.keys(process.env);
  const name = names.find((k) => k.trim().toUpperCase() === 'CORE_API_KEY') || names.find((k) => /^core[_\s-]*(api)?[_\s-]*(key|token)$/i.test(k.trim()));
  return name ? String(process.env[name] || '').trim().replace(/^["']|["']$/g, '') : '';
}
function coreHint() {
  const similar = Object.keys(process.env).filter((k) => /core/i.test(k));
  return similar.length ? ' (وُجدت متغيرات باسم: ' + similar.join('، ') + ' — تأكد أن الاسم بالضبط CORE_API_KEY وأن القيمة غير فارغة)' : ' (لم يُعثر على أي متغير اسمه CORE_API_KEY في هذا النشر — تأكد من اسم المتغير ومن تفعيل Production ثم أعد النشر)';
}

/* ============================================================
 * CORE: أكبر مجمّع لمستودعات الجامعات المفتوحة (يشمل مستودعات عربية)
 * يحتاج مفتاحاً مجانياً: متغير البيئة CORE_API_KEY (من https://core.ac.uk/services/api)
 * ============================================================ */
const CORE_NO_KEY = 'مصدر CORE غير مفعّل: سجّل مجاناً في https://core.ac.uk/services/api للحصول على مفتاح، ثم أضفه في Vercel باسم CORE_API_KEY (Settings ← Environment Variables) وأعد النشر.';
async function coreSearch(q, n) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch('https://api.core.ac.uk/v3/search/works?limit=' + n + '&q=' + encodeURIComponent(q), {
      headers: { Authorization: 'Bearer ' + getCoreKey(), Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!r.ok) throw httpError(502, 'CORE رجع الخطأ ' + r.status + (r.status === 401 ? ' (المفتاح غير صالح)' : r.status === 429 ? ' (تجاوزتَ الحد المسموح، انتظر قليلاً)' : ''));
    return (await r.json()).results || [];
  } catch (e) {
    if (e.status) throw e;
    throw httpError(502, 'تعذّر الاتصال بـ CORE');
  } finally { clearTimeout(t); }
}

router.get(
  '/admin/core-search',
  ...staffOnly,
  ah(async (req, res) => {
    if (!getCoreKey()) throw httpError(400, CORE_NO_KEY + coreHint());
    const q = String(req.query.q || '').trim().slice(0, 200);
    if (q.length < 2) throw httpError(400, 'اكتب كلمات البحث');
    const n = Math.min(100, Math.max(10, parseInt(req.query.n, 10) || 50));
    const sec = String(req.query.sec || '');
    const lang = String(req.query.lang || '').toLowerCase();
    const works = await coreSearch(q, n);
    const rows = [];
    works.forEach((w) => {
      const url = w.downloadUrl || (w.sourceFulltextUrls || [])[0] || '';
      if (!/^https?:\/\//i.test(url) || !w.title) return;
      const wl = String((w.language && w.language.code) || '').toLowerCase();
      if (lang && wl && wl !== lang) return;
      const types = [].concat(w.documentType || [], w.documentTypes || []).map((x) => String(x).toLowerCase());
      if (types.length) {
        const isThesis = types.some((x) => /thesis|dissertation/.test(x));
        const isBook = types.some((x) => /book/.test(x));
        if (sec === 'theses' && !isThesis) return;
        if (sec === 'books' && !isBook) return;
        if (sec === 'articles' && (isThesis || isBook)) return;
      }
      rows.push({
        title: String(w.title),
        year: w.yearPublished || '',
        lang: wl,
        authors: (w.authors || []).slice(0, 3).map((x) => x.name).filter(Boolean).join('، '),
        venue: ((w.journals && w.journals[0] && w.journals[0].title) || w.publisher || 'CORE'),
        url,
        license: '',
        doi: w.doi || '',
        abstract: w.abstract || '',
      });
    });
    res.json(rows);
  })
);

router.get(
  '/admin/suggest-link',
  ...staffOnly,
  ah(async (req, res) => {
    const section = String(req.query.section || '');
    const cfg = SECTIONS[section];
    if (!cfg || !LINK_FIELDS[section]) throw httpError(404, 'قسم غير مدعوم');
    const item = await prisma[lowerFirst(cfg.model)].findUnique({ where: { id: String(req.query.id || '') } });
    if (!item) throw httpError(404, 'المرجع غير موجود');
    const title = String(item.title || item.subject || '').trim();
    if (title.length < 6) return res.json({ verdict: 'no_title', candidates: [], archive: null });
    const q = encodeURIComponent(title.slice(0, 200));

    // أرشيف الإنترنت: نسخة محفوظة من الرابط المعطوب نفسه (إن وُجدت)
    let oldUrl = String(req.query.url || '');
    try { const u = new URL(oldUrl); if (!/^https?:$/.test(u.protocol)) oldUrl = ''; } catch (e) { oldUrl = ''; }
    const archiveP = oldUrl
      ? fetchJsonSafe('https://archive.org/wayback/available?url=' + encodeURIComponent(oldUrl), 6000)
      : Promise.resolve(null);

    const names = Object.keys(ALT_SOURCES);
    const lists = await Promise.all(names.map((n) => ALT_SOURCES[n](q).then((l) => l.map((x) => ({ ...x, source: n }))).catch(() => [])));
    const seen = new Set();
    let cands = lists.flat()
      .filter((c) => c.url && /^https?:\/\//i.test(c.url) && c.title)
      .map((c) => ({ ...c, score: Math.round(titleSimilarity(title, c.title) * 100) }))
      .filter((c) => c.score >= 50)
      .sort((a, b) => b.score - a.score)
      .filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)))
      .slice(0, 4);

    // نتأكد أن الرابط المقترح نفسه يعمل قبل عرضه
    const probes = await Promise.all(cands.map((c) => probeUrl(c.url).catch(() => ({ state: 'warn', note: '' }))));
    cands = cands.map((c, i) => ({ ...c, state: probes[i].state, note: probes[i].note })).filter((c) => c.state !== 'broken');

    const ar = await archiveP;
    const snap = ar && ar.archived_snapshots && ar.archived_snapshots.closest;
    const archive = snap && snap.available && snap.url ? String(snap.url).replace(/^http:\/\//i, 'https://') : null;

    const best = cands.length ? cands[0].score : 0;
    const verdict = best >= 80 ? 'confirmed' : best >= 50 ? 'possible' : 'not_found';
    res.json({ verdict, candidates: cands, archive });
  })
);

/* ============================================================
 * استيراد جماعي (من ملف Excel يقرؤه المتصفح)
 * ============================================================ */
const IMPORT_DEFAULTS = {
  theses: { degree: 'master', university: 'غير محدد' },
  jurisprudence: { court: 'غير محدد', decisionNumber: 'غير محدد' },
  lectures: { type: 'lecture' },
  announcements: { type: 'other' },
};
router.post(
  '/import/:section',
  ...staffOnly,
  ah(async (req, res) => {
    const cfg = SECTIONS[req.params.section];
    if (!cfg || req.params.section === 'categories') throw httpError(404, 'قسم غير مدعوم للاستيراد');
    const model = cfg.model;
    const delegate = prisma[lowerFirst(model)];
    const rows = Array.isArray((req.body || {}).rows) ? req.body.rows : [];
    if (!rows.length) throw httpError(400, 'لا توجد صفوف للاستيراد');
    if (rows.length > 150) throw httpError(400, 'الحد الأقصى 150 صفاً في كل دفعة');
    const skipDup = (req.body || {}).skipDuplicates !== false;
    const out = { created: 0, skipped: 0, badLinks: 0, failed: [] };
    for (let i = 0; i < rows.length; i++) {
      const raw = { ...(rows[i] || {}) };
      const n = raw.__row || i + 1;
      delete raw.__row;
      try {
        if (raw.fileUrl && !/^https?:\/\//i.test(String(raw.fileUrl).trim())) { delete raw.fileUrl; out.badLinks++; }
        const data = cleanData(model, { ...(IMPORT_DEFAULTS[req.params.section] || {}), ...Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== '' && v != null)) }, true);
        if (hasField(model, 'createdById')) data.createdById = req.user.id;
        if (skipDup) {
          const key = req.params.section === 'jurisprudence'
            ? { decisionNumber: data.decisionNumber, court: data.court, subject: data.subject || null }
            : { title: data.title };
          if (await delegate.findFirst({ where: key, select: { id: true } })) { out.skipped++; continue; }
          if (data.fileUrl && (await delegate.findFirst({ where: { fileUrl: data.fileUrl }, select: { id: true } }))) { out.skipped++; continue; }
        }
        await delegate.create({ data });
        out.created++;
      } catch (e) {
        out.failed.push({ row: n, error: e.message ? e.message.split('\n').slice(-1)[0].slice(0, 160) : 'خطأ' });
      }
    }
    res.json(out);
  })
);

/* ============================================================
 * نقل مرجع من قسم إلى آخر (للمدير فقط)
 * نحوّل الحقول المشتركة (العنوان، الملخص، الجهة، السنة، DOI، الروابط، اللغة، التصنيف)
 * ============================================================ */
const yearOf = (d) => (d ? new Date(d).getUTCFullYear() : null);
const jan1 = (y) => (y ? new Date(Date.UTC(y, 0, 1)) : null);
const MOVE_MAP = {
  laws: {
    read: (i) => ({ title: i.title, text: i.summary, org: '', year: yearOf(i.publicationDate), doi: null, fileUrl: i.fileUrl, url2: i.sourceUrl, lang: i.language, keywords: [] }),
    write: (c) => ({ title: c.title, summary: c.text, fileUrl: c.fileUrl, sourceUrl: c.url2, language: c.lang || 'ar', publicationDate: jan1(c.year) }),
  },
  jurisprudence: {
    read: (i) => ({ title: i.subject || i.decisionNumber, text: i.summary, org: i.court, year: yearOf(i.decisionDate), doi: null, fileUrl: i.fileUrl, url2: i.sourceUrl, lang: i.language, keywords: i.keywords || [] }),
    write: (c) => ({ decisionNumber: String(c.title).slice(0, 190), subject: String(c.title).slice(0, 480), court: c.org || 'غير محدد', summary: c.text, keywords: c.keywords || [], fileUrl: c.fileUrl, sourceUrl: c.url2, language: c.lang || 'ar', decisionDate: jan1(c.year) }),
  },
  books: {
    read: (i) => ({ title: i.title, text: i.description, org: i.publisher, year: i.publicationYear, doi: i.doi, fileUrl: i.fileUrl, url2: null, lang: i.language, keywords: [] }),
    write: (c) => ({ title: c.title, description: c.text, publisher: c.org, publicationYear: c.year, doi: c.doi, fileUrl: c.fileUrl || c.url2, language: c.lang || 'ar' }),
  },
  theses: {
    read: (i) => ({ title: i.title, text: i.abstract, org: i.university, year: i.defenseYear, doi: i.doi, fileUrl: i.fileUrl, url2: null, lang: i.language, keywords: i.keywords || [] }),
    write: (c) => ({ title: c.title, abstract: c.text, university: c.org || 'غير محدد', defenseYear: c.year, degree: 'phd', keywords: c.keywords || [], doi: c.doi, fileUrl: c.fileUrl || c.url2, language: c.lang || 'ar' }),
  },
  articles: {
    read: (i) => ({ title: i.title, text: i.abstract, org: i.journalName, year: i.publicationYear, doi: i.doi, fileUrl: i.fileUrl, url2: null, lang: i.language, keywords: i.keywords || [] }),
    write: (c) => ({ title: c.title, abstract: c.text, journalName: c.org, publicationYear: c.year, keywords: c.keywords || [], doi: c.doi, fileUrl: c.fileUrl || c.url2, isOpenAccess: true, language: c.lang || 'ar' }),
  },
  reports: {
    read: (i) => ({ title: i.title, text: i.description, org: i.issuingBody, year: yearOf(i.publicationDate), doi: i.doi, fileUrl: i.fileUrl, url2: null, lang: i.language, keywords: [] }),
    write: (c) => ({ title: c.title, description: c.text, issuingBody: c.org, publicationDate: jan1(c.year), doi: c.doi, fileUrl: c.fileUrl || c.url2, language: c.lang || 'ar' }),
  },
  lectures: {
    read: (i) => ({ title: i.title, text: i.description, org: i.instructorName, year: null, doi: i.doi, fileUrl: i.fileUrl, url2: i.videoUrl, lang: 'ar', keywords: [] }),
    write: (c) => ({ title: c.title, description: c.text, instructorName: c.org, type: 'lecture', doi: c.doi, fileUrl: c.fileUrl, videoUrl: c.url2 }),
  },
};

router.post(
  '/admin/move',
  ...adminOnly,
  ah(async (req, res) => {
    const { from, to, id } = req.body || {};
    if (!MOVE_MAP[from] || !MOVE_MAP[to] || from === to) throw httpError(400, 'قسم غير صالح');
    const src = SECTIONS[from], dst = SECTIONS[to];
    const srcDel = prisma[lowerFirst(src.model)], dstDel = prisma[lowerFirst(dst.model)];
    const item = await srcDel.findUnique({ where: { id: String(id || '') } });
    if (!item) throw httpError(404, 'المرجع غير موجود');
    const common = MOVE_MAP[from].read(item);
    const data = cleanData(dst.model, { ...MOVE_MAP[to].write(common), categoryId: item.categoryId || null, statusDoc: item.statusDoc || 'draft' }, true);
    if (hasField(dst.model, 'createdById') && item.createdById) data.createdById = item.createdById;
    if (hasField(dst.model, 'viewsCount') && item.viewsCount) data.viewsCount = item.viewsCount;
    const created = await prisma.$transaction(async (tx) => {
      const c = await tx[lowerFirst(dst.model)].create({ data });
      await tx[lowerFirst(src.model)].delete({ where: { id: item.id } });
      return c;
    });
    res.json({ ok: true, id: created.id, to });
  })
);

/* ============================================================
 * ملخص عربي موجز للمراجع المستوردة (يعتمد فقط على ملخص المصدر، ولا يخترع محتوى)
 * يستعمل مفتاح AI_API_KEY نفسه؛ وإن لم يتوفر يُرجع ملخص المصدر كما هو
 * ============================================================ */
const stripHtml = (t) => String(t || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

router.post(
  '/admin/summarize',
  limit('summarize', 40, 60 * 60 * 1000),
  ...staffOnly,
  ah(async (req, res) => {
    const items = (Array.isArray((req.body || {}).items) ? req.body.items : []).slice(0, 6);
    const base = (process.env.AI_BASE_URL || 'https://api.x.ai/v1').replace(/\/$/, '');
    const summaries = await Promise.all(items.map(async (it) => {
      const title = stripHtml(it.title).slice(0, 300);
      const abs = stripHtml(it.abstract).slice(0, 2500);
      if (abs.length < 40) return { summary: '', ai: false };
      const fallback = { summary: abs.length > 900 ? abs.slice(0, 900).replace(/\s+\S*$/, '') + '…' : abs, ai: false };
      if (!process.env.AI_API_KEY) return fallback;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20000);
      try {
        const r = await fetch(base + '/chat/completions', {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.AI_API_KEY },
          body: JSON.stringify({
            model: process.env.AI_MODEL || 'grok-3',
            temperature: 0.1,
            messages: [
              { role: 'system', content: 'أنت محرر علمي. لخّص المرجع بالعربية الفصحى في 2 إلى 3 جمل (نحو 50 إلى 90 كلمة) اعتماداً على العنوان والملخص المرفقين فقط. لا تضف أي معلومة أو رقم أو اسم غير وارد فيهما. اكتب الملخص وحده دون مقدمات أو عناوين.' },
              { role: 'user', content: 'العنوان: ' + title + '\nالملخص الأصلي: ' + abs },
            ],
          }),
        });
        const j = await r.json().catch(() => ({}));
        const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
        const clean = stripHtml(text).slice(0, 1200);
        return r.ok && clean.length > 30 ? { summary: clean, ai: true } : fallback;
      } catch (e) {
        return fallback;
      } finally { clearTimeout(t); }
    }));
    res.json({ summaries, aiEnabled: !!process.env.AI_API_KEY });
  })
);

/* ============================================================
 * إكمال بيانات المراجع القديمة: بحث عن DOI وملخص بحسب العنوان (يُراجَع قبل الحفظ)
 * ============================================================ */
const ENRICH_ABS = { books: 'description', theses: 'abstract', articles: 'abstract', reports: 'description', lectures: 'description' };
function oaAbstractText(ix) {
  if (!ix) return '';
  const w = [];
  Object.keys(ix).forEach((k) => ix[k].forEach((pos) => { w[pos] = k; }));
  return w.join(' ');
}
const bareDoi = (d) => String(d || '').replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').trim();

router.post(
  '/admin/enrich-lookup',
  limit('enrich', 600, 60 * 60 * 1000),
  ...staffOnly,
  ah(async (req, res) => {
    const section = String((req.body || {}).section || '');
    const absKey = ENRICH_ABS[section];
    if (!absKey) throw httpError(400, 'قسم غير مدعوم');
    const item = await prisma[lowerFirst(SECTIONS[section].model)].findUnique({ where: { id: String((req.body || {}).id || '') } });
    if (!item) throw httpError(404, 'المرجع غير موجود');
    const title = String(item.title || '').replace(/\s+/g, ' ').trim();
    if (title.length < 8) return res.json({ found: false, reason: 'العنوان قصير جداً للبحث' });
    const year = item.publicationYear || item.defenseYear || (item.publicationDate ? new Date(item.publicationDate).getUTCFullYear() : null);
    const q = encodeURIComponent(title.slice(0, 250));
    const [oa, cr, hal] = await Promise.all([
      fetchJsonSafe('https://api.openalex.org/works?per-page=5&select=title,doi,publication_year,abstract_inverted_index&search=' + q, 7000),
      fetchJsonSafe('https://api.crossref.org/works?rows=5&select=title,DOI,abstract,issued&query.bibliographic=' + q, 7000),
      fetchJsonSafe('https://api.archives-ouvertes.fr/search/?q=' + q + '&fl=title_s,doiId_s,abstract_s,producedDateY_i&rows=5&wt=json', 7000),
    ]);
    const cands = [];
    ((oa && oa.results) || []).forEach((w) => cands.push({ src: 'OpenAlex', title: w.title || '', doi: bareDoi(w.doi), year: w.publication_year, abstract: oaAbstractText(w.abstract_inverted_index) }));
    ((cr && cr.message && cr.message.items) || []).forEach((w) => cands.push({ src: 'Crossref', title: (w.title || [])[0] || '', doi: w.DOI || '', year: w.issued && w.issued['date-parts'] && w.issued['date-parts'][0] && w.issued['date-parts'][0][0], abstract: stripHtml(w.abstract) }));
    ((hal && hal.response && hal.response.docs) || []).forEach((w) => cands.push({ src: 'HAL', title: [].concat(w.title_s || [''])[0], doi: w.doiId_s || '', year: w.producedDateY_i, abstract: stripHtml([].concat(w.abstract_s || [''])[0]) }));
    cands.forEach((c) => {
      c.score = titleSimilarity(title, c.title);
      if (year && c.year && Math.abs(Number(c.year) - Number(year)) > 2) c.score -= 0.25;
    });
    const good = cands.filter((c) => c.score >= 0.7).sort((x, y) => y.score - x.score);
    if (!good.length) return res.json({ found: false, reason: 'لم يُعثر على مرجع مطابق للعنوان' });
    const withDoi = good.find((c) => c.doi);
    const withAbs = good.find((c) => c.abstract && c.abstract.length >= 40);
    const best = good[0];
    res.json({
      found: true,
      matchedTitle: best.title,
      score: Math.round(best.score * 100),
      source: best.src,
      doi: withDoi ? withDoi.doi : '',
      abstract: withAbs ? withAbs.abstract.slice(0, 2500) : '',
      hasDoi: !!item.doi,
      hasAbstract: !!String(item[absKey] || '').trim(),
    });
  })
);

/* ============================================================
 * نسخة PDF مستضافة في المنصة (Vercel Blob): تُنزَّل للمراجعة أولاً، ولا تُربط بالمرجع إلا بعد اعتماد المدير
 * ============================================================ */
router.post(
  '/admin/cache-file',
  limit('cachefile', 60, 60 * 60 * 1000),
  ...staffOnly,
  ah(async (req, res) => {
    if (!process.env.BLOB_READ_WRITE_TOKEN) throw httpError(500, NO_BLOB);
    const raw = String((req.body || {}).url || '').trim();
    let u;
    try { u = new URL(raw); } catch (e) { throw httpError(400, 'رابط غير صالح'); }
    if (!/^https?:$/.test(u.protocol) || isPrivateHost(u.hostname)) throw httpError(400, 'رابط غير مسموح');
    const MAX = 25 * 1024 * 1024;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    let buf;
    try {
      const r = await fetch(u.href, { redirect: 'follow', signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ObservatoireFetch/1.0)', Accept: 'application/pdf,*/*' } });
      if (!r.ok) throw httpError(502, 'تعذّر تنزيل الملف (استجابة ' + r.status + ')');
      const len = Number(r.headers.get('content-length') || 0);
      if (len > MAX) throw httpError(413, 'الملف أكبر من 25 ميغابايت');
      const chunks = [];
      let size = 0;
      for await (const c of r.body) {
        size += c.length;
        if (size > MAX) throw httpError(413, 'الملف أكبر من 25 ميغابايت');
        chunks.push(Buffer.from(c));
      }
      buf = Buffer.concat(chunks);
    } catch (e) {
      if (e.status) throw e;
      throw httpError(502, e && e.name === 'AbortError' ? 'انتهت مهلة تنزيل الملف' : 'تعذّر تنزيل الملف من هذا الرابط');
    } finally { clearTimeout(t); }
    if (buf.slice(0, 5).toString('latin1') !== '%PDF-') throw httpError(422, 'هذا الرابط لا يحيل إلى ملف PDF مباشر (قد يكون صفحة ويب).');
    const { put } = await import('@vercel/blob');
    const name = 'hosted/' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.pdf';
    const blob = await put(name, buf, { access: 'public', contentType: 'application/pdf', addRandomSuffix: true });
    res.json({ url: blob.url, size: buf.length });
  })
);

router.post(
  '/admin/discard-file',
  ...staffOnly,
  ah(async (req, res) => {
    const url = String((req.body || {}).url || '');
    if (!/^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i.test(url) || !process.env.BLOB_READ_WRITE_TOKEN) return res.json({ ok: true });
    try { const { del } = await import('@vercel/blob'); await del(url); } catch (e) { /* ignore */ }
    res.json({ ok: true });
  })
);

/* ============================================================
 * كشف المراجع المكررة (عنوان متطابق بعد التطبيع أو رابط ملف واحد)
 * ============================================================ */
router.get(
  '/admin/duplicates',
  ...staffOnly,
  ah(async (req, res) => {
    const section = String(req.query.section || '');
    const cfg = SECTIONS[section];
    if (!cfg || !LINK_FIELDS[section] || section === 'announcements') throw httpError(404, 'قسم غير مدعوم');
    const tKey = section === 'jurisprudence' ? 'subject' : 'title';
    const items = await prisma[lowerFirst(cfg.model)].findMany({ take: 3000, orderBy: { id: 'asc' } });
    const parent = new Map();
    const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    const union = (x, y) => { const rx = find(x), ry = find(y); if (rx !== ry) parent.set(rx, ry); };
    items.forEach((it) => parent.set(it.id, it.id));
    const byKey = new Map();
    items.forEach((it) => {
      const keys = [];
      const t = normTitle(it[tKey] || it.decisionNumber || '');
      if (t.length >= 6) keys.push('t:' + t + (section === 'jurisprudence' ? '|' + normTitle(it.court || '') + '|' + (it.decisionNumber || '') : ''));
      if (it.fileUrl) keys.push('u:' + String(it.fileUrl).trim());
      keys.forEach((k) => { if (byKey.has(k)) union(it.id, byKey.get(k)); else byKey.set(k, it.id); });
    });
    const groups = new Map();
    items.forEach((it) => { const r = find(it.id); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(it); });
    const out = [];
    groups.forEach((list) => {
      if (list.length < 2) return;
      out.push({ items: list.map((it) => ({ id: it.id, title: it[tKey] || it.decisionNumber || '—', fileUrl: it.fileUrl || '', statusDoc: it.statusDoc || (it.isPublished === false ? 'draft' : 'published'), hasSummary: !!String(it.summary || it.description || it.abstract || '').trim(), createdAt: it.createdAt || null })) });
    });
    res.json({ total: items.length, groups: out.slice(0, 200) });
  })
);

/* ============================================================
 * إحصاءات لوحة التحكم
 * ============================================================ */
router.get(
  '/stats',
  ...staffOnly,
  ah(async (req, res) => {
    const [laws, jurisprudence, books, theses, articles, reports, lectures, announcements, users, consultations] = await Promise.all([
      prisma.law.count(), prisma.jurisprudence.count(), prisma.book.count(), prisma.thesis.count(),
      prisma.article.count(), prisma.report.count(), prisma.lecture.count(), prisma.announcement.count(),
      prisma.user.count(), prisma.consultation.count({ where: { status: 'new' } }),
    ]);
    res.json({ laws, jurisprudence, books, theses, articles, reports, lectures, announcements, users, newConsultations: consultations });
  })
);

/* ============================================================
 * المساعد: بحث ذكي في مراجع المنصة. العناوين والروابط تأتي من قاعدة البيانات وحدها،
 * فلا يستطيع النموذج اختلاق أي مرجع. والذكاء الاصطناعي (اختياري) يكتب فقرة تعريفية قصيرة فقط.
 * ============================================================ */
const AR_STOP = new Set('ما ماذا هو هي هل كيف متى أين اين من في على عن إلى الى التي الذي هذا هذه ذلك تلك أريد اريد أبحث ابحث حول بشأن لدي عندي يمكن يمكنني كل بعض مع أو او ثم قد لا لم لن كان يكون أي اي فيما بين لماذا هناك ريد معلومات مراجع موضوع'.split(' '));
const arNorm = (s) => String(s || '').replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[إأآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').toLowerCase();
const ASSIST_SECS = { laws: 'summary', jurisprudence: 'summary', books: 'description', theses: 'abstract', articles: 'abstract', reports: 'description', lectures: 'description' };
const ASSIST_TITLE = { jurisprudence: ['subject', 'decisionNumber', 'court'] };

function assistTerms(q) {
  const clean = String(q || '').replace(/[\u064B-\u065F\u0670\u0640]/g, '');
  const words = Array.from(new Set(clean.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !AR_STOP.has(w)))).slice(0, 6);
  const variants = new Set();
  words.forEach((w) => {
    const bases = [w];
    if (w.startsWith('ال') && w.length > 4) bases.push(w.slice(2));
    bases.forEach((b) => {
      variants.add(b);
      const k = b.search(/[اأإ]/);
      if (k !== -1) ['ا', 'أ', 'إ'].forEach((c) => variants.add(b.slice(0, k) + c + b.slice(k + 1)));
    });
  });
  return { words, variants: Array.from(variants).slice(0, 24) };
}

router.post(
  '/assistant/ask',
  limit('assistant', 40, 60 * 60 * 1000),
  optionalAuth,
  ah(async (req, res) => {
    const question = String((req.body || {}).question || '').trim().slice(0, 500);
    if (question.length < 3) throw httpError(400, 'اكتب سؤالك بوضوح');
    const st = await readSettings();
    if (st.assistantEnabled === '0') return res.json({ answer: 'المساعد متوقف حالياً. يمكنك تصفح المكتبة القانونية والاجتهادات مباشرة.', results: [] });

    const { words, variants } = assistTerms(question);
    if (!words.length) return res.json({ answer: 'اكتب موضوعك بكلمات محددة، مثل اسم قانون أو موضوع (التقادم، الكراء، المسؤولية المدنية...).', results: [] });
    const nWords = words.map(arNorm);

    const found = [];
    await Promise.all(Object.keys(ASSIST_SECS).map(async (sec) => {
      const model = SECTIONS[sec].model;
      const absKey = ASSIST_SECS[sec];
      const titleKeys = ASSIST_TITLE[sec] || ['title'];
      const fields = Array.from(new Set([...(SECTIONS[sec].search || []), ...titleKeys, absKey])).filter((f) => hasField(model, f) && MODELS[model][f].type === 'String' && !MODELS[model][f].isList);
      const where = { OR: variants.flatMap((v) => fields.map((f) => ({ [f]: { contains: v, mode: 'insensitive' } }))) };
      if (hasField(model, 'statusDoc')) where.statusDoc = 'published';
      let rows = [];
      try { rows = await prisma[lowerFirst(model)].findMany({ where, take: 25 }); } catch (e) { rows = []; }
      rows.forEach((it) => {
        const title = arNorm(titleKeys.map((k) => it[k]).filter(Boolean).join(' '));
        const body = arNorm([it[absKey], (it.keywords || []).join(' '), it.journalName, it.university, it.publisher, it.court].filter(Boolean).join(' '));
        let score = 0, matched = 0;
        nWords.forEach((w) => {
          const stem = w.startsWith('ال') && w.length > 4 ? w.slice(2) : w;
          if (title.includes(stem)) { score += 3; matched++; } else if (body.includes(stem)) { score += 1; matched++; }
        });
        if (matched >= (words.length >= 3 ? 2 : 1)) found.push({ sec, it, score });
      });
    }));
    found.sort((x, y) => y.score - x.score);
    const top = found.slice(0, 8);
    const results = top.map((r) => ({ sec: r.sec, item: shape(r.it, req, true) }));

    if (!results.length)
      return res.json({ answer: 'لم أجد في المنصة مراجع تطابق سؤالك. جرّب كلمات أخرى (اسم القانون أو موضوعه بدقة)، أو أرسل طلب استشارة عبر نموذج الاستشارة.', results: [] });

    let answer = 'وجدتُ ' + results.length + ' مرجعاً في المنصة يتعلق بسؤالك. اضغط على أي مرجع لقراءة ملخصه وفتحه.';
    // شرح تعريفي قصير بالذكاء الاصطناعي (اختياري)، يُرفض إذا ذكر رقماً أو رابطاً غير موجود في النتائج
    if (st.assistantAi === '1' && process.env.AI_API_KEY) {
      const ctx = top.map((r, i) => '[' + (i + 1) + '] ' + String(r.it.title || r.it.subject || '') + ' — ' + stripHtml(r.it[ASSIST_SECS[r.sec]]).slice(0, 400)).join('\n');
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      try {
        const base = (process.env.AI_BASE_URL || 'https://api.x.ai/v1').replace(/\/$/, '');
        const r = await fetch(base + '/chat/completions', {
          method: 'POST', signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.AI_API_KEY },
          body: JSON.stringify({
            model: process.env.AI_MODEL || 'grok-3', temperature: 0,
            messages: [
              { role: 'system', content: 'لديك قائمة مراجع مرقمة من قاعدة بيانات منصة قانونية. اكتب بالعربية فقرة تعريفية من جملتين أو ثلاث تبيّن ما تتناوله هذه المراجع بحسب العناوين والملخصات المرفقة فقط، وأشر إلى المرجع برقمه بين قوسين مربعين. ممنوع منعاً باتاً: ذكر أي عنوان أو رابط أو رقم أو تاريخ أو اسم محكمة غير وارد حرفياً في القائمة، وممنوع تقديم نصيحة قانونية أو معلومة من خارج القائمة.' },
              { role: 'user', content: 'المراجع:\n' + ctx + '\n\nسؤال الزائر: ' + question },
            ],
          }),
        });
        const j = await r.json().catch(() => ({}));
        let text = stripHtml((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '');
        const allowed = arNorm(ctx).replace(/[^0-9]+/g, ' ').split(' ').filter(Boolean);
        const used = text.replace(/\[\d+\]/g, ' ').replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660)).match(/\d+/g) || [];
        const bad = /https?:\/\/|www\./i.test(text) || used.some((n) => !allowed.includes(n));
        if (r.ok && text.length > 20 && !bad) answer += '\n\n' + text.slice(0, 900);
      } catch (e) { /* نكتفي بالنتائج */ } finally { clearTimeout(t); }
    }
    res.json({ answer, results });
  })
);

/* ============================================================
 * الإعداد الأولي: إنشاء حساب المدير (+ محتوى تجريبي اختياري)
 * يتطلب SETUP_KEY و ADMIN_EMAIL و ADMIN_PASSWORD في إعدادات Vercel
 * ============================================================ */
router.all(
  '/setup',
  ah(async (req, res) => {
    const expected = process.env.SETUP_KEY || '';
    const given = String(req.query.key || (req.body || {}).key || '');
    if (!expected) throw httpError(503, 'لم يتم ضبط SETUP_KEY في إعدادات Vercel.');
    const a = Buffer.from(given), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw httpError(403, 'مفتاح الإعداد غير صحيح');
    const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const password = String(process.env.ADMIN_PASSWORD || '');
    if (!emailOk(email) || password.length < 8) throw httpError(400, 'اضبط ADMIN_EMAIL و ADMIN_PASSWORD (8 أحرف على الأقل) في إعدادات Vercel.');
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.upsert({
      where: { email },
      update: { passwordHash, role: 'admin', isActive: true },
      create: { fullName: 'مدير المنصة', email, passwordHash, role: 'admin', isActive: true },
    });
    const report = ['تم إنشاء/تحديث حساب المدير: ' + email];

    if (String(req.query.sample || '') === '1') {
      const S = require('./_sample.js');
      const when = async (model, rows) => {
        if ((await prisma[model].count()) > 0) return report.push('تخطّي ' + model + ' (يحتوي بيانات)');
        await prisma[model].createMany({ data: rows });
        report.push('أُضيفت نماذج ' + model + ': ' + rows.length);
      };
      const first = (m) => String(m || '').split('•')[0].trim();
      await when('law', S.laws.map((x) => ({ title: x.t, summary: x.m })));
      await when('book', S.books.map((x) => ({ title: x.t, description: x.m })));
      await when('thesis', S.theses.map((x) => ({ title: x.t, university: first(x.m) || 'غير محدد', degree: /دكتوراه|PhD|doctor/i.test(x.m + x.b) ? 'phd' : 'master', abstract: x.m })));
      await when('article', S.articles.map((x) => ({ title: x.t, journalName: x.m })));
      await when('report', S.reports.map((x) => ({ title: x.t, description: x.m })));
      await when('jurisprudence', S.jur.map((x, i) => ({ decisionNumber: 'نموذج-' + (i + 1), court: first(x.m) || 'محكمة النقض', subject: x.t, summary: x.m })));
      await when('lecture', [
        ...S.pedagogy.map((x) => ({ title: x.t, instructorName: x.m, type: 'lecture' })),
        ...S.workshops.map((x) => ({ title: x.t, instructorName: x.m, type: 'workshop' })),
      ]);
      await when('announcement', [
        ...S.conferences.map((x) => ({ title: x.t, organization: x.m, type: 'conference', isPublished: true, publishedAt: new Date() })),
        ...S.competitions.map((x) => ({ title: x.t, organization: x.m, type: 'competition', isPublished: true, publishedAt: new Date() })),
      ]);
    }
    res.json({ ok: true, report, note: 'احذف المتغيرات SETUP_KEY و ADMIN_PASSWORD من Vercel بعد التأكد من الدخول.' });
  })
);

/* ============================================================
 * ربط المسارات + معالجة الأخطاء
 * ============================================================ */
app.use('/api', router);
app.use('/', router);

app.use((req, res) => res.status(404).json({ error: 'المسار غير موجود' }));

app.use((err, req, res, next) => {
  if (err && err.code === 'P2002') return res.status(400).json({ error: 'القيمة مستخدمة مسبقاً (تكرار)' });
  if (err && err.code === 'P2025') return res.status(404).json({ error: 'العنصر غير موجود' });
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'خطأ داخلي في الخادم' });
});

module.exports = app;
