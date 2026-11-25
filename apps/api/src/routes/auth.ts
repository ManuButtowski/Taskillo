// Rutas públicas de autenticación (contracts/api.md). Todas pasan por el limitador de frecuencia.
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import type { AppContext } from '../app.js';
import { createRegisterToken, purgeExpiredRegisterTokens } from '../auth/email-tokens.js';
import { buildTokens } from '../auth/issue.js';
import { hashPassword, verifyPassword } from '../auth/passwords.js';
import { createSession, DeviceIdConflictError, rotateRefreshToken } from '../auth/sessions.js';
import { completeRegistration } from '../auth/registration.js';
import { users } from '../db/schema.js';
import { errorBody, validationHook } from '../lib/errors.js';
import { clientIp, emailFromBody, LIMITS, rateLimit } from '../lib/rate-limit.js';
import { alreadyRegisteredEmail, registrationCodeEmail } from '../mail/index.js';
import { sendInBackground } from '../mail/background.js';
import { AuthResponseSchema, DeviceSchema, EmailSchema, errorResponse, RefreshResponseSchema } from './schemas.js';

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

const loginRoute = createRoute({
  method: 'post',
  path: '/auth/login',
  tags: ['Autenticación'],
  summary: 'Inicia sesión y registra el dispositivo',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z
            .object({ email: EmailSchema, password: z.string().min(1).max(1024), device: DeviceSchema })
            .openapi('LoginRequest'),
        },
      },
    },
  },
  responses: {
    200: { description: 'Sesión iniciada', content: { 'application/json': { schema: AuthResponseSchema } } },
    401: errorResponse('invalid_credentials (genérico: correo inexistente o contraseña errónea)'),
    409: errorResponse('device_id_conflict: el id de dispositivo ya existe; la app genera otro y reintenta'),
    422: errorResponse('Datos no válidos'),
    429: errorResponse('Demasiados intentos (cabecera Retry-After)'),
  },
});

const refreshRoute = createRoute({
  method: 'post',
  path: '/auth/refresh',
  tags: ['Autenticación'],
  summary: 'Rota el refresh token y emite un token de acceso nuevo',
  description: 'Un refresh token ya rotado que se reutiliza revoca toda la familia (cierra esa sesión).',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({ refreshToken: z.string().min(1).max(256) }).openapi('RefreshRequest'),
        },
      },
    },
  },
  responses: {
    200: { description: 'Tokens nuevos', content: { 'application/json': { schema: RefreshResponseSchema } } },
    401: errorResponse('invalid_refresh_token: inválido, caducado, rotado o revocado'),
    422: errorResponse('Datos no válidos'),
  },
});

// Hash de relleno: con un correo inexistente también se ejecuta una verificación Argon2, para que
// el tiempo de respuesta no delate si la cuenta existe.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword('contrasena-de-relleno-sin-uso'));

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

  r.use(
    '/auth/login',
    rateLimit(ctx.limiter, [
      { name: 'login:ip', limit: LIMITS.loginIp, key: ip },
      { name: 'login:email', limit: LIMITS.loginEmail, key: emailFromBody },
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

  r.openapi(loginRoute, async (c) => {
    const { email, password, device } = c.req.valid('json');
    const [row] = await ctx.db
      .select({
        id: users.id,
        email: users.email,
        username: users.username,
        displayName: users.displayName,
        timezone: users.timezone,
        passwordHash: users.passwordHash,
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    const valid = await verifyPassword(row?.passwordHash ?? (await getDummyHash()), password);
    if (!row || !valid) {
      return c.json(errorBody('invalid_credentials', 'Correo o contraseña incorrectos.'), 401);
    }
    const { passwordHash: _omit, ...user } = row;
    try {
      const session = await createSession(ctx.db, {
        userId: row.id,
        deviceId: device.id,
        platform: device.platform,
        name: device.name ?? null,
      });
      return c.json({ user, tokens: await buildTokens(session, ctx.jwtSecret) }, 200);
    } catch (err) {
      if (err instanceof DeviceIdConflictError) {
        return c.json(errorBody('device_id_conflict', 'El identificador de dispositivo ya existe.'), 409);
      }
      throw err;
    }
  });

  r.openapi(refreshRoute, async (c) => {
    const result = await rotateRefreshToken(ctx.db, c.req.valid('json').refreshToken);
    if (!result.ok) {
      return c.json(errorBody('invalid_refresh_token', 'Sesión no válida o caducada.'), 401);
    }
    return c.json({ tokens: await buildTokens(result.session, ctx.jwtSecret) }, 200);
  });

  return r;
}
