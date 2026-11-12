import { PrismaClient } from '@prisma/client';

// Neon: عند استخدام رابط الـ pooler نضيف pgbouncer=true ليعمل Prisma معه
function dbUrl(): string | undefined {
  let u = process.env.DATABASE_URL;
  if (!u) return undefined;
  if (u.includes('-pooler') && !u.includes('pgbouncer')) {
    u += (u.includes('?') ? '&' : '?') + 'pgbouncer=true&connect_timeout=15';
  }
  return u;
}

const g = globalThis as unknown as { __prisma?: PrismaClient };

const prisma =
  g.__prisma ??
  new PrismaClient({
    datasourceUrl: dbUrl(),
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') g.__prisma = prisma;

export default prisma;
