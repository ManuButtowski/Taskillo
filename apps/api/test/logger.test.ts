import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createLogger, REDACTED } from '../src/lib/logger.js';

function capture() {
  const lines: string[] = [];
  return { lines, logger: createLogger({ write: (l) => lines.push(l) }) };
}

describe('logger', () => {
  it('escribe JSON y censura campos sensibles, también anidados', () => {
    const { lines, logger } = capture();
    logger.info('prueba', {
      password: 'hunter2',
      body: { refreshToken: 'abc', email: 'a@b.es', nested: { Authorization: 'Bearer x' } },
      code: 'ABCD1234',
    });
    const out = JSON.parse(lines[0]!);
    expect(out.password).toBe(REDACTED);
    expect(out.body.refreshToken).toBe(REDACTED);
    expect(out.body.nested.Authorization).toBe(REDACTED);
    expect(out.code).toBe(REDACTED);
    expect(out.body.email).toBe('a@b.es');
    expect(lines[0]).not.toContain('hunter2');
  });

  it('registra la ruta sin la cadena de consulta', async () => {
    const { lines, logger } = capture();
    const app = createApp({ logger });
    await app.request('/health?token=SECRETO123');
    expect(lines).toHaveLength(1);
    const out = JSON.parse(lines[0]!);
    expect(out.path).toBe('/health');
    expect(lines[0]).not.toContain('SECRETO123');
  });
});
