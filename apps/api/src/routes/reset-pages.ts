// Páginas HTML de la recuperación de contraseña. Sin recursos externos: solo estilos en línea.
import { escapeHtml } from '../mail/templates.js';

/** Cabeceras de toda página que maneja un token: sin referer, sin caché y sin recursos de terceros. */
export const PAGE_HEADERS = {
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'",
  'X-Content-Type-Options': 'nosniff',
} as const;

const FORM_ACTION = '/api/v1/auth/reset-password';

function layout(body: string): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Taskillo · Nueva contraseña</title>
<style>
body{font-family:system-ui,sans-serif;background:#f4f4f8;margin:0;padding:24px;color:#1f2937}
main{max-width:420px;margin:40px auto;background:#fff;padding:24px;border-radius:12px}
h1{font-size:20px;margin-top:0}
label{display:block;margin:16px 0 6px}
input[type=password]{width:100%;box-sizing:border-box;padding:10px;font-size:16px;border:1px solid #9ca3af;border-radius:6px}
button{margin-top:20px;background:#4f46e5;color:#fff;border:0;padding:10px 16px;font-size:16px;border-radius:6px;cursor:pointer}
.error{color:#b91c1c}
small{color:#6b7280}
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
}

export function resetFormPage(token: string, error?: string): string {
  return layout(
    `<h1>Nueva contraseña</h1>
${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
<form method="post" action="${FORM_ACTION}">
<input type="hidden" name="token" value="${escapeHtml(token)}">
<label for="newPassword">Elige tu nueva contraseña</label>
<input id="newPassword" name="newPassword" type="password" autocomplete="new-password" minlength="10" maxlength="128" required>
<small>Entre 10 y 128 caracteres.</small>
<br><button type="submit">Cambiar contraseña</button>
</form>`,
  );
}

export function resetDonePage(): string {
  return layout(
    `<h1>Contraseña cambiada</h1>
<p>Tu contraseña se ha cambiado y se ha cerrado la sesión en todos tus dispositivos. Ya puedes volver a Taskillo e iniciar sesión con la contraseña nueva.</p>`,
  );
}

export function resetInvalidPage(): string {
  return layout(
    `<h1>Enlace no válido</h1>
<p class="error">Este enlace no es válido o ha caducado. Puede que ya lo hayas usado.</p>
<p>Vuelve a Taskillo y pide un enlace nuevo desde "He olvidado mi contraseña".</p>`,
  );
}
