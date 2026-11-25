import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform((v) => v === 'true');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    PUBLIC_BASE_URL: z.url().default('http://localhost:3000'),
    TRUST_PROXY: booleanString.default(false),
    DATABASE_URL: z.string().min(1),
    TEST_DATABASE_URL: z.string().min(1).optional(),
    JWT_SECRET: z.string().min(32),
    MAIL_DRIVER: z.enum(['smtp', 'resend']).default('smtp'),
    MAIL_FROM: z.string().min(1).default('Taskillo <no-reply@devkomp.es>'),
    SMTP_HOST: z.string().default('localhost'),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
    SMTP_SECURE: booleanString.default(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),
    MAILPIT_URL: z.string().optional(),
  })
  .refine((e) => e.MAIL_DRIVER !== 'resend' || !!e.RESEND_API_KEY, {
    path: ['RESEND_API_KEY'],
    message: 'obligatoria con MAIL_DRIVER=resend',
  });

export type Config = z.infer<typeof envSchema>;

/**
 * Valida las variables de entorno. Si falla, el mensaje nombra las variables
 * erróneas pero nunca sus valores (podrían ser secretos).
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  // Una variable vacía (p. ej. `SMTP_USER=` en .env) cuenta como ausente.
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== undefined && v !== ''),
  );
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    const detalle = result.error.issues
      .map((i) => `${i.path.join('.') || '(general)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Configuración de entorno no válida: ${detalle}`);
  }
  return result.data;
}
