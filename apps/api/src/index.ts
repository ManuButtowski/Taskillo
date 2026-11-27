import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { createLogger } from './lib/logger.js';
import { schedulePrune, SlidingWindowLimiter } from './lib/rate-limit.js';
import { createMailer } from './mail/index.js';

const config = loadConfig();
const logger = createLogger({ level: config.NODE_ENV === 'production' ? 'info' : 'debug' });
const database = createDb(config.DATABASE_URL);
const limiter = new SlidingWindowLimiter();
// Purga periódica del limitador; el timer no impide cerrar el proceso.
schedulePrune(limiter);

const app = createApp({
  logger,
  db: database,
  mailer: createMailer(config),
  jwtSecret: config.JWT_SECRET,
  trustProxy: config.TRUST_PROXY,
  publicBaseUrl: config.PUBLIC_BASE_URL,
  limiter,
});

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  logger.info('listening', { port: info.port });
});

const shutdown = () =>
  server.close(() => {
    void database.client.end().finally(() => process.exit(0));
  });
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
