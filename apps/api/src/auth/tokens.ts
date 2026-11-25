// Tokens: JWT de acceso (15 min, HS256 con `jose`) y refresh token opaco (32 bytes, solo se guarda su SHA-256).
import { createHash, randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const ALGORITHM = 'HS256';

export interface AccessClaims {
  userId: string;
  familyId: string;
}

const key = (secret: string) => new TextEncoder().encode(secret);

/** `now` solo se inyecta en los tests; en producción es la hora actual. */
export async function signAccessToken(claims: AccessClaims, secret: string, now: Date = new Date()): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({ fam: claims.familyId })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(claims.userId)
    .setIssuedAt(iat)
    .setExpirationTime(iat + ACCESS_TOKEN_TTL_SECONDS)
    .sign(key(secret));
}

/** Devuelve las claims, o `null` si el token es inválido, está caducado o manipulado (nunca lanza). */
export async function verifyAccessToken(token: string, secret: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      algorithms: [ALGORITHM],
      requiredClaims: ['sub', 'fam', 'exp'],
    });
    if (typeof payload.sub !== 'string' || typeof payload.fam !== 'string') return null;
    return { userId: payload.sub, familyId: payload.fam };
  } catch {
    return null;
  }
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashRefreshToken(token) };
}
