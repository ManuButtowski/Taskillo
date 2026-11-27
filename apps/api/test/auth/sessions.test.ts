// Sesiones y rotación de refresh tokens (T009) contra un PostgreSQL real.
// Sigue "Ciclo de vida de sesiones y dispositivos" de data-model.md.
import { randomUUID } from 'node:crypto';
import { sql as dsql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createSession,
  DeviceIdConflictError,
  deleteDevice,
  deleteDeviceByFamily,
  listActiveDevices,
  revokeAllSessions,
  rotateRefreshToken,
  SESSION_TTL_DAYS,
} from '../../src/auth/sessions.js';
import { hashRefreshToken } from '../../src/auth/tokens.js';
import { createDb, type Database } from '../../src/db/client.js';
import { setupTestDb, testDatabaseUrl, truncateAll } from '../support/db.js';

const ARGON = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA';
const quiet = { onnotice: () => {} };

let db: Database;
let sql: Database['client'];

async function insertUser(username: string) {
  const id = uuidv7();
  await sql`INSERT INTO users (id, email, password_hash, username, display_name)
            VALUES (${id}, ${`${username}@example.com`}, ${ARGON}, ${username}, ${'Nombre'})`;
  return id;
}

function newSession(userId: string, deviceId: string = uuidv7(), name: string | null = 'Portátil') {
  return createSession(db.db, { userId, deviceId, platform: 'windows', name });
}

async function familyRows(familyId: string) {
  return sql<{ id: string; rotated_at: Date | null; revoked_at: Date | null }[]>`
    SELECT id, rotated_at, revoked_at FROM sessions WHERE family_id = ${familyId} ORDER BY id`;
}

