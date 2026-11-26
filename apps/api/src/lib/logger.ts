import type { MiddlewareHandler } from 'hono';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

export const REDACTED = '[REDACTED]';

// Nombres de campo cuyo valor nunca se escribe en el log.
const SENSITIVE_KEY = /password|passwd|token|authorization|secret|cookie|hash|^code$|apikey/i;

/**
 * Resumen de un error apto para el log: clase, códigos (PostgreSQL, Node, SMTP) y las primeras
 * líneas de la pila. Nunca `message`, `params`, `query`, `response` ni `command`: los errores de
 * base de datos y de correo llevan en ellos correos, hashes, códigos y enlaces (SC-005).
 */
export function summarizeError(err: Error): Record<string, unknown> {
  const out: Record<string, unknown> = { name: err.constructor?.name || err.name };
  const cause = (err as { cause?: unknown }).cause;
  // El error de Drizzle envuelve al de PostgreSQL en `cause`.
  for (const src of [err, cause] as any[]) {
    if (!src || typeof src !== 'object') continue;
    if (typeof src.code === 'string' && out.code === undefined) out.code = src.code;
    const constraint = src.constraint_name ?? src.constraint;
    if (typeof constraint === 'string' && out.constraint === undefined) out.constraint = constraint;
    if (typeof src.table_name === 'string' && out.table === undefined) out.table = src.table_name;
  }
  if (cause instanceof Error) out.cause = cause.constructor?.name || cause.name;
  if (err.stack) {
    out.stack = err.stack
      .split('\n')
      .filter((l) => l.trimStart().startsWith('at '))
      .slice(0, 6)
      .map((l) => l.trim());
  }
  return out;
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return REDACTED;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Error) return summarizeError(value);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        SENSITIVE_KEY.test(k) ? REDACTED : redact(v, depth + 1),
      ]),
    );
  }
  return value;
}

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(
  opts: { level?: LogLevel; write?: (line: string) => void } = {},
): Logger {
  const min = ORDER[opts.level ?? 'info'];
  const write = opts.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const log = (level: LogLevel, msg: string, fields: LogFields = {}) => {
    if (ORDER[level] < min) return;
    write(
      JSON.stringify({
        level,
        time: new Date().toISOString(),
        msg,
        ...(redact(fields) as LogFields),
      }),
    );
  };
  return {
    debug: (m, f) => log('debug', m, f),
    info: (m, f) => log('info', m, f),
    warn: (m, f) => log('warn', m, f),
    error: (m, f) => log('error', m, f),
  };
}

/** Registra cada petición con método, ruta (sin cadena de consulta), estado y duración. */
export function requestLogger(logger: Logger): MiddlewareHandler {
  return async (c, next) => {
    const start = performance.now();
    await next();
    logger.info('request', {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Math.round(performance.now() - start),
    });
  };
}
