// Servicio de tokens de correo (T012) contra un PostgreSQL real.
// Sigue "Tokens de correo" de data-model.md.
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  consumeResetToken,
  createRegisterToken,
  createResetToken,
  generateRegistrationCode,
  hashRegistrationCode,
  invalidateResetTokens,
  normalizeRegistrationCode,
  purgeExpiredRegisterTokens,
  REGISTER_MAX_ATTEMPTS,
  verifyRegisterCode,
} from '../../src/auth/email-tokens.js';
import type { Database } from '../../src/db/client.js';
import { setupTestDb, truncateAll } from '../support/db.js';

const ARGON = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA';

let db: Database;
let sql: Database['client'];

async function insertUser(username: string) {
  const id = uuidv7();
  await sql`INSERT INTO users (id, email, password_hash, username, display_name)
            VALUES (${id}, ${`${username}@example.com`}, ${ARGON}, ${username}, ${'Nombre'})`;
  return id;
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

/** Ejecuta la verificación en su propia transacción (como el paso 2 del registro). */
function verify(email: string, code: string) {
  return db.db.transaction((tx) => verifyRegisterCode(tx, email, code));
}

describe('código de registro (formato)', () => {
  it('genera 8 caracteres Crockford base32 (sin I, L, O, U) y distintos entre sí', () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateRegistrationCode()));
    expect(codes.size).toBe(200);
    for (const c of codes) expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
  });

  it('normaliza mayúsculas, guion y espacios; I/L → 1 y O → 0', () => {
    expect(normalizeRegistrationCode('abcd-efgh')).toBe('ABCDEFGH');
    expect(normalizeRegistrationCode(' abcd efgh ')).toBe('ABCDEFGH');
    expect(normalizeRegistrationCode('ILo0-1234')).toBe('11001234');
  });

  it('rechaza longitudes y caracteres no válidos', () => {
    expect(normalizeRegistrationCode('ABC')).toBeNull();
    expect(normalizeRegistrationCode('ABCDEFGHJ')).toBeNull();
    expect(normalizeRegistrationCode('ABCDEFGU')).toBeNull(); // U no existe en Crockford
    expect(normalizeRegistrationCode('ABCDEF€H')).toBeNull();
    expect(normalizeRegistrationCode('')).toBeNull();
  });

  it('el hash liga el código al correo', () => {
    const a = hashRegistrationCode('a@example.com', 'ABCDEFGH');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(hashRegistrationCode('b@example.com', 'ABCDEFGH'));
  });
});

