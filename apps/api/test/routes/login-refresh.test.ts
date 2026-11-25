// POST /auth/login y POST /auth/refresh (T014) contra PostgreSQL real.
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { verifyAccessToken } from '../../src/auth/tokens.js';
import type { Database } from '../../src/db/client.js';
import { freshIp, loginBody, PASSWORD, registerAccount } from '../support/accounts.js';
import { buildTestApp, TEST_JWT_SECRET } from '../support/app.js';
import { setupTestDb, truncateAll } from '../support/db.js';
import { postJson } from '../support/http.js';

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

type Tokens = { accessToken: string; refreshToken: string; expiresIn: number };
const WRONG = 'mala-contrasena-larga-1';

describe('POST /auth/login', () => {
  it('200 con user y tokens; registra el dispositivo con su plataforma y nombre', async () => {
    const t = buildTestApp({ db });
    const ana = await registerAccount(t, 'ana@example.com');
    const device = { id: uuidv7(), platform: 'android', name: 'Pixel de Ana' };
    const res = await postJson(t.app, '/auth/login', loginBody(ana, device), freshIp());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { user: Record<string, unknown>; tokens: Tokens };
    expect(json.user).toEqual({
      id: ana.userId,
      email: 'ana@example.com',
      username: 'ana',
      displayName: 'Nombre Visible',
      timezone: 'Europe/Madrid',
    });
    expect(json.tokens.expiresIn).toBe(900);

    const [row] = await sql<{ platform: string; name: string; user_id: string }[]>`
      SELECT platform, name, user_id FROM devices WHERE id = ${device.id}`;
    expect(row).toEqual({ platform: 'android', name: 'Pixel de Ana', user_id: ana.userId });
    const claims = await verifyAccessToken(json.tokens.accessToken, TEST_JWT_SECRET);
    const [session] = await sql<{ family_id: string }[]>`SELECT family_id FROM sessions WHERE device_id = ${device.id}`;
    expect(claims).toEqual({ userId: ana.userId, familyId: session!.family_id });
  });

  it('cada login crea una familia nueva sin tocar la sesión anterior', async () => {
    const t = buildTestApp({ db });
    const ana = await registerAccount(t, 'ana@example.com');
    await postJson(t.app, '/auth/login', loginBody(ana), freshIp());
    const [row] = await sql<{ n: number; f: number }[]>`
      SELECT count(*)::int AS n, count(DISTINCT family_id)::int AS f FROM sessions WHERE revoked_at IS NULL AND rotated_at IS NULL`;
    expect(row).toEqual({ n: 2, f: 2 });
  });

  it('el correo no distingue mayúsculas ni espacios', async () => {
    const t = buildTestApp({ db });
    const ana = await registerAccount(t, 'ana@example.com');
    const res = await postJson(t.app, '/auth/login', { ...loginBody(ana), email: '  ANA@Example.com ' }, freshIp());
    expect(res.status).toBe(200);
  });

  it('correo inexistente y contraseña errónea dan exactamente el mismo 401', async () => {
    const t = buildTestApp({ db });
    const ana = await registerAccount(t, 'ana@example.com');
    const noExiste = await postJson(t.app, '/auth/login', loginBody({ email: 'nadie@example.com', password: PASSWORD }), freshIp());
    const mala = await postJson(t.app, '/auth/login', loginBody({ ...ana, password: WRONG }), freshIp());
    expect(noExiste.status).toBe(401);
    expect(mala.status).toBe(401);
    const text = await noExiste.text();
    expect(text).toBe(await mala.text());
    expect([...noExiste.headers.entries()].sort()).toEqual([...mala.headers.entries()].sort());
    expect((JSON.parse(text) as { error: { code: string } }).error.code).toBe('invalid_credentials');
  });

  it('un login fallido no crea dispositivo ni sesión', async () => {
    const t = buildTestApp({ db });
    const ana = await registerAccount(t, 'ana@example.com');
    await postJson(t.app, '/auth/login', loginBody({ ...ana, password: WRONG }), freshIp());
    expect(await sql`SELECT 1 FROM devices`).toHaveLength(1);
  });

  it('device_id_conflict (409) solo con credenciales correctas y sin reasignar el dispositivo', async () => {
    const t = buildTestApp({ db });
    const ana = await registerAccount(t, 'ana@example.com');
    const bea = await registerAccount(t, 'bea@example.com');
    // Bea intenta usar el id del dispositivo de Ana.
    const conflict = await postJson(t.app, '/auth/login', loginBody(bea, { id: ana.deviceId }), freshIp());
    expect(conflict.status).toBe(409);
    expect(((await conflict.json()) as { error: { code: string } }).error.code).toBe('device_id_conflict');
    const [d] = await sql<{ user_id: string }[]>`SELECT user_id FROM devices WHERE id = ${ana.deviceId}`;
    expect(d!.user_id).toBe(ana.userId);
    // Con contraseña errónea no se revela que el id exista.
    const wrong = await postJson(t.app, '/auth/login', loginBody({ ...bea, password: WRONG }, { id: ana.deviceId }), freshIp());
    expect(wrong.status).toBe(401);
  });

  it('cuerpo inválido → 422', async () => {
    const t = buildTestApp({ db });
    const bodies = [
      {},
      { email: 'ana@example.com', password: 'x' },
      { email: 'no', password: 'x', device: { id: uuidv7(), platform: 'windows' } },
    ];
    for (const body of bodies) {
      expect((await postJson(t.app, '/auth/login', body, freshIp())).status).toBe(422);
    }
  });

  it('limita por correo: el 6.º intento en 15 min → 429 aunque la contraseña sea correcta', async () => {
    const t = buildTestApp({ db });
    const ana = await registerAccount(t, 'ana@example.com');
    for (let i = 0; i < 5; i++) {
      const res = await postJson(t.app, '/auth/login', loginBody({ ...ana, password: WRONG }), freshIp());
      expect(res.status).toBe(401);
    }
    const res = await postJson(t.app, '/auth/login', loginBody(ana), freshIp());
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    // Otro correo desde otra IP no se ve afectado.
    const bea = await registerAccount(t, 'bea@example.com');
    expect((await postJson(t.app, '/auth/login', loginBody(bea), freshIp())).status).toBe(200);
  });

  it('limita por IP: el 11.º intento desde la misma IP → 429', async () => {
    const t = buildTestApp({ db });
    const headers = { 'x-forwarded-for': '7.7.7.7' };
    for (let i = 0; i < 10; i++) {
      const res = await postJson(t.app, '/auth/login', loginBody({ email: `u${i}@example.com`, password: PASSWORD }), headers);
      expect(res.status).toBe(401);
    }
    const res = await postJson(t.app, '/auth/login', loginBody({ email: 'u99@example.com', password: PASSWORD }), headers);
    expect(res.status).toBe(429);
  });

  it('ni la respuesta ni el log contienen la contraseña ni el hash', async () => {
    const t = buildTestApp({ db });
    const ana = await registerAccount(t, 'ana@example.com');
    const ok = await postJson(t.app, '/auth/login', loginBody(ana), freshIp());
    const bad = await postJson(t.app, '/auth/login', loginBody({ ...ana, password: WRONG }), freshIp());
    const everything = [await ok.text(), await bad.text(), t.logs.join('\n')].join('\n');
    expect(everything).not.toContain(PASSWORD);
    expect(everything).not.toContain(WRONG);
    expect(everything).not.toMatch(/argon2/i);
  });
});

