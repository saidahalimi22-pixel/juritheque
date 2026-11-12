import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';

type PrismaDelegate = {
  findMany: (args?: any) => Promise<any[]>;
  findUnique: (args: any) => Promise<any>;
  create: (args: any) => Promise<any>;
  update: (args: any) => Promise<any>;
  delete: (args: any) => Promise<any>;
  count: (args?: any) => Promise<number>;
};

interface CrudOptions {
  searchFields?: string[];
  defaultOrderBy?: Record<string, 'asc' | 'desc'>;
  publishedOnlyForPublic?: boolean;
}

export function createCrudController(model: PrismaDelegate, options: CrudOptions = {}) {
  const {
    searchFields = ['title'],
    defaultOrderBy = { createdAt: 'desc' },
    publishedOnlyForPublic = true,
  } = options;

  return {
    // GET / → list with pagination & search
    async list(req: AuthRequest, res: Response) {
      try {
        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const limit = Math.min(50, parseInt(req.query.limit as string) || 20);
        const search = (req.query.q as string) || '';
        const statusDoc = req.query.status as string;

        const where: any = {};

        if (publishedOnlyForPublic && (!req.user || req.user.role === 'visitor')) {
          where.statusDoc = 'published';
        } else if (statusDoc) {
          where.statusDoc = statusDoc;
        }

        if (search && searchFields.length) {
          where.OR = searchFields.map((field) => ({
            [field]: { contains: search, mode: 'insensitive' },
          }));
        }

        // Extra filters from query
        if (req.query.categoryId) where.categoryId = req.query.categoryId;
        if (req.query.year) {
          // handled per model if needed
        }

        const [items, total] = await Promise.all([
          model.findMany({
            where,
            orderBy: defaultOrderBy,
            skip: (page - 1) * limit,
            take: limit,
          }),
          model.count({ where }),
        ]);

        res.json({
          data: items,
          meta: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        });
      } catch (error: any) {
        console.error(error);
        res.status(500).json({ error: 'خطأ في جلب البيانات', details: error.message });
      }
    },

    // GET /:id
    async getOne(req: AuthRequest, res: Response) {
      try {
        const item = await model.findUnique({ where: { id: req.params.id } });
        if (!item) return res.status(404).json({ error: 'العنصر غير موجود' });
        res.json(item);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    },

    // POST /
    async create(req: AuthRequest, res: Response) {
      try {
        const data = { ...req.body };
        if (req.user) data.createdById = req.user.id;

        const item = await model.create({ data });
        res.status(201).json(item);
      } catch (error: any) {
        console.error(error);
        res.status(400).json({ error: 'خطأ في الإنشاء', details: error.message });
      }
    },

    // PUT /:id
    async update(req: AuthRequest, res: Response) {
      try {
        const item = await model.update({
          where: { id: req.params.id },
          data: req.body,
        });
        res.json(item);
      } catch (error: any) {
        res.status(400).json({ error: 'خطأ في التحديث', details: error.message });
      }
    },

    // DELETE /:id
    async remove(req: AuthRequest, res: Response) {
      try {
        await model.delete({ where: { id: req.params.id } });
        res.json({ message: 'تم الحذف بنجاح' });
      } catch (error: any) {
        res.status(400).json({ error: 'خطأ في الحذف', details: error.message });
      }
    },
  };
}
