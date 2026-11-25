import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** Cuerpo de error con el formato del contrato: { error: { code, message } }. */
export function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

export function jsonError(c: Context, status: ContentfulStatusCode, code: string, message: string) {
  return c.json(errorBody(code, message), status);
}

/**
 * Hook de validación de Zod para las rutas: 422 con el formato del contrato. El mensaje nombra
 * los campos erróneos, nunca sus valores (podrían ser contraseñas o códigos).
 */
export function validationHook(
  result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } },
  c: Context,
) {
  if (result.success) return undefined;
  const fields = [...new Set((result.error?.issues ?? []).map((i) => i.path.map(String).join('.') || '(cuerpo)'))];
  return c.json(errorBody('validation_error', `Datos no válidos: ${fields.join(', ')}.`), 422);
}
