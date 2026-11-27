// T016 · SC-005: ninguna respuesta ni línea de log contiene contraseñas, hashes, códigos de registro
// ni tokens (salvo los `Tokens` recién emitidos en la respuesta que los emite), y la limitación de
// frecuencia actúa en login y en los dos pasos del registro.
// T017 añade la recuperación de contraseña: limitación de frecuencia y token ausente de respuestas y logs.
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/db/client.js';
import { freshIp, loginBody, PASSWORD, registerAccount } from '../support/accounts.js';
import { buildTestApp } from '../support/app.js';
import { setupTestDb, truncateAll } from '../support/db.js';
import { bearer, codeFrom, del, getJson, postForm, postJson, resetTokenFrom } from '../support/http.js';

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

interface Recorded {
  label: string;
  status: number;
  /** Cabeceras y cuerpo tal como los vería el cliente. */
  text: string;
  /** Tokens emitidos legítimamente por esta respuesta. */
  issued: string[];
  /** Refresh tokens emitidos (aleatorios y únicos; el JWT de acceso se repite si se emite en el mismo segundo). */
  issuedRefresh: string[];
}

const WRONG_PASSWORD = 'contrasena-equivocada-4455';
const SECOND_PASSWORD = 'otra-contrasena-larga-8820';

describe('SC-005: no se filtran secretos', () => {
  it('recorre registro, login, refresh, reutilización, sesiones y cierres sin filtrar nada', async () => {
    const t = buildTestApp({ db });
    const recorded: Recorded[] = [];
    const codes: string[] = [];
    const secretsGiven = [PASSWORD, WRONG_PASSWORD, SECOND_PASSWORD];

    async function call(label: string, res: Response): Promise<{ json: any; status: number }> {
      const text = await res.text();
      const headers = [...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join('\n');
      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {
        // 204 u otros sin cuerpo
      }
      const tokens = json?.tokens ?? null;
      recorded.push({
        label,
        status: res.status,
        text: `${headers}\n${text}`,
        issued: tokens ? [tokens.accessToken, tokens.refreshToken] : [],
        issuedRefresh: tokens ? [tokens.refreshToken] : [],
      });
      return { json, status: res.status };
    }

    const email = 'ana@example.com';
    // Paso 1 (correo nuevo y, después, correo ya registrado) y paso 2.
    await call('register-1', await postJson(t.app, '/auth/register', { email }, freshIp()));
    const code = codeFrom(t.mailer.last());
    codes.push(code, code.replace('-', ''));
    await call('complete-mal', await postJson(t.app, '/auth/register/complete', {
      email, code: 'ZZZZ-ZZZZ', username: 'ana', displayName: 'Ana', password: PASSWORD,
      device: { id: uuidv7(), platform: 'windows' },
    }, freshIp()));
    const deviceId = uuidv7();
    const reg = await call('complete', await postJson(t.app, '/auth/register/complete', {
      email, code, username: 'ana', displayName: 'Ana', password: PASSWORD,
      device: { id: deviceId, platform: 'windows', name: 'PC' },
    }, freshIp()));
    expect(reg.status).toBe(201);
    await call('register-1-existente', await postJson(t.app, '/auth/register', { email }, freshIp()));
    await call('complete-contraseña-débil-422', await postJson(t.app, '/auth/register/complete', {
      email: 'otra@example.com', code, username: 'x', displayName: 'X', password: 'corta',
      device: { id: uuidv7(), platform: 'windows' },
    }, freshIp()));

    // Login correcto, fallido y con validación errónea.
    const login = await call('login', await postJson(t.app, '/auth/login', loginBody({ email, password: PASSWORD }), freshIp()));
    await call('login-mal', await postJson(t.app, '/auth/login', loginBody({ email, password: WRONG_PASSWORD }), freshIp()));
    await call('login-422', await postJson(t.app, '/auth/login', { email, password: SECOND_PASSWORD }, freshIp()));

    // Refresh correcto, reutilización y token inexistente.
    const rotated = await call('refresh', await postJson(t.app, '/auth/refresh', { refreshToken: reg.json.tokens.refreshToken }));
    await call('refresh-reuse', await postJson(t.app, '/auth/refresh', { refreshToken: reg.json.tokens.refreshToken }));
    await call('refresh-basura', await postJson(t.app, '/auth/refresh', { refreshToken: 'x'.repeat(40) }));

    // Sesiones, cierres y borrado.
    const access = login.json.tokens.accessToken as string;
    await call('sessions', await getJson(t.app, '/me/sessions', bearer(access)));
    await call('sessions-sin-token', await getJson(t.app, '/me/sessions'));
    await call('delete-ajeno', await del(t.app, `/me/sessions/${uuidv7()}`, bearer(access)));
    await call('logout', await postJson(t.app, '/auth/logout', undefined, bearer(access)));
    await call('logout-all', await postJson(t.app, '/auth/logout-all', undefined, bearer(rotated.json.tokens.accessToken)));

    // Secretos de la base de datos.
    const hashes = [
      ...(await sql<{ v: string }[]>`SELECT password_hash AS v FROM users`),
      ...(await sql<{ v: string }[]>`SELECT refresh_token_hash AS v FROM sessions`),
      ...(await sql<{ v: string }[]>`SELECT token_hash AS v FROM email_tokens`),
    ].map((r) => r.v);
    expect(hashes.length).toBeGreaterThan(3);

    const issuedTokens = recorded.flatMap((r) => r.issued);
    expect(issuedTokens.length).toBeGreaterThanOrEqual(6);

    const allLogs = t.logs.join('\n');
    // 1. Los logs no contienen ningún secreto ni ningún token (ni siquiera los emitidos).
    for (const secret of [...secretsGiven, ...codes, ...hashes, ...issuedTokens]) {
      expect(allLogs, 'log').not.toContain(secret);
    }
    // 2. Ninguna respuesta contiene contraseñas, hashes ni códigos de registro.
    for (const r of recorded) {
      for (const secret of [...secretsGiven, ...codes, ...hashes]) {
        expect(r.text, r.label).not.toContain(secret);
      }
      expect(r.text, r.label).not.toMatch(/argon2|password_hash|passwordHash/i);
    }
    // 3. Un refresh token emitido aparece solo en la respuesta que lo emitió.
    for (const r of recorded) {
      for (const other of recorded) {
        if (other === r) continue;
        for (const token of r.issuedRefresh) expect(other.text, `${other.label} filtra token de ${r.label}`).not.toContain(token);
      }
    }
    // 4. Las respuestas de error no repiten los valores enviados.
    expect(recorded.find((r) => r.label === 'login-422')!.text).not.toContain(email);
  });

  it('un error interno tampoco filtra datos: el log lleva el nombre y el mensaje, no la petición', async () => {
    const t = buildTestApp({ db });
    t.app.get('/boom', () => {
      throw new Error('fallo inesperado');
    });
    const res = await t.app.request('/boom?token=SECRETO-DE-PRUEBA', { headers: bearer('JWT-DE-PRUEBA') });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('fallo inesperado');
    const logs = t.logs.join('\n');
    expect(logs).not.toContain('SECRETO-DE-PRUEBA');
    expect(logs).not.toContain('JWT-DE-PRUEBA');
  });
});

describe('SC-005: la limitación de frecuencia actúa', () => {
  it('login: por correo (5) y por IP (10)', async () => {
    const t = buildTestApp({ db });
    for (let i = 0; i < 5; i++) {
      const res = await postJson(t.app, '/auth/login', loginBody({ email: 'x@example.com', password: WRONG_PASSWORD }), freshIp());
      expect(res.status).toBe(401);
    }
    expect((await postJson(t.app, '/auth/login', loginBody({ email: 'x@example.com', password: WRONG_PASSWORD }), freshIp())).status).toBe(429);

    const headers = { 'x-forwarded-for': '10.9.9.9' };
    for (let i = 0; i < 10; i++) {
      expect((await postJson(t.app, '/auth/login', loginBody({ email: `y${i}@example.com`, password: WRONG_PASSWORD }), headers)).status).toBe(401);
    }
    expect((await postJson(t.app, '/auth/login', loginBody({ email: 'y99@example.com', password: WRONG_PASSWORD }), headers)).status).toBe(429);
  });

  it('registro paso 1: por correo (3) y por IP (10)', async () => {
    const t = buildTestApp({ db });
    for (let i = 0; i < 3; i++) expect((await postJson(t.app, '/auth/register', { email: 'a@example.com' }, freshIp())).status).toBe(202);
    expect((await postJson(t.app, '/auth/register', { email: 'a@example.com' }, freshIp())).status).toBe(429);

    const headers = { 'x-forwarded-for': '10.8.8.8' };
    for (let i = 0; i < 10; i++) expect((await postJson(t.app, '/auth/register', { email: `b${i}@example.com` }, headers)).status).toBe(202);
    expect((await postJson(t.app, '/auth/register', { email: 'b99@example.com' }, headers)).status).toBe(429);
  });

  it('registro paso 2: por IP (10)', async () => {
    const t = buildTestApp({ db });
    const headers = { 'x-forwarded-for': '10.7.7.7' };
    const body = {
      email: 'a@example.com', code: 'ZZZZ-ZZZZ', username: 'abc', displayName: 'A', password: PASSWORD,
      device: { id: uuidv7(), platform: 'windows' },
    };
    for (let i = 0; i < 10; i++) expect((await postJson(t.app, '/auth/register/complete', body, headers)).status).toBe(400);
    const res = await postJson(t.app, '/auth/register/complete', body, headers);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).not.toBeNull();
  });

  it('recuperación de contraseña: por correo (3) y por IP (10)', async () => {
    const t = buildTestApp({ db });
    for (let i = 0; i < 3; i++) expect((await postJson(t.app, '/auth/forgot-password', { email: 'a@example.com' }, freshIp())).status).toBe(202);
    const blocked = await postJson(t.app, '/auth/forgot-password', { email: 'a@example.com' }, freshIp());
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).not.toBeNull();

    const headers = { 'x-forwarded-for': '10.6.6.6' };
    for (let i = 0; i < 10; i++) expect((await postJson(t.app, '/auth/forgot-password', { email: `c${i}@example.com` }, headers)).status).toBe(202);
    expect((await postJson(t.app, '/auth/forgot-password', { email: 'c99@example.com' }, headers)).status).toBe(429);
  });
});

