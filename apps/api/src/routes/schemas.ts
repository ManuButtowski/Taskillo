// Esquemas compartidos de la API (contracts/api.md, "Esquemas"). Fuente del OpenAPI.
import { z } from '@hono/zod-openapi';
import { DEVICE_PLATFORMS } from '../db/schema.js';

export const ErrorSchema = z
  .object({ error: z.object({ code: z.string(), message: z.string() }) })
  .openapi('Error');

export const UserSchema = z
  .object({
    id: z.string().uuid(),
    email: z.string(),
    username: z.string(),
    displayName: z.string(),
    timezone: z.string(),
  })
  .openapi('User');

export const TokensSchema = z
  .object({
    accessToken: z.string(),
    refreshToken: z.string(),
    expiresIn: z.number().int().openapi({ example: 900 }),
  })
  .openapi('Tokens');

export const DeviceSchema = z
  .object({
    id: z.string().uuid(),
    platform: z.enum(DEVICE_PLATFORMS),
    name: z.string().trim().min(1).max(100).optional(),
  })
  .openapi('Device');

export const AuthResponseSchema = z.object({ user: UserSchema, tokens: TokensSchema }).openapi('AuthResponse');

export const RefreshResponseSchema = z.object({ tokens: TokensSchema }).openapi('RefreshResponse');

/** Correo recortado y en minúsculas (data-model.md, "Reglas de validación"). */
export const EmailSchema = z.string().trim().toLowerCase().max(254).email();

/** Respuestas de error comunes, para no repetirlas en cada ruta. */
export const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: ErrorSchema } },
});
