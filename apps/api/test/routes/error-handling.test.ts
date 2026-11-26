// QA bloque 3, hallazgos 1 y 2: el log de errores internos no lleva valores de consultas ni mensajes
// de proveedores (SC-005), y los errores del propio cliente (JSON mal formado, tipo de contenido)
// responden con su estado y no se registran como error interno.
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { sendInBackground } from '../../src/mail/background.js';
import { createLogger } from '../../src/lib/logger.js';
import { freshIp } from '../support/accounts.js';
import { buildTestApp } from '../support/app.js';
import { testDatabaseUrl } from '../support/db.js';
import { postJson } from '../support/http.js';

const EMAIL = 'secreto-ana@example.com';
const PASSWORD = 'contrasena-que-no-debe-salir-5521';

const opened: Array<{ end: () => Promise<void> }> = [];
afterAll(async () => {
  await Promise.all(opened.map((c) => c.end().catch(() => {})));
});

/** Base cuyo cliente ya está cerrado: cualquier consulta falla con un DrizzleQueryError real. */
async function brokenDb() {
  const database = createDb(testDatabaseUrl(), { onnotice: () => {} });
  await database.client.end();
  return database;
}

describe('hallazgo 1: errores internos sin valores en el log', () => {
  it('un fallo de consulta real (login) responde 500 y no deja correo ni parámetros en el log', async () => {
    const t = buildTestApp({ db: await brokenDb() });
    const res = await postJson(t.app, '/auth/login', {
      email: EMAIL,
      password: PASSWORD,
      device: { id: '0190a0a0-0000-7000-8000-000000000001', platform: 'windows' },
    }, freshIp());
    expect(res.status).toBe(500);
    const logs = t.logs.join('\n');
    expect(logs).toContain('unhandled_error');
    expect(logs).not.toContain(EMAIL);
    expect(logs).not.toContain(PASSWORD);
    expect(logs).not.toMatch(/params:/);
    expect(logs).not.toMatch(/Failed query/);
    expect(logs).not.toMatch(/select /i);
  });

  it('un DrizzleQueryError directo solo deja nombre y código de PostgreSQL', () => {
    const lines: string[] = [];
    const logger = createLogger({ write: (l) => lines.push(l) });
    const cause = Object.assign(new Error(`duplicate key value (${EMAIL})`), {
      code: '23505',
      constraint_name: 'users_email_key',
    });
    logger.error('unhandled_error', {
      err: new DrizzleQueryError('select "password_hash" from users where email = $1', [EMAIL, 'hash-abc123'], cause),
    });
    const out = JSON.parse(lines[0]!);
    expect(out.err.name).toBe('DrizzleQueryError');
    expect(out.err.code).toBe('23505');
    expect(out.err.constraint).toBe('users_email_key');
    expect(lines[0]).not.toContain(EMAIL);
    expect(lines[0]).not.toContain('hash-abc123');
    expect(lines[0]).not.toContain('password_hash');
  });

  it('un fallo de envío de correo no registra el mensaje del proveedor', async () => {
    const lines: string[] = [];
    const logger = createLogger({ write: (l) => lines.push(l) });
    const failing = {
      send: async () => {
        throw Object.assign(new Error(`550 rechazado para ${EMAIL}: enlace https://x/reset?t=TOKEN-SECRETO`), {
          code: 'EENVELOPE',
          command: 'RCPT TO',
          response: `550 ${EMAIL}`,
        });
      },
    };
    sendInBackground(failing, logger, { to: EMAIL, subject: 's', text: 'código ABCD-EFGH', html: '<p>ABCD-EFGH</p>' });
    await new Promise((r) => setTimeout(r, 20));
    expect(lines.join('\n')).toContain('mail_send_failed');
    expect(lines.join('\n')).not.toContain(EMAIL);
    expect(lines.join('\n')).not.toContain('TOKEN-SECRETO');
    expect(lines.join('\n')).not.toContain('ABCD-EFGH');
  });
});

describe('hallazgo 2: errores del cliente no son 500', () => {
  it('JSON mal formado responde 400 invalid_json y no se registra como error', async () => {
    const t = buildTestApp();
    const res = await t.app.request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...freshIp() },
      body: '{"email": ',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('invalid_json');
    expect(typeof body.error.message).toBe('string');
    expect(t.logs.join('\n')).not.toContain('"level":"error"');
    expect(t.logs.join('\n')).not.toContain('unhandled_error');
  });

  it('sin Content-Type JSON responde 415 unsupported_media_type', async () => {
    const t = buildTestApp();
    const res = await t.app.request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'text/plain', ...freshIp() },
      body: 'hola',
    });
    expect(res.status).toBe(415);
    expect(((await res.json()) as any).error.code).toBe('unsupported_media_type');
    expect(t.logs.join('\n')).not.toContain('"level":"error"');
  });
});
