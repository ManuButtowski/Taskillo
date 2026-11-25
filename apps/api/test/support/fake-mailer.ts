import type { Mailer, MailMessage } from '../../src/mail/mailer.js';

/** Mailer de tests: guarda los correos en memoria en vez de enviarlos. */
export class FakeMailer implements Mailer {
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }

  last(): MailMessage | undefined {
    return this.sent.at(-1);
  }

  to(address: string): MailMessage[] {
    return this.sent.filter((m) => m.to === address);
  }

  clear(): void {
    this.sent.length = 0;
  }
}