async function liveCount(familyId: string) {
  const [row] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM sessions
    WHERE family_id = ${familyId} AND rotated_at IS NULL AND revoked_at IS NULL AND expires_at > now()`;
  return row!.n;
}

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

describe('crear sesión', () => {
  it('crea dispositivo, familia nueva y un token que caduca a 30 días (reloj de PostgreSQL)', async () => {
    const userId = await insertUser('ana');
    const deviceId = uuidv7();
    const s = await newSession(userId, deviceId);

    expect(SESSION_TTL_DAYS).toBe(30);
    expect(s.userId).toBe(userId);
    expect(s.deviceId).toBe(deviceId);
    expect(s.familyId).toMatch(/^[0-9a-f-]{36}$/);
    expect(s.familyId).not.toBe(deviceId);

    const [row] = await sql<{ hash: string; ok: boolean; platform: string; name: string }[]>`
      SELECT s.refresh_token_hash AS hash,
             s.expires_at = s.created_at + interval '30 days' AS ok,
             d.platform, d.name
      FROM sessions s JOIN devices d ON d.id = s.device_id
      WHERE s.id = ${s.sessionId}`;
    expect(row!.hash).toBe(hashRefreshToken(s.refreshToken));
    expect(row!.hash).not.toBe(s.refreshToken);
    expect(row!.ok).toBe(true);
    expect(row!.platform).toBe('windows');
    expect(row!.name).toBe('Portátil');
  });

  it('cada login crea una familia distinta', async () => {
    const userId = await insertUser('ana');
    const a = await newSession(userId);
    const b = await newSession(userId);
    expect(a.familyId).not.toBe(b.familyId);
  });

  it('id de dispositivo repetido → DeviceIdConflictError (device_id_conflict), sin tocar el existente', async () => {
    const ana = await insertUser('ana');
    const bea = await insertUser('bea');
    const deviceId = uuidv7();
    const first = await newSession(ana, deviceId);

    for (const userId of [ana, bea]) {
      const err = await newSession(userId, deviceId).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DeviceIdConflictError);
      expect((err as DeviceIdConflictError).code).toBe('device_id_conflict');
    }

    const devices = await sql`SELECT user_id FROM devices WHERE id = ${deviceId}`;
    expect(devices).toEqual([{ user_id: ana }]);
    const sessions = await sql`SELECT family_id FROM sessions WHERE device_id = ${deviceId}`;
    expect(sessions).toEqual([{ family_id: first.familyId }]);
  });

  it('dentro de la transacción de quien llama, el conflicto deshace también su trabajo', async () => {
    const ana = await insertUser('ana');
    const deviceId = uuidv7();
    await newSession(ana, deviceId);

    const err = await db.db
      .transaction(async (tx) => {
        await tx.execute(dsql`UPDATE users SET display_name = 'Cambiado' WHERE id = ${ana}`);
        await createSession(tx, { userId: ana, deviceId, platform: 'android', name: null });
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DeviceIdConflictError);
    const [u] = await sql`SELECT display_name FROM users WHERE id = ${ana}`;
    expect(u!.display_name).toBe('Nombre');
  });
});

describe('rotar', () => {
  it('rotación normal: conserva family_id y device_id, marca la anterior y renueva 30 días', async () => {
    const userId = await insertUser('ana');
    const s1 = await newSession(userId);
    await sql`UPDATE devices SET last_seen_at = now() - interval '5 days' WHERE id = ${s1.deviceId}`;

    const r = await rotateRefreshToken(db.db, s1.refreshToken);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s2 = r.session;
    expect(s2.familyId).toBe(s1.familyId);
    expect(s2.deviceId).toBe(s1.deviceId);
    expect(s2.userId).toBe(userId);
    expect(s2.sessionId).not.toBe(s1.sessionId);
    expect(s2.refreshToken).not.toBe(s1.refreshToken);

    const [old] = await sql`SELECT rotated_at, revoked_at FROM sessions WHERE id = ${s1.sessionId}`;
    expect(old!.rotated_at).not.toBeNull();
    expect(old!.revoked_at).toBeNull();
    const [fresh] = await sql<{ ok: boolean; hash: string }[]>`
      SELECT expires_at = created_at + interval '30 days' AS ok, refresh_token_hash AS hash
      FROM sessions WHERE id = ${s2.sessionId}`;
    expect(fresh!.ok).toBe(true);
    expect(fresh!.hash).toBe(hashRefreshToken(s2.refreshToken));
    const [dev] = await sql<{ recent: boolean }[]>`
      SELECT last_seen_at > now() - interval '1 minute' AS recent FROM devices WHERE id = ${s1.deviceId}`;
    expect(dev!.recent).toBe(true);
    expect(await liveCount(s1.familyId)).toBe(1);

    // La cadena sigue: el nuevo token también rota.
    const r3 = await rotateRefreshToken(db.db, s2.refreshToken);
    expect(r3.ok).toBe(true);
  });

  it('la caducidad es deslizante: el token nuevo vale 30 días desde su emisión, no desde el login', async () => {
    const userId = await insertUser('ana');
    const s1 = await newSession(userId);
    await sql`UPDATE sessions SET created_at = now() - interval '20 days',
                                  expires_at = now() + interval '10 days'
              WHERE id = ${s1.sessionId}`;
    const r = await rotateRefreshToken(db.db, s1.refreshToken);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [row] = await sql<{ ok: boolean }[]>`
      SELECT expires_at > now() + interval '29 days' AS ok FROM sessions WHERE id = ${r.session.sessionId}`;
    expect(row!.ok).toBe(true);
  });

  it('reutilización: revoca toda la familia, la revocación persiste y el token nuevo deja de valer', async () => {
    const userId = await insertUser('ana');
    const s1 = await newSession(userId);
    const other = await newSession(userId); // otra familia del mismo usuario
    const r2 = await rotateRefreshToken(db.db, s1.refreshToken);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;

    const reuse = await rotateRefreshToken(db.db, s1.refreshToken);
    expect(reuse).toEqual({ ok: false, reason: 'reused' });

    // Desde OTRA conexión: la revocación está confirmada, no dentro de una transacción deshecha.
    const probe = createDb(testDatabaseUrl(), { max: 1, ...quiet });
    try {
      const rows = await probe.client`SELECT revoked_at FROM sessions WHERE family_id = ${s1.familyId}`;
      expect(rows).toHaveLength(2);
      for (const row of rows) expect(row.revoked_at).not.toBeNull();
    } finally {
      await probe.client.end();
    }

    expect(await rotateRefreshToken(db.db, r2.session.refreshToken)).toEqual({ ok: false, reason: 'invalid' });
    // La otra familia no se toca.
    expect(await liveCount(other.familyId)).toBe(1);
  });

  it('token caducado (sin rotar): 401 sin revocar la familia', async () => {
    const userId = await insertUser('ana');
    const s1 = await newSession(userId);
    await sql`UPDATE sessions SET created_at = now() - interval '31 days',
                                  expires_at = now() - interval '1 day'
              WHERE id = ${s1.sessionId}`;
    expect(await rotateRefreshToken(db.db, s1.refreshToken)).toEqual({ ok: false, reason: 'invalid' });
    const rows = await familyRows(s1.familyId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.rotated_at).toBeNull();
    expect(rows[0]!.revoked_at).toBeNull();
  });

  it('token revocado: 401', async () => {
    const userId = await insertUser('ana');
    const s1 = await newSession(userId);
    await revokeAllSessions(db.db, userId);
    expect(await rotateRefreshToken(db.db, s1.refreshToken)).toEqual({ ok: false, reason: 'invalid' });
    expect(await familyRows(s1.familyId)).toHaveLength(1);
  });

  it('token inexistente: 401', async () => {
    expect(await rotateRefreshToken(db.db, 'no-existe')).toEqual({ ok: false, reason: 'invalid' });
    expect(await rotateRefreshToken(db.db, '')).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('rotaciones simultáneas con dos conexiones reales', () => {
  const REPEAT = 10;
  let connA: Database;
  let connB: Database;
  let connC: Database;

  beforeAll(() => {
    connA = createDb(testDatabaseUrl(), { max: 1, ...quiet });
    connB = createDb(testDatabaseUrl(), { max: 1, ...quiet });
    connC = createDb(testDatabaseUrl(), { max: 1, ...quiet });
  });

  afterAll(async () => {
    await Promise.all([connA.client.end(), connB.client.end(), connC.client.end()]);
  });

  async function expectOneWinnerAndFamilyRevoked(
    results: Awaited<ReturnType<typeof rotateRefreshToken>>[],
    familyId: string,
  ) {
    const winners = results.filter((r) => r.ok);
    const losers = results.filter((r) => !r.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toEqual([{ ok: false, reason: 'reused' }]);
    const rows = await familyRows(familyId);
    expect(rows).toHaveLength(2); // original + la recién emitida, nada más
    for (const row of rows) expect(row.revoked_at).not.toBeNull();
    const winner = winners[0]!;
    if (winner.ok) {
      expect(await rotateRefreshToken(db.db, winner.session.refreshToken)).toEqual({
        ok: false,
        reason: 'invalid',
      });
    }
  }

  it.each(Array.from({ length: REPEAT }, (_, i) => i + 1))(
    'carrera libre (intento %i): una gana y la otra revoca toda la familia',
    async () => {
      const userId = await insertUser('ana');
      const s1 = await newSession(userId);
      const results = await Promise.all([
        rotateRefreshToken(connA.db, s1.refreshToken),
        rotateRefreshToken(connB.db, s1.refreshToken),
      ]);
      await expectOneWinnerAndFamilyRevoked(results, s1.familyId);
    },
  );

  it.each(Array.from({ length: REPEAT }, (_, i) => i + 1))(
    'con espera de bloqueo forzada (intento %i): la segunda espera a la primera y revoca la familia',
    async () => {
      const userId = await insertUser('ana');
      const s1 = await newSession(userId);
      const hash = hashRefreshToken(s1.refreshToken);

      // C bloquea la fila; A y B quedan esperando ese bloqueo en su UPDATE.
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      let locked!: () => void;
      const isLocked = new Promise<void>((resolve) => (locked = resolve));
      const holder = connC.client.begin(async (tx) => {
        await tx`SELECT id FROM sessions WHERE refresh_token_hash = ${hash} FOR UPDATE`;
        locked();
        await released;
      });
      await isLocked;

      const both = Promise.all([
        rotateRefreshToken(connA.db, s1.refreshToken),
        rotateRefreshToken(connB.db, s1.refreshToken),
      ]);

      // Espera a ver las dos sesiones bloqueadas en PostgreSQL antes de soltar.
      for (let i = 0; i < 200; i++) {
        const [row] = await sql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'`;
        if (row!.n >= 2) break;
        await new Promise((r) => setTimeout(r, 10));
      }
      const [waiting] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      expect(waiting!.n).toBe(2);

      release();
      await holder;
      await expectOneWinnerAndFamilyRevoked(await both, s1.familyId);
    },
  );
});