describe('POST /auth/refresh', () => {
  it('rota el refresh token: devuelve tokens nuevos, mantiene la familia y actualiza last_seen_at', async () => {
    const t = buildTestApp({ db });
    const ana = await registerAccount(t, 'ana@example.com');
    await sql`UPDATE devices SET last_seen_at = now() - interval '5 days'`;
    const res = await postJson(t.app, '/auth/refresh', { refreshToken: ana.refreshToken });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { tokens: Tokens };
    expect(Object.keys(json)).toEqual(['tokens']);
    expect(json.tokens.refreshToken).not.toBe(ana.refreshToken);
    expect(json.tokens.expiresIn).toBe(900);

    const oldClaims = await verifyAccessToken(ana.accessToken, TEST_JWT_SECRET);
    const newClaims = await verifyAccessToken(json.tokens.accessToken, TEST_JWT_SECRET);
    expect(newClaims).toEqual(oldClaims);
    const [d] = await sql<{ recent: boolean }[]>`SELECT last_seen_at > now() - interval '1 minute' AS recent FROM devices`;
    expect(d!.recent).toBe(true);
  });

  it('el refresh nuevo también se puede rotar (cadena de rotaciones)', async () => {
    const t = buildTestApp({ db });
    const ana = await registerAccount(t, 'ana@example.com');
    let refresh = ana.refreshToken;
    for (let i = 0; i < 3; i++) {
      const res = await postJson(t.app, '/auth/refresh', { refreshToken: refresh });
      expect(res.status).toBe(200);
      refresh = ((await res.json()) as { tokens: Tokens }).tokens.refreshToken;
    }
  });

  it('reutilizar un refresh ya rotado falla con 401 y revoca la familia entera', async () => {
    const t = buildTestApp({ db });
    const ana = await registerAccount(t, 'ana@example.com');
    const first = (await (await postJson(t.app, '/auth/refresh', { refreshToken: ana.refreshToken })).json()) as { tokens: Tokens };
    const reuse = await postJson(t.app, '/auth/refresh', { refreshToken: ana.refreshToken });
    expect(reuse.status).toBe(401);
    // El token legítimo más reciente queda revocado también.
    const legit = await postJson(t.app, '/auth/refresh', { refreshToken: first.tokens.refreshToken });
    expect(legit.status).toBe(401);
    const [row] = await sql<{ live: number }[]>`
      SELECT count(*)::int AS live FROM sessions WHERE revoked_at IS NULL AND rotated_at IS NULL`;
    expect(row!.live).toBe(0);
  });

  it('la reutilización solo afecta a la familia de ese dispositivo', async () => {
    const t = buildTestApp({ db });
    const ana = await registerAccount(t, 'ana@example.com');
    const otra = (await (await postJson(t.app, '/auth/login', loginBody(ana), freshIp())).json()) as { tokens: Tokens };
    await postJson(t.app, '/auth/refresh', { refreshToken: ana.refreshToken });
    await postJson(t.app, '/auth/refresh', { refreshToken: ana.refreshToken }); // reutilización
    expect((await postJson(t.app, '/auth/refresh', { refreshToken: otra.tokens.refreshToken })).status).toBe(200);
  });

  it('token inexistente o caducado → 401 con formato de error', async () => {
    const t = buildTestApp({ db });
    const ana = await registerAccount(t, 'ana@example.com');
    const unknown = await postJson(t.app, '/auth/refresh', { refreshToken: 'no-existe' });
    expect(unknown.status).toBe(401);
    expect(((await unknown.json()) as { error: { code: string } }).error.code).toBe('invalid_refresh_token');
    await sql`UPDATE sessions SET created_at = now() - interval '40 days', expires_at = now() - interval '10 days'`;
    expect((await postJson(t.app, '/auth/refresh', { refreshToken: ana.refreshToken })).status).toBe(401);
  });

  it('cuerpo sin refreshToken → 422', async () => {
    const t = buildTestApp({ db });
    expect((await postJson(t.app, '/auth/refresh', {})).status).toBe(422);
    expect((await postJson(t.app, '/auth/refresh', { refreshToken: '' })).status).toBe(422);
  });

  it('no deja el refresh en claro en el log ni en la base', async () => {
    const t = buildTestApp({ db });
    const ana = await registerAccount(t, 'ana@example.com');
    await postJson(t.app, '/auth/refresh', { refreshToken: ana.refreshToken });
    await postJson(t.app, '/auth/refresh', { refreshToken: ana.refreshToken });
    expect(t.logs.join('\n')).not.toContain(ana.refreshToken);
    const rows = await sql`SELECT 1 FROM sessions WHERE refresh_token_hash = ${ana.refreshToken}`;
    expect(rows).toHaveLength(0);
  });
});
