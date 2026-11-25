// Restricciones del esquema de la spec 001 contra un PostgreSQL real (migración 0000).
// Infraestructura mínima de T004: la base sale de TEST_DATABASE_URL; T005 la generaliza
// (negativa a arrancar, migraciones al empezar, limpieza entre tests) para el resto de tests.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Database } from '../../src/db/client.js';
import { users } from '../../src/db/schema.js';
import { runMigrations } from '../../src/migrate.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DATABASE_URL) {
  throw new Error('Falta TEST_DATABASE_URL: los tests de base de datos necesitan su propia base');
}
if (TEST_DATABASE_URL === process.env.DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL no puede coincidir con DATABASE_URL');
}

const hex64 = () => createHash('sha256').update(randomBytes(16)).digest('hex');
const ARGON = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA';

let db: Database;
let sql: Database['client'];

async function expectViolation(query: Promise<unknown>, constraint: string) {
  await expect(query).rejects.toMatchObject({ constraint_name: constraint });
}

async function insertUser(username: string, email = `${username}@example.com`) {
  const id = randomUUID();
  await sql`INSERT INTO users (id, email, password_hash, username, display_name)
            VALUES (${id}, ${email}, ${ARGON}, ${username}, ${'Nombre'})`;
  return id;
}

async function insertDevice(userId: string, platform = 'windows') {
  const id = randomUUID();
  await sql`INSERT INTO devices (id, user_id, platform) VALUES (${id}, ${userId}, ${platform})`;
  return id;
}

function insertSession(
  userId: string,
  deviceId: string,
  familyId: string = randomUUID(),
  hash: string = hex64(),
) {
  return sql`INSERT INTO sessions (id, user_id, device_id, family_id, refresh_token_hash, expires_at)
             VALUES (${randomUUID()}, ${userId}, ${deviceId}, ${familyId}, ${hash},
                     now() + interval '30 days')`;
}

function insertEmailToken(
  type: string,
  userId: string | null,
  email: string,
  hash: string = hex64(),
) {
  return sql`INSERT INTO email_tokens (id, user_id, email, type, token_hash, expires_at)
             VALUES (${randomUUID()}, ${userId}, ${email}, ${type}, ${hash},
                     now() + interval '30 minutes')`;
}

