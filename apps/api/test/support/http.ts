import type { MailMessage } from '../../src/mail/mailer.js';

type Fetcher = { request: (input: string, init?: RequestInit) => Response | Promise<Response> };

/** POST con cuerpo JSON (y cabeceras extra, p. ej. X-Forwarded-For o Authorization). */
export function postJson(app: Fetcher, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return app.request(`/api/v1${path}`, {
    method: 'POST',
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export function getJson(app: Fetcher, path: string, headers: Record<string, string> = {}) {
  return app.request(`/api/v1${path}`, { headers });
}

export function del(app: Fetcher, path: string, headers: Record<string, string> = {}) {
  return app.request(`/api/v1${path}`, { method: 'DELETE', headers });
}

export function bearer(accessToken: string) {
  return { authorization: `Bearer ${accessToken}` };
}

/** Extrae el código ABCD-EFGH del correo de registro. */
export function codeFrom(mail: MailMessage | undefined): string {
  const match = mail?.text.match(/\b([0-9A-Z]{4}-[0-9A-Z]{4})\b/);
  if (!match) throw new Error('el correo no lleva un código de registro');
  return match[1]!;
}
