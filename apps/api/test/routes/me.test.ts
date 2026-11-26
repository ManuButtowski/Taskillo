// T018 · perfil: GET /me, PATCH /me y POST /me/password.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/db/client.js';
import { freshIp, loginBody, PASSWORD, registerAccount, type Account } from '../support/accounts.js';
import { buildTestApp } from '../support/app.js';
import { setupTestDb, truncateAll } from '../support/db.js';
import { bearer, getJson, patchJson, postJson, resetTokenFrom } from '../support/http.js';

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

const changePassword = (t: ReturnType<typeof buildTestApp>, a: Account, currentPassword: string, newPassword: string) =>
  postJson(t.app, '/me/password', { currentPassword, newPassword }, bearer(a.accessToken));

describe('sin sesión', () => {
  it('las tres rutas dan 401', async () => {
    const t = buildTestApp({ db });
    expect((await getJson(t.app, '/me')).status).toBe(401);
    expect((await patchJson(t.app, '/me', { displayName: 'X' })).status).toBe(401);
    expect((await postJson(t.app, '/me/password', { currentPassword: 'a', newPassword: 'b' })).status).toBe(401);
  });
});

describe('GET /me', () => {
  it('devuelve el usuario del token, sin hash ni datos de otros', async () => {
    const t = buildTestApp({ db });
    const ana = await registerAccount(t, 'ana@example.com', { username: 'ana_g' });
    await registerAccount(t, 'luis@example.com', { username: 'luis' });
    const res = await getJson(t.app, '/me', bearer(ana.accessToken));
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.user).toEqual({
      id: ana.userId,
      email: 'ana@example.com',
      username: 'ana_g',
      displayName: 'Nombre Visible',
      timezone: 'Europe/Madrid',
    });
    expect(JSON.stringify(body)).not.toMatch(/argon2|passwordHash|password_hash/i);
  });
});

describe('PATCH /me', () => {
  it('cambia el nombre visible (recortado) y solo el del usuario del token', async () => {
    const t = buildTestApp({ db });
    const ana = await registerAccount(t, 'ana@example.com');
    const luis = await registerAccount(t, 'luis@example.com');
    const res = await patchJson(t.app, '/me', { displayName: '  Ana García  ' }, bearer(ana.accessToken));
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).user.displayName).toBe('Ana García');
    const other = (await (await getJson(t.app, '/me', bearer(luis.accessToken))).json()) as any;
    expect(other.user.displayName).toBe('Nombre Visible');
  });

  it('rechaza un nombre vacío, de solo espacios o de más de 100 caracteres (422)', async () => {
    const t = buildTestApp({ db });
    const ana = await registerAccount(t, 'ana@example.com');
    for (const displayName of ['', '   ', 'x'.repeat(101)]) {
      const res = await patchJson(t.app, '/me', { displayName }, bearer(ana.accessToken));
      expect(res.status, JSON.stringify(displayName)).toBe(422);
      expect(((await res.json()) as any).error.code).toBe('validation_error');
    }
    expect((await patchJson(t.app, '/me', {}, bearer(ana.accessToken))).status).toBe(422);
  });
});

describe('POST /me/password', () => {
  it('cambia la contraseña, revoca las demás sesiones y conserva la actual', async () => {
    const t = buildTestApp({ db });
    const ana = await registerAccount(t, 'ana@example.com');
    const other = ((await (await postJson(t.app, '/auth/login', loginBody(ana), freshIp())).json()) as any).tokens;

    const res = await changePassword(t, ana, PASSWORD, NEW_PASSWORD);
    expect(res.status).toBe(204);

    // La actual sigue: su refresh token rota; la otra queda revocada.
    expect((await postJson(t.app, '/auth/refresh', { refreshToken: ana.refreshToken })).status).toBe(200);
    expect((await postJson(t.app, '/auth/refresh', { refreshToken: other.refreshToken })).status).toBe(401);
    expect((await postJson(t.app, '/auth/login', loginBody(ana), freshIp())).status).toBe(401);
    expect((await postJson(t.app, '/auth/login', loginBody({ email: ana.email, password: NEW_PASSWORD }), freshIp())).status).toBe(200);
  });

  it('con la contraseña actual errónea da 403 invalid_credentials y no cambia nada', async () => {
    const t = buildTestApp({ db });
    const ana = await registerAccount(t, 'ana@example.com');
    const res = await changePassword(t, ana, 'no-es-la-actual-123', NEW_PASSWORD);
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).error.code).toBe('invalid_credentials');
    expect((await postJson(t.app, '/auth/login', loginBody(ana), freshIp())).status).toBe(200);
  });

  it('una contraseña nueva no válida da 422 weak_password y no revoca sesiones', async () => {
    const t = buildTestApp({ db });
    const ana = await registerAccount(t, 'ana@example.com', { username: 'ana_g' });
    const other = ((await (await postJson(t.app, '/auth/login', loginBody(ana), freshIp())).json()) as any).tokens;
    for (const bad of ['corta', 'ana_g', 'ana@example.com', 'password123']) {
      const res = await changePassword(t, ana, PASSWORD, bad);
      expect(res.status, bad).toBe(422);
      expect(((await res.json()) as any).error.code).toBe('weak_password');
    }
    expect((await postJson(t.app, '/auth/refresh', { refreshToken: other.refreshToken })).status).toBe(200);
  });

  it('invalida los enlaces de recuperación pendientes', async () => {
    const t = buildTestApp({ db });
    const ana = await registerAccount(t, 'ana@example.com');
    await postJson(t.app, '/auth/forgot-password', { email: ana.email }, freshIp());
    await new Promise((r) => setTimeout(r, 20));
    const token = resetTokenFrom(t.mailer.last());
    expect((await changePassword(t, ana, PASSWORD, NEW_PASSWORD)).status).toBe(204);
    const res = await postJson(t.app, '/auth/reset-password', { token, newPassword: 'otra-contrasena-larga-8820' });
    expect(res.status).toBe(400);
  });

  it('solo afecta al usuario del token', async () => {
    const t = buildTestApp({ db });
    const ana = await registerAccount(t, 'ana@example.com');
    const luis = await registerAccount(t, 'luis@example.com');
    await changePassword(t, ana, PASSWORD, NEW_PASSWORD);
    expect((await postJson(t.app, '/auth/login', loginBody(luis), freshIp())).status).toBe(200);
    expect((await postJson(t.app, '/auth/refresh', { refreshToken: luis.refreshToken })).status).toBe(200);
  });

  it('faltan campos: 422', async () => {
    const t = buildTestApp({ db });
    const ana = await registerAccount(t, 'ana@example.com');
    expect((await postJson(t.app, '/me/password', { currentPassword: PASSWORD }, bearer(ana.accessToken))).status).toBe(422);
  });
});
