// Recuperación de contraseña (US2): forgot-password y la página/POST de reset-password.
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
import type { AppContext } from '../app.js';
import { createResetToken } from '../auth/email-tokens.js';
import { isResetTokenValid, resetPassword } from '../auth/password-reset.js';
import { users } from '../db/schema.js';
import { errorBody, validationHook } from '../lib/errors.js';
import { startMinDuration } from '../lib/min-duration.js';
import { clientIp, emailFromBody, LIMITS, rateLimit } from '../lib/rate-limit.js';
import { passwordResetEmail } from '../mail/index.js';
import { sendInBackground } from '../mail/background.js';
import { EmailSchema, errorResponse } from './schemas.js';
import { PAGE_HEADERS, resetDonePage, resetFormPage, resetInvalidPage } from './reset-pages.js';

const forgotRoute = createRoute({
  method: 'post',
  path: '/auth/forgot-password',
  tags: ['Recuperación'],
  summary: 'Pide un enlace para recuperar la contraseña',
  description:
    'Responde siempre igual (estado, cuerpo, cabeceras y tiempo mínimo), tenga o no cuenta el correo. ' +
    'Si la tiene, envía un enlace de un solo uso que caduca en 1 hora.',
  request: {
    body: { content: { 'application/json': { schema: z.object({ email: EmailSchema }).openapi('ForgotPasswordRequest') } } },
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

const ResetBodySchema = z
  .object({ token: z.string().min(1).max(256), newPassword: z.string().max(1024) })
  .openapi('ResetPasswordRequest');

const html = { 'text/html': { schema: z.string() } };

// Solo documentación: los manejadores de estas dos rutas son manuales (negociación JSON/formulario y HTML).
const resetPageRoute = createRoute({
  method: 'get',
  path: '/auth/reset-password',
  tags: ['Recuperación'],
  summary: 'Página HTML con el formulario de nueva contraseña',
  description:
    'No consume el token. Se sirve con Referrer-Policy: no-referrer y Cache-Control: no-store. ' +
    'Las URL con ?token= se registran en los logs sin la consulta.',
  request: { query: z.object({ token: z.string().optional() }) },
  responses: {
    200: { description: 'Formulario', content: html },
    400: { description: 'Enlace no válido o caducado', content: html },
  },
});

const resetPostRoute = createRoute({
  method: 'post',
  path: '/auth/reset-password',
  tags: ['Recuperación'],
  summary: 'Fija una contraseña nueva con el enlace de recuperación',
  description:
    'Acepta JSON o formulario (application/x-www-form-urlencoded; en ese caso responde con una página HTML). ' +
    'Consume el token, revoca todas las sesiones e invalida los demás enlaces pendientes. Una contraseña no válida no gasta el enlace.',
  request: {
    body: {
      content: {
        'application/json': { schema: ResetBodySchema },
        'application/x-www-form-urlencoded': { schema: ResetBodySchema },
      },
    },
  },
  responses: {
    200: { description: 'Contraseña cambiada', content: { 'application/json': { schema: z.object({}).openapi('Empty') } } },
    400: errorResponse('invalid_token: enlace inválido, caducado o ya usado'),
    422: errorResponse('weak_password o validation_error'),
    429: errorResponse('Demasiados intentos (cabecera Retry-After)'),
  },
});

function htmlResponse(c: Context, body: string, status: 200 | 400 | 422) {
  return c.html(body, status, PAGE_HEADERS);
}

export function recoveryRoutes(ctx: AppContext) {
  const r = new OpenAPIHono({ defaultHook: validationHook });
  const ip = (c: Parameters<typeof clientIp>[0]) => clientIp(c, ctx.trustProxy);

  r.use(
    '/auth/forgot-password',
    rateLimit(ctx.limiter, [
      { name: 'forgot:email', limit: LIMITS.forgotEmail, key: emailFromBody },
      { name: 'forgot:ip', limit: LIMITS.forgotIp, key: ip },
    ]),
  );

  r.use('/auth/reset-password', async (c, next) => {
    // Solo el POST gasta intentos; el GET de la página no.
    if (c.req.method !== 'POST') return next();
    return rateLimit(ctx.limiter, [{ name: 'reset:ip', limit: LIMITS.resetPasswordIp, key: ip }])(c, next);
  });

  r.openapi(forgotRoute, async (c) => {
    const { email } = c.req.valid('json');
    const waitFloor = startMinDuration(ctx.timing);
    const [account] = await ctx.db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (account) {
      const { token } = await createResetToken(ctx.db, account.id, account.email);
      const link = `${ctx.publicBaseUrl.replace(/\/+$/, '')}/api/v1/auth/reset-password?token=${token}`;
      sendInBackground(ctx.mailer, ctx.logger, { to: account.email, ...passwordResetEmail(link) });
    }
    // Mismo suelo de tiempo exista o no la cuenta ("cero fuga", igual que el registro).
    await waitFloor();
    return c.json({}, 202);
  });

  // Documentación de las dos rutas manuales.
  r.openAPIRegistry.registerPath(resetPageRoute);
  r.openAPIRegistry.registerPath(resetPostRoute);

  r.get('/auth/reset-password', async (c) => {
    const token = c.req.query('token') ?? '';
    if (!(await isResetTokenValid(ctx.db, token))) return htmlResponse(c, resetInvalidPage(), 400);
    return htmlResponse(c, resetFormPage(token), 200);
  });

  r.post('/auth/reset-password', async (c) => {
    const isForm = /^(application\/x-www-form-urlencoded|multipart\/form-data)/i.test(c.req.header('content-type') ?? '');
    let raw: unknown;
    try {
      raw = isForm ? await c.req.parseBody() : await c.req.json();
    } catch {
      raw = null;
    }
    const parsed = ResetBodySchema.safeParse(raw);
    if (!parsed.success) {
      if (isForm) return htmlResponse(c, resetInvalidPage(), 400);
      const fields = [...new Set(parsed.error.issues.map((i) => i.path.join('.') || '(cuerpo)'))];
      return c.json(errorBody('validation_error', `Datos no válidos: ${fields.join(', ')}.`), 422);
    }
    const { token, newPassword } = parsed.data;
    const result = await resetPassword(ctx.db, token, newPassword);
    switch (result.kind) {
      case 'ok':
        return isForm ? htmlResponse(c, resetDonePage(), 200) : c.json({}, 200);
      case 'invalid_token':
        return isForm
          ? htmlResponse(c, resetInvalidPage(), 400)
          : c.json(errorBody('invalid_token', 'El enlace no es válido o ha caducado.'), 400);
      case 'weak_password':
        return isForm
          ? htmlResponse(c, resetFormPage(token, result.message), 422)
          : c.json(errorBody('weak_password', result.message), 422);
    }
  });

  return r;
}
