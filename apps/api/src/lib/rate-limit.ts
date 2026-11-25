// Limitador de frecuencia en memoria (ventana deslizante). Basta con una sola instancia (research.md).
import type { Context, MiddlewareHandler } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { jsonError } from './errors.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export interface Limit {
  max: number;
  windowMs: number;
}

/** Política de research.md. */
export const LIMITS = {
  loginIp: { max: 10, windowMs: 15 * MINUTE },
  loginEmail: { max: 5, windowMs: 15 * MINUTE },
  registerEmail: { max: 3, windowMs: HOUR },
  registerIp: { max: 10, windowMs: HOUR },
  registerCompleteIp: { max: 10, windowMs: 15 * MINUTE },
  forgotEmail: { max: 3, windowMs: HOUR },
  forgotIp: { max: 10, windowMs: HOUR },
} as const satisfies Record<string, Limit>;

export type Clock = () => number;

export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly now: Clock = Date.now) {}

  /** Registra un intento. `retryAfterSeconds` solo viene cuando se supera el límite. */
  hit(key: string, limit: Limit): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => t > now - limit.windowMs);
    if (recent.length >= limit.max) {
      this.hits.set(key, recent);
      const retryMs = recent[0]! + limit.windowMs - now;
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryMs / 1000)) };
    }
    recent.push(now);
    this.hits.set(key, recent);
    return { allowed: true };
  }

  /** Borra claves sin intentos vivos (llamar de vez en cuando para no crecer sin límite). */
  prune(maxWindowMs: number): void {
    const cutoff = this.now() - maxWindowMs;
    for (const [key, times] of this.hits) {
      if (times.every((t) => t <= cutoff)) this.hits.delete(key);
    }
  }
}

/** IP del cliente. Con `trustProxy` usa el primer valor de X-Forwarded-For (Caddy); si no, la conexión. */
export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded) return forwarded;
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export interface RateLimitRule {
  /** Prefijo de la clave: separa los contadores de cada ruta y tipo. */
  name: string;
  limit: Limit;
  /** Valor a limitar (IP, correo...). `null` = no aplica a esta petición. */
  key: (c: Context) => string | null | Promise<string | null>;
}

/** Middleware que aplica una o varias reglas; la primera que se supera devuelve 429 con Retry-After. */
export function rateLimit(limiter: SlidingWindowLimiter, rules: RateLimitRule[]): MiddlewareHandler {
  return async (c, next) => {
    for (const rule of rules) {
      const value = await rule.key(c);
      if (value === null) continue;
      const result = limiter.hit(`${rule.name}:${value}`, rule.limit);
      if (!result.allowed) {
        c.header('Retry-After', String(result.retryAfterSeconds));
        return jsonError(c, 429, 'rate_limited', 'Demasiados intentos. Inténtalo de nuevo más tarde.');
      }
    }
    await next();
  };
}

/** Correo del cuerpo JSON (recortado y en minúsculas) para limitar por correo; `null` si no hay. */
export async function emailFromBody(c: Context): Promise<string | null> {
  try {
    const body = (await c.req.json()) as { email?: unknown };
    return typeof body?.email === 'string' && body.email.trim() ? body.email.trim().toLowerCase().slice(0, 254) : null;
  } catch {
    return null;
  }
}

/** Ventana mayor de la política: tras ella un intento ya no cuenta para ninguna regla. */
export const MAX_WINDOW_MS = Math.max(...Object.values(LIMITS).map((l) => l.windowMs));

/**
 * Programa la purga periódica del limitador (sin ella el mapa crece con cada IP/correo distinto).
 * El timer no impide cerrar el proceso (`unref`); el que llama puede pararlo con `clearInterval`.
 */
export function schedulePrune(
  limiter: SlidingWindowLimiter,
  options: { intervalMs?: number; maxWindowMs?: number } = {},
): NodeJS.Timeout {
  const timer = setInterval(
    () => limiter.prune(options.maxWindowMs ?? MAX_WINDOW_MS),
    options.intervalMs ?? 10 * MINUTE,
  );
  timer.unref();
  return timer;
}
