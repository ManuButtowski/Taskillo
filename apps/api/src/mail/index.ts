import type { Config } from '../config.js';
import type { Mailer } from './mailer.js';
import { ResendMailer } from './resend-mailer.js';
import { SmtpMailer } from './smtp-mailer.js';

/** Elige el proveedor según MAIL_DRIVER; cambiar de proveedor es cambiar la variable. */
export function createMailer(
  config: Pick<
    Config,
    'MAIL_DRIVER' | 'MAIL_FROM' | 'SMTP_HOST' | 'SMTP_PORT' | 'SMTP_SECURE' | 'SMTP_USER' | 'SMTP_PASSWORD' | 'RESEND_API_KEY'
  >,
  fetchFn?: typeof fetch,
): Mailer {
  if (config.MAIL_DRIVER === 'resend') {
    if (!config.RESEND_API_KEY) throw new Error('RESEND_API_KEY obligatoria con MAIL_DRIVER=resend');
    return new ResendMailer({ from: config.MAIL_FROM, apiKey: config.RESEND_API_KEY }, fetchFn);
  }
  return new SmtpMailer({
    from: config.MAIL_FROM,
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    ...(config.SMTP_USER ? { user: config.SMTP_USER } : {}),
    ...(config.SMTP_PASSWORD ? { password: config.SMTP_PASSWORD } : {}),
  });
}

export { passwordResetEmail, alreadyRegisteredEmail, registrationCodeEmail } from './templates.js';
export type { Mailer, MailMessage } from './mailer.js';
