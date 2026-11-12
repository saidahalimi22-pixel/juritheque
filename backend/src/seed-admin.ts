/**
 * ينشئ حساب المدير من متغيرات البيئة ADMIN_EMAIL و ADMIN_PASSWORD.
 * يعمل تلقائياً أثناء بناء المشروع على Vercel. لا يغيّر حساباً موجوداً.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import prisma from './lib/prisma.js';

async function main() {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';

  if (!email || !password) {
    console.log('ADMIN_EMAIL / ADMIN_PASSWORD غير محددين — تخطي إنشاء المدير.');
    return;
  }
  if (password.length < 10) {
    console.log('ADMIN_PASSWORD قصيرة (10 أحرف على الأقل) — تخطي إنشاء المدير.');
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log('المسؤول موجود مسبقاً:', email);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.create({
    data: { fullName: 'مدير المنصة', email, passwordHash, role: 'admin', isActive: true },
  });
  console.log('تم إنشاء المسؤول:', email);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
