import { Router, Response } from 'express';
import prisma from '../lib/prisma.js';
import { optionalAuth, AuthRequest } from '../middleware/auth.js';

const router = Router();

/**
 * GET /api/search?q=...&type=law|jurisprudence|book|...&page=1&limit=20
 * بحث موحد عبر جميع الأقسام
 */
router.get('/', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const q = ((req.query.q as string) || '').trim();
    const type = (req.query.type as string) || '';
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(30, parseInt(req.query.limit as string) || 15);

    if (!q && !type) {
      return res.status(400).json({ error: 'أدخل كلمة بحث أو اختر نوعاً' });
    }

    const results: any[] = [];

    const searchIn = async (
      modelName: string,
      model: any,
      fields: string[],
      mapFn: (item: any) => any
    ) => {
      if (type && type !== modelName) return;

      const where: any = { statusDoc: 'published' };
      if (q) {
        where.OR = fields.map((f) => ({
          [f]: { contains: q, mode: 'insensitive' },
        }));
      }

      const items = await model.findMany({
        where,
        take: limit,
        orderBy: { createdAt: 'desc' },
      });

      results.push(...items.map(mapFn));
    };

    await Promise.all([
      searchIn('law', prisma.law, ['title', 'officialNumber', 'summary'], (i) => ({
        type: 'law',
        id: i.id,
        title: i.title,
        snippet: i.summary,
        meta: i.officialNumber,
        date: i.publicationDate,
        url: `/laws/${i.id}`,
      })),
      searchIn('jurisprudence', prisma.jurisprudence, ['decisionNumber', 'subject', 'summary', 'court'], (i) => ({
        type: 'jurisprudence',
        id: i.id,
        title: `${i.decisionNumber} - ${i.subject || i.court}`,
        snippet: i.summary,
        meta: i.court,
        date: i.decisionDate,
        url: `/jurisprudence/${i.id}`,
      })),
      searchIn('book', prisma.book, ['title', 'subtitle', 'publisher'], (i) => ({
        type: 'book',
        id: i.id,
        title: i.title,
        snippet: i.description,
        meta: i.publisher,
        date: i.publicationYear,
        url: `/books/${i.id}`,
      })),
      searchIn('thesis', prisma.thesis, ['title', 'university'], (i) => ({
        type: 'thesis',
        id: i.id,
        title: i.title,
        snippet: i.abstract,
        meta: i.university,
        date: i.defenseYear,
        url: `/theses/${i.id}`,
      })),
      searchIn('article', prisma.article, ['title', 'journalName'], (i) => ({
        type: 'article',
        id: i.id,
        title: i.title,
        snippet: i.abstract,
        meta: i.journalName,
        date: i.publicationYear,
        url: `/articles/${i.id}`,
      })),
      searchIn('report', prisma.report, ['title', 'issuingBody'], (i) => ({
        type: 'report',
        id: i.id,
        title: i.title,
        snippet: i.description,
        meta: i.issuingBody,
        date: i.publicationDate,
        url: `/reports/${i.id}`,
      })),
      searchIn('lecture', prisma.lecture, ['title', 'instructorName'], (i) => ({
        type: 'lecture',
        id: i.id,
        title: i.title,
        snippet: i.description,
        meta: i.instructorName,
        date: null,
        url: `/lectures/${i.id}`,
      })),
    ]);

    // Simple ranking: put exact title matches first (basic)
    results.sort((a, b) => {
      const aScore = a.title?.toLowerCase().includes(q.toLowerCase()) ? 1 : 0;
      const bScore = b.title?.toLowerCase().includes(q.toLowerCase()) ? 1 : 0;
      return bScore - aScore;
    });

    const start = (page - 1) * limit;
    const paged = results.slice(start, start + limit);

    res.json({
      data: paged,
      meta: {
        page,
        limit,
        total: results.length,
        query: q,
        type: type || 'all',
      },
    });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في البحث', details: error.message });
  }
});

export default router;
