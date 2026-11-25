// Rutas públicas de autenticación (contracts/api.md). Todas pasan por el limitador de frecuencia.
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import type { AppContext } from '../app.js';
import { createRegisterToken, purgeExpiredRegisterTokens } from '../auth/email-tokens.js';
import { buildTokens } from '../auth/issue.js';
import { completeRegistration } from '../auth/registration.js';
import { users } from '../db/schema.js';
import { errorBody, validationHook } from '../lib/errors.js';
import { clientIp, emailFromBody, LIMITS, rateLimit } from '../lib/rate-limit.js';
import { alreadyRegisteredEmail, registrationCodeEmail } from '../mail/index.js';
import { sendInBackground } from '../mail/background.js';
import { AuthResponseSchema, DeviceSchema, EmailSchema, errorResponse } from './schemas.js';

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

const completeRoute = createRoute({
  method: 'post',
  path: '/auth/register/complete',
  tags: ['Autenticación'],
  summary: 'Paso 2 del registro: crea la cuenta con el código recibido',
  description:
    'Comprueba el código antes que cualquier otro dato. Un nombre de usuario ocupado no gasta el código. ' +
    'Reglas: nombre de usuario de 3 a 30 caracteres entre a-z, 0-9 y _ (sin distinguir mayúsculas), nombre visible de 1 a 100 ' +
    'caracteres, contraseña de 10 a 128 caracteres no común, zona horaria IANA (por defecto Europe/Madrid).',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z
            .object({
              email: EmailSchema,
              code: z.string().max(32),
              username: z.string().max(64),
              displayName: z.string().max(200),
              password: z.string().max(1024),
              timezone: z.string().max(64).optional(),
              device: DeviceSchema,
            })
            .openapi('RegisterCompleteRequest'),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Cuenta creada (ya verificada) y sesión iniciada',
      content: { 'application/json': { schema: AuthResponseSchema } },
    },
    400: errorResponse('invalid_code: código erróneo, caducado, usado o agotado (siempre igual)'),
    409: errorResponse('username_taken, email_taken o device_id_conflict'),
    422: errorResponse('Datos no válidos (weak_password, validation_error...)'),
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

  r.use('/auth/register/complete', rateLimit(ctx.limiter, [{ name: 'register-complete:ip', limit: LIMITS.registerCompleteIp, key: ip }]));

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

  r.openapi(completeRoute, async (c) => {
    const result = await completeRegistration(ctx.db, c.req.valid('json'));
    switch (result.kind) {
      case 'ok':
        return c.json({ user: result.user, tokens: await buildTokens(result.session, ctx.jwtSecret) }, 201);
      case 'invalid_code':
        return c.json(errorBody('invalid_code', 'El código no es válido o ha caducado.'), 400);
      case 'username_taken':
        return c.json(errorBody('username_taken', 'Ese nombre de usuario ya está en uso.'), 409);
      case 'email_taken':
        return c.json(errorBody('email_taken', 'Ya existe una cuenta con este correo.'), 409);
      case 'device_id_conflict':
        return c.json(errorBody('device_id_conflict', 'El identificador de dispositivo ya existe.'), 409);
      case 'invalid_data':
        return c.json(errorBody(result.field === 'password' ? 'weak_password' : 'validation_error', result.message), 422);
    }
  });

  return r;
}
