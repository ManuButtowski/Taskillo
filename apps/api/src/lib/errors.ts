import type { Context } from 'hono';

/** Cuerpo de error con el formato del contrato: { error: { code, message } }. */
export function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

export function jsonError(c: Context, status: 401 | 429, code: string, message: string) {
  return c.json(errorBody(code, message), status);
}
