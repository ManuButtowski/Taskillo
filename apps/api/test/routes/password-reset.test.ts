// T017 · recuperación de contraseña: POST /auth/forgot-password y GET/POST /auth/reset-password.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/db/client.js';
import { freshIp, loginBody, PASSWORD, registerAccount } from '../support/accounts.js';
import { buildTestApp } from '../support/app.js';
import { setupTestDb, truncateAll } from '../support/db.js';
import { FakeClock } from '../support/fake-clock.js';
import { getJson, postForm, postJson, resetTokenFrom } from '../support/http.js';

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

const NEW_PASSWORD = 'nueva-contrasena-segura-5512';

function build() {
  const clock = new FakeClock();
  const t = buildTestApp({ db, timing: { clock, floorMs: 50 } });
  return { ...t, clock };
}
type T = ReturnType<typeof build>;

/** Esperar a que el envío en segundo plano llegue al FakeMailer. */
const flush = () => new Promise((r) => setTimeout(r, 20));

async function requestLink(t: T, email: string): Promise<string> {
  const res = await postJson(t.app, '/auth/forgot-password', { email }, freshIp());
  expect(res.status).toBe(202);
  await flush();
  return resetTokenFrom(t.mailer.last());
}

const reset = (t: T, token: string, newPassword = NEW_PASSWORD) =>
  postJson(t.app, '/auth/reset-password', { token, newPassword });

describe('POST /auth/forgot-password', () => {
  it('responde igual (estado, cuerpo y cabeceras) exista o no el correo', async () => {
    const t = build();
    await registerAccount(t, 'ana@example.com');
    t.mailer.clear();
    const known = await postJson(t.app, '/auth/forgot-password', { email: 'ana@example.com' }, freshIp());
    const unknown = await postJson(t.app, '/auth/forgot-password', { email: 'nadie@example.com' }, freshIp());
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(known.status);
    expect(await unknown.text()).toBe(await known.text());
    expect([...unknown.headers.entries()].sort()).toEqual([...known.headers.entries()].sort());
    await flush();
    expect(t.mailer.sent).toHaveLength(1);
    expect(t.mailer.sent[0]!.to).toBe('ana@example.com');
    expect(t.mailer.to('nadie@example.com')).toHaveLength(0);
  });

  it('el correo lleva un enlace /auth/reset-password?token= y en la base solo hay el hash', async () => {
    const t = build();
    await registerAccount(t, 'ana@example.com');
    const token = await requestLink(t, 'ana@example.com');
    expect(t.mailer.last()!.text).toContain(`/api/v1/auth/reset-password?token=${token}`);
    const rows = await sql<{ token_hash: string }[]>`SELECT token_hash FROM email_tokens WHERE type='reset_password'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash).not.toContain(token);
  });

  it('aplica el mismo suelo de 50 ms exista o no el correo (reloj falso)', async () => {
    const t = build();
    await registerAccount(t, 'ana@example.com');
    t.clock.sleeps.length = 0;
    await postJson(t.app, '/auth/forgot-password', { email: 'ana@example.com' }, freshIp());
    expect(t.clock.sleeps).toEqual([50]);
    t.clock.sleeps.length = 0;
    await postJson(t.app, '/auth/forgot-password', { email: 'nadie@example.com' }, freshIp());
    expect(t.clock.sleeps).toEqual([50]);
  });

  it('un correo mal formado da 422 y un segundo enlace invalida el primero', async () => {
    const t = build();
    expect((await postJson(t.app, '/auth/forgot-password', { email: 'no-es-correo' }, freshIp())).status).toBe(422);
    await registerAccount(t, 'ana@example.com');
    const first = await requestLink(t, 'ana@example.com');
    const second = await requestLink(t, 'ana@example.com');
    expect((await reset(t, first)).status).toBe(400);
    expect((await reset(t, second)).status).toBe(200);
  });
});

describe('GET /auth/reset-password', () => {
  it('sirve una página HTML en español con Referrer-Policy y Cache-Control, sin consumir el token', async () => {
    const t = build();
    await registerAccount(t, 'ana@example.com');
    const token = await requestLink(t, 'ana@example.com');
    const res = await getJson(t.app, `/auth/reset-password?token=${token}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('cache-control')).toContain('no-store');
    const html = await res.text();
    expect(html).toContain('lang="es"');
    expect(html).toContain('Nueva contraseña');
    expect(html).not.toMatch(/(src|href)="https?:/);
    // El GET no consume: abrirlo dos veces y después restablecer sigue valiendo.
    expect((await getJson(t.app, `/auth/reset-password?token=${token}`)).status).toBe(200);
    expect((await reset(t, token)).status).toBe(200);
  });

  it('un enlace inválido, usado o sin token da una página de error con las mismas cabeceras', async () => {
    const t = build();
    await registerAccount(t, 'ana@example.com');
    const token = await requestLink(t, 'ana@example.com');
    await reset(t, token);
    for (const path of [`/auth/reset-password?token=${token}`, '/auth/reset-password?token=basura', '/auth/reset-password']) {
      const res = await getJson(t.app, path);
      expect(res.status, path).toBe(400);
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
      expect(res.headers.get('cache-control')).toContain('no-store');
      const html = await res.text();
      expect(html).toContain('no es válido o ha caducado');
      expect(html).not.toContain(token);
    }
  });
});

