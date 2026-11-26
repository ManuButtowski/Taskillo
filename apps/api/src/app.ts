import { OpenAPIHono } from '@hono/zod-openapi';
import type { Database } from './db/client.js';
import { errorBody, validationHook } from './lib/errors.js';
import { requestLogger, type Logger } from './lib/logger.js';
import { SlidingWindowLimiter } from './lib/rate-limit.js';
import type { Mailer } from './mail/mailer.js';
import { authRoutes } from './routes/auth.js';
import { health } from './routes/health.js';
import { sessionRoutes } from './routes/sessions.js';

export interface AppDeps {
  logger: Logger;
  // Opcionales para poder montar la app solo para documentar el contrato (openapi.ts) o probar
  // /health; si faltan, los manejadores de cuenta fallan con un 500.
  db?: Database;
  mailer?: Mailer;
  jwtSecret?: string;
  /** Leer la IP de X-Forwarded-For (solo con Caddy delante). */
  trustProxy?: boolean;
  /** URL pública de la API (enlace de recuperación). */
  publicBaseUrl?: string;
  /** Limitador de frecuencia; si no se da, la app crea uno propio. */
  limiter?: SlidingWindowLimiter;
}

/** Dependencias ya resueltas que reciben los módulos de rutas. */
export interface AppContext {
  db: Database['db'];
  mailer: Mailer;
  logger: Logger;
  jwtSecret: string;
  trustProxy: boolean;
  publicBaseUrl: string;
  limiter: SlidingWindowLimiter;
}

function unavailable<T extends object>(name: string): T {
  return new Proxy({} as T, {
    get() {
      throw new Error(`${name} no está configurado en esta instancia de la app`);
    },
  });
}

export function createApp(deps: AppDeps) {
  const ctx: AppContext = {
    db: deps.db?.db ?? unavailable('db'),
    mailer: deps.mailer ?? unavailable('mailer'),
    logger: deps.logger,
    jwtSecret: deps.jwtSecret ?? '',
    trustProxy: deps.trustProxy ?? false,
    publicBaseUrl: deps.publicBaseUrl ?? 'http://localhost:3000',
    limiter: deps.limiter ?? new SlidingWindowLimiter(),
  };

  const app = new OpenAPIHono({ defaultHook: validationHook });
  app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  });
  app.use(requestLogger(deps.logger));
  app.route('/', health);
  app.route('/api/v1', authRoutes(ctx));
  app.route('/api/v1', sessionRoutes(ctx));
  app.onError((err, c) => {
    deps.logger.error('unhandled_error', { err });
    return c.json(errorBody('internal_error', 'Error interno del servidor.'), 500);
  });
  return app;
}
