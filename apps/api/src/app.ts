import { OpenAPIHono } from '@hono/zod-openapi';
import type { Database } from './db/client.js';
import { health } from './routes/health.js';
import { requestLogger, type Logger } from './lib/logger.js';
import type { Mailer } from './mail/mailer.js';

export interface AppDeps {
  logger: Logger;
  // Opcionales hasta que las rutas de cuenta (bloque 3) los necesiten; los tests los inyectan.
  db?: Database;
  mailer?: Mailer;
}

export function createApp(deps: AppDeps) {
  const app = new OpenAPIHono();
  app.use(requestLogger(deps.logger));
  app.route('/', health);
  app.onError((err, c) => {
    deps.logger.error('unhandled_error', { err });
    return c.json({ error: 'internal_error' }, 500);
  });
  return app;
}
