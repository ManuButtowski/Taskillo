// Esquema de la spec 001 (data-model.md, "Migración 0000"). El SQL de data-model.md es la
// referencia: este fichero debe generar una migración equivalente con `pnpm db:generate`.
// - Ninguna columna `id` tiene DEFAULT en la base de datos (PostgreSQL 16 no tiene uuidv7());
//   la API los genera con `$defaultFn` y `v7` de `uuid`. `devices.id` lo envía el cliente.
// - Todas las fechas son TIMESTAMPTZ (`withTimezone: true`).
// - Los nombres de restricciones e índices son explícitos para poder comprobarlos en los tests.
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  customType,
  foreignKey,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';

/** CITEXT (extensión `citext`, creada al principio de la migración 0000). */
const citext = customType<{ data: string }>({
  dataType: () => 'citext',
});

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

export const DEVICE_PLATFORMS = ['android', 'windows', 'linux', 'macos'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

export const EMAIL_TOKEN_TYPES = ['register', 'reset_password'] as const;
export type EmailTokenType = (typeof EMAIL_TOKEN_TYPES)[number];

// 1. USUARIOS
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
    email: citext('email').notNull(),
    emailVerifiedAt: timestamptz('email_verified_at'),
    passwordHash: text('password_hash').notNull(),
    username: citext('username').notNull(),
    displayName: varchar('display_name', { length: 100 }).notNull(),
    timezone: varchar('timezone', { length: 64 }).notNull().default('Europe/Madrid'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('users_email_key').on(t.email),
    unique('users_username_key').on(t.username),
    check(
      'users_email_chk',
      sql`char_length(email::text) <= 254 AND email::text = lower(email::text) AND strpos(email::text, '@') > 1`,
    ),
    check('users_username_chk', sql`username::text ~ '^[a-z0-9_]{3,30}$'`),
    check(
      'users_display_name_chk',
      sql`char_length(display_name) BETWEEN 1 AND 100 AND display_name = btrim(display_name)`,
    ),
    check('users_password_hash_chk', sql`password_hash LIKE '$argon2id$%'`),
  ],
);

// 2. DISPOSITIVOS
export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey(), // generado en el cliente
    userId: uuid('user_id').notNull(),
    platform: varchar('platform', { length: 10 }).$type<DevicePlatform>().notNull(),
    name: varchar('name', { length: 100 }),
    lastSyncSeq: bigint('last_sync_seq', { mode: 'number' }).notNull().default(0), // spec 002
    lastSeenAt: timestamptz('last_seen_at').notNull().defaultNow(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: 'devices_user_id_fkey', columns: [t.userId], foreignColumns: [users.id] }).onDelete(
      'cascade',
    ),
    check('devices_platform_chk', sql`platform IN ('android','windows','linux','macos')`),
    check('devices_last_sync_seq_chk', sql`last_sync_seq >= 0`),
    unique('devices_id_user_key').on(t.id, t.userId), // destino de la FK compuesta
    index('idx_devices_user').on(t.userId),
  ],
);

// 3. SESIONES (una fila por refresh token emitido)
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
    userId: uuid('user_id').notNull(),
    deviceId: uuid('device_id').notNull(),
    familyId: uuid('family_id').notNull(), // cadena de rotación (UUIDv7, API)
    refreshTokenHash: text('refresh_token_hash').notNull(), // SHA-256 hex, nunca el token
    expiresAt: timestamptz('expires_at').notNull(),
    rotatedAt: timestamptz('rotated_at'),
    revokedAt: timestamptz('revoked_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: 'sessions_user_id_fkey', columns: [t.userId], foreignColumns: [users.id] }).onDelete(
      'cascade',
    ),
    unique('sessions_refresh_token_hash_key').on(t.refreshTokenHash),
    foreignKey({
      name: 'sessions_device_fk',
      columns: [t.deviceId, t.userId],
      foreignColumns: [devices.id, devices.userId],
    }).onDelete('cascade'),
    check('sessions_refresh_token_hash_chk', sql`refresh_token_hash ~ '^[0-9a-f]{64}$'`),
    check('sessions_expires_chk', sql`expires_at > created_at`),
    // Como mucho UN token vivo por familia (impone la rotación atómica).
    uniqueIndex('uq_sessions_family_live')
      .on(t.familyId)
      .where(sql`rotated_at IS NULL AND revoked_at IS NULL`),
    index('idx_sessions_user_live')
      .on(t.userId)
      .where(sql`rotated_at IS NULL AND revoked_at IS NULL`),
    index('idx_sessions_family').on(t.familyId),
    index('idx_sessions_device').on(t.deviceId),
  ],
);

// 4. TOKENS DE CORREO
//    register: código del paso 1 del registro (aún no hay usuario; user_id NULL).
//    reset_password: enlace de recuperación de una cuenta existente.
export const emailTokens = pgTable(
  'email_tokens',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
    userId: uuid('user_id'), // NULL solo en 'register'
    email: citext('email').notNull(),
    type: varchar('type', { length: 20 }).$type<EmailTokenType>().notNull(),
    tokenHash: text('token_hash').notNull(),
    attempts: smallint('attempts').notNull().default(0),
    expiresAt: timestamptz('expires_at').notNull(),
    usedAt: timestamptz('used_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: 'email_tokens_user_id_fkey', columns: [t.userId], foreignColumns: [users.id] }).onDelete(
      'cascade',
    ),
    unique('email_tokens_token_hash_key').on(t.tokenHash),
    check('email_tokens_type_chk', sql`type IN ('register','reset_password')`),
    check('email_tokens_user_type_chk', sql`(type = 'register') = (user_id IS NULL)`),
    check('email_tokens_email_chk', sql`email::text = lower(email::text)`),
    check('email_tokens_token_hash_chk', sql`token_hash ~ '^[0-9a-f]{64}$'`),
    check('email_tokens_attempts_chk', sql`attempts BETWEEN 0 AND 5`),
    check('email_tokens_expires_chk', sql`expires_at > created_at`),
    // Índice completo (no parcial) para que también lo use la cascada desde users.
    index('idx_email_tokens_user_type').on(t.userId, t.type),
    // Como mucho UN código de registro pendiente por correo.
    uniqueIndex('uq_email_tokens_register_pending')
      .on(t.email)
      .where(sql`type = 'register' AND used_at IS NULL`),
  ],
);
