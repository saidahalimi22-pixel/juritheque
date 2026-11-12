/**
 * بيانات تجريبية مفتوحة (عناوين وأرقام رسمية عامة فقط — ليست نصوصاً كاملة محمية)
 * التشغيل: npx tsx src/seed-sample-content.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const laws = [
    {
      title: 'الأمر رقم 75-58 المؤرخ في 26 سبتمبر 1975 المتضمن القانون المدني (معدل ومتمم)',
      officialNumber: '75-58',
      publicationDate: new Date('1975-09-26'),
      status: 'sari' as const,
      summary: 'الإطار العام للقانون المدني: الالتزامات، العقود، المسؤولية، الملكية.',
      sourceUrl: 'https://www.joradp.dz',
      statusDoc: 'published' as const,
    },
    {
      title: 'القانون رقم 08-09 المؤرخ في 25 فبراير 2008 المتضمن قانون الإجراءات المدنية والإدارية',
      officialNumber: '08-09',
      publicationDate: new Date('2008-02-25'),
      status: 'muaddal' as const,
      summary: 'ينظم إجراءات التقاضي أمام الجهات القضائية المدنية والإدارية.',
      sourceUrl: 'https://www.joradp.dz',
      statusDoc: 'published' as const,
    },
    {
      title: 'الأمر رقم 66-156 المؤرخ في 8 يونيو 1966 المتضمن قانون العقوبات (معدل ومتمم)',
      officialNumber: '66-156',
      publicationDate: new Date('1966-06-08'),
      status: 'sari' as const,
      summary: 'يحدد الجرائم والعقوبات في التشريع الجزائري.',
      sourceUrl: 'https://www.joradp.dz',
      statusDoc: 'published' as const,
    },
    {
      title: 'القانون رقم 90-11 المؤرخ في 21 أبريل 1990 المتعلق بعلاقات العمل (معدل ومتمم)',
      officialNumber: '90-11',
      publicationDate: new Date('1990-04-21'),
      status: 'sari' as const,
      summary: 'ينظم علاقات العمل الفردية والجماعية وحقوق العمال.',
      sourceUrl: 'https://www.joradp.dz',
      statusDoc: 'published' as const,
    },
  ];

  for (const law of laws) {
    const exists = await prisma.law.findFirst({
      where: { officialNumber: law.officialNumber },
    });
    if (!exists) {
      await prisma.law.create({ data: law });
      console.log('قانون:', law.officialNumber);
    }
  }

  const jurisprudence = [
    {
      decisionNumber: '1452/2025',
      decisionDate: new Date('2025-03-15'),
      court: 'المحكمة العليا',
      chamber: 'الغرفة المدنية',
      subject: 'المسؤولية التقصيرية',
      summary: 'مثال تجريبي لقرار — استبدله بنص من المصدر الرسمي.',
      statusDoc: 'published' as const,
    },
    {
      decisionNumber: '087/2025',
      decisionDate: new Date('2025-02-28'),
      court: 'مجلس الدولة',
      chamber: null,
      subject: 'منازعات إدارية',
      summary: 'مثال تجريبي — يُستبدل بمحتوى من الموقع الرسمي لمجلس الدولة.',
      statusDoc: 'published' as const,
    },
  ];

  for (const j of jurisprudence) {
    const exists = await prisma.jurisprudence.findFirst({
      where: { decisionNumber: j.decisionNumber },
    });
    if (!exists) {
      await prisma.jurisprudence.create({ data: j });
      console.log('اجتهاد:', j.decisionNumber);
    }
  }

  console.log('تم إدخال البيانات التجريبية.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
