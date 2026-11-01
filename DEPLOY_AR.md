# دليل النشر التجريبي — Jurithèque

هذا الدليل لمن لا يعمل Docker على جهازه (مثل Windows 8).
النشر على **Render.com** مجاني للتجربة.

---

## ما ستحصلين عليه

- رابط للموقع مثل: `https://juritheque-xxxx.onrender.com`
- قاعدة بيانات حقيقية
- لوحة تحكم تعمل
- يمكنك تجربتها من الهاتف قبل فتحها للعموم

---

## المتطلبات (مرة واحدة)

1. بريد إلكتروني (Gmail مناسب)
2. حساب مجاني على: https://render.com
3. حساب مجاني على: https://github.com
4. رفع مجلد المشروع على GitHub (أو نساعدك لاحقاً بالخطوات)

---

## الخطوات باختصار

### أ) تجهيز المشروع على GitHub

1. افتحي https://github.com وسجّلي حساباً
2. New repository → الاسم: `juritheque`
3. ارفعي مجلد المشروع (من حاسوب أو بمساعدة شخص)

### ب) على Render

1. ادخلي https://dashboard.render.com
2. New → Blueprint أو Web Service
3. اربطي مستودع GitHub `juritheque`
4. أضيفي **PostgreSQL** مجاني من Render
5. في متغيرات البيئة (Environment):

```
DATABASE_URL = (رابط قاعدة البيانات من Render)
JWT_SECRET = أي جملة سرية طويلة عشوائية
NODE_VERSION = 20
```

6. أوامر البناء والتشغيل:

**Build Command:**
```
cd backend && npm install && node copy-frontend.mjs && npx prisma generate && npm run build
```

**Start Command:**
```
cd backend && npx prisma db push && node dist/server.js
```

*(إذا كان Root Directory = backend فاحذفي `cd backend &&` من الأوامر)*

7. بعد نجاح النشر، افتحي الرابط الذي يعطيك إياه Render.

### ج) إنشاء حساب المدير

بعد أن يعمل الموقع، من جهازك (أو عبر Render Shell إن وُجد):

```
npx tsx src/seed-admin.ts
npx tsx src/seed-sample-content.ts
```

أو سجّلي مستخدماً من API إن كان التسجيل مفعّلاً، ثم غيّري الدور إلى admin في قاعدة البيانات.

الافتراضي من السكربت:
- البريد: admin@juritheque.com
- كلمة المرور: admin123456
**(غيّريها فوراً بعد أول دخول)**

---

## ملاحظات مهمة

- الخطة المجانية على Render قد **تنام** بعد ربع ساعة بدون زيارة؛ أول فتح بعدها يأخذ دقيقة. هذا طبيعي للتجربة.
- للنشر النهائي المدفوع لاحقاً: نفس الخطوات على خطة غير مجانية أو VPS.
- لا تنشوري الرابط للعموم حتى تجربين كل الأقسام بنفسك.

---

## إذا احتجت مساعدة أثناء النشر

أرسل:
1. هل أنشأت حساب GitHub؟
2. هل أنشأت حساب Render؟
3. أي رسالة خطأ ظهرت (نص أو صورة)

نكمل خطوة بخطوة معاً.
