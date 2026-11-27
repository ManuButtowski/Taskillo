// Restablecer y cambiar contraseña (US2, US3, FR-008). Las reglas de contraseña son las del registro.
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { emailTokens, users } from '../db/schema.js';
import { consumeResetToken, hashResetToken, invalidateResetTokens } from './email-tokens.js';
import { hashPassword, validatePasswordPolicy, verifyPassword } from './passwords.js';
import { PASSWORD_MESSAGES } from './registration.js';
import { revokeAllSessions } from './sessions.js';

export type ResetResult =
  | { kind: 'ok' }
  | { kind: 'invalid_token' }
  | { kind: 'weak_password'; message: string };

class Rollback extends Error {
  constructor(readonly result: ResetResult) {
    super('rollback');
  }
}

/** ¿Sigue vivo el enlace? No lo consume (el GET de la página no debe gastarlo). */
export async function isResetTokenValid(db: Database['db'], token: string): Promise<boolean> {
  if (!token) return false;
  const [row] = await db
    .select({ userId: emailTokens.userId, email: emailTokens.email })
    .from(emailTokens)
    .where(
      and(
        eq(emailTokens.tokenHash, hashResetToken(token)),
        eq(emailTokens.type, 'reset_password'),
        isNull(emailTokens.usedAt),
        sql`${emailTokens.expiresAt} > now()`,
      ),
    );
  if (!row?.userId) return false;
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, row.userId));
  return !!user && user.email.toLowerCase() === row.email.toLowerCase();
}

/** Datos del enlace vivo y de su usuario (sin consumirlo), o null. */
async function peekResetToken(db: Database['db'], token: string) {
  if (!token) return null;
  const [row] = await db
    .select({ userId: emailTokens.userId, email: emailTokens.email })
    .from(emailTokens)
    .where(
      and(
        eq(emailTokens.tokenHash, hashResetToken(token)),
        eq(emailTokens.type, 'reset_password'),
        isNull(emailTokens.usedAt),
        sql`${emailTokens.expiresAt} > now()`,
      ),
    );
  if (!row?.userId) return null;
  const [user] = await db.select({ email: users.email, username: users.username }).from(users).where(eq(users.id, row.userId));
  if (!user || user.email.toLowerCase() !== row.email.toLowerCase()) return null;
  return { userId: row.userId, email: row.email, username: user.username };
}

/**
 * Consume el enlace, fija la contraseña nueva y revoca todas las sesiones. La política y el hash Argon2 se
 * calculan ANTES de abrir la transacción (no se mantiene abierta durante el hash); una contraseña no válida
 * no llega a consumir el enlace. La transacción consume el enlace de forma atómica (si otro lo gastó antes,
 * invalid_token).
 */
export async function resetPassword(db: Database['db'], token: string, newPassword: string): Promise<ResetResult> {
  const pending = await peekResetToken(db, token);
  if (!pending) return { kind: 'invalid_token' };
  const policy = validatePasswordPolicy(newPassword, { email: pending.email, username: pending.username });
  if (!policy.ok) return { kind: 'weak_password', message: PASSWORD_MESSAGES[policy.reason] };
  const passwordHash = await hashPassword(newPassword);
  try {
    return await db.transaction(async (tx): Promise<ResetResult> => {
      const consumed = await consumeResetToken(tx, token);
      if (!consumed || consumed.userId !== pending.userId) throw new Rollback({ kind: 'invalid_token' });
      await tx.update(users).set({ passwordHash, updatedAt: sql`now()` }).where(eq(users.id, consumed.userId));
      await revokeAllSessions(tx, consumed.userId);
      await invalidateResetTokens(tx, consumed.userId);
      return { kind: 'ok' };
    });
  } catch (err) {
    if (err instanceof Rollback) return err.result;
    throw err;
  }
}

export type ChangePasswordResult =
  | { kind: 'ok' }
  | { kind: 'invalid_credentials' }
  | { kind: 'weak_password'; message: string };

/** Cambia la contraseña con la actual: revoca las demás sesiones, conserva la actual e invalida los enlaces pendientes. */
export async function changePassword(
  db: Database['db'],
  input: { userId: string; familyId: string; currentPassword: string; newPassword: string },
): Promise<ChangePasswordResult> {
  const [user] = await db
    .select({ email: users.email, username: users.username, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, input.userId));
  if (!user || !(await verifyPassword(user.passwordHash, input.currentPassword))) {
    return { kind: 'invalid_credentials' };
  }
  const policy = validatePasswordPolicy(input.newPassword, { email: user.email, username: user.username });
  if (!policy.ok) return { kind: 'weak_password', message: PASSWORD_MESSAGES[policy.reason] };
  const passwordHash = await hashPassword(input.newPassword);
  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash, updatedAt: sql`now()` }).where(eq(users.id, input.userId));
    await revokeAllSessions(tx, input.userId, { exceptFamilyId: input.familyId });
    await invalidateResetTokens(tx, input.userId);
  });
  return { kind: 'ok' };
}
