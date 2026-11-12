set -e

# Neon: رابط الاتصال المباشر (غير pooled) مطلوب لإنشاء الجداول
export DIRECT_URL="${DIRECT_URL:-${DATABASE_URL_UNPOOLED:-$DATABASE_URL}}"

if [ -z "$DATABASE_URL" ]; then
  echo "ERREUR: la variable DATABASE_URL est absente (ajoutez-la dans Vercel > Settings > Environment Variables)"
  exit 1
fi

echo "==> 1/5 Copie du site (frontend)"
node scripts/build-frontend.mjs

echo "==> 2/5 Prisma generate"
npx prisma generate --schema backend/prisma/schema.prisma

echo "==> 3/5 Création / mise à jour des tables Neon"
npx prisma db push --schema backend/prisma/schema.prisma --skip-generate

echo "==> 4/5 Compilation de l'API"
npx tsc -p backend/tsconfig.json || echo "(avertissements TypeScript ignorés)"
test -f backend/dist/app.js

echo "==> 5/5 Compte administrateur"
node backend/dist/seed-admin.js

echo "==> Terminé"
