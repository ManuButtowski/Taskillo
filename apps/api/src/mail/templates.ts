// Plantillas de correo en español (texto y HTML). Sin recursos externos.
import type { MailMessage } from './mailer.js';

type Template = Pick<MailMessage, 'subject' | 'text' | 'html'>;

export const REGISTER_CODE_TTL_MINUTES = 30;
export const RESET_TOKEN_TTL_MINUTES = 60;

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Muestra el código de 8 caracteres como ABCD-EFGH (ya con guion se devuelve igual). */
export function formatRegistrationCode(code: string): string {
  const clean = code.replaceAll('-', '').toUpperCase();
  return clean.length === 8 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>` +
    `<body style="font-family:sans-serif;color:#222;max-width:480px;margin:0 auto;padding:16px">` +
    `<h2 style="margin:0 0 16px">Taskillo</h2>${bodyHtml}` +
    `<p style="color:#777;font-size:12px;margin-top:24px">Si no has sido tú, puedes ignorar este correo.</p></body></html>`;
}

export function registrationCodeEmail(code: string): Template {
  const shown = formatRegistrationCode(code);
  return {
    subject: 'Tu código para crear la cuenta de Taskillo',
    text:
      `Hola,\n\nTu código para crear la cuenta de Taskillo es: ${shown}\n\n` +
      `Escríbelo en la app. Caduca en ${REGISTER_CODE_TTL_MINUTES} minutos.\n\n` +
      `Si no has sido tú, puedes ignorar este correo.\n`,
    html: layout(
      'Código de registro',
      `<p>Tu código para crear la cuenta de Taskillo es:</p>` +
        `<p style="font-size:28px;letter-spacing:3px;font-weight:bold">${escapeHtml(shown)}</p>` +
        `<p>Escríbelo en la app. Caduca en ${REGISTER_CODE_TTL_MINUTES} minutos.</p>`,
    ),
  };
}

export function alreadyRegisteredEmail(): Template {
  return {
    subject: 'Ya tienes una cuenta en Taskillo',
    text:
      'Hola,\n\nAlguien ha intentado crear una cuenta con este correo, pero ya tienes cuenta en Taskillo.\n\n' +
      'Inicia sesión o, si no recuerdas la contraseña, recupérala desde la pantalla de acceso.\n\n' +
      'Si no has sido tú, puedes ignorar este correo.\n',
    html: layout(
      'Ya tienes cuenta',
      `<p>Alguien ha intentado crear una cuenta con este correo, pero <strong>ya tienes cuenta</strong> en Taskillo.</p>` +
        `<p>Inicia sesión o, si no recuerdas la contraseña, recupérala desde la pantalla de acceso.</p>`,
    ),
  };
}

export function passwordResetEmail(link: string): Template {
  return {
    subject: 'Recupera tu contraseña de Taskillo',
    text:
      `Hola,\n\nHas pedido recuperar tu contraseña. Abre este enlace para elegir una nueva:\n\n${link}\n\n` +
      `El enlace caduca en ${RESET_TOKEN_TTL_MINUTES / 60} hora y solo se puede usar una vez.\n\n` +
      `Si no has sido tú, puedes ignorar este correo: tu contraseña no cambiará.\n`,
    html: layout(
      'Recuperar contraseña',
      `<p>Has pedido recuperar tu contraseña. Pulsa el botón para elegir una nueva:</p>` +
        `<p><a href="${escapeHtml(link)}" style="background:#4f46e5;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Cambiar contraseña</a></p>` +
        `<p style="font-size:12px;word-break:break-all">${escapeHtml(link)}</p>` +
        `<p>El enlace caduca en ${RESET_TOKEN_TTL_MINUTES / 60} hora y solo se puede usar una vez.</p>`,
    ),
  };
}