beforeAll(async () => {
  // Base exclusiva de tests: se parte de cero y se aplica la migración real.
  const admin = createDb(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await admin.client.unsafe(
    'DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;',
  );
  await admin.client.end();
  await runMigrations(TEST_DATABASE_URL, { onnotice: () => {} });
  db = createDb(TEST_DATABASE_URL, { onnotice: () => {} });
  sql = db.client;
});

beforeEach(async () => {
  await sql`TRUNCATE users, devices, sessions, email_tokens CASCADE`;
});

afterAll(async () => {
  await sql?.end();
});

describe('migración 0000', () => {
  it('crea la extensión citext y las cuatro tablas', async () => {
    const [ext] = await sql`SELECT extname FROM pg_extension WHERE extname = 'citext'`;
    expect(ext).toBeDefined();
    const tables = await sql`SELECT table_name FROM information_schema.tables
                             WHERE table_schema = 'public' ORDER BY table_name`;
    expect(tables.map((t) => t.table_name)).toEqual(['devices', 'email_tokens', 'sessions', 'users']);
  });

  it('fija los nombres de restricciones e índices del modelo', async () => {
    const constraints = await sql`SELECT conname FROM pg_constraint c
                                  JOIN pg_namespace n ON n.oid = c.connamespace
                                  WHERE n.nspname = 'public'`;
    const names = constraints.map((c) => c.conname);
    expect(names).toEqual(
      expect.arrayContaining([
        'users_pkey',
        'users_email_key',
        'users_username_key',
        'users_email_chk',
        'users_username_chk',
        'users_display_name_chk',
        'users_password_hash_chk',
        'devices_pkey',
        'devices_user_id_fkey',
        'devices_platform_chk',
        'devices_last_sync_seq_chk',
        'devices_id_user_key',
        'sessions_pkey',
        'sessions_user_id_fkey',
        'sessions_refresh_token_hash_key',
        'sessions_device_fk',
        'sessions_refresh_token_hash_chk',
        'sessions_expires_chk',
        'email_tokens_pkey',
        'email_tokens_user_id_fkey',
        'email_tokens_token_hash_key',
        'email_tokens_type_chk',
        'email_tokens_user_type_chk',
        'email_tokens_email_chk',
        'email_tokens_token_hash_chk',
        'email_tokens_attempts_chk',
        'email_tokens_expires_chk',
      ]),
    );
    const indexes = await sql`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'`;
    const byName = Object.fromEntries(indexes.map((i) => [i.indexname, i.indexdef as string]));
    expect(Object.keys(byName)).toEqual(
      expect.arrayContaining([
        'idx_devices_user',
        'uq_sessions_family_live',
        'idx_sessions_user_live',
        'idx_sessions_family',
        'idx_sessions_device',
        'idx_email_tokens_user_type',
        'uq_email_tokens_register_pending',
      ]),
    );
    expect(byName.uq_sessions_family_live).toMatch(/^CREATE UNIQUE INDEX .* WHERE /);
    expect(byName.idx_sessions_user_live).toMatch(/ WHERE /);
    expect(byName.uq_email_tokens_register_pending).toMatch(/^CREATE UNIQUE INDEX .* WHERE /);
    // Índice completo (no parcial) para la cascada desde users.
    expect(byName.idx_email_tokens_user_type).not.toMatch(/ WHERE /);
  });

  it('todas las columnas de fecha son timestamptz', async () => {
    const cols = await sql`SELECT table_name || '.' || column_name AS col, data_type
                           FROM information_schema.columns
                           WHERE table_schema = 'public' AND data_type LIKE 'timestamp%'`;
    expect(cols.map((c) => c.col).sort()).toEqual(
      [
        'devices.created_at',
        'devices.last_seen_at',
        'email_tokens.created_at',
        'email_tokens.expires_at',
        'email_tokens.used_at',
        'sessions.created_at',
        'sessions.expires_at',
        'sessions.revoked_at',
        'sessions.rotated_at',
        'users.created_at',
        'users.email_verified_at',
        'users.updated_at',
      ].sort(),
    );
    for (const c of cols) expect(c.data_type, c.col).toBe('timestamp with time zone');
  });

  it('las columnas id no tienen DEFAULT en la base de datos', async () => {
    const cols = await sql`SELECT table_name, column_default FROM information_schema.columns
                           WHERE table_schema = 'public' AND column_name = 'id'`;
    expect(cols).toHaveLength(4);
    for (const c of cols) expect(c.column_default, c.table_name).toBeNull();
  });

  it('correo y usuario son citext', async () => {
    const cols = await sql`SELECT table_name || '.' || column_name AS col, udt_name
                           FROM information_schema.columns
                           WHERE table_schema = 'public' AND column_name IN ('email', 'username')`;
    expect(cols).toHaveLength(3);
    for (const c of cols) expect(c.udt_name, c.col).toBe('citext');
  });
});

describe('cliente', () => {
  it('la conexión trabaja en UTC', async () => {
    const [row] = await sql`SHOW TimeZone`;
    expect(row?.TimeZone).toBe('UTC');
  });

  it('Drizzle genera ids UUIDv7 en la API', async () => {
    const [row] = await db.db
      .insert(users)
      .values({
        email: 'v7@example.com',
        passwordHash: ARGON,
        username: 'v7_user',
        displayName: 'Uve Siete',
      })
      .returning({ id: users.id, timezone: users.timezone });
    expect(row?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(row?.timezone).toBe('Europe/Madrid');
  });
});

describe('users', () => {
  it('correo único sin distinguir mayúsculas', async () => {
    await insertUser('ana', 'ana@example.com');
    await expectViolation(insertUser('ana2', 'ana@example.com'), 'users_email_key');
    const found = await sql`SELECT 1 FROM users WHERE email = ${'ANA@Example.COM'}`;
    expect(found).toHaveLength(1);
  });

  it('nombre de usuario único sin distinguir mayúsculas', async () => {
    await insertUser('pepe', 'pepe@example.com');
    await expectViolation(insertUser('pepe', 'otro@example.com'), 'users_username_key');
    const found = await sql`SELECT 1 FROM users WHERE username = ${'PePe'}`;
    expect(found).toHaveLength(1);
  });

  it('el correo debe estar en minúsculas, con @ y hasta 254 caracteres', async () => {
    await expectViolation(insertUser('u1', 'Ana@example.com'), 'users_email_chk');
    await expectViolation(insertUser('u2', 'sinarroba'), 'users_email_chk');
    await expectViolation(insertUser('u3', '@example.com'), 'users_email_chk');
    await expectViolation(insertUser('u4', `${'a'.repeat(250)}@x.es`), 'users_email_chk');
  });

  it('el usuario solo admite [a-z0-9_] en minúsculas, de 3 a 30', async () => {
    await expectViolation(insertUser('Pepe', 'p1@example.com'), 'users_username_chk');
    await expectViolation(insertUser('ab', 'p2@example.com'), 'users_username_chk');
    await expectViolation(insertUser('con-guion', 'p3@example.com'), 'users_username_chk');
    await expectViolation(insertUser('a'.repeat(31), 'p4@example.com'), 'users_username_chk');
    await insertUser('ok_user_123', 'p5@example.com');
  });

  it('el nombre visible va recortado y no vacío', async () => {
    const q = (name: string) =>
      sql`INSERT INTO users (id, email, password_hash, username, display_name)
          VALUES (${randomUUID()}, ${'dn@example.com'}, ${ARGON}, ${'dn_user'}, ${name})`;
    await expectViolation(q(''), 'users_display_name_chk');
    await expectViolation(q(' Ana'), 'users_display_name_chk');
  });

  it('password_hash debe ser Argon2id', async () => {
    const q = (hash: string) =>
      sql`INSERT INTO users (id, email, password_hash, username, display_name)
          VALUES (${randomUUID()}, ${'ph@example.com'}, ${hash}, ${'ph_user'}, ${'Ana'})`;
    await expectViolation(q('contraseña-en-claro'), 'users_password_hash_chk');
    await expectViolation(q('$argon2i$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA'), 'users_password_hash_chk');
    await q(ARGON);
  });
});

describe('devices', () => {
  it('la plataforma debe ser una de las permitidas', async () => {
    const userId = await insertUser('dev_user');
    await expectViolation(insertDevice(userId, 'ios'), 'devices_platform_chk');
    for (const p of ['android', 'windows', 'linux', 'macos']) await insertDevice(userId, p);
  });

  it('last_sync_seq no puede ser negativo', async () => {
    const userId = await insertUser('seq_user');
    await expectViolation(
      sql`INSERT INTO devices (id, user_id, platform, last_sync_seq)
          VALUES (${randomUUID()}, ${userId}, 'linux', -1)`,
      'devices_last_sync_seq_chk',
    );
  });
});

describe('sessions', () => {
  it('el hash del refresh token debe ser SHA-256 hex en minúsculas (un token en claro se rechaza)', async () => {
    const userId = await insertUser('ses_user');
    const deviceId = await insertDevice(userId);
    const plainToken = randomBytes(32).toString('base64url');
    await expectViolation(
      insertSession(userId, deviceId, randomUUID(), plainToken),
      'sessions_refresh_token_hash_chk',
    );
    await expectViolation(
      insertSession(userId, deviceId, randomUUID(), hex64().toUpperCase()),
      'sessions_refresh_token_hash_chk',
    );
    await insertSession(userId, deviceId);
  });

  it('el hash del refresh token es único', async () => {
    const userId = await insertUser('uniq_user');
    const deviceId = await insertDevice(userId);
    const hash = hex64();
    await insertSession(userId, deviceId, randomUUID(), hash);
    await expectViolation(
      insertSession(userId, deviceId, randomUUID(), hash),
      'sessions_refresh_token_hash_key',
    );
  });

  it('la FK compuesta rechaza una sesión con el dispositivo de otro usuario', async () => {
    const ana = await insertUser('ana_fk');
    const luis = await insertUser('luis_fk');
    const anaDevice = await insertDevice(ana);
    await expectViolation(insertSession(luis, anaDevice), 'sessions_device_fk');
    await expectViolation(insertSession(ana, randomUUID()), 'sessions_device_fk');
  });

  it('expires_at debe ser posterior a created_at', async () => {
    const userId = await insertUser('exp_user');
    const deviceId = await insertDevice(userId);
    await expectViolation(
      sql`INSERT INTO sessions (id, user_id, device_id, family_id, refresh_token_hash, expires_at)
          VALUES (${randomUUID()}, ${userId}, ${deviceId}, ${randomUUID()}, ${hex64()}, now())`,
      'sessions_expires_chk',
    );
  });

  it('uq_sessions_family_live: un solo token vivo por familia', async () => {
    const userId = await insertUser('fam_user');
    const deviceId = await insertDevice(userId);
    const familyId = randomUUID();
    const first = hex64();
    await insertSession(userId, deviceId, familyId, first);
    await expectViolation(insertSession(userId, deviceId, familyId), 'uq_sessions_family_live');

    await sql`UPDATE sessions SET rotated_at = now() WHERE refresh_token_hash = ${first}`;
    const second = hex64();
    await insertSession(userId, deviceId, familyId, second);

    await sql`UPDATE sessions SET revoked_at = now() WHERE refresh_token_hash = ${second}`;
    await insertSession(userId, deviceId, familyId);
    const [row] = await sql`SELECT count(*)::int AS n FROM sessions WHERE family_id = ${familyId}`;
    expect(row?.n).toBe(3);
  });
});

describe('email_tokens', () => {
  it('el hash debe ser SHA-256 hex (un token en claro se rechaza)', async () => {
    await expectViolation(
      insertEmailToken('register', null, 'a@example.com', 'ABCD-EFGH'),
      'email_tokens_token_hash_chk',
    );
    await expectViolation(
      insertEmailToken('register', null, 'a@example.com', randomBytes(32).toString('base64url')),
      'email_tokens_token_hash_chk',
    );
  });

  it('el tipo debe ser register o reset_password', async () => {
    await expectViolation(insertEmailToken('verify_email', null, 'b@example.com'), 'email_tokens_type_chk');
  });

  it('email_tokens_user_type_chk: register sin usuario y reset_password con usuario', async () => {
    const userId = await insertUser('tok_user');
    await expectViolation(
      insertEmailToken('register', userId, 'tok_user@example.com'),
      'email_tokens_user_type_chk',
    );
    await expectViolation(
      insertEmailToken('reset_password', null, 'tok_user@example.com'),
      'email_tokens_user_type_chk',
    );
    await insertEmailToken('register', null, 'nuevo@example.com');
    await insertEmailToken('reset_password', userId, 'tok_user@example.com');
  });

  it('el correo debe ir en minúsculas', async () => {
    await expectViolation(insertEmailToken('register', null, 'Mayus@example.com'), 'email_tokens_email_chk');
  });

  it('attempts va de 0 a 5', async () => {
    const q = (attempts: number) =>
      sql`INSERT INTO email_tokens (id, email, type, token_hash, attempts, expires_at)
          VALUES (${randomUUID()}, 'att@example.com', 'register', ${hex64()}, ${attempts},
                  now() + interval '30 minutes')`;
    await expectViolation(q(6), 'email_tokens_attempts_chk');
    await expectViolation(q(-1), 'email_tokens_attempts_chk');
  });

  it('uq_email_tokens_register_pending: un solo código pendiente por correo', async () => {
    const email = 'pendiente@example.com';
    const first = hex64();
    await insertEmailToken('register', null, email, first);
    await expectViolation(insertEmailToken('register', null, email), 'uq_email_tokens_register_pending');

    await sql`UPDATE email_tokens SET used_at = now() WHERE token_hash = ${first}`;
    await insertEmailToken('register', null, email);

    // No afecta a los enlaces de recuperación de una cuenta con ese correo.
    const userId = await insertUser('pendiente', email);
    await insertEmailToken('reset_password', userId, email);
    await insertEmailToken('reset_password', userId, email);
  });
});

describe('cascadas', () => {
  it('borrar el usuario borra sus dispositivos, sesiones y tokens', async () => {
    const userId = await insertUser('borrar');
    const deviceId = await insertDevice(userId);
    await insertSession(userId, deviceId);
    await insertEmailToken('reset_password', userId, 'borrar@example.com');
    await insertEmailToken('register', null, 'ajeno@example.com');

    await sql`DELETE FROM users WHERE id = ${userId}`;
    const [counts] = await sql`SELECT
        (SELECT count(*) FROM devices)::int AS devices,
        (SELECT count(*) FROM sessions)::int AS sessions,
        (SELECT count(*) FROM email_tokens)::int AS tokens`;
    expect(counts).toEqual({ devices: 0, sessions: 0, tokens: 1 });
  });

  it('borrar un dispositivo borra solo sus sesiones', async () => {
    const userId = await insertUser('dos_disp');
    const pc = await insertDevice(userId, 'windows');
    const movil = await insertDevice(userId, 'android');
    await insertSession(userId, pc);
    await insertSession(userId, movil);

    await sql`DELETE FROM devices WHERE id = ${pc}`;
    const rows = await sql`SELECT device_id FROM sessions`;
    expect(rows.map((r) => r.device_id)).toEqual([movil]);
  });
});
