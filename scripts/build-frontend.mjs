import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  const from = path.join(root, entry.name);
  const to = path.join(out, entry.name);
  if (entry.isFile() && entry.name.endsWith('.html')) fs.copyFileSync(from, to);
  else if (entry.isDirectory() && ['admin', 'css', 'js', 'assets', 'search'].includes(entry.name)) {
    fs.cpSync(from, to, { recursive: true });
  }
}
console.log('Frontend copié vers public/');
