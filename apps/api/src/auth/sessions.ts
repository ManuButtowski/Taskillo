// Sesiones, dispositivos y rotación de refresh tokens (data-model.md, "Ciclo de vida de sesiones
// y dispositivos"). Invariante: un dispositivo ↔ una familia. Todas las fechas salen de now() de
// PostgreSQL, nunca del reloj de Node.
import { and, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Database } from '../db/client.js';
import { devices, type DevicePlatform, sessions } from '../db/schema.js';
import { generateRefreshToken, hashRefreshToken } from './tokens.js';

export const SESSION_TTL_DAYS = 30;
// Literal y no parámetro: coincide con SESSION_TTL_DAYS (lo comprueba el test).
const EXPIRES_AT = sql`now() + interval '30 days'`;

type Db = Database['db'];
/** Base de datos o transacción de Drizzle (createSession puede ir dentro de la de quien llama). */
export type DbExecutor = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

/** El id de dispositivo enviado por el cliente ya existe (nunca se reasigna). La API responde 409. */
export class DeviceIdConflictError extends Error {
  readonly code = 'device_id_conflict';
  constructor() {
    super('El id de dispositivo ya existe');
    this.name = 'DeviceIdConflictError';
  }
}

export interface IssuedSession {
  sessionId: string;
  userId: string;
  deviceId: string;
  familyId: string;
  /** Token en claro: solo se devuelve al cliente, nunca se guarda ni se registra. */
  refreshToken: string;
  expiresAt: Date;
}

/**
 * `invalid`: no existe, revocado o caducado (401 sin más).
 * `reused`: ya se había rotado; la familia entera queda revocada y confirmada (401).
 */
export type RotateResult = { ok: true; session: IssuedSession } | { ok: false; reason: 'invalid' | 'reused' };

export interface NewSessionInput {
  userId: string;
  deviceId: string;
  platform: DevicePlatform;
  name: string | null;
}

export interface ActiveDevice {
  deviceId: string;
  /** Familia de su token vivo (para marcar la sesión actual). */
  familyId: string;
  platform: DevicePlatform;
  name: string | null;
  lastSeenAt: Date;
  createdAt: Date;
}

function isDeviceIdConflict(err: unknown): boolean {
  // Drizzle envuelve el error de postgres en DrizzleQueryError (cause).
  for (let e = err, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    const pg = e as { code?: string; constraint_name?: string };
    if (pg.code === '23505' && (pg.constraint_name === 'devices_pkey' || pg.constraint_name === 'devices_id_user_key')) {
      return true;
    }
  }
  return false;
}

async function insertSession(
  ex: DbExecutor,
  ids: { userId: string; deviceId: string; familyId: string },
): Promise<IssuedSession> {
  const { token, hash } = generateRefreshToken();
  const [row] = await ex
    .insert(sessions)
    .values({ id: uuidv7(), ...ids, refreshTokenHash: hash, expiresAt: EXPIRES_AT })
    .returning({ id: sessions.id, expiresAt: sessions.expiresAt });
  return { sessionId: row!.id, ...ids, refreshToken: token, expiresAt: row!.expiresAt };
}

/**
 * Login y paso 2 del registro: crea el dispositivo (INSERT simple, nunca UPSERT), una familia
 * nueva y su primer token. Con una transacción de quien llama, usa un punto de guardado.
 * @throws DeviceIdConflictError si el id de dispositivo ya existe.
 */
export async function createSession(ex: DbExecutor, input: NewSessionInput): Promise<IssuedSession> {
  return ex.transaction(async (tx) => {
    try {
      await tx
        .insert(devices)
        .values({ id: input.deviceId, userId: input.userId, platform: input.platform, name: input.name });
    } catch (err) {
      if (isDeviceIdConflict(err)) throw new DeviceIdConflictError();
      throw err;
    }
    return insertSession(tx, { userId: input.userId, deviceId: input.deviceId, familyId: uuidv7() });
  });
}

/**
 * Rota un refresh token. Necesita la base de datos raíz (no una transacción): la revocación por
 * reutilización se confirma por su cuenta antes de devolver el fallo. READ COMMITTED a propósito:
 * con REPEATABLE READ o SERIALIZABLE una rotación simultánea daría error de serialización.
 */
