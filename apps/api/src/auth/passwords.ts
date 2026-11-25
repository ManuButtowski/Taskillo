// Contraseñas: hash Argon2id (parámetros OWASP de research.md) y política de contraseña (NIST 800-63B).
import { hash, verify } from '@node-rs/argon2';
import { COMMON_PASSWORDS } from './common-passwords.js';

export const ARGON2_PARAMS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

// Algorithm.Argon2id = 2 (enum const de @node-rs/argon2, no importable con isolatedModules).
const ARGON2ID = 2;

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, { ...ARGON2_PARAMS, algorithm: ARGON2ID });
}

/** Nunca lanza: un hash mal formado o una contraseña vacía simplemente no verifican. */
export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  if (!storedHash || !plain) return false;
  try {
    return await verify(storedHash, plain);
  } catch {
    return false;
  }
}

export type PasswordPolicyResult =
  | { ok: true }
  | { ok: false; reason: 'too_short' | 'too_long' | 'common' | 'same_as_identity' };

export function validatePasswordPolicy(
  password: string,
  identity: { email?: string; username?: string } = {},
): PasswordPolicyResult {
  const length = [...password].length; // caracteres, no unidades UTF-16
  if (length < PASSWORD_MIN_LENGTH) return { ok: false, reason: 'too_short' };
  if (length > PASSWORD_MAX_LENGTH) return { ok: false, reason: 'too_long' };
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return { ok: false, reason: 'common' };
  for (const value of [identity.email, identity.username]) {
    if (value && lower === value.toLowerCase()) return { ok: false, reason: 'same_as_identity' };
  }
  return { ok: true };
}
