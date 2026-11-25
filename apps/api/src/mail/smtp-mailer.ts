import { createTransport, type Transporter } from 'nodemailer';
import type { Mailer, MailMessage } from './mailer.js';

export interface SmtpOptions {
  from: string;
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
}

/** Envío por SMTP (IONOS en producción, Mailpit en local). */
export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;

  constructor(private readonly opts: SmtpOptions) {
    this.transport = createTransport({
      host: opts.host,
      port: opts.port,
      secure: opts.secure,
      ...(opts.user ? { auth: { user: opts.user, pass: opts.password ?? '' } } : {}),
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({
      from: this.opts.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }
}
