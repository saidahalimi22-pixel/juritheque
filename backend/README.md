# Jurithèque Backend API

## التقنيات
- Node.js + Express + TypeScript
- Prisma ORM + PostgreSQL
- JWT للمصادقة
- بنية CRUD موحدة لجميع الأقسام

## الأقسام المدعومة (CRUD كامل)
- `/api/laws` — مدونة القوانين
- `/api/jurisprudence` — الاجتهادات القضائية
- `/api/books` — الكتب
- `/api/theses` — الرسائل والأطروحات
- `/api/articles` — المقالات
- `/api/reports` — التقارير
- `/api/lectures` — المحاضرات والتكوينات
- `/api/announcements` — الإعلانات
- `/api/categories` — التصنيفات
- `/api/authors` — المؤلفون
- `/api/tags` — الوسوم
- `/api/users` — المستخدمون (admin)
- `/api/search` — البحث الموحد
- `/api/assistant` — المساعد القانوني الذكي (RAG skeleton)
- `/api/auth` — التسجيل وتسجيل الدخول

## التشغيل السريع

### 1. تشغيل قاعدة البيانات
```bash
# من مجلد juritheque الرئيسي
docker-compose up -d
```

### 2. إعداد الـ Backend
```bash
cd backend
cp .env.example .env
npm install
npx prisma generate
npx prisma db push          # أو prisma migrate dev
npm run dev
```

الخادم سيعمل على: **http://localhost:4000**

### 3. أمثلة على الطلبات

```bash
# تسجيل
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"fullName":"أحمد","email":"ahmed@test.com","password":"12345678"}'

# تسجيل دخول
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"ahmed@test.com","password":"12345678"}'

# قائمة القوانين
curl http://localhost:4000/api/laws

# بحث
curl "http://localhost:4000/api/search?q=المسؤولية"

# المساعد الذكي
curl -X POST http://localhost:4000/api/assistant/ask \
  -H "Content-Type: application/json" \
  -d '{"question":"ما هي أحكام المسؤولية التقصيرية؟"}'
```

## الصلاحيات
| الإجراء | الزائر | المشترك | محرر | مدير |
|---------|--------|---------|------|------|
| قراءة المحتوى المنشور | ✅ | ✅ | ✅ | ✅ |
| إنشاء/تعديل محتوى | ❌ | ❌ | ✅ | ✅ |
| حذف | ❌ | ❌ | ❌ | ✅ |
| إدارة المستخدمين | ❌ | ❌ | ❌ | ✅ |

## الخطوات التالية
1. ربط رفع الملفات (multer) بحقول `fileUrl`
2. استبدال إجابة المساعد التجريبية باستدعاء Grok/OpenAI الحقيقي
3. إضافة Meilisearch لتحسين البحث
4. ربط لوحة التحكم (`admin/`) بهذه الـ APIs
