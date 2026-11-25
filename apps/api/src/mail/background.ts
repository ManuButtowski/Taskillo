import type { Logger } from '../lib/logger.js';
import type { Mailer, MailMessage } from './mailer.js';

/**
 * Lanza el envío sin esperarlo (un SMTP lento no debe ralentizar ni delatar nada en la respuesta).
 * Los fallos se registran sin el contenido del correo (puede llevar un código o un enlace).
 */
export function sendInBackground(mailer: Mailer, logger: Logger, message: MailMessage): void {
  Promise.resolve()
    .then(() => mailer.send(message))
    .catch((err: unknown) => logger.error('mail_send_failed', { err }));
}