describe('SC-005: la recuperación de contraseña no filtra el token', () => {
  it('el token solo está en el correo y en la URL de la petición: ni en respuestas de otras rutas ni en logs', async () => {
    const t = buildTestApp({ db });
    const account = await registerAccountForReset(t);
    await postJson(t.app, '/auth/forgot-password', { email: account.email }, freshIp());
    await new Promise((r) => setTimeout(r, 20));
    const token = resetTokenFrom(t.mailer.last());
    const hashes = (await sql<{ v: string }[]>`SELECT token_hash AS v FROM email_tokens WHERE type = 'reset_password'`).map((r) => r.v);

    const responses: { label: string; text: string }[] = [];
    const record = async (label: string, res: Response) => {
      const headers = [...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join('\n');
      responses.push({ label, text: `${headers}\n${await res.text()}` });
    };
    await record('forgot-existente', await postJson(t.app, '/auth/forgot-password', { email: account.email }, freshIp()));
    await record('forgot-inexistente', await postJson(t.app, '/auth/forgot-password', { email: 'nadie@example.com' }, freshIp()));
    await record('reset-debil', await postJson(t.app, '/auth/reset-password', { token: 'basura', newPassword: SECOND_PASSWORD }));
    await record('reset-form-mal', await postForm(t.app, '/auth/reset-password', { token: 'basura', newPassword: 'corta' }));
    await record('get-basura', await getJson(t.app, '/auth/reset-password?token=basura'));
    // El enlace del correo anterior quedó invalidado por el segundo forgot-password; el último es el vigente.
    const current = resetTokenFrom(t.mailer.last());
    await record('reset-ok', await postJson(t.app, '/auth/reset-password', { token: current, newPassword: SECOND_PASSWORD }));
    await record('reset-reuso', await postJson(t.app, '/auth/reset-password', { token: current, newPassword: SECOND_PASSWORD }));
    await record('reset-form-reuso', await postForm(t.app, '/auth/reset-password', { token: current, newPassword: SECOND_PASSWORD }));

    for (const r of responses) {
      for (const secret of [token, current, SECOND_PASSWORD, ...hashes]) expect(r.text, r.label).not.toContain(secret);
    }
    const logs = t.logs.join('\n');
    for (const secret of [token, current, SECOND_PASSWORD, PASSWORD, ...hashes]) expect(logs, 'log').not.toContain(secret);
    // Las rutas con ?token= se registran sin la consulta.
    expect(logs).not.toContain('token=');
  });

  it('GET con token en la URL no deja el token en el log aunque la ruta falle', async () => {
    const t = buildTestApp({ db });
    await getJson(t.app, '/auth/reset-password?token=TOKEN-SECRETO-DE-PRUEBA');
    expect(t.logs.join('\n')).not.toContain('TOKEN-SECRETO-DE-PRUEBA');
  });
});

async function registerAccountForReset(t: ReturnType<typeof buildTestApp>) {
  return registerAccount(t, 'recupera@example.com');
}
