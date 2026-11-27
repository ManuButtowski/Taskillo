// Paso 2 del registro (data-model.md, "Registro en dos pasos"): el código se comprueba ANTES que
// cualquier dato, así que `username_taken` y `email_taken` solo se revelan a quien posee el correo.
import { sql } from 'drizzle-orm';
import { DeviceIdConflictError, createSession, type IssuedSession } from './sessions.js';
import { markTokenUsed, verifyRegisterCode } from './email-tokens.js';
import { hashPassword, validatePasswordPolicy } from './passwords.js';
import type { Database } from '../db/client.js';
import { type DevicePlatform, users } from '../db/schema.js';
import { isUniqueViolation } from '../lib/pg-errors.js';

export const DEFAULT_TIMEZONE = 'Europe/Madrid';
const USERNAME_PATTERN = /^[a-z0-9_]{3,30}$/;

export interface PublicUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  timezone: string;
}

export interface CompleteRegistrationInput {
  email: string;
  code: string;
  username: string;
  displayName: string;
  password: string;
  timezone?: string | undefined;
  device: { id: string; platform: DevicePlatform; name?: string | undefined };
}

export type InvalidDataField = 'username' | 'displayName' | 'password' | 'timezone';

export type CompleteRegistrationResult =
  | { kind: 'ok'; user: PublicUser; session: IssuedSession }
  | { kind: 'invalid_code' }
  | { kind: 'invalid_data'; field: InvalidDataField; message: string }
  | { kind: 'username_taken' }
  | { kind: 'email_taken' }
  | { kind: 'device_id_conflict' };

/** Identificador IANA aceptado por `Intl`; devuelve el nombre canónico o `null`. */
export function canonicalTimezone(value: string): string | null {
  if (!value || value.length > 64 || /^[+-]|:/.test(value)) return null; // desfases tipo "+01:00" no son IANA
  try {
    return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

export const PASSWORD_MESSAGES = {
  too_short: 'La contraseña debe tener al menos 10 caracteres.',
  too_long: 'La contraseña no puede superar los 128 caracteres.',
  common: 'Esa contraseña es demasiado común. Elige otra.',
  same_as_identity: 'La contraseña no puede ser igual al correo o al nombre de usuario.',
} as const;

export async function completeRegistration(
  db: Database['db'],
  input: CompleteRegistrationInput,
): Promise<CompleteRegistrationResult> {
  const email = input.email.toLowerCase();
  try {
    return await db.transaction(async (tx): Promise<CompleteRegistrationResult> => {
      // 1. El código, antes que nada. Si falla, el intento queda anotado y la transacción se confirma.
      const code = await verifyRegisterCode(tx, email, input.code);
      if (!code.ok) return { kind: 'invalid_code' };

      // 2. Datos de la cuenta. Un fallo aquí no gasta el código ni cuenta intento.
      const username = input.username.trim().toLowerCase();
      if (!USERNAME_PATTERN.test(username)) {
        return {
          kind: 'invalid_data',
          field: 'username',
          message: 'El nombre de usuario debe tener de 3 a 30 caracteres: letras, números o guion bajo.',
        };
      }
      const displayName = input.displayName.trim();
      const nameLength = [...displayName].length;
      if (nameLength < 1 || nameLength > 100) {
        return { kind: 'invalid_data', field: 'displayName', message: 'El nombre visible debe tener de 1 a 100 caracteres.' };
      }
      const policy = validatePasswordPolicy(input.password, { email, username });
      if (!policy.ok) {
        return { kind: 'invalid_data', field: 'password', message: PASSWORD_MESSAGES[policy.reason] };
      }
      const timezone = input.timezone === undefined ? DEFAULT_TIMEZONE : canonicalTimezone(input.timezone);
      if (!timezone) {
        return { kind: 'invalid_data', field: 'timezone', message: 'La zona horaria no es un identificador IANA válido.' };
      }

      // 3. Alta. El INSERT del usuario va en un punto de guardado para poder responder el conflicto
      //    sin deshacer la anotación del código (no hay nada más escrito en este punto).
      const passwordHash = await hashPassword(input.password);
      let user: PublicUser;
      try {
        user = await tx.transaction(async (sp) => {
          const [row] = await sp
            .insert(users)
            .values({ email, username, displayName, passwordHash, timezone, emailVerifiedAt: sql`now()` })
            .returning({
              id: users.id,
              email: users.email,
              username: users.username,
              displayName: users.displayName,
              timezone: users.timezone,
            });
          return row!;
        });
      } catch (err) {
        if (isUniqueViolation(err, 'users_username_key')) return { kind: 'username_taken' };
        if (isUniqueViolation(err, 'users_email_key')) return { kind: 'email_taken' };
        throw err;
      }

      const session = await createSession(tx, {
        userId: user.id,
        deviceId: input.device.id,
        platform: input.device.platform,
        name: input.device.name ?? null,
      });
      await markTokenUsed(tx, code.tokenId);
      return { kind: 'ok', user, session };
    });
  } catch (err) {
    // El conflicto de dispositivo ocurre con el usuario ya insertado: se deshace todo (el código
    // sigue vivo y la app reintenta con otro id).
    if (err instanceof DeviceIdConflictError) return { kind: 'device_id_conflict' };
    throw err;
  }
}
