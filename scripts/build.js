// يُنفَّذ تلقائياً عند كل نشر على Vercel: يجهّز Prisma وينشئ/يحدّث جداول قاعدة البيانات في Neon
const { execSync } = require('child_process');

function run(cmd) {
  console.log('> ' + cmd);
  execSync(cmd, { stdio: 'inherit', env: process.env });
}

if (!process.env.DATABASE_URL) {
  console.error('\n✗ المتغير DATABASE_URL غير موجود. أضفه في Vercel: Settings → Environment Variables ثم أعد النشر.\n');
  process.exit(1);
}
if (!process.env.DIRECT_URL) process.env.DIRECT_URL = process.env.DATABASE_URL;

run('npx prisma generate');
run('npx prisma db push --skip-generate');
console.log('\n✓ قاعدة البيانات جاهزة.\n');