describe('cerrar sesión', () => {
  it('borrar el dispositivo borra en cascada su familia y su refresh deja de existir', async () => {
    const ana = await insertUser('ana');
    const s1 = await newSession(ana);
    const r = await rotateRefreshToken(db.db, s1.refreshToken);
    expect(r.ok).toBe(true);
    const keep = await newSession(ana);

    expect(await deleteDevice(db.db, ana, s1.deviceId)).toBe(true);
    expect(await familyRows(s1.familyId)).toHaveLength(0);
    expect(await sql`SELECT id FROM devices WHERE id = ${s1.deviceId}`).toHaveLength(0);
    if (r.ok) {
      expect(await rotateRefreshToken(db.db, r.session.refreshToken)).toEqual({ ok: false, reason: 'invalid' });
    }
    expect(await liveCount(keep.familyId)).toBe(1);
  });

  it('no borra el dispositivo de otro usuario', async () => {
    const ana = await insertUser('ana');
    const bea = await insertUser('bea');
    const s = await newSession(ana);
    expect(await deleteDevice(db.db, bea, s.deviceId)).toBe(false);
    expect(await deleteDevice(db.db, ana, randomUUID())).toBe(false);
    expect(await liveCount(s.familyId)).toBe(1);
  });

  it('cerrar sesión por familia (la del token de acceso) borra su dispositivo', async () => {
    const ana = await insertUser('ana');
    const bea = await insertUser('bea');
    const s = await newSession(ana);
    const keep = await newSession(ana);
    expect(await deleteDeviceByFamily(db.db, bea, s.familyId)).toBe(false);
    expect(await deleteDeviceByFamily(db.db, ana, s.familyId)).toBe(true);
    expect(await sql`SELECT id FROM devices WHERE id = ${s.deviceId}`).toHaveLength(0);
    expect(await familyRows(s.familyId)).toHaveLength(0);
    expect(await liveCount(keep.familyId)).toBe(1);
    // Tras borrarlo, el mismo id de dispositivo vuelve a estar libre.
    await expect(newSession(bea, s.deviceId)).resolves.toMatchObject({ deviceId: s.deviceId });
  });
});

