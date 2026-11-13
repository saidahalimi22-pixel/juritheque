import { Router, Response } from 'express';
import prisma from '../lib/prisma.js';
import { authenticate, optionalAuth, requireRole, AuthRequest } from '../middleware/auth.js';

const router = Router();
const STATUSES = ['new', 'in_progress', 'answered', 'closed'];

// POST /api/consultations — إرسال طلب استشارة (مفتوح للزوار)
router.post('/', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { fullName, email, phone, topic, body, website } = req.body || {};

    // حقل فخ للروبوتات: يجب أن يبقى فارغاً
    if (website) return res.status(201).json({ ok: true });

    const clean = (v: any, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    const data = {
      fullName: clean(fullName, 120),
      email: clean(email, 160).toLowerCase(),
      phone: clean(phone, 40) || null,
      topic: clean(topic, 120),
      body: clean(body, 5000),
    };

    if (!data.fullName || !data.topic || !data.body) {
      return res.status(400).json({ error: 'يرجى إكمال الاسم والمجال ونص السؤال.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      return res.status(400).json({ error: 'البريد الإلكتروني غير صالح.' });
    }

    // حد بسيط ضد الإزعاج: 5 طلبات في الساعة لكل بريد
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const recent = await prisma.consultation.count({ where: { email: data.email, createdAt: { gte: since } } });
    if (recent >= 5) {
      return res.status(429).json({ error: 'تجاوزت عدد الطلبات المسموح به. حاول لاحقاً.' });
    }

    await prisma.consultation.create({ data: { ...data, userId: req.user?.id || null } });
    res.status(201).json({ ok: true });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: 'تعذر حفظ الطلب، حاول لاحقاً.' });
  }
});

// GET /api/consultations — للإدارة
router.get('/', authenticate, requireRole('admin', 'editor'), async (req: AuthRequest, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 30);
    const where: any = {};
    if (req.query.status && STATUSES.includes(req.query.status as string)) where.status = req.query.status;
    const [data, total] = await Promise.all([
      prisma.consultation.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      prisma.consultation.count({ where }),
    ]);
    res.json({ data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/consultations/:id — تغيير الحالة / ملاحظة
router.put('/:id', authenticate, requireRole('admin', 'editor'), async (req: AuthRequest, res: Response) => {
  try {
    const data: any = {};
    if (req.body.status !== undefined) {
      if (!STATUSES.includes(req.body.status)) return res.status(400).json({ error: 'حالة غير صالحة' });
      data.status = req.body.status;
    }
    if (req.body.adminNote !== undefined) data.adminNote = String(req.body.adminNote).slice(0, 5000);
    const item = await prisma.consultation.update({ where: { id: req.params.id }, data });
    res.json(item);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// DELETE /api/consultations/:id — للمدير فقط
router.delete('/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.consultation.delete({ where: { id: req.params.id } });
    res.json({ message: 'تم الحذف' });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
