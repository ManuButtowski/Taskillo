import { createApp, type AppDeps } from '../../src/app.js';
import { createLogger, type Logger } from '../../src/lib/logger.js';
import { FakeMailer } from './fake-mailer.js';

export interface TestApp {
  app: ReturnType<typeof createApp>;
  mailer: FakeMailer;
  logs: string[];
}

/** Fábrica de la app para tests: logger que captura las líneas, FakeMailer y lo que se inyecte encima. */
export function buildTestApp(overrides: Partial<AppDeps> = {}): TestApp {
  const logs: string[] = [];
  const logger: Logger = createLogger({ write: (line: string) => void logs.push(line) });
  const mailer = new FakeMailer();
  const app = createApp({ logger, mailer, ...overrides });
  return { app, mailer, logs };
}
