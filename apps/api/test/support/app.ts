import { createApp, type AppDeps } from '../../src/app.js';
import { createLogger, type Logger } from '../../src/lib/logger.js';
import { FakeMailer } from './fake-mailer.js';

export const TEST_JWT_SECRET = 'secreto-de-test-con-al-menos-32-caracteres-ok';

export interface TestApp {
  app: ReturnType<typeof createApp>;
  mailer: FakeMailer;
  logs: string[];
}

/**
 * Fábrica de la app para tests: logger que captura las líneas, FakeMailer, secreto de test y
 * `trustProxy` activo (así cada test puede fijar la IP con X-Forwarded-For), más lo que se inyecte.
 */
export function buildTestApp(overrides: Partial<AppDeps> = {}): TestApp {
  const logs: string[] = [];
  const logger: Logger = createLogger({ write: (line: string) => void logs.push(line) });
  const mailer = new FakeMailer();
  const app = createApp({ logger, mailer, jwtSecret: TEST_JWT_SECRET, trustProxy: true, ...overrides });
  return { app, mailer, logs };
}
