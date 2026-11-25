import type { MiddlewareHandler } from 'hono';
import { jsonError } from '../lib/errors.js';
import { verifyAccessToken } from './tokens.js';

export type AuthVariables = { userId: string; familyId: string };

/** Exige `Authorization: Bearer <access>` válido e inyecta `userId` y `familyId` en el contexto. */
export function requireAuth(jwtSecret: string): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    const claims = match?.[1] ? await verifyAccessToken(match[1], jwtSecret) : null;
    if (!claims) {
      c.header('WWW-Authenticate', 'Bearer');
      return jsonError(c, 401, 'unauthorized', 'Sesión no válida o caducada.');
    }
    c.set('userId', claims.userId);
    c.set('familyId', claims.familyId);
    await next();
  };
}
