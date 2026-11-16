/**
 * المرصد المغربي للأبحاث والدراسات القانونية — API — يعمل على Vercel (Serverless) + Neon (PostgreSQL) + Vercel Blob (الملفات)
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

router.get('/health', (req, res) => res.json({ status: 'ok', service: 'Moroccan Legal Research Observatory API' }));

/* ============================================================
 * إعدادات المنصة: نص «من نحن» + بريد التواصل (قابلة للتعديل من لوحة الإدارة)
 * ============================================================ */
const SITE_NAME = 'المرصد المغربي للأبحاث والدراسات القانونية';
const DEFAULT_ABOUT_HTML = `<h4>من نحن</h4>
<p>المرصد المغربي للأبحاث والدراسات القانونية منصة رقمية تجمع في مكان واحد النصوص التشريعية والاجتهادات القضائية والكتب والأطروحات والمقالات العلمية والمحاضرات وإعلانات الندوات والمؤتمرات، مع التركيز على القانون المغربي والقانون المقارن، لتسهيل وصول الطلبة والباحثين والمهنيين إلى المراجع الموثوقة.</p>
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
const ALLOWED_TAGS = new Set(['h3', 'h4', 'p', 'ul', 'ol', 'li', 'b', 'strong', 'i', 'em', 'u', 'br', 'a', 'blockquote']);
function sanitizeHtml(input) {
  let html = String(input || '');
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  html = html.replace(/<(script|style|iframe|object|embed)[\s\S]*?<\/\1\s*>/gi, '');
  html = html.replace(/<(div|section)(\s[^>]*)?>/gi, '<p>').replace(/<\/(div|section)\s*>/gi, '</p>');
  html = html.replace(/<h[12](\s[^>]*)?>/gi, '<h3>').replace(/<\/h[12]\s*>/gi, '</h3>');
  html = html.replace(/<h[56](\s[^>]*)?>/gi, '<h4>').replace(/<\/h[56]\s*>/gi, '</h4>');
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

async function readSettings() {
  try {
    const rows = await prisma.setting.findMany();
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
      aboutHtml: st.aboutHtml || DEFAULT_ABOUT_HTML,
      aboutIsDefault: !st.aboutHtml,
      defaultAboutHtml: DEFAULT_ABOUT_HTML,
    });
  })
);

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
    if (b.aboutHtml !== undefined) {
      const clean = sanitizeHtml(b.aboutHtml).slice(0, 60000);
      // نص فارغ = العودة إلى النص الافتراضي
      await save('aboutHtml', clean.replace(/<[^>]*>/g, '').trim() ? clean : '');
    }
    const st = await readSettings();
    res.json({ ok: true, contactEmail: st.contactEmail || '', aboutHtml: st.aboutHtml || DEFAULT_ABOUT_HTML });
  })
);

router.post(
  '/auth/register',
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
  o.hasFile = !!(o.fileUrl || o.videoUrl);
  if (light) delete o.fullText;
  if (!req.user) {
    delete o.fileUrl;
    delete o.videoUrl;
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
    const url = item.fileUrl || item.videoUrl;
    if (!url) throw httpError(404, 'لا يوجد ملف مرفق بهذا المرجع بعد');
    if (hasField(model, 'downloadsCount')) {
      prisma[lowerFirst(model)].update({ where: { id: item.id }, data: { downloadsCount: { increment: 1 } } }).catch(() => {});
    }
    res.json({ url, title: item.title || item.decisionNumber || '' });
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
 * المساعد الذكي (يتطلب تسجيل الدخول + مفتاح AI_API_KEY)
 * ============================================================ */
router.post(
  '/assistant/ask',
  authenticate,
  ah(async (req, res) => {
    const question = String((req.body || {}).question || '').trim().slice(0, 1000);
    if (question.length < 3) throw httpError(400, 'اكتب سؤالك بوضوح');
    if (!process.env.AI_API_KEY)
      return res.json({ answer: 'المساعد الذكي غير مفعّل بعد: لم يضف مدير المنصة مفتاح الذكاء الاصطناعي.', sources: [] });

    const words = Array.from(new Set(question.replace(/[؟?!.,،:;()«»"']/g, ' ').split(/\s+/).filter((w) => w.length >= 3))).slice(0, 6);
    const like = (fields) => words.flatMap((w) => fields.map((f) => ({ [f]: { contains: w, mode: 'insensitive' } })));
    const pub = { statusDoc: 'published' };
    const [laws, jur] = await Promise.all([
      words.length ? prisma.law.findMany({ where: { ...pub, OR: like(['title', 'summary', 'officialNumber']) }, take: 4, select: { title: true, officialNumber: true, summary: true } }) : [],
      words.length ? prisma.jurisprudence.findMany({ where: { ...pub, OR: like(['subject', 'summary', 'court']) }, take: 4, select: { decisionNumber: true, court: true, subject: true, summary: true } }) : [],
    ]);
    const sources = [
      ...laws.map((l) => ({ type: 'قانون', title: l.title + (l.officialNumber ? ' (' + l.officialNumber + ')' : ''), text: l.summary || '' })),
      ...jur.map((j) => ({ type: 'اجتهاد', title: (j.court || '') + ' — ' + (j.decisionNumber || ''), text: [j.subject, j.summary].filter(Boolean).join(' — ') })),
    ];
    const context = sources.map((s, i) => '[' + (i + 1) + '] ' + s.type + ': ' + s.title + '\n' + s.text.slice(0, 800)).join('\n\n') || '(لا توجد مصادر مطابقة في قاعدة بيانات المنصة)';

    const base = (process.env.AI_BASE_URL || 'https://api.x.ai/v1').replace(/\/$/, '');
    const r = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.AI_API_KEY },
      body: JSON.stringify({
        model: process.env.AI_MODEL || 'grok-3',
        temperature: 0.2,
        messages: [
          { role: 'system', content: 'أنت مساعد قانوني للمرصد المغربي للأبحاث والدراسات القانونية. أجب بالعربية وباختصار اعتماداً على المصادر المرفقة فقط عند توفرها، واذكر رقم المصدر بين أقواس مربعة. إن لم تكفِ المصادر فاذكر ذلك بصراحة ولا تخترع نصوصاً أو أرقام قوانين. في النهاية نبّه أن هذا توجيه أولي لا يغني عن استشارة محامٍ.' },
          { role: 'user', content: 'المصادر:\n' + context + '\n\nالسؤال: ' + question },
        ],
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw httpError(502, 'تعذّر الوصول لخدمة الذكاء الاصطناعي: ' + ((j.error && (j.error.message || j.error)) || r.status));
    const answer = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || 'لم أتمكن من توليد إجابة.';
    res.json({ answer, sources: sources.map((s) => s.type + ': ' + s.title) });
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