describe('crear código de registro', () => {
  it('guarda solo el hash, sin usuario, con 30 minutos de vida (reloj de PostgreSQL)', async () => {
    const created = await createRegisterToken(db.db, 'ana@example.com');
    expect(created).not.toBeNull();
    const [row] = await sql<{ token_hash: string; user_id: string | null; ok: boolean; type: string }[]>`
      SELECT token_hash, user_id, type, expires_at = created_at + interval '30 minutes' AS ok FROM email_tokens`;
    expect(row!.type).toBe('register');
    expect(row!.user_id).toBeNull();
    expect(row!.ok).toBe(true);
    expect(row!.token_hash).toBe(hashRegistrationCode('ana@example.com', created!.code));
    expect(row!.token_hash).not.toContain(created!.code);
  });

  it('repetir invalida el código anterior y deja uno solo pendiente', async () => {
    const first = await createRegisterToken(db.db, 'ana@example.com');
    const second = await createRegisterToken(db.db, 'ana@example.com');
    const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM email_tokens WHERE used_at IS NULL`;
    expect(row!.n).toBe(1);
    expect((await verify('ana@example.com', first!.code)).ok).toBe(false);
    expect((await verify('ana@example.com', second!.code)).ok).toBe(true);
  });

  it('dos creaciones simultáneas dejan un solo código pendiente (la perdedora devuelve null)', async () => {
    for (let i = 0; i < 10; i++) {
      await truncateAll(sql);
      const results = await Promise.all([
        createRegisterToken(db.db, 'ana@example.com'),
        createRegisterToken(db.db, 'ana@example.com'),
      ]);
      const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM email_tokens WHERE used_at IS NULL`;
      expect(row!.n).toBe(1);
      expect(results.filter((r) => r !== null).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('el correo se compara sin distinguir mayúsculas', async () => {
    const created = await createRegisterToken(db.db, 'Ana@Example.com');
    expect((await verify('ana@example.com', created!.code)).ok).toBe(true);
  });
});

describe('verificar código de registro', () => {
  it('código correcto (con guion y minúsculas) → ok; no gasta el token por sí solo', async () => {
    const created = await createRegisterToken(db.db, 'ana@example.com');
    const typed = `${created!.code.slice(0, 4)}-${created!.code.slice(4)}`.toLowerCase();
    const r = await verify('ana@example.com', typed);
    expect(r.ok).toBe(true);
    const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM email_tokens WHERE used_at IS NULL`;
    expect(row!.n).toBe(1);
  });

  it('código erróneo: falla y el intento persiste', async () => {
    await createRegisterToken(db.db, 'ana@example.com');
    expect((await verify('ana@example.com', 'ZZZZZZZZ')).ok).toBe(false);
    const [row] = await sql<{ attempts: number }[]>`SELECT attempts FROM email_tokens`;
    expect(row!.attempts).toBe(1);
  });

  it('código con formato inválido también cuenta como intento fallido', async () => {
    await createRegisterToken(db.db, 'ana@example.com');
    expect((await verify('ana@example.com', 'xx')).ok).toBe(false);
    const [row] = await sql<{ attempts: number }[]>`SELECT attempts FROM email_tokens`;
    expect(row!.attempts).toBe(1);
  });

  it('tras 5 intentos fallidos el código queda agotado aunque luego se acierte', async () => {
    const created = await createRegisterToken(db.db, 'ana@example.com');
    for (let i = 0; i < REGISTER_MAX_ATTEMPTS; i++) {
      expect((await verify('ana@example.com', 'ZZZZZZZZ')).ok).toBe(false);
    }
    const [row] = await sql<{ attempts: number; used: boolean }[]>`SELECT attempts, used_at IS NOT NULL AS used FROM email_tokens`;
    expect(row).toEqual({ attempts: 5, used: true });
    expect((await verify('ana@example.com', created!.code)).ok).toBe(false);
  });

  it('caducado → falla', async () => {
    const created = await createRegisterToken(db.db, 'ana@example.com');
    await sql`UPDATE email_tokens SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour'`;
    expect((await verify('ana@example.com', created!.code)).ok).toBe(false);
  });

  it('ya usado → falla', async () => {
    const created = await createRegisterToken(db.db, 'ana@example.com');
    const r = await verify('ana@example.com', created!.code);
    if (!r.ok) throw new Error('debía ser válido');
    await sql`UPDATE email_tokens SET used_at = now() WHERE id = ${r.tokenId}`;
    expect((await verify('ana@example.com', created!.code)).ok).toBe(false);
  });

  it('el código de un correo no vale para otro', async () => {
    const created = await createRegisterToken(db.db, 'ana@example.com');
    await createRegisterToken(db.db, 'bea@example.com');
    expect((await verify('bea@example.com', created!.code)).ok).toBe(false);
  });

  it('sin fila pendiente → falla sin error', async () => {
    expect((await verify('nadie@example.com', 'ABCDEFGH')).ok).toBe(false);
  });
});

describe('purga de códigos de registro', () => {
  it('borra solo los register caducados hace más de un día', async () => {
    await createRegisterToken(db.db, 'viejo@example.com');
    await createRegisterToken(db.db, 'reciente@example.com');
    await sql`UPDATE email_tokens SET created_at = now() - interval '3 days', expires_at = now() - interval '2 days'
              WHERE email = 'viejo@example.com'`;
    expect(await purgeExpiredRegisterTokens(db.db)).toBe(1);
    const rows = await sql<{ email: string }[]>`SELECT email FROM email_tokens`;
    expect(rows).toEqual([{ email: 'reciente@example.com' }]);
  });

  it('no toca los reset_password caducados', async () => {
    const userId = await insertUser('ana');
    await createResetToken(db.db, userId, 'ana@example.com');
    await sql`UPDATE email_tokens SET created_at = now() - interval '3 days', expires_at = now() - interval '2 days'`;
    expect(await purgeExpiredRegisterTokens(db.db)).toBe(0);
  });
});

describe('token de recuperación', () => {
  it('guarda solo el hash, con 1 hora de vida, y el token es base64url de 32 bytes', async () => {
    const userId = await insertUser('ana');
    const { token } = await createResetToken(db.db, userId, 'ana@example.com');
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [row] = await sql<{ token_hash: string; ok: boolean; user_id: string; email: string }[]>`
      SELECT token_hash, user_id, email, expires_at = created_at + interval '1 hour' AS ok FROM email_tokens`;
    expect(row!.ok).toBe(true);
    expect(row!.user_id).toBe(userId);
    expect(row!.email).toBe('ana@example.com');
    expect(row!.token_hash).not.toContain(token);
  });

  it('crear uno nuevo invalida los anteriores pendientes del usuario', async () => {
    const userId = await insertUser('ana');
    const a = await createResetToken(db.db, userId, 'ana@example.com');
    const b = await createResetToken(db.db, userId, 'ana@example.com');
    expect(await consumeResetToken(db.db, a.token)).toBeNull();
    expect(await consumeResetToken(db.db, b.token)).toEqual({ userId, email: 'ana@example.com' });
  });

  it('es de un solo uso', async () => {
    const userId = await insertUser('ana');
    const { token } = await createResetToken(db.db, userId, 'ana@example.com');
    expect(await consumeResetToken(db.db, token)).not.toBeNull();
    expect(await consumeResetToken(db.db, token)).toBeNull();
  });

  it('caducado → null', async () => {
    const userId = await insertUser('ana');
    const { token } = await createResetToken(db.db, userId, 'ana@example.com');
    await sql`UPDATE email_tokens SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour'`;
    expect(await consumeResetToken(db.db, token)).toBeNull();
  });

  it('un token inexistente o vacío → null', async () => {
    expect(await consumeResetToken(db.db, 'no-existe')).toBeNull();
    expect(await consumeResetToken(db.db, '')).toBeNull();
  });

  it('consumir filtra por tipo: un hash de tipo register no sirve para recuperar', async () => {
    // Forzamos que el hash de un register coincida con el de un "token" que alguien presente.
    const fake = 'Zm9v-token-fingido-de-registro-xxxxxxxxxxxxxx';
    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256').update(fake).digest('hex');
    await sql`INSERT INTO email_tokens (id, user_id, email, type, token_hash, expires_at)
              VALUES (${uuidv7()}, NULL, 'ana@example.com', 'register', ${hash}, now() + interval '30 minutes')`;
    expect(await consumeResetToken(db.db, fake)).toBeNull();
    const [row] = await sql<{ used: boolean }[]>`SELECT used_at IS NOT NULL AS used FROM email_tokens`;
    expect(row!.used).toBe(false);
  });

  it('si el correo del usuario cambió desde el envío, se rechaza', async () => {
    const userId = await insertUser('ana');
    const { token } = await createResetToken(db.db, userId, 'ana@example.com');
    await sql`UPDATE users SET email = 'otro@example.com' WHERE id = ${userId}`;
    expect(await consumeResetToken(db.db, token)).toBeNull();
  });

  it('invalidateResetTokens deja sin efecto los pendientes del usuario y solo los suyos', async () => {
    const ana = await insertUser('ana');
    const bea = await insertUser('bea');
    const a = await createResetToken(db.db, ana, 'ana@example.com');
    const b = await createResetToken(db.db, bea, 'bea@example.com');
    await invalidateResetTokens(db.db, ana);
    expect(await consumeResetToken(db.db, a.token)).toBeNull();
    expect(await consumeResetToken(db.db, b.token)).not.toBeNull();
  });
});
