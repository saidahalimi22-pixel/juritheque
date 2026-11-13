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
  /** شرط ما يراه الزوار والأعضاء (null = كل شيء ظاهر للجميع) */
  publicWhere?: Record<string, any> | null;
}

const DEFAULT_PUBLIC = { statusDoc: 'published' };

function isStaff(req: AuthRequest) {
  return !!req.user && ['admin', 'editor'].includes(req.user.role);
}

/** تنظيف البيانات القادمة من لوحة الإدارة قبل إرسالها لقاعدة البيانات */
function sanitize(body: any) {
  const data: any = { ...body };
  delete data.id;
  delete data.createdAt;
  delete data.updatedAt;
  delete data.passwordHash;
  for (const key of Object.keys(data)) {
    const v = data[key];
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
      data[key] = new Date(v + 'T00:00:00.000Z');
    }
    if (key === 'keywords' && typeof v === 'string') {
      data[key] = v.split(/[,،]/).map((s) => s.trim()).filter(Boolean);
    }
  }
  return data;
}

export function createCrudController(model: PrismaDelegate, options: CrudOptions = {}) {
  const {
    searchFields = ['title'],
    defaultOrderBy = { createdAt: 'desc' },
    publicWhere = DEFAULT_PUBLIC,
  } = options;

  // رابط الملف لا يُرسل إلا للمستخدمين المسجلين
  const scrub = (req: AuthRequest, item: any) => {
    if (item && 'passwordHash' in item) {
      const { passwordHash, ...safe } = item;
      item = safe;
    }
    if (req.user || !item || !('fileUrl' in item)) return item;
    const { fileUrl, ...rest } = item;
    return { ...rest, hasFile: !!fileUrl };
  };

  return {
    // GET / → قائمة مع بحث وترقيم
    async list(req: AuthRequest, res: Response) {
      try {
        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const limit = Math.min(50, parseInt(req.query.limit as string) || 20);
        const search = (req.query.q as string) || '';
        const where: any = {};

        if (!isStaff(req) && publicWhere) {
          Object.assign(where, publicWhere);
        } else if (req.query.status && publicWhere && 'statusDoc' in publicWhere) {
          where.statusDoc = req.query.status as string;
        }

        if (search && searchFields.length) {
          where.OR = searchFields.map((field) => ({
            [field]: { contains: search, mode: 'insensitive' },
          }));
        }
        if (req.query.categoryId) where.categoryId = req.query.categoryId;

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
          data: items.map((i) => scrub(req, i)),
          meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
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
        if (!isStaff(req) && publicWhere) {
          for (const [k, v] of Object.entries(publicWhere)) {
            if (k in item && item[k] !== v) return res.status(404).json({ error: 'العنصر غير موجود' });
          }
        }
        res.json(scrub(req, item));
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    },

    // POST /
    async create(req: AuthRequest, res: Response) {
      try {
        const data = sanitize(req.body);
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
          data: sanitize(req.body),
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
