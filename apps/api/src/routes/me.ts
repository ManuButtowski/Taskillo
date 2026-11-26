// Perfil (US3): GET /me, PATCH /me y POST /me/password. Todas exigen Bearer y filtran por el user_id del token.
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { eq, sql } from 'drizzle-orm';
import type { AppContext } from '../app.js';
import { requireAuth, type AuthVariables } from '../auth/middleware.js';
import { changePassword } from '../auth/password-reset.js';
import { users } from '../db/schema.js';
import { errorBody, jsonError, validationHook } from '../lib/errors.js';
import { LIMITS } from '../lib/rate-limit.js';
import { errorResponse, UserSchema, rateLimitedResponse, unauthorizedResponse } from './schemas.js';

const security = [{ bearerAuth: [] }];
const unauthorized = unauthorizedResponse();
const UserResponseSchema = z.object({ user: UserSchema }).openapi('UserResponse');

const getMeRoute = createRoute({
  method: 'get',
  path: '/me',
  tags: ['Perfil'],
  summary: 'Perfil del usuario autenticado',
  security,
  responses: {
    200: { description: 'Usuario', content: { 'application/json': { schema: UserResponseSchema } } },
    401: unauthorized,
  },
});

const patchMeRoute = createRoute({
  method: 'patch',
  path: '/me',
  tags: ['Perfil'],
  summary: 'Cambia el nombre visible',
  security,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z
            .object({ displayName: z.string().max(1000).transform((v) => v.trim()).pipe(z.string().min(1).max(100)) })
            .openapi('UpdateMeRequest'),
        },
      },
    },
  },
  responses: {
    200: { description: 'Usuario actualizado', content: { 'application/json': { schema: UserResponseSchema } } },
    401: unauthorized,
    422: errorResponse('Nombre visible no válido (de 1 a 100 caracteres)'),
  },
});

const passwordRoute = createRoute({
  method: 'post',
  path: '/me/password',
  tags: ['Perfil'],
  summary: 'Cambia la contraseña',
  description:
    'Exige la contraseña actual. Revoca las demás sesiones, conserva la actual e invalida los enlaces de recuperación pendientes.',
  security,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z
            .object({ currentPassword: z.string().min(1).max(1024), newPassword: z.string().max(1024) })
            .openapi('ChangePasswordRequest'),
        },
      },
    },
  },
  responses: {
    204: { description: 'Contraseña cambiada' },
    401: unauthorized,
    403: errorResponse('invalid_credentials: la contraseña actual no coincide'),
    422: errorResponse('weak_password o validation_error'),
    429: rateLimitedResponse('Demasiados intentos fallidos'),
  },
});

export function meRoutes(ctx: AppContext) {
  const r = new OpenAPIHono<{ Variables: AuthVariables }>({ defaultHook: validationHook });
  const auth = requireAuth(ctx.jwtSecret);
  r.use('/me', auth);
  r.use('/me/password', auth);
  // Límite por usuario que solo cuenta los fallos de contraseña actual (research.md); va tras el Bearer.
  const failKey = (userId: string) => `change-password-fail:${userId}`;
  r.use('/me/password', async (c, next) => {
    const state = ctx.limiter.peek(failKey(c.get('userId')), LIMITS.changePasswordFailures);
    if (!state.allowed) {
      c.header('Retry-After', String(state.retryAfterSeconds));
      return jsonError(c, 429, 'rate_limited', 'Demasiados intentos. Inténtalo de nuevo más tarde.');
    }
    await next();
  });

  const columns = {
    id: users.id,
    email: users.email,
    username: users.username,
    displayName: users.displayName,
    timezone: users.timezone,
  };

  r.openapi(getMeRoute, async (c) => {
    const [user] = await ctx.db.select(columns).from(users).where(eq(users.id, c.get('userId')));
    // Cuenta borrada con un token aún vivo: tratamos el token como no válido.
    if (!user) return c.json(errorBody('unauthorized', 'Sesión no válida o caducada.'), 401);
    return c.json({ user }, 200);
  });

  r.openapi(patchMeRoute, async (c) => {
    const { displayName } = c.req.valid('json');
    const [user] = await ctx.db
      .update(users)
      .set({ displayName, updatedAt: sql`now()` })
      .where(eq(users.id, c.get('userId')))
      .returning(columns);
    if (!user) return c.json(errorBody('unauthorized', 'Sesión no válida o caducada.'), 401);
    return c.json({ user }, 200);
  });

  r.openapi(passwordRoute, async (c) => {
    const { currentPassword, newPassword } = c.req.valid('json');
    const result = await changePassword(ctx.db, {
      userId: c.get('userId'),
      familyId: c.get('familyId'),
      currentPassword,
      newPassword,
    });
    switch (result.kind) {
      case 'ok':
        return c.body(null, 204);
      case 'invalid_credentials':
        ctx.limiter.hit(failKey(c.get('userId')), LIMITS.changePasswordFailures);
        return c.json(errorBody('invalid_credentials', 'La contraseña actual no es correcta.'), 403);
      case 'weak_password':
        return c.json(errorBody('weak_password', result.message), 422);
    }
  });

  return r;
}
