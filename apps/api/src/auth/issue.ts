import { ACCESS_TOKEN_TTL_SECONDS, signAccessToken } from './tokens.js';
import type { IssuedSession } from './sessions.js';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/** Tokens que recibe el cliente: JWT de acceso (con `fam`) + el refresh recién emitido. */
export async function buildTokens(session: IssuedSession, jwtSecret: string): Promise<IssuedTokens> {
  return {
    accessToken: await signAccessToken({ userId: session.userId, familyId: session.familyId }, jwtSecret),
    refreshToken: session.refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  };
}