export async function rotateRefreshToken(db: Db, refreshToken: string): Promise<RotateResult> {
  const hash = hashRefreshToken(refreshToken);

  // Pasos 1 y 2: marcar el anterior e insertar el nuevo en la misma transacción.
  const rotated = await db.transaction(
    async (tx) => {
      const [prev] = await tx
        .update(sessions)
        .set({ rotatedAt: sql`now()` })
        .where(
          and(
            eq(sessions.refreshTokenHash, hash),
            isNull(sessions.rotatedAt),
            isNull(sessions.revokedAt),
            gt(sessions.expiresAt, sql`now()`),
          ),
        )
        .returning({ userId: sessions.userId, deviceId: sessions.deviceId, familyId: sessions.familyId });
      if (!prev) return null;
      const next = await insertSession(tx, prev);
      await tx.update(devices).set({ lastSeenAt: sql`now()` }).where(eq(devices.id, prev.deviceId));
      return next;
    },
    { isolationLevel: 'read committed' },
  );
  if (rotated) return { ok: true, session: rotated };

  // Paso 3, fuera de la transacción (cada sentencia se confirma sola y ve lo ya confirmado).
  const [found] = await db
    .select({ familyId: sessions.familyId, rotatedAt: sessions.rotatedAt })
    .from(sessions)
    .where(eq(sessions.refreshTokenHash, hash));
  if (!found || found.rotatedAt === null) return { ok: false, reason: 'invalid' };

  const revoked = await db
    .update(sessions)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(sessions.familyId, found.familyId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  // Si ya estaba toda revocada ("cerrar todas"), el token viejo no dispara nada.
  return { ok: false, reason: revoked.length > 0 ? 'reused' : 'invalid' };
}

/** DELETE /me/sessions/{deviceId}: borra el dispositivo y, en cascada, todas sus sesiones. */
export async function deleteDevice(db: DbExecutor, userId: string, deviceId: string): Promise<boolean> {
  const rows = await db
    .delete(devices)
    .where(and(eq(devices.id, deviceId), eq(devices.userId, userId)))
    .returning({ id: devices.id });
  return rows.length > 0;
}

/** POST /auth/logout: borra el dispositivo de la familia del token de acceso (y su familia). */
export async function deleteDeviceByFamily(db: DbExecutor, userId: string, familyId: string): Promise<boolean> {
  const deviceIds = db
    .selectDistinct({ id: sessions.deviceId })
    .from(sessions)
    .where(and(eq(sessions.familyId, familyId), eq(sessions.userId, userId)));
  const rows = await db
    .delete(devices)
    .where(and(eq(devices.userId, userId), inArray(devices.id, deviceIds)))
    .returning({ id: devices.id });
  return rows.length > 0;
}

/**
 * Cerrar todas / cambiar o recuperar contraseña: revoca todas las filas no revocadas del usuario,
 * también las rotadas. Con `exceptFamilyId` conserva la sesión actual. Devuelve las filas revocadas.
 */
export async function revokeAllSessions(
  db: DbExecutor,
  userId: string,
  options: { exceptFamilyId?: string } = {},
): Promise<number> {
  const rows = await db
    .update(sessions)
    .set({ revokedAt: sql`now()` })
    .where(
      and(
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        options.exceptFamilyId ? ne(sessions.familyId, options.exceptFamilyId) : undefined,
      ),
    )
    .returning({ id: sessions.id });
  return rows.length;
}

/** Dispositivos activos (con un token vivo) del usuario, el más reciente primero. */
export async function listActiveDevices(db: DbExecutor, userId: string): Promise<ActiveDevice[]> {
  return db
    .select({
      deviceId: devices.id,
      familyId: sessions.familyId,
      platform: devices.platform,
      name: devices.name,
      lastSeenAt: devices.lastSeenAt,
      createdAt: devices.createdAt,
    })
    .from(sessions)
    .innerJoin(devices, and(eq(devices.id, sessions.deviceId), eq(devices.userId, sessions.userId)))
    .where(
      and(
        eq(sessions.userId, userId),
        isNull(sessions.rotatedAt),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, sql`now()`),
      ),
    )
    .orderBy(sql`${devices.lastSeenAt} DESC`, devices.id);
}

