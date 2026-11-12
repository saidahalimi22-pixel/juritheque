// تشغيل محلي فقط (npm run dev). على Vercel يُستخدم api/index.js
import path from 'path';
import fs from 'fs';
import express from 'express';
import { createApp } from './app.js';

const PORT = Number(process.env.PORT) || 4000;
const publicDir = path.join(process.cwd(), '..');

const app = createApp((a) => {
  if (fs.existsSync(path.join(publicDir, 'index.html'))) a.use(express.static(publicDir));
});

app.listen(PORT, '0.0.0.0', () => console.log(`Juritheque on port ${PORT}`));
