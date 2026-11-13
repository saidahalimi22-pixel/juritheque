import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { createCrudController } from '../controllers/crudFactory.js';
import { authenticate, requireRole, optionalAuth } from '../middleware/auth.js';
import authRoutes from './auth.js';
import assistantRoutes from './assistant.js';
import searchRoutes from './search.js';
import uploadRoutes from './upload.js';
import consultationRoutes from './consultations.js';

const router = Router();

// Auth
router.use('/auth', authRoutes);

// Search
router.use('/search', searchRoutes);
router.use('/upload', uploadRoutes);
router.use('/consultations', consultationRoutes);

// Assistant
router.use('/assistant', assistantRoutes);

// ========== Helper to mount CRUD ==========
function mountCrud(
  path: string,
  model: any,
  options: { searchFields?: string[]; defaultOrderBy?: any; publicWhere?: Record<string, any> | null } = {}
) {
  const ctrl = createCrudController(model, options);
  const r = Router();

  r.get('/', optionalAuth, ctrl.list);
  r.get('/:id', optionalAuth, ctrl.getOne);
  r.post('/', authenticate, requireRole('admin', 'editor'), ctrl.create);
  r.put('/:id', authenticate, requireRole('admin', 'editor'), ctrl.update);
  r.delete('/:id', authenticate, requireRole('admin'), ctrl.remove);

  router.use(path, r);
}

// ========== All content sections ==========
mountCrud('/laws', prisma.law, {
  searchFields: ['title', 'officialNumber', 'summary'],
  defaultOrderBy: { publicationDate: 'desc' },
});

mountCrud('/jurisprudence', prisma.jurisprudence, {
  searchFields: ['decisionNumber', 'subject', 'summary', 'court'],
  defaultOrderBy: { decisionDate: 'desc' },
});

mountCrud('/books', prisma.book, {
  searchFields: ['title', 'subtitle', 'publisher'],
});

mountCrud('/theses', prisma.thesis, {
  searchFields: ['title', 'university', 'faculty'],
});

mountCrud('/articles', prisma.article, {
  searchFields: ['title', 'journalName', 'doi'],
});

mountCrud('/reports', prisma.report, {
  searchFields: ['title', 'issuingBody'],
});

mountCrud('/lectures', prisma.lecture, {
  searchFields: ['title', 'instructorName'],
});

mountCrud('/announcements', prisma.announcement, {
  searchFields: ['title', 'organization'],
  defaultOrderBy: { createdAt: 'desc' },
  publicWhere: { isPublished: true },
});

mountCrud('/categories', prisma.category, {
  searchFields: ['nameAr', 'nameFr', 'slug'],
  defaultOrderBy: { sortOrder: 'asc' },
  publicWhere: null,
});

mountCrud('/authors', prisma.author, {
  searchFields: ['fullName', 'affiliation'],
  publicWhere: null,
});

mountCrud('/tags', prisma.tag, {
  searchFields: ['name', 'slug'],
  publicWhere: null,
});

// Users (admin only for list/update)
const usersCtrl = createCrudController(prisma.user, {
  searchFields: ['fullName', 'email'],
  publicWhere: null,
});
const usersRouter = Router();
usersRouter.get('/', authenticate, requireRole('admin'), usersCtrl.list);
usersRouter.get('/:id', authenticate, requireRole('admin'), usersCtrl.getOne);
usersRouter.put('/:id', authenticate, requireRole('admin'), usersCtrl.update);
usersRouter.delete('/:id', authenticate, requireRole('admin'), usersCtrl.remove);
router.use('/users', usersRouter);

export default router;
