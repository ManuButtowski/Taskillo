import { Hono } from 'hono';
import { health } from './routes/health.js';
import { requestLogger, type Logger } from './lib/logger.js';

export interface AppDeps {
  logger: Logger;
}

export function createApp(deps: AppDeps) {
  const app = new Hono();
  app.use(requestLogger(deps.logger));
  app.route('/', health);
  app.onError((err, c) => {
    deps.logger.error('unhandled_error', { err });
    return c.json({ error: 'internal_error' }, 500);
  });
  return app;
}
