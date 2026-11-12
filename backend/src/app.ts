import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import routes from './routes/index.js';

export function createApp(beforeFallbacks?: (app: express.Express) => void) {
  const app = express();

  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  const health = (_req: express.Request, res: express.Response) =>
    res.json({ status: 'ok', service: 'Juritheque API', version: '2.0.0' });
  app.get('/health', health);
  app.get('/api/health', health);

  app.use('/api', routes);

  if (beforeFallbacks) beforeFallbacks(app);

  app.use((_req, res) => {
    res.status(404).json({ error: 'المسار غير موجود' });
  });

  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || 'خطأ داخلي في الخادم' });
  });

  return app;
}

export default createApp();
