// Cierre de sesión y gestión de dispositivos (contracts/api.md). Todas exigen Bearer; cada consulta
// va filtrada por el user_id del token.
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppContext } from '../app.js';
import { requireAuth, type AuthVariables } from '../auth/middleware.js';
import {
  deleteDevice,
  deleteDeviceByFamily,
  listActiveDevices,
  revokeAllSessions,
} from '../auth/sessions.js';
import { errorBody, validationHook } from '../lib/errors.js';
import { errorResponse } from './schemas.js';

const security = [{ bearerAuth: [] }];
const noContent = { 204: { description: 'Hecho' } } as const;

const SessionSchema = z
  .object({
    deviceId: z.string().uuid(),
    platform: z.enum(['android', 'windows', 'linux', 'macos']),
    name: z.string().optional(),
    lastSeenAt: z.string().datetime(),
    createdAt: z.string().datetime(),
    current: z.boolean(),
  })
  .openapi('Session');

const logoutRoute = createRoute({
  method: 'post',
  path: '/auth/logout',
  tags: ['Sesiones'],
  summary: 'Cierra la sesión del dispositivo actual',
  description: 'Borra el dispositivo de la sesión actual y, en cascada, sus sesiones. Idempotente.',
  security,
  responses: { ...noContent, 401: errorResponse('Token de acceso ausente o no válido') },
});

const logoutAllRoute = createRoute({
  method: 'post',
  path: '/auth/logout-all',
  tags: ['Sesiones'],
  summary: 'Cierra la sesión en todos los dispositivos',
  description: 'Revoca todas las sesiones del usuario: ningún refresh token anterior vuelve a valer.',
  security,
  responses: { ...noContent, 401: errorResponse('Token de acceso ausente o no válido') },
});

const listRoute = createRoute({
  method: 'get',
  path: '/me/sessions',
  tags: ['Sesiones'],
  summary: 'Lista los dispositivos con sesión activa',
  security,
  responses: {
    200: {
      description: 'Un elemento por dispositivo activo, identificado por su deviceId estable',
      content: { 'application/json': { schema: z.object({ sessions: z.array(SessionSchema) }).openapi('SessionList') } },
    },
    401: errorResponse('Token de acceso ausente o no válido'),
  },
});

const deleteRoute = createRoute({
  method: 'delete',
  path: '/me/sessions/{deviceId}',
  tags: ['Sesiones'],
  summary: 'Cierra la sesión de un dispositivo',
  description: 'Borra el dispositivo (y sus sesiones). 404 si no existe o no es del usuario.',
  security,
  request: { params: z.object({ deviceId: z.string().uuid() }) },
  responses: {
    ...noContent,
    401: errorResponse('Token de acceso ausente o no válido'),
    404: errorResponse('not_found: el dispositivo no existe o no es del usuario'),
    422: errorResponse('deviceId no es un UUID'),
  },
});

export function sessionRoutes(ctx: AppContext) {
  const r = new OpenAPIHono<{ Variables: AuthVariables }>({ defaultHook: validationHook });
  const auth = requireAuth(ctx.jwtSecret);
  r.use('/auth/logout', auth);
  r.use('/auth/logout-all', auth);
  r.use('/me/sessions', auth);
  r.use('/me/sessions/*', auth);

  r.openapi(logoutRoute, async (c) => {
    await deleteDeviceByFamily(ctx.db, c.get('userId'), c.get('familyId'));
    return c.body(null, 204);
  });

  r.openapi(logoutAllRoute, async (c) => {
    await revokeAllSessions(ctx.db, c.get('userId'));
    return c.body(null, 204);
  });

  r.openapi(listRoute, async (c) => {
    const current = c.get('familyId');
    const devices = await listActiveDevices(ctx.db, c.get('userId'));
    return c.json(
      {
        sessions: devices.map((d) => ({
          deviceId: d.deviceId,
          platform: d.platform,
          ...(d.name === null ? {} : { name: d.name }),
          lastSeenAt: d.lastSeenAt.toISOString(),
          createdAt: d.createdAt.toISOString(),
          current: d.familyId === current,
        })),
      },
      200,
    );
  });

  r.openapi(deleteRoute, async (c) => {
    const deleted = await deleteDevice(ctx.db, c.get('userId'), c.req.valid('param').deviceId);
    if (!deleted) return c.json(errorBody('not_found', 'No existe ese dispositivo.'), 404);
    return c.body(null, 204);
  });

  return r;
}
