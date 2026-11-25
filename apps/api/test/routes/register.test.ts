// POST /auth/register (T012, paso 1 del registro) contra PostgreSQL real.
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { verifyRegisterCode } from '../../src/auth/email-tokens.js';
import type { Database } from '../../src/db/client.js';
import { buildTestApp } from '../support/app.js';
import { setupTestDb, truncateAll } from '../support/db.js';
import { codeFrom, postJson } from '../support/http.js';

const ARGON = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA';

let db: Database;
let sql: Database['client'];

beforeAll(async () => {
  db = await setupTestDb();
  sql = db.client;
});
beforeEach(async () => {
  await truncateAll(sql);
});
afterAll(async () => {
  await sql.end();
});

function build() {
  return buildTestApp({ db });
}

async function insertUser(email: string) {
  await sql`INSERT INTO users (id, email, password_hash, username, display_name)
            VALUES (${uuidv7()}, ${email}, ${ARGON}, ${email.split('@')[0]!}, 'Nombre')`;
}

function verify(email: string, code: string) {
  return db.db.transaction((tx) => verifyRegisterCode(tx, email, code));
}

describe('POST /auth/register', () => {
  it('correo nuevo: 202 y un correo con el código', async () => {
    const { app, mailer } = build();
    const res = await postJson(app, '/auth/register', { email: 'ana@example.com' });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({});
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.last()!.to).toBe('ana@example.com');
    expect(mailer.last()!.subject).toContain('código');
    expect(codeFrom(mailer.last())).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    const [row] = await sql`SELECT type, user_id FROM email_tokens`;
    expect(row).toEqual({ type: 'register', user_id: null });
  });

  it('correo con cuenta: mismo 202, aviso "ya tienes cuenta" y nada escrito en email_tokens', async () => {
    await insertUser('ana@example.com');
    const { app, mailer } = build();
    const res = await postJson(app, '/auth/register', { email: 'ana@example.com' });
    expect(res.status).toBe(202);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.last()!.subject).toContain('Ya tienes una cuenta');
    expect(mailer.last()!.text).not.toMatch(/[0-9A-Z]{4}-[0-9A-Z]{4}/);
    expect(await sql`SELECT 1 FROM email_tokens`).toHaveLength(0);
  });

  it('respuesta idéntica (estado, cuerpo y cabeceras) exista o no la cuenta', async () => {
    await insertUser('existe@example.com');
    const { app } = build();
    const a = await postJson(app, '/auth/register', { email: 'existe@example.com' });
    const b = await postJson(app, '/auth/register', { email: 'nuevo@example.com' });
    expect(a.status).toBe(b.status);
    expect(await a.text()).toBe(await b.text());
    expect([...a.headers.entries()].sort()).toEqual([...b.headers.entries()].sort());
  });

  it('normaliza el correo (recorta y pasa a minúsculas)', async () => {
    const { app, mailer } = build();
    expect((await postJson(app, '/auth/register', { email: '  Ana@Example.COM ' })).status).toBe(202);
    expect(mailer.last()!.to).toBe('ana@example.com');
  });

  it('correo mal formado o ausente → 422 con formato de error y sin enviar nada', async () => {
    const { app, mailer } = build();
    for (const body of [{ email: 'no-es-correo' }, { email: '' }, {}, { email: 42 }]) {
      const res = await postJson(app, '/auth/register', body);
      expect(res.status).toBe(422);
      const json = (await res.json()) as { error: { code: string; message: string } };
      expect(json.error.code).toBe('validation_error');
    }
    expect(mailer.sent).toHaveLength(0);
  });

  it('repetir invalida el código anterior: solo vale el último', async () => {
    const { app, mailer } = build();
    await postJson(app, '/auth/register', { email: 'ana@example.com' });
    const first = codeFrom(mailer.last());
    await postJson(app, '/auth/register', { email: 'ana@example.com' });
    const second = codeFrom(mailer.last());
    expect(second).not.toBe(first);
    expect((await verify('ana@example.com', first)).ok).toBe(false);
    expect((await verify('ana@example.com', second)).ok).toBe(true);
  });

  it('dos peticiones simultáneas dejan un solo código pendiente y solo uno de los correos enviados vale', async () => {
    for (let i = 0; i < 5; i++) {
      await truncateAll(sql);
      const { app, mailer } = build();
      const [a, b] = await Promise.all([
        postJson(app, '/auth/register', { email: 'ana@example.com' }),
        postJson(app, '/auth/register', { email: 'ana@example.com' }),
      ]);
      expect([a.status, b.status]).toEqual([202, 202]);
      expect(await a.text()).toBe(await b.text());
      const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM email_tokens WHERE used_at IS NULL`;
      expect(row!.n).toBe(1);
      expect(mailer.sent.length).toBeGreaterThanOrEqual(1);
      expect(mailer.sent.length).toBeLessThanOrEqual(2);
      // De todos los códigos enviados, exactamente uno es el que quedó pendiente.
      const valid = await Promise.all(mailer.sent.map((m) => verify('ana@example.com', codeFrom(m))));
      expect(valid.filter((v) => v.ok)).toHaveLength(1);
    }
  });

  it('purga los register caducados hace más de un día', async () => {
    const { app } = build();
    await postJson(app, '/auth/register', { email: 'viejo@example.com' });
    await sql`UPDATE email_tokens SET created_at = now() - interval '3 days', expires_at = now() - interval '2 days'`;
    await postJson(app, '/auth/register', { email: 'otro@example.com' });
    const rows = await sql<{ email: string }[]>`SELECT email FROM email_tokens`;
    expect(rows).toEqual([{ email: 'otro@example.com' }]);
  });

  it('un fallo de SMTP no cambia el 202 y se registra sin el contenido del correo', async () => {
    const { app, logs, mailer } = build();
    mailer.send = async () => {
      throw new Error('SMTP caído');
    };
    const res = await postJson(app, '/auth/register', { email: 'ana@example.com' });
    expect(res.status).toBe(202);
    await new Promise((r) => setTimeout(r, 20));
    expect(logs.some((l) => l.includes('mail_send_failed'))).toBe(true);
  });

  it('limita por correo: la 4.ª petición en una hora → 429 con Retry-After', async () => {
    const { app } = build();
    for (let i = 0; i < 3; i++) {
      const res = await postJson(app, '/auth/register', { email: 'ana@example.com' }, { 'x-forwarded-for': `10.0.0.${i}` });
      expect(res.status).toBe(202);
    }
    const res = await postJson(app, '/auth/register', { email: 'ANA@example.com' }, { 'x-forwarded-for': '10.0.0.99' });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('rate_limited');
  });

  it('limita por IP: la 11.ª petición con correos distintos → 429', async () => {
    const { app } = build();
    for (let i = 0; i < 10; i++) {
      const res = await postJson(app, '/auth/register', { email: `u${i}@example.com` }, { 'x-forwarded-for': '1.2.3.4' });
      expect(res.status).toBe(202);
    }
    expect((await postJson(app, '/auth/register', { email: 'u99@example.com' }, { 'x-forwarded-for': '1.2.3.4' })).status).toBe(429);
    // Otra IP no se ve afectada.
    expect((await postJson(app, '/auth/register', { email: 'u99@example.com' }, { 'x-forwarded-for': '5.6.7.8' })).status).toBe(202);
  });

  it('el código nunca aparece en la respuesta ni en el log', async () => {
    const { app, mailer, logs } = build();
    const res = await postJson(app, '/auth/register', { email: 'ana@example.com' });
    const code = codeFrom(mailer.last());
    const everything = `${await res.text()}\n${[...res.headers.entries()].join('\n')}\n${logs.join('\n')}`;
    expect(everything).not.toContain(code);
    expect(everything).not.toContain(code.replace('-', ''));
  });
});
