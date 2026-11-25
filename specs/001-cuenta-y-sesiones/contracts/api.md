# Contrato de la API · 001 Cuenta y sesiones

Descripción de diseño. El contrato real es `packages/contrato/openapi.json`, generado desde
Zod (principio VIII). Esta lista fija qué rutas, esquemas y códigos debe tener. Errores en
JSON: `{ "error": { "code": string, "message": string } }`, con mensajes en español.

Base: `/api/v1`. Autenticación: cabecera `Authorization: Bearer <access>` salvo donde se
indique "pública".

| Método y ruta | Auth | Petición | Respuesta |
| :--- | :--- | :--- | :--- |
| `GET /health` (sin prefijo) | pública | | `200 {status:"ok"}` |
| `POST /auth/register` | pública | `{email, username, displayName, password, timezone?, device:{id, platform, name?}}` | `201 {user, tokens}` · `409` correo o usuario en uso (ver research) · `422` validación · `429` |
| `POST /auth/login` | pública | `{email, password, device:{id, platform, name?}}` | `200 {user, tokens}` · `401 invalid_credentials` genérico · `429` |
| `POST /auth/refresh` | pública | `{refreshToken}` | `200 {tokens}` · `401` inválido, caducado, rotado o revocado (la reutilización además revoca la familia) |
| `POST /auth/logout` | Bearer | | `204` borra la familia de la sesión y el dispositivo |
| `POST /auth/logout-all` | Bearer | | `204` revoca todas las sesiones del usuario |
| `POST /auth/resend-verification` | Bearer | | `204` (no-op si ya verificado) · `429` |
| `GET /auth/verify-email?token=` | pública | | HTML: éxito, o error con enlace para reenviar |
| `POST /auth/forgot-password` | pública | `{email}` | `202` siempre igual, exista o no · `429` |
| `GET /auth/reset-password?token=` | pública | | HTML con formulario |
| `POST /auth/reset-password` | pública | `{token, newPassword}` (JSON o formulario) | `200` y revoca todas las sesiones · `400` token inválido o caducado · `422` contraseña no válida |
| `GET /me` | Bearer | | `200 {user}` |
| `PATCH /me` | Bearer | `{displayName}` | `200 {user}` |
| `POST /me/password` | Bearer | `{currentPassword, newPassword}` | `204`, revoca las demás sesiones · `403 invalid_credentials` si la actual falla |
| `GET /me/sessions` | Bearer | | `200 {sessions:[{id, device:{platform,name}, lastSeenAt, createdAt, current}]}` (una por dispositivo con familia viva) |
| `DELETE /me/sessions/{id}` | Bearer | | `204` cierra la sesión de otro dispositivo · `404` si no es del usuario |

Esquemas:

- `User`: `{id, email, emailVerified: boolean, username, displayName, timezone}`. Nunca `password_hash`.
- `Tokens`: `{accessToken, refreshToken, expiresIn: 900}`.
- `Device`: `{id: uuid, platform: "android"|"windows"|"linux"|"macos", name?: string}`.

Reglas transversales:

- Toda consulta lleva el `user_id` del token; `DELETE /me/sessions/{id}` comprueba pertenencia y responde `404` si no es suya.
- Las rutas `/auth/*` públicas pasan por el limitador de frecuencia (`429` con cabecera `Retry-After`).
- Ninguna respuesta ni log incluye contraseñas, hashes o tokens salvo el `Tokens` recién emitido.