describe('POST /auth/reset-password', () => {
  it('cambia la contraseña, revoca todas las sesiones y el enlace es de un solo uso', async () => {
    const t = build();
    const ana = await registerAccount(t, 'ana@example.com');
    const second = await postJson(t.app, '/auth/login', loginBody(ana), freshIp());
    const secondTokens = ((await second.json()) as any).tokens;
    const token = await requestLink(t, 'ana@example.com');

    const res = await reset(t, token);
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain(token);

    expect((await postJson(t.app, '/auth/refresh', { refreshToken: ana.refreshToken })).status).toBe(401);
    expect((await postJson(t.app, '/auth/refresh', { refreshToken: secondTokens.refreshToken })).status).toBe(401);
    expect((await postJson(t.app, '/auth/login', loginBody(ana), freshIp())).status).toBe(401);
    expect((await postJson(t.app, '/auth/login', loginBody({ email: ana.email, password: NEW_PASSWORD }), freshIp())).status).toBe(200);

    const again = await reset(t, token);
    expect(again.status).toBe(400);
    expect(((await again.json()) as any).error.code).toBe('invalid_token');
  });

  it('rechaza un token caducado', async () => {
    const t = build();
    await registerAccount(t, 'ana@example.com');
    const token = await requestLink(t, 'ana@example.com');
    await sql`UPDATE email_tokens SET created_at = now() - interval '3 hours', expires_at = now() - interval '2 hours' WHERE type = 'reset_password'`;
    expect((await reset(t, token)).status).toBe(400);
    expect((await getJson(t.app, `/auth/reset-password?token=${token}`)).status).toBe(400);
  });

  it('un código de registro no sirve para restablecer', async () => {
    const t = build();
    await postJson(t.app, '/auth/register', { email: 'nuevo@example.com' }, freshIp());
    await flush();
    const code = t.mailer.last()!.text.match(/\b([0-9A-Z]{4}-[0-9A-Z]{4})\b/)![1]!;
    expect((await reset(t, code)).status).toBe(400);
    expect((await reset(t, code.replace('-', ''))).status).toBe(400);
  });

  it('rechaza un token inventado y un token si el correo de la cuenta cambió', async () => {
    const t = build();
    const ana = await registerAccount(t, 'ana@example.com');
    expect((await reset(t, 'x'.repeat(43))).status).toBe(400);
    const token = await requestLink(t, 'ana@example.com');
    await sql`UPDATE users SET email = 'otro@example.com' WHERE id = ${ana.userId}`;
    expect((await reset(t, token)).status).toBe(400);
  });

  it('una contraseña no válida da 422 sin gastar el enlace', async () => {
    const t = build();
    await registerAccount(t, 'ana@example.com');
    const token = await requestLink(t, 'ana@example.com');
    const weak = await reset(t, token, 'corta');
    expect(weak.status).toBe(422);
    expect(((await weak.json()) as any).error.code).toBe('weak_password');
    expect((await reset(t, token, 'ana@example.com')).status).toBe(422);
    expect((await reset(t, token)).status).toBe(200);
  });

  it('faltan campos: 422', async () => {
    const t = build();
    expect((await postJson(t.app, '/auth/reset-password', { token: 'abc' })).status).toBe(422);
  });

  it('por formulario responde con una página HTML (éxito y error) sin repetir contraseñas', async () => {
    const t = build();
    await registerAccount(t, 'ana@example.com');
    const token = await requestLink(t, 'ana@example.com');

    const weak = await postForm(t.app, '/auth/reset-password', { token, newPassword: 'corta' });
    expect(weak.status).toBe(422);
    expect(weak.headers.get('content-type')).toContain('text/html');
    expect(weak.headers.get('referrer-policy')).toBe('no-referrer');
    expect(weak.headers.get('cache-control')).toContain('no-store');
    expect(await weak.text()).toContain('al menos 10');

    const ok = await postForm(t.app, '/auth/reset-password', { token, newPassword: NEW_PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('referrer-policy')).toBe('no-referrer');
    const html = await ok.text();
    expect(html).toContain('contraseña');
    expect(html).not.toContain(token);
    expect(html).not.toContain(NEW_PASSWORD);

    const used = await postForm(t.app, '/auth/reset-password', { token, newPassword: NEW_PASSWORD });
    expect(used.status).toBe(400);
    expect(await used.text()).not.toContain(token);
  });

  it('no toca a otros usuarios', async () => {
    const t = build();
    await registerAccount(t, 'ana@example.com');
    const luis = await registerAccount(t, 'luis@example.com');
    const token = await requestLink(t, 'ana@example.com');
    await reset(t, token);
    expect((await postJson(t.app, '/auth/refresh', { refreshToken: luis.refreshToken })).status).toBe(200);
    expect((await postJson(t.app, '/auth/login', loginBody(luis), freshIp())).status).toBe(200);
    expect(PASSWORD).not.toBe(NEW_PASSWORD);
  });
});

describe('POST /auth/reset-password · límite por IP (T019a)', () => {
  it('la petición 21 desde la misma IP da 429 con Retry-After; otra IP no se ve afectada', async () => {
    const t = buildTestApp({ db });
    const ip = { 'x-forwarded-for': '10.9.9.9' };
    for (let i = 0; i < 20; i++) {
      const res = await postJson(t.app, '/auth/reset-password', { token: 'basura', newPassword: NEW_PASSWORD }, ip);
      expect(res.status).toBe(400);
    }
    const blocked = await postForm(t.app, '/auth/reset-password', { token: 'basura', newPassword: NEW_PASSWORD }, ip);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    const other = await postJson(t.app, '/auth/reset-password', { token: 'basura', newPassword: NEW_PASSWORD }, { 'x-forwarded-for': '10.9.9.10' });
    expect(other.status).toBe(400);
  });
});
