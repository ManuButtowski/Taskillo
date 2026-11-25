import { connect } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { createMailer } from '../../src/mail/index.js';
import { ResendMailer } from '../../src/mail/resend-mailer.js';
import { SmtpMailer } from '../../src/mail/smtp-mailer.js';
import {
  alreadyRegisteredEmail,
  formatRegistrationCode,
  passwordResetEmail,
  registrationCodeEmail,
} from '../../src/mail/templates.js';

const baseEnv = {
  DATABASE_URL: 'postgres://x:x@localhost:5433/x',
  JWT_SECRET: 'secreto-de-test-con-al-menos-32-caracteres-ok',
};

describe('plantillas', () => {
  it('el código de registro sale como ABCD-EFGH y avisa de los 30 minutos', () => {
    const m = registrationCodeEmail('abcdefgh');
    expect(m.text).toContain('ABCD-EFGH');
    expect(m.html).toContain('ABCD-EFGH');
    expect(m.text).toContain('30 minutos');
    expect(formatRegistrationCode('ABCD-EFGH')).toBe('ABCD-EFGH');
  });

  it('"ya tienes cuenta" invita a iniciar sesión o recuperar la contraseña y no lleva código', () => {
    const m = alreadyRegisteredEmail();
    expect(m.text).toMatch(/ya tienes cuenta/i);
    expect(m.text).toMatch(/inicia sesión/i);
    expect(m.text).toMatch(/recup/i);
    expect(m.text).not.toMatch(/[A-Z0-9]{4}-[A-Z0-9]{4}/);
  });

  it('la recuperación incluye el enlace en texto y HTML, escapado en el HTML', () => {
    const link = 'http://localhost:3000/auth/reset-password?token=a&b=<x>';
    const m = passwordResetEmail(link);
    expect(m.text).toContain(link);
    expect(m.html).toContain('token=a&amp;b=&lt;x&gt;');
    expect(m.html).not.toContain('<x>');
  });

  it('todas están en español y tienen asunto', () => {
    for (const m of [registrationCodeEmail('ABCDEFGH'), alreadyRegisteredEmail(), passwordResetEmail('http://x/y')]) {
      expect(m.subject.length).toBeGreaterThan(5);
      expect(m.html).toContain('lang="es"');
    }
  });
});

describe('selección de driver', () => {
  it('smtp por defecto', () => {
    expect(createMailer(loadConfig(baseEnv))).toBeInstanceOf(SmtpMailer);
  });

  it('resend con MAIL_DRIVER=resend', () => {
    const cfg = loadConfig({ ...baseEnv, MAIL_DRIVER: 'resend', RESEND_API_KEY: 're_test' });
    expect(createMailer(cfg)).toBeInstanceOf(ResendMailer);
  });

  it('resend sin clave no pasa la validación de configuración', () => {
    expect(() => loadConfig({ ...baseEnv, MAIL_DRIVER: 'resend' })).toThrow(/RESEND_API_KEY/);
  });
});

describe('ResendMailer (fetch simulado)', () => {
  const message = { to: 'ana@example.com', subject: 'Hola', text: 't', html: '<p>t</p>' };

  it('hace POST a la API de Resend con clave Bearer y el cuerpo esperado', async () => {
    const fetchFn = vi.fn(async () => new Response('{"id":"1"}', { status: 200 }));
    await new ResendMailer({ from: 'Taskillo <a@b.es>', apiKey: 're_secreta' }, fetchFn as unknown as typeof fetch).send(message);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_secreta');
    expect(JSON.parse(init.body as string)).toEqual({
      from: 'Taskillo <a@b.es>',
      to: ['ana@example.com'],
      subject: 'Hola',
      text: 't',
      html: '<p>t</p>',
    });
  });

  it('si Resend responde error, lanza sin incluir la clave ni el cuerpo', async () => {
    const fetchFn = vi.fn(async () => new Response('{"detail":"ana@example.com"}', { status: 422 }));
    const mailer = new ResendMailer({ from: 'a@b.es', apiKey: 're_secreta' }, fetchFn as unknown as typeof fetch);
    const err = await mailer.send(message).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('422');
    expect((err as Error).message).not.toContain('re_secreta');
    expect((err as Error).message).not.toContain('ana@example.com');
  });
});

// Envío real contra el Mailpit de Docker (API web en MAILPIT_URL, SMTP 1025 en el mismo host).
// Se omite si la API web o el puerto SMTP no responden.
const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const MAILPIT_HOST = new URL(MAILPIT_URL).hostname;
const MAILPIT_SMTP_PORT = 1025;

function tcpOpen(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port, timeout: 1500 });
    socket.once('connect', () => (socket.destroy(), resolve(true)));
    socket.once('timeout', () => (socket.destroy(), resolve(false)));
    socket.once('error', () => resolve(false));
  });
}

const mailpitUp =
  (await fetch(`${MAILPIT_URL}/api/v1/info`, { signal: AbortSignal.timeout(1500) })
    .then((r) => r.ok)
    .catch(() => false)) && (await tcpOpen(MAILPIT_HOST, MAILPIT_SMTP_PORT));

describe.skipIf(!mailpitUp)('SmtpMailer contra Mailpit', () => {
  it('entrega el correo con asunto y cuerpo', async () => {
    const to = `test-${Date.now()}@example.com`;
    const mailer = new SmtpMailer({ from: 'Taskillo <no-reply@devkomp.es>', host: MAILPIT_HOST, port: MAILPIT_SMTP_PORT, secure: false });
    const { subject, text, html } = registrationCodeEmail('ABCDEFGH');
    await mailer.send({ to, subject, text, html });

    const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`);
    const body = (await res.json()) as { messages: { ID: string; Subject: string }[] };
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]!.Subject).toBe(subject);
    const full = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${body.messages[0]!.ID}`)).json()) as { Text: string };
    expect(full.Text).toContain('ABCD-EFGH');
  });
});
