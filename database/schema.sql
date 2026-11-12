-- ============================================================
-- Jurithèque - Database Schema
-- Database: PostgreSQL 15+
-- Encoding: UTF-8
-- Created: 2025
-- ============================================================

-- Enable useful extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";          -- for fuzzy text search
CREATE EXTENSION IF NOT EXISTS "unaccent";        -- for Arabic/French search

-- ============================================================
-- 1. ENUMS
-- ============================================================

CREATE TYPE user_role AS ENUM (
    'visitor',
    'subscriber',
    'lawyer',
    'editor',
    'admin'
);

CREATE TYPE document_status AS ENUM (
    'draft',
    'published',
    'archived'
);

CREATE TYPE law_status AS ENUM (
    'sari',           -- ساري المفعول
    'mulgha',         -- ملغى
    'muaddal',        -- معدل
    'mutammam'        -- متمم
);

CREATE TYPE degree_type AS ENUM (
    'licence',
    'master',
    'phd',
    'other'
);

CREATE TYPE lecture_type AS ENUM (
    'lecture',        -- محاضرة
    'course',         -- دورة
    'workshop',       -- ورشة
    'seminar'         -- ندوة
);

CREATE TYPE announcement_type AS ENUM (
    'competition',    -- مسابقة
    'job',            -- توظيف
    'seminar',        -- ندوة
    'training',       -- تكوين
    'conference',     -- مؤتمر
    'other'
);

CREATE TYPE category_type AS ENUM (
    'law',
    'jurisprudence',
    'book',
    'thesis',
    'article',
    'report',
    'lecture',
    'announcement',
    'general'
);

-- ============================================================
-- 2. USERS & AUTH
-- ============================================================

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    full_name       VARCHAR(150) NOT NULL,
    email           VARCHAR(180) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    role            user_role NOT NULL DEFAULT 'visitor',
    phone           VARCHAR(30),
    avatar_url      TEXT,
    bio             TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    email_verified_at TIMESTAMPTZ,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);

-- ============================================================
-- 3. CATEGORIES (تصنيفات مشتركة)
-- ============================================================

