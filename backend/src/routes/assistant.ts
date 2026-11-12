import { Router, Response } from 'express';
import prisma from '../lib/prisma.js';
import { optionalAuth, AuthRequest } from '../middleware/auth.js';
import { chatCompletion, buildLegalSystemPrompt } from '../services/ai.js';

const router = Router();

router.post('/ask', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { question, sessionId } = req.body;
    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'السؤال مطلوب' });
    }

    let session;
    if (sessionId) {
      session = await prisma.chatSession.findUnique({ where: { id: sessionId } });
    }
    if (!session) {
      session = await prisma.chatSession.create({
        data: {
          userId: req.user?.id || null,
          title: question.substring(0, 80),
        },
      });
    }

    await prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: 'user',
        content: question,
      },
    });

    const keywords = question.split(/\s+/).filter((w: string) => w.length > 2).slice(0, 5);

    const [laws, jurisprudence, articles] = await Promise.all([
      prisma.law.findMany({
        where: {
          statusDoc: 'published',
          OR: [
            { title: { contains: question, mode: 'insensitive' } },
            { summary: { contains: question, mode: 'insensitive' } },
            ...keywords.map((k: string) => ({ title: { contains: k, mode: 'insensitive' as const } })),
          ],
        },
        take: 5,
        select: { id: true, title: true, officialNumber: true, summary: true, fullText: true },
      }),
      prisma.jurisprudence.findMany({
        where: {
          statusDoc: 'published',
          OR: [
            { subject: { contains: question, mode: 'insensitive' } },
            { summary: { contains: question, mode: 'insensitive' } },
            { decisionNumber: { contains: question, mode: 'insensitive' } },
            ...keywords.map((k: string) => ({ subject: { contains: k, mode: 'insensitive' as const } })),
          ],
        },
        take: 5,
        select: {
          id: true,
          decisionNumber: true,
          subject: true,
          court: true,
          summary: true,
          fullText: true,
        },
      }),
      prisma.article.findMany({
        where: {
          statusDoc: 'published',
          OR: [
            { title: { contains: question, mode: 'insensitive' } },
            { abstract: { contains: question, mode: 'insensitive' } },
          ],
        },
        take: 3,
        select: { id: true, title: true, abstract: true, journalName: true },
      }),
    ]);

    const sources = [
      ...laws.map((l) => ({
        type: 'law',
        id: l.id,
        title: l.title,
        ref: l.officialNumber,
        snippet: (l.summary || l.fullText || '').substring(0, 400),
      })),
      ...jurisprudence.map((j) => ({
        type: 'jurisprudence',
        id: j.id,
        title: j.decisionNumber + ' - ' + (j.subject || ''),
        ref: j.court,
        snippet: (j.summary || j.fullText || '').substring(0, 400),
      })),
      ...articles.map((a) => ({
        type: 'article',
        id: a.id,
        title: a.title,
        ref: a.journalName,
        snippet: (a.abstract || '').substring(0, 300),
      })),
    ];

    const context = sources
      .map(
        (s, i) =>
          '[مصدر ' + (i + 1) + '] (' + s.type + ') ' + s.title + (s.ref ? ' — ' + s.ref : '') + '\n' + (s.snippet || 'بدون ملخص')
      )
      .join('\n\n');

    const systemPrompt = buildLegalSystemPrompt(context);

    let answer: string;
    let usedAI = false;

    try {
      const aiResult = await chatCompletion([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: question },
      ]);
      answer = aiResult.content;
      usedAI = true;
    } catch (aiError: any) {
      console.warn('AI call failed, using fallback:', aiError.message);

      if (sources.length === 0) {
        answer =
          'لم أجد مصادر مباشرة في قاعدة البيانات حول هذا السؤال. ' +
          'يرجى إضافة محتوى (قوانين / اجتهادات) أو ضبط AI_API_KEY في ملف .env.\n\n' +
          'تفاصيل: ' + aiError.message;
      } else {
        const list = sources
          .map((s, i) => (i + 1) + '. [' + s.type + '] ' + s.title + (s.ref ? ' (' + s.ref + ')' : ''))
          .join('\n');
        answer =
          'تم استرجاع ' + sources.length + ' مصدر(s) من المنصة:\n\n' + list + '\n\n' +
          'لم يتم توليد إجابة مفصلة لأن نموذج الذكاء الاصطناعي غير مفعّل.\n' +
          '(' + aiError.message + ')\n\n' +
          'أضف AI_API_KEY في backend/.env ثم أعد تشغيل الخادم.';
      }
    }

    const assistantMessage = await prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: 'assistant',
        content: answer,
        sources: sources,
      },
    });

    res.json({
      sessionId: session.id,
      answer,
      sources,
      messageId: assistantMessage.id,
      usedAI,
    });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في المساعد الذكي', details: error.message });
  }
});

router.get('/sessions/:id', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const session = await prisma.chatSession.findUnique({
      where: { id: req.params.id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!session) return res.status(404).json({ error: 'الجلسة غير موجودة' });
    res.json(session);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/sessions', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.json([]);
    const sessions = await prisma.chatSession.findMany({
      where: { userId: req.user.id },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    });
    res.json(sessions);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
