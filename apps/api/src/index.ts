import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createLogger } from './lib/logger.js';

const config = loadConfig();
const logger = createLogger({ level: config.NODE_ENV === 'production' ? 'info' : 'debug' });
const app = createApp({ logger });

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  logger.info('listening', { port: info.port });
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