CREATE TABLE categories (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name_ar         VARCHAR(150) NOT NULL,
    name_fr         VARCHAR(150),
    slug            VARCHAR(180) NOT NULL UNIQUE,
    description     TEXT,
    parent_id       UUID REFERENCES categories(id) ON DELETE SET NULL,
    type            category_type NOT NULL DEFAULT 'general',
    sort_order      INTEGER DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_categories_parent ON categories(parent_id);
CREATE INDEX idx_categories_type ON categories(type);
CREATE INDEX idx_categories_slug ON categories(slug);

-- ============================================================
-- 4. AUTHORS (مؤلفون / مشرفون)
-- ============================================================

CREATE TABLE authors (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    full_name       VARCHAR(200) NOT NULL,
    full_name_fr    VARCHAR(200),
    affiliation     VARCHAR(255),          -- الجامعة / المؤسسة
    bio             TEXT,
    email           VARCHAR(180),
    orcid           VARCHAR(50),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_authors_name ON authors USING gin (full_name gin_trgm_ops);

-- ============================================================
-- 5. TAGS
-- ============================================================

CREATE TABLE tags (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(100) NOT NULL UNIQUE,
    slug            VARCHAR(120) NOT NULL UNIQUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 6. LAWS (مدونة القوانين)
-- ============================================================

CREATE TABLE laws (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title               VARCHAR(500) NOT NULL,
    official_number     VARCHAR(100),              -- رقم الأمر / القانون
    publication_date    DATE,
    last_amendment_date DATE,
    status              law_status NOT NULL DEFAULT 'sari',
    category_id         UUID REFERENCES categories(id) ON DELETE SET NULL,
    summary             TEXT,
    full_text           TEXT,                      -- النص الكامل (اختياري)
    file_url            TEXT,                      -- رابط PDF
    source_url          TEXT,                      -- الرابط الرسمي (الجريدة الرسمية)
    language            VARCHAR(10) DEFAULT 'ar',
    pages_count         INTEGER,
    status_doc          document_status NOT NULL DEFAULT 'published',
    views_count         INTEGER NOT NULL DEFAULT 0,
    created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_laws_title ON laws USING gin (title gin_trgm_ops);
CREATE INDEX idx_laws_official_number ON laws(official_number);
CREATE INDEX idx_laws_status ON laws(status);
CREATE INDEX idx_laws_category ON laws(category_id);
CREATE INDEX idx_laws_publication_date ON laws(publication_date DESC);

-- ============================================================
-- 7. BOOKS (الكتب)
-- ============================================================

CREATE TABLE books (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title               VARCHAR(500) NOT NULL,
    subtitle            VARCHAR(500),
    publisher           VARCHAR(255),
    publication_year    INTEGER,
    isbn                VARCHAR(20),
    edition             VARCHAR(50),
    category_id         UUID REFERENCES categories(id) ON DELETE SET NULL,
    description         TEXT,
    file_url            TEXT,
    cover_url           TEXT,
    pages_count         INTEGER,
    language            VARCHAR(10) DEFAULT 'ar',
    access_level        VARCHAR(30) DEFAULT 'public',  -- public / subscribers_only
    status_doc          document_status NOT NULL DEFAULT 'published',
    views_count         INTEGER NOT NULL DEFAULT 0,
    downloads_count     INTEGER NOT NULL DEFAULT 0,
    created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_books_title ON books USING gin (title gin_trgm_ops);
CREATE INDEX idx_books_year ON books(publication_year DESC);
CREATE INDEX idx_books_category ON books(category_id);

-- ============================================================
-- 8. THESES (الرسائل والأطروحات)
-- ============================================================

CREATE TABLE theses (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title               VARCHAR(600) NOT NULL,
    degree              degree_type NOT NULL,
    university          VARCHAR(255) NOT NULL,
    faculty             VARCHAR(255),
    defense_year        INTEGER,
    defense_date        DATE,
    abstract            TEXT,
    keywords            TEXT[],                    -- مصفوفة كلمات مفتاحية
    category_id         UUID REFERENCES categories(id) ON DELETE SET NULL,
    file_url            TEXT,
    pages_count         INTEGER,
    language            VARCHAR(10) DEFAULT 'ar',
    status_doc          document_status NOT NULL DEFAULT 'published',
    views_count         INTEGER NOT NULL DEFAULT 0,
    downloads_count     INTEGER NOT NULL DEFAULT 0,
    created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_theses_title ON theses USING gin (title gin_trgm_ops);
CREATE INDEX idx_theses_university ON theses(university);
CREATE INDEX idx_theses_degree ON theses(degree);
CREATE INDEX idx_theses_year ON theses(defense_year DESC);
CREATE INDEX idx_theses_keywords ON theses USING gin (keywords);

-- ============================================================
-- 9. ARTICLES (المقالات العلمية)
-- ============================================================

CREATE TABLE articles (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title               VARCHAR(600) NOT NULL,
    journal_name        VARCHAR(255),
    volume              VARCHAR(50),
    issue               VARCHAR(50),
    publication_year    INTEGER,
    pages               VARCHAR(50),
    doi                 VARCHAR(100),
    abstract            TEXT,
    keywords            TEXT[],
    category_id         UUID REFERENCES categories(id) ON DELETE SET NULL,
    file_url            TEXT,
    is_open_access      BOOLEAN NOT NULL DEFAULT FALSE,
    language            VARCHAR(10) DEFAULT 'ar',
    status_doc          document_status NOT NULL DEFAULT 'published',
    views_count         INTEGER NOT NULL DEFAULT 0,
    downloads_count     INTEGER NOT NULL DEFAULT 0,
    created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_articles_title ON articles USING gin (title gin_trgm_ops);
CREATE INDEX idx_articles_doi ON articles(doi);
CREATE INDEX idx_articles_year ON articles(publication_year DESC);
CREATE INDEX idx_articles_keywords ON articles USING gin (keywords);

-- ============================================================
-- 10. REPORTS (التقارير)
-- ============================================================

CREATE TABLE reports (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title               VARCHAR(500) NOT NULL,
    issuing_body        VARCHAR(255),              -- الجهة المصدرة
    publication_date    DATE,
    description         TEXT,
    category_id         UUID REFERENCES categories(id) ON DELETE SET NULL,
    file_url            TEXT,
    language            VARCHAR(10) DEFAULT 'ar',
    status_doc          document_status NOT NULL DEFAULT 'published',
    views_count         INTEGER NOT NULL DEFAULT 0,
    downloads_count     INTEGER NOT NULL DEFAULT 0,
    created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reports_title ON reports USING gin (title gin_trgm_ops);
CREATE INDEX idx_reports_issuing_body ON reports(issuing_body);

-- ============================================================
-- 11. JURISPRUDENCE (الاجتهادات القضائية)
-- ============================================================

CREATE TABLE jurisprudence (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    decision_number     VARCHAR(100) NOT NULL,
    decision_date       DATE,
    court               VARCHAR(150) NOT NULL,     -- المحكمة العليا، مجلس الدولة...
    chamber             VARCHAR(150),              -- الغرفة المدنية، الجنائية...
    subject             VARCHAR(500),              -- موضوع القضية
    summary             TEXT,                      -- ملخص
    full_text           TEXT,
    keywords            TEXT[],
    category_id         UUID REFERENCES categories(id) ON DELETE SET NULL,
    file_url            TEXT,
    source_url          TEXT,                      -- الرابط الرسمي
    language            VARCHAR(10) DEFAULT 'ar',
    status_doc          document_status NOT NULL DEFAULT 'published',
    views_count         INTEGER NOT NULL DEFAULT 0,
    created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_jurisprudence_number ON jurisprudence(decision_number);
CREATE INDEX idx_jurisprudence_date ON jurisprudence(decision_date DESC);
CREATE INDEX idx_jurisprudence_court ON jurisprudence(court);
CREATE INDEX idx_jurisprudence_chamber ON jurisprudence(chamber);
CREATE INDEX idx_jurisprudence_subject ON jurisprudence USING gin (subject gin_trgm_ops);
CREATE INDEX idx_jurisprudence_keywords ON jurisprudence USING gin (keywords);

-- جدول وسيط: ربط الأحكام بالقوانين ذات الصلة
CREATE TABLE jurisprudence_laws (
    jurisprudence_id    UUID REFERENCES jurisprudence(id) ON DELETE CASCADE,
    law_id              UUID REFERENCES laws(id) ON DELETE CASCADE,
    PRIMARY KEY (jurisprudence_id, law_id)
);

-- ============================================================
-- 12. LECTURES (المحاضرات والتكوينات)
-- ============================================================

CREATE TABLE lectures (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title               VARCHAR(400) NOT NULL,
    instructor_name     VARCHAR(200),
    type                lecture_type NOT NULL DEFAULT 'lecture',
    duration_minutes    INTEGER,
    description         TEXT,
    video_url           TEXT,
    file_url            TEXT,                      -- ملفات مرفقة (PDF)
    cover_url           TEXT,
    category_id         UUID REFERENCES categories(id) ON DELETE SET NULL,
    is_free             BOOLEAN NOT NULL DEFAULT TRUE,
    status_doc          document_status NOT NULL DEFAULT 'published',
    views_count         INTEGER NOT NULL DEFAULT 0,
    created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lectures_title ON lectures USING gin (title gin_trgm_ops);
CREATE INDEX idx_lectures_type ON lectures(type);

-- ============================================================
-- 13. ANNOUNCEMENTS (الإعلانات)
-- ============================================================

CREATE TABLE announcements (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title               VARCHAR(400) NOT NULL,
    type                announcement_type NOT NULL DEFAULT 'other',
    description         TEXT,
    organization        VARCHAR(255),
    location            VARCHAR(255),
    event_date          DATE,
    deadline            DATE,
    external_link       TEXT,
    is_published        BOOLEAN NOT NULL DEFAULT FALSE,
    published_at        TIMESTAMPTZ,
    created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_announcements_type ON announcements(type);
CREATE INDEX idx_announcements_deadline ON announcements(deadline);
CREATE INDEX idx_announcements_published ON announcements(is_published, published_at DESC);

-- ============================================================
-- 14. DOCUMENT ↔ AUTHORS (علاقة many-to-many)
-- ============================================================

CREATE TABLE document_authors (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_type   VARCHAR(30) NOT NULL,          -- book, thesis, article, report
    document_id     UUID NOT NULL,
    author_id       UUID NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
    role            VARCHAR(50) DEFAULT 'author',  -- author, co-author, supervisor, editor
    sort_order      INTEGER DEFAULT 0
);

CREATE INDEX idx_document_authors_doc ON document_authors(document_type, document_id);
CREATE INDEX idx_document_authors_author ON document_authors(author_id);

-- ============================================================
-- 15. DOCUMENT ↔ TAGS
-- ============================================================

CREATE TABLE document_tags (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_type   VARCHAR(30) NOT NULL,
    document_id     UUID NOT NULL,
    tag_id          UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE
);

CREATE INDEX idx_document_tags_doc ON document_tags(document_type, document_id);
CREATE INDEX idx_document_tags_tag ON document_tags(tag_id);

-- ============================================================
-- 16. AI ASSISTANT (المساعد الذكي)
-- ============================================================

CREATE TABLE chat_sessions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,  -- null = زائر
    title           VARCHAR(255),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chat_sessions_user ON chat_sessions(user_id);

CREATE TABLE chat_messages (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id      UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role            VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content         TEXT NOT NULL,
    sources         JSONB,                         -- [{type, id, title, url}, ...]
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chat_messages_session ON chat_messages(session_id);

-- ============================================================
-- 17. USEFUL VIEWS (اختياري)
-- ============================================================

-- أحدث المحتويات من كل الأقسام
CREATE OR REPLACE VIEW latest_content AS
SELECT 'law' AS type, id, title, created_at FROM laws WHERE status_doc = 'published'
UNION ALL
SELECT 'jurisprudence', id, decision_number || ' - ' || COALESCE(subject, ''), created_at FROM jurisprudence WHERE status_doc = 'published'
UNION ALL
SELECT 'book', id, title, created_at FROM books WHERE status_doc = 'published'
UNION ALL
SELECT 'thesis', id, title, created_at FROM theses WHERE status_doc = 'published'
UNION ALL
SELECT 'article', id, title, created_at FROM articles WHERE status_doc = 'published'
UNION ALL
SELECT 'report', id, title, created_at FROM reports WHERE status_doc = 'published'
UNION ALL
SELECT 'lecture', id, title, created_at FROM lectures WHERE status_doc = 'published'
ORDER BY created_at DESC;

-- ============================================================
-- 18. TRIGGER: تحديث updated_at تلقائياً
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- تطبيق الـ trigger على الجداول المهمة
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_laws_updated_at BEFORE UPDATE ON laws FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_books_updated_at BEFORE UPDATE ON books FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_theses_updated_at BEFORE UPDATE ON theses FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_articles_updated_at BEFORE UPDATE ON articles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_reports_updated_at BEFORE UPDATE ON reports FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_jurisprudence_updated_at BEFORE UPDATE ON jurisprudence FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_lectures_updated_at BEFORE UPDATE ON lectures FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_announcements_updated_at BEFORE UPDATE ON announcements FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- END OF SCHEMA
-- ============================================================
