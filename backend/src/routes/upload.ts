import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { jwtSecret } from '../lib/jwt-secret.js';

const router = Router();
const MAX_BYTES = Number(process.env.MAX_UPLOAD_MB || 500) * 1024 * 1024;

/**
 * POST /api/upload
 * الرفع المباشر: المتصفح يرسل الملف إلى Vercel Blob مباشرة،
 * وهذا المسار يتحقق فقط من أن المستخدم admin أو editor ويصدر تصريح الرفع.
 */
router.post('/', async (req, res) => {
  try {
    const body = req.body as HandleUploadBody;
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        let user: any;
        try {
          user = jwt.verify(clientPayload || '', jwtSecret());
        } catch {
          throw new Error('غير مصرح. يرجى تسجيل الدخول.');
        }
        if (!['admin', 'editor'].includes(user.role)) {
          throw new Error('ليس لديك صلاحية رفع الملفات.');
        }
        return {
          allowedContentTypes: [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'image/jpeg',
            'image/png',
            'image/webp',
            'video/mp4',
            'video/webm',
          ],
          maximumSizeInBytes: MAX_BYTES,
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {},
    });
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
