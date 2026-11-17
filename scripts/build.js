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
// قاعدة Neon قد تكون «نائمة» فتستغرق أول اتصال: نعيد المحاولة حتى 3 مرات قبل إفشال النشر
let ok = false;
for (let i = 1; i <= 3 && !ok; i++) {
  try {
    run('npx prisma db push --skip-generate');
    ok = true;
  } catch (e) {
    console.error('\n⚠ فشلت المحاولة ' + i + ' من 3' + (i < 3 ? ' — إعادة المحاولة بعد 5 ثوانٍ...' : ''));
    if (i < 3) execSync('node -e "setTimeout(()=>{},5000)"');
  }
}
if (!ok) process.exit(1);
console.log('\n✓ قاعدة البيانات جاهزة.\n');
