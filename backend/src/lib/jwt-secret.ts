export function jwtSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) {
    throw new Error('JWT_SECRET manquant ou trop court (16 caractères minimum)');
  }
  return s;
}
