// Tokens de correo (data-model.md, "Tokens de correo"): código del paso 1 del registro y enlace de
// recuperación de contraseña. Solo se guardan hashes SHA-256; las caducidades usan now() de PostgreSQL.
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { DbExecutor } from './sessions.js';
import { emailTokens, users } from '../db/schema.js';
import { isUniqueViolation } from '../lib/pg-errors.js';

export const REGISTER_MAX_ATTEMPTS = 5;
const CODE_LENGTH = 8;
// Alfabeto Crockford base32: sin I, L, O ni U.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{8}$/;

const sha256Hex = (value: string) => createHash('sha256').update(value).digest('hex');

export function generateRegistrationCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

/** Mayúsculas, sin guion ni espacios; I/L → 1 y O → 0. `null` si no es un código Crockford de 8 caracteres. */
export function normalizeRegistrationCode(input: string): string | null {
  const code = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
  return CODE_PATTERN.test(code) ? code : null;
}

/** sha256_hex(correo + ':' + código): dos correos con el mismo código no chocan en el UNIQUE. */
export function hashRegistrationCode(email: string, normalizedCode: string): string {
  return sha256Hex(`${email.toLowerCase()}:${normalizedCode}`);
}

export const hashResetToken = sha256Hex;

/**
 * Paso 1 del registro para un correo sin cuenta: invalida el código pendiente y crea otro.
 * Devuelve `null` si una petición simultánea ganó la carrera (`uq_email_tokens_register_pending`).
 */
export async function createRegisterToken(db: DbExecutor, rawEmail: string): Promise<{ code: string } | null> {
  const email = rawEmail.toLowerCase();
  const code = generateRegistrationCode();
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(emailTokens)
        .set({ usedAt: sql`now()` })
        .where(and(eq(emailTokens.email, email), eq(emailTokens.type, 'register'), isNull(emailTokens.usedAt)));
      await tx.insert(emailTokens).values({
        email,
        type: 'register',
        tokenHash: hashRegistrationCode(email, code),
        expiresAt: sql`now() + interval '30 minutes'`,
      });
    });
  } catch (err) {
    if (isUniqueViolation(err, 'uq_email_tokens_register_pending')) return null;
    throw err;
  }
  return { code };
}

/** Borra los `register` caducados hace más de 24 h (correos de personas sin cuenta). */
export async function purgeExpiredRegisterTokens(db: DbExecutor): Promise<number> {
  const rows = await db
    .delete(emailTokens)
    .where(and(eq(emailTokens.type, 'register'), sql`${emailTokens.expiresAt} < now() - interval '1 day'`))
    .returning({ id: emailTokens.id });
  return rows.length;
}

export type VerifyRegisterResult = { ok: true; tokenId: string } | { ok: false };

/**
 * Paso 2 del registro, comprobación del código. Debe ir dentro de la transacción del paso 2: bloquea
 * la fila (`FOR UPDATE`). Si el código no vale suma un intento (y agota la fila al quinto); quien
 * llama debe CONFIRMAR la transacción en ese caso (no lanzar) para que el intento persista.
 * Si vale, no marca el token: lo hace `markTokenUsed` cuando el alta sale bien.
 */
export async function verifyRegisterCode(
  tx: DbExecutor,
  rawEmail: string,
  rawCode: string,
): Promise<VerifyRegisterResult> {
  const email = rawEmail.toLowerCase();
  const [row] = await tx
    .select({ id: emailTokens.id, tokenHash: emailTokens.tokenHash })
    .from(emailTokens)
    .where(
      and(
        eq(emailTokens.email, email),
        eq(emailTokens.type, 'register'),
        isNull(emailTokens.usedAt),
        sql`${emailTokens.expiresAt} > now()`,
      ),
    )
    .for('update');
  if (!row) return { ok: false };

  const code = normalizeRegistrationCode(rawCode);
  const expected = Buffer.from(row.tokenHash, 'hex');
  // Si el formato no es válido se compara contra un hash de relleno: mismo trabajo, siempre falla.
  const given = Buffer.from(code ? hashRegistrationCode(email, code) : '0'.repeat(64), 'hex');
  if (code && timingSafeEqual(expected, given)) return { ok: true, tokenId: row.id };

  await tx
    .update(emailTokens)
    .set({
      attempts: sql`${emailTokens.attempts} + 1`,
      usedAt: sql`CASE WHEN ${emailTokens.attempts} + 1 >= ${REGISTER_MAX_ATTEMPTS} THEN now() ELSE ${emailTokens.usedAt} END`,
    })
    .where(eq(emailTokens.id, row.id));
  return { ok: false };
}

export async function markTokenUsed(tx: DbExecutor, tokenId: string): Promise<void> {
  await tx.update(emailTokens).set({ usedAt: sql`now()` }).where(eq(emailTokens.id, tokenId));
}

/** Invalida (`used_at = now()`) los enlaces de recuperación pendientes del usuario. */
export async function invalidateResetTokens(db: DbExecutor, userId: string): Promise<void> {
  await db
    .update(emailTokens)
    .set({ usedAt: sql`now()` })
    .where(
      and(eq(emailTokens.userId, userId), eq(emailTokens.type, 'reset_password'), isNull(emailTokens.usedAt)),
    );
}

/** Crea un token de recuperación (32 bytes en base64url) invalidando los pendientes del usuario. */
export async function createResetToken(
  db: DbExecutor,
  userId: string,
  email: string,
): Promise<{ token: string }> {
  const token = randomBytes(32).toString('base64url');
  await db.transaction(async (tx) => {
    await invalidateResetTokens(tx, userId);
    await tx.insert(emailTokens).values({
      userId,
      email: email.toLowerCase(),
      type: 'reset_password',
      tokenHash: hashResetToken(token),
      expiresAt: sql`now() + interval '1 hour'`,
    });
  });
  return { token };
}

/**
 * Consume un token de recuperación (atómico y siempre con el tipo `reset_password`). Devuelve el
 * usuario, o `null` si no existe, caducó, ya se usó, o el correo del usuario cambió desde el envío.
 */
export async function consumeResetToken(
  db: DbExecutor,
  token: string,
): Promise<{ userId: string; email: string } | null> {
  if (!token) return null;
  const [row] = await db
    .update(emailTokens)
    .set({ usedAt: sql`now()` })
    .where(
      and(
        eq(emailTokens.tokenHash, hashResetToken(token)),
        eq(emailTokens.type, 'reset_password'),
        isNull(emailTokens.usedAt),
        sql`${emailTokens.expiresAt} > now()`,
      ),
    )
    .returning({ userId: emailTokens.userId, email: emailTokens.email });
  if (!row?.userId) return null;
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, row.userId));
  if (!user || user.email.toLowerCase() !== row.email.toLowerCase()) return null;
  return { userId: row.userId, email: row.email };
}
