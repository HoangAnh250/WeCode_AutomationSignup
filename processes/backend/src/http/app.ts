import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import type { Container } from '../composition.js';
import { authenticate, errorHandler, requestLog } from './middleware.js';
import { routes } from './routes.js';
export function createApp(c: Container) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use(helmet());
  app.use(requestLog(c.logger));
  app.get('/health/live', (_req, res) => res.json({ status: 'alive' }));
  app.use(authenticate(c.config.API_TOKEN));
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(
    rateLimit({
      windowMs: 60000,
      limit: 300,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: {
        error: { code: 'RATE_LIMITED', message: 'Too many desktop requests. Retry later.' },
      },
    }),
  );
  app.use(express.json({ limit: '3mb', strict: true }));
  app.get('/health/ready', async (_req, res) => {
    try {
      await c.db.$queryRaw`SELECT 1`;
      await c.queue.counts();
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });
  app.use('/api/v1', routes(c));
  app.use((_req, res) =>
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } }),
  );
  app.use(errorHandler(c.logger));
  return app;
}
