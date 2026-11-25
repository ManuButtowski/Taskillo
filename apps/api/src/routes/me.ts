import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppContext } from '../app.js';
import type { AuthVariables } from '../auth/middleware.js';
import { validationHook } from '../lib/errors.js';

export function meRoutes(_ctx: AppContext) {
  return new OpenAPIHono<{ Variables: AuthVariables }>({ defaultHook: validationHook });
}
