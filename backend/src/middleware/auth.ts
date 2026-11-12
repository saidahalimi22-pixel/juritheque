import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { jwtSecret } from '../lib/jwt-secret.js';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
  };
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'غير مصرح. يرجى تسجيل الدخول.' });
  }

  const token = header.split(' ')[1];
  try {
    const secret = jwtSecret();
    const decoded = jwt.verify(token, secret) as { id: string; email: string; role: string };
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'رمز غير صالح أو منتهي الصلاحية.' });
  }
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'ليس لديك صلاحية لتنفيذ هذا الإجراء.' });
    }
    next();
  };
}

// Optional auth: attaches user if token exists, but doesn't block
export function optionalAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try {
      const token = header.split(' ')[1];
      const secret = jwtSecret();
      req.user = jwt.verify(token, secret) as { id: string; email: string; role: string };
    } catch {
      // ignore invalid token
    }
  }
  next();
}
