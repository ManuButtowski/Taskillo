// Interfaz de correo: la API solo conoce esto; el proveedor (SMTP, Resend) se elige con MAIL_DRIVER.
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}
