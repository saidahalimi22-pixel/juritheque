# دليل بناء الـ Backend لمنصة Jurithèque

## 1. تشغيل قاعدة البيانات محلياً

```bash
# تأكد من تثبيت Docker أولاً
cd juritheque
docker-compose up -d

# قاعدة البيانات ستعمل على:
# Host: localhost
# Port: 5432
# User: juritheque
# Password: juritheque_secret_2025
# Database: juritheque

# واجهة Adminer لإدارة القاعدة من المتصفح:
# http://localhost:8081
```

بعد التشغيل سيتم تنفيذ `schema.sql` و `seed_categories.sql` تلقائياً.

---

## 2. هيكل مشروع Backend مقترح (NestJS)

```
backend/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── auth/                 # تسجيل الدخول والتسجيل
│   ├── users/
│   ├── laws/
│   ├── jurisprudence/
│   ├── books/
│   ├── theses/
│   ├── articles/
│   ├── reports/
│   ├── lectures/
│   ├── announcements/
│   ├── categories/
│   ├── search/               # تكامل مع Meilisearch
│   ├── assistant/            # RAG + AI
│   └── common/
│       ├── guards/
│       ├── decorators/
│       └── filters/
├── prisma/                   # أو TypeORM
│   └── schema.prisma
└── package.json
```

### أو باستخدام Laravel:

```
app/
├── Models/
│   ├── Law.php
│   ├── Jurisprudence.php
│   ├── Book.php
│   └── ...
├── Http/Controllers/Api/
│   ├── LawController.php
│   ├── JurisprudenceController.php
│   └── AssistantController.php
└── Services/
    ├── SearchService.php
    └── RagService.php
```

---

## 3. أهم الـ API Endpoints

### المحتوى
```
GET    /api/laws
POST   /api/laws
GET    /api/laws/:id
PUT    /api/laws/:id
DELETE /api/laws/:id

GET    /api/jurisprudence
POST   /api/jurisprudence
...

GET    /api/search?q=...&type=law&category=...&year=...
```

### المساعد الذكي
```
POST   /api/assistant/sessions          # إنشاء جلسة
POST   /api/assistant/ask               # إرسال سؤال
GET    /api/assistant/sessions/:id      # استرجاع محادثة
```

### المصادقة
```
POST   /api/auth/register
POST   /api/auth/login
GET    /api/auth/me
```

---

## 4. ترتيب التنفيذ الموصى به

1. **إعداد PostgreSQL** عبر docker-compose
2. **إنشاء مشروع Backend** (NestJS أو Laravel)
3. **ربط النماذج** بالجداول
4. **بناء CRUD** للقوانين والاجتهادات أولاً
5. **إضافة رفع الملفات** (PDF)
6. **دمج Meilisearch** للبحث
7. **بناء خدمة RAG** للمساعد الذكي
8. **ربط الواجهة الأمامية** بالـ API

---

## 5. متغيرات البيئة المهمة (.env)

```env
DATABASE_URL=postgresql://juritheque:juritheque_secret_2025@localhost:5432/juritheque
MEILI_HOST=http://localhost:7700
MEILI_MASTER_KEY=juritheque_master_key
AI_API_KEY=your_grok_or_openai_key
AI_PROVIDER=grok
JWT_SECRET=your_jwt_secret
UPLOAD_DIR=./uploads
```

---

## 6. ملاحظات

- ابدأ دائماً بالقوانين + الاجتهادات القضائية (الأسهل قانونياً والأكثر قيمة)
- استخدم Transactions عند إضافة وثيقة + مؤلفين + وسوم
- أضف Rate Limiting على endpoint المساعد الذكي
- احفظ دائماً `source_url` للمحتوى الرسمي
