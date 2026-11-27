// POST /auth/logout, POST /auth/logout-all, GET /me/sessions y DELETE /me/sessions/{deviceId} (T015).
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/db/client.js';
import { freshIp, loginBody, registerAccount, type Account } from '../support/accounts.js';
import { buildTestApp } from '../support/app.js';
import { setupTestDb, truncateAll } from '../support/db.js';
import { bearer, del, getJson, postJson } from '../support/http.js';

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

type Tokens = { accessToken: string; refreshToken: string };
type SessionItem = {
  deviceId: string;
  platform: string;
  name?: string;
  lastSeenAt: string;
  createdAt: string;
  current: boolean;
};

const refresh = (t: ReturnType<typeof buildTestApp>, refreshToken: string) =>
  postJson(t.app, '/auth/refresh', { refreshToken });

/** Inicia sesión desde otro dispositivo de la misma cuenta. */
async function loginAgain(t: ReturnType<typeof buildTestApp>, account: Account, device: Record<string, unknown> = {}) {
  const id = uuidv7();
  const res = await postJson(t.app, '/auth/login', loginBody(account, { id, ...device }), freshIp());
  const { tokens } = (await res.json()) as { tokens: Tokens };
  return { deviceId: id, ...tokens };
}

describe('sin sesión', () => {
  it('todas las rutas exigen un token de acceso válido (401)', async () => {
    const t = buildTestApp({ db });
    const id = uuidv7();
    expect((await postJson(t.app, '/auth/logout')).status).toBe(401);
    expect((await postJson(t.app, '/auth/logout-all')).status).toBe(401);
    expect((await getJson(t.app, '/me/sessions')).status).toBe(401);
    expect((await del(t.app, `/me/sessions/${id}`)).status).toBe(401);
    expect((await getJson(t.app, '/me/sessions', bearer('basura'))).status).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  it('204: borra el dispositivo actual y sus sesiones; su refresh deja de valer', async () => {
    const t = buildTestApp({ db });
    const ana = await registerAccount(t, 'ana@example.com');
    const res = await postJson(t.app, '/auth/logout', undefined, bearer(ana.accessToken));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(await sql`SELECT 1 FROM devices`).toHaveLength(0);
    expect(await sql`SELECT 1 FROM sessions`).toHaveLength(0);
    expect((await refresh(t, ana.refreshToken)).status).toBe(401);
  });

  it('solo cierra el dispositivo de la sesión actual; los demás siguen', async () => {
    const t = buildTestApp({ db });
    const ana = await registerAccount(t, 'ana@example.com');
    const movil = await loginAgain(t, ana);
    await postJson(t.app, '/auth/logout', undefined, bearer(ana.accessToken));
    expect((await refresh(t, movil.refreshToken)).status).toBe(200);
    const [row] = await sql<{ id: string }[]>`SELECT id FROM devices`;
    expect(row!.id).toBe(movil.deviceId);
  });

  it('es idempotente: repetirlo con el mismo token de acceso vuelve a dar 204', async () => {
    const t = buildTestApp({ db });
    const ana = await registerAccount(t, 'ana@example.com');
    expect((await postJson(t.app, '/auth/logout', undefined, bearer(ana.accessToken))).status).toBe(204);
    expect((await postJson(t.app, '/auth/logout', undefined, bearer(ana.accessToken))).status).toBe(204);
  });

  it('no toca los dispositivos de otro usuario', async () => {
    const t = buildTestApp({ db });
    const ana = await registerAccount(t, 'ana@example.com');
    const bea = await registerAccount(t, 'bea@example.com');
    await postJson(t.app, '/auth/logout', undefined, bearer(ana.accessToken));
    expect((await refresh(t, bea.refreshToken)).status).toBe(200);
  });

  it('funciona también tras rotar el refresh (la familia se conserva)', async () => {
    const t = buildTestApp({ db });
    const ana = await registerAccount(t, 'ana@example.com');
    const rotated = (await (await refresh(t, ana.refreshToken)).json()) as { tokens: Tokens };
    expect((await postJson(t.app, '/auth/logout', undefined, bearer(rotated.tokens.accessToken))).status).toBe(204);
    expect((await refresh(t, rotated.tokens.refreshToken)).status).toBe(401);
    expect(await sql`SELECT 1 FROM devices`).toHaveLength(0);
  });
});

describe('POST /auth/logout-all (SC-002)', () => {
  it('204: ningún refresh token anterior vale, ni de otros dispositivos ni rotados', async () => {
    const t = buildTestApp({ db });
    const ana = await registerAccount(t, 'ana@example.com');
    const movil = await loginAgain(t, ana);
    const tablet = await loginAgain(t, ana);
    const rotated = (await (await refresh(t, tablet.refreshToken)).json()) as { tokens: Tokens };

    const res = await postJson(t.app, '/auth/logout-all', undefined, bearer(ana.accessToken));
    expect(res.status).toBe(204);

    for (const token of [ana.refreshToken, movil.refreshToken, tablet.refreshToken, rotated.tokens.refreshToken]) {
      expect((await refresh(t, token)).status).toBe(401);
    }
    const [row] = await sql<{ live: number }[]>`SELECT count(*)::int AS live FROM sessions WHERE revoked_at IS NULL`;
    expect(row!.live).toBe(0);
  });

  it('no afecta a otro usuario', async () => {
    const t = buildTestApp({ db });
    const ana = await registerAccount(t, 'ana@example.com');
    const bea = await registerAccount(t, 'bea@example.com');
    await postJson(t.app, '/auth/logout-all', undefined, bearer(ana.accessToken));
    expect((await refresh(t, bea.refreshToken)).status).toBe(200);
  });

  it('tras cerrar todas se puede volver a iniciar sesión', async () => {
    const t = buildTestApp({ db });
    const ana = await registerAccount(t, 'ana@example.com');
    await postJson(t.app, '/auth/logout-all', undefined, bearer(ana.accessToken));
    const again = await postJson(t.app, '/auth/login', loginBody(ana), freshIp());
    expect(again.status).toBe(200);
  });
});

describe('GET /me/sessions', () => {
  it('una entrada por dispositivo activo, identificada por deviceId y con la actual marcada', async () => {
    const t = buildTestApp({ db });
    const ana = await registerAccount(t, 'ana@example.com', { platform: 'windows', deviceName: 'Portátil' });
    const movil = await loginAgain(t, ana, { platform: 'android', name: 'Pixel' });
    const res = await getJson(t.app, '/me/sessions', bearer(movil.accessToken));
    expect(res.status).toBe(200);
    const { sessions } = (await res.json()) as { sessions: SessionItem[] };
    expect(sessions).toHaveLength(2);
    const byId = new Map(sessions.map((s) => [s.deviceId, s]));
    expect(byId.get(ana.deviceId)).toMatchObject({ platform: 'windows', name: 'Portátil', current: false });
    expect(byId.get(movil.deviceId)).toMatchObject({ platform: 'android', name: 'Pixel', current: true });
    for (const s of sessions) {
      expect(Object.keys(s).sort()).toEqual(['createdAt', 'current', 'deviceId', 'lastSeenAt', 'name', 'platform']);
      expect(new Date(s.lastSeenAt).toString()).not.toBe('Invalid Date');
      expect(new Date(s.createdAt).toString()).not.toBe('Invalid Date');
    }
  });

  it('no expone ids de sesión, familias ni hashes', async () => {
    const t = buildTestApp({ db });
    const ana = await registerAccount(t, 'ana@example.com');
    const text = await (await getJson(t.app, '/me/sessions', bearer(ana.accessToken))).text();
    const rows = await sql<{ id: string; family_id: string; refresh_token_hash: string }[]>`
      SELECT id, family_id, refresh_token_hash FROM sessions`;
    for (const r of rows) {
      expect(text).not.toContain(r.id);
      expect(text).not.toContain(r.family_id);
      expect(text).not.toContain(r.refresh_token_hash);
    }
    expect(text).not.toContain(ana.refreshToken);
  });

  it('el deviceId no cambia tras rotar el refresh', async () => {
    const t = buildTestApp({ db });
    const ana = await registerAccount(t, 'ana@example.com');
    const before = (await (await getJson(t.app, '/me/sessions', bearer(ana.accessToken))).json()) as { sessions: SessionItem[] };
    const rotated = (await (await refresh(t, ana.refreshToken)).json()) as { tokens: Tokens };
    const after = (await (await getJson(t.app, '/me/sessions', bearer(rotated.tokens.accessToken))).json()) as { sessions: SessionItem[] };
    expect(after.sessions.map((s) => s.deviceId)).toEqual(before.sessions.map((s) => s.deviceId));
    expect(after.sessions).toHaveLength(1);
    expect(after.sessions[0]!.current).toBe(true);
  });

  it('no incluye dispositivos sin token vivo (revocados, caducados)', async () => {
    const t = buildTestApp({ db });
    const ana = await registerAccount(t, 'ana@example.com');
    const movil = await loginAgain(t, ana);
    const tablet = await loginAgain(t, ana);
    // El móvil sufre una reutilización (familia revocada); la tablet caduca.
    await refresh(t, movil.refreshToken);
    await refresh(t, movil.refreshToken);
    await sql`UPDATE sessions SET created_at = now() - interval '40 days', expires_at = now() - interval '10 days'
              WHERE device_id = ${tablet.deviceId}`;
    const { sessions } = (await (await getJson(t.app, '/me/sessions', bearer(ana.accessToken))).json()) as { sessions: SessionItem[] };
    expect(sessions.map((s) => s.deviceId)).toEqual([ana.deviceId]);
  });

  it('tras "cerrar todas" la lista queda vacía', async () => {
    const t = buildTestApp({ db });
    const ana = await registerAccount(t, 'ana@example.com');
    await postJson(t.app, '/auth/logout-all', undefined, bearer(ana.accessToken));
    const { sessions } = (await (await getJson(t.app, '/me/sessions', bearer(ana.accessToken))).json()) as { sessions: SessionItem[] };
    expect(sessions).toEqual([]);
  });

  it('solo lista los dispositivos del usuario del token', async () => {
    const t = buildTestApp({ db });
    const ana = await registerAccount(t, 'ana@example.com');
    const bea = await registerAccount(t, 'bea@example.com');
    const { sessions } = (await (await getJson(t.app, '/me/sessions', bearer(ana.accessToken))).json()) as { sessions: SessionItem[] };
    expect(sessions.map((s) => s.deviceId)).toEqual([ana.deviceId]);
    expect(sessions.map((s) => s.deviceId)).not.toContain(bea.deviceId);
  });

  it('omite name cuando el dispositivo no lo tiene', async () => {
    const t = buildTestApp({ db });
    const ana = await registerAccount(t, 'ana@example.com');
    await sql`UPDATE devices SET name = NULL`;
    const { sessions } = (await (await getJson(t.app, '/me/sessions', bearer(ana.accessToken))).json()) as { sessions: SessionItem[] };
    expect('name' in sessions[0]!).toBe(false);
  });
});

describe('DELETE /me/sessions/{deviceId}', () => {
  it('204: cierra la sesión de ese dispositivo (borra el dispositivo y su refresh deja de valer)', async () => {
    const t = buildTestApp({ db });
    const ana = await registerAccount(t, 'ana@example.com');
    const movil = await loginAgain(t, ana);
    const res = await del(t.app, `/me/sessions/${movil.deviceId}`, bearer(ana.accessToken));
    expect(res.status).toBe(204);
    expect((await refresh(t, movil.refreshToken)).status).toBe(401);
    expect((await refresh(t, ana.refreshToken)).status).toBe(200);
    expect(await sql`SELECT 1 FROM devices WHERE id = ${movil.deviceId}`).toHaveLength(0);
  });

  it('no se puede borrar la sesión de otro usuario: 404 y el dispositivo sigue', async () => {
    const t = buildTestApp({ db });
    const ana = await registerAccount(t, 'ana@example.com');
    const bea = await registerAccount(t, 'bea@example.com');
    const res = await del(t.app, `/me/sessions/${bea.deviceId}`, bearer(ana.accessToken));
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('not_found');
    expect(await sql`SELECT 1 FROM devices WHERE id = ${bea.deviceId}`).toHaveLength(1);
    expect((await refresh(t, bea.refreshToken)).status).toBe(200);
  });

  it('un dispositivo inexistente da el mismo 404 que el ajeno', async () => {
    const t = buildTestApp({ db });
    const ana = await registerAccount(t, 'ana@example.com');
    const bea = await registerAccount(t, 'bea@example.com');
    const ajeno = await del(t.app, `/me/sessions/${bea.deviceId}`, bearer(ana.accessToken));
    const noExiste = await del(t.app, `/me/sessions/${uuidv7()}`, bearer(ana.accessToken));
    expect(noExiste.status).toBe(404);
    expect(await noExiste.text()).toBe(await ajeno.text());
  });

  it('se puede cerrar el propio dispositivo actual', async () => {
    const t = buildTestApp({ db });
    const ana = await registerAccount(t, 'ana@example.com');
    expect((await del(t.app, `/me/sessions/${ana.deviceId}`, bearer(ana.accessToken))).status).toBe(204);
    expect((await refresh(t, ana.refreshToken)).status).toBe(401);
  });

  it('un deviceId que no es UUID → 422', async () => {
    const t = buildTestApp({ db });
    const ana = await registerAccount(t, 'ana@example.com');
    expect((await del(t.app, '/me/sessions/no-es-uuid', bearer(ana.accessToken))).status).toBe(422);
  });
});