describe('cerrar todas', () => {
  it('revoca todas las filas no revocadas del usuario (también las rotadas) y ningún refresh vale', async () => {
    const ana = await insertUser('ana');
    const bea = await insertUser('bea');
    const a1 = await newSession(ana);
    const r = await rotateRefreshToken(db.db, a1.refreshToken);
    const a2 = await newSession(ana);
    const b = await newSession(bea);

    expect(await revokeAllSessions(db.db, ana)).toBe(3);
    const rows = await sql`SELECT revoked_at FROM sessions WHERE user_id = ${ana}`;
    for (const row of rows) expect(row.revoked_at).not.toBeNull();
    if (r.ok) {
      expect(await rotateRefreshToken(db.db, r.session.refreshToken)).toEqual({ ok: false, reason: 'invalid' });
    }
    expect(await rotateRefreshToken(db.db, a2.refreshToken)).toEqual({ ok: false, reason: 'invalid' });
    // El token rotado ya revocado no dispara nada: "invalid", no "reused".
    expect(await rotateRefreshToken(db.db, a1.refreshToken)).toEqual({ ok: false, reason: 'invalid' });
    expect(await listActiveDevices(db.db, ana)).toEqual([]);
    expect(await liveCount(b.familyId)).toBe(1);
  });

  it('revocar las demás conserva la familia actual', async () => {
    const ana = await insertUser('ana');
    const current = await newSession(ana);
    const other = await newSession(ana);
    expect(await revokeAllSessions(db.db, ana, { exceptFamilyId: current.familyId })).toBe(1);
    expect(await liveCount(current.familyId)).toBe(1);
    expect(await liveCount(other.familyId)).toBe(0);
    expect((await rotateRefreshToken(db.db, current.refreshToken)).ok).toBe(true);
    expect(await rotateRefreshToken(db.db, other.refreshToken)).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('listar dispositivos activos', () => {
  it('solo los que tienen un token vivo, con su familia; el deviceId no cambia al rotar', async () => {
    const ana = await insertUser('ana');
    const bea = await insertUser('bea');
    const live = await newSession(ana, uuidv7(), 'Móvil');
    const expired = await newSession(ana);
    const revoked = await newSession(ana);
    await newSession(bea);
    await sql`UPDATE sessions SET created_at = now() - interval '31 days', expires_at = now() - interval '1 day'
              WHERE id = ${expired.sessionId}`;
    await revokeAllSessions(db.db, ana, { exceptFamilyId: live.familyId });
    void revoked;
    const r = await rotateRefreshToken(db.db, live.refreshToken);
    expect(r.ok).toBe(true);

    const list = await listActiveDevices(db.db, ana);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      deviceId: live.deviceId,
      familyId: live.familyId,
      platform: 'windows',
      name: 'Móvil',
    });
    expect(list[0]!.lastSeenAt).toBeInstanceOf(Date);
    expect(list[0]!.createdAt).toBeInstanceOf(Date);
  });
});
