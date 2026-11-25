// Rutas públicas de autenticación (contracts/api.md). Todas pasan por el limitador de frecuencia.
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import type { AppContext } from '../app.js';
import { createRegisterToken, purgeExpiredRegisterTokens } from '../auth/email-tokens.js';
import { users } from '../db/schema.js';
import { validationHook } from '../lib/errors.js';
import { clientIp, emailFromBody, LIMITS, rateLimit } from '../lib/rate-limit.js';
import { alreadyRegisteredEmail, registrationCodeEmail } from '../mail/index.js';
import { sendInBackground } from '../mail/background.js';
import { EmailSchema, errorResponse } from './schemas.js';

const registerRoute = createRoute({
  method: 'post',
  path: '/auth/register',
  tags: ['Autenticación'],
  summary: 'Paso 1 del registro: envía un código al correo',
  description:
    'Responde siempre igual, tenga o no cuenta el correo: si no la tiene, envía el código de registro; ' +
    'si la tiene, envía un aviso de "ya tienes cuenta".',
  request: {
    body: { content: { 'application/json': { schema: z.object({ email: EmailSchema }).openapi('RegisterRequest') } } },
  },
  responses: {
    202: {
      description: 'Petición aceptada (idéntica exista o no la cuenta)',
      content: { 'application/json': { schema: z.object({}).openapi('Empty') } },
    },
    422: errorResponse('Correo mal formado'),
    429: errorResponse('Demasiados intentos (cabecera Retry-After)'),
  },
});

export function authRoutes(ctx: AppContext) {
  const r = new OpenAPIHono({ defaultHook: validationHook });
  const ip = (c: Parameters<typeof clientIp>[0]) => clientIp(c, ctx.trustProxy);

  r.use(
    '/auth/register',
    rateLimit(ctx.limiter, [
      { name: 'register:email', limit: LIMITS.registerEmail, key: emailFromBody },
      { name: 'register:ip', limit: LIMITS.registerIp, key: ip },
    ]),
  );

  r.openapi(registerRoute, async (c) => {
    const { email } = c.req.valid('json');
    // Mismo trabajo visible en los dos casos: una consulta y un envío sin esperar.
    const [account] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    const message = account
      ? alreadyRegisteredEmail()
      : await createRegisterToken(ctx.db, email).then((t) => (t ? registrationCodeEmail(t.code) : null));
    await purgeExpiredRegisterTokens(ctx.db);
    if (message) sendInBackground(ctx.mailer, ctx.logger, { to: email, ...message });
    return c.json({}, 202);
  });

  return r;
}
