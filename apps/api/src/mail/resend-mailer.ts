import type { Mailer, MailMessage } from './mailer.js';

const RESEND_URL = 'https://api.resend.com/emails';

/** Envío por la API HTTP de Resend. `fetchFn` solo se inyecta en los tests. */
export class ResendMailer implements Mailer {
  constructor(
    private readonly opts: { from: string; apiKey: string },
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async send(message: MailMessage): Promise<void> {
    const res = await this.fetchFn(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.opts.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: this.opts.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    });
    if (!res.ok) {
      // Solo el estado: el cuerpo podría reflejar datos del correo y nunca debe acabar en un log.
      throw new Error(`Resend rechazó el envío (HTTP ${res.status})`);
    }
  }
}
