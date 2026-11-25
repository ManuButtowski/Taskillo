# Contrato de la API · 001 Cuenta y sesiones

Descripción de diseño. El contrato real es `packages/contrato/openapi.json`, generado desde
Zod (principio VIII). Esta lista fija qué rutas, esquemas y códigos debe tener. Errores en
JSON: `{ "error": { "code": string, "message": string } }`, con mensajes en español.

Base: `/api/v1`. Autenticación: cabecera `Authorization: Bearer <access>` salvo donde se
indique "pública".

| Método y ruta | Auth | Petición | Respuesta |
| :--- | :--- | :--- | :--- |
| `GET /health` (sin prefijo) | pública | | `200 {status:"ok"}` |
| `POST /auth/register` | pública | `{email}` | `202 {}` siempre igual, exista o no la cuenta (si no existe, envía el código; si existe, el aviso "ya tienes cuenta") · `422` correo mal formado · `429` |
| `POST /auth/register/complete` | pública | `{email, code, username, displayName, password, timezone?, device:{id, platform, name?}}` | `201 {user, tokens}` (cuenta creada ya verificada y sesión iniciada) · `400 invalid_code` código erróneo, caducado, usado o agotado (siempre igual) · `409 username_taken` · `409 email_taken` · `409 device_id_conflict` · `422` validación · `429` |
| `POST /auth/login` | pública | `{email, password, device:{id, platform, name?}}` | `200 {user, tokens}` · `401 invalid_credentials` genérico · `409 device_id_conflict` · `429` |
| `POST /auth/refresh` | pública | `{refreshToken}` | `200 {tokens}` · `401` inválido, caducado, rotado o revocado (la reutilización además revoca la familia) |
| `POST /auth/logout` | Bearer | | `204` borra el dispositivo de la sesión actual (y en cascada todas sus filas de sesión); idempotente |
| `POST /auth/logout-all` | Bearer | | `204` revoca todas las sesiones del usuario |
| `POST /auth/forgot-password` | pública | `{email}` | `202` siempre igual, exista o no · `429` |
| `GET /auth/reset-password?token=` | pública | | HTML con formulario |
| `POST /auth/reset-password` | pública | `{token, newPassword}` (JSON o formulario) | `200` y revoca todas las sesiones e invalida los demás enlaces de recuperación pendientes · `400` token inválido o caducado · `422` contraseña no válida |
| `GET /me` | Bearer | | `200 {user}` |
| `PATCH /me` | Bearer | `{displayName}` | `200 {user}` |
| `POST /me/password` | Bearer | `{currentPassword, newPassword}` | `204`, revoca las demás sesiones e invalida los enlaces de recuperación pendientes · `403 invalid_credentials` si la actual falla |
| `GET /me/sessions` | Bearer | | `200 {sessions:[{deviceId, platform, name?, lastSeenAt, createdAt, current}]}` (una por dispositivo activo, ver data-model) |
| `DELETE /me/sessions/{deviceId}` | Bearer | | `204` cierra la sesión de ese dispositivo (borra el dispositivo) · `404` si no es del usuario o no existe |

Esquemas:

- `User`: `{id, email, username, displayName, timezone}`. Nunca `password_hash`. Sin `emailVerified`: con el registro en dos pasos toda cuenta nace verificada.
- `Tokens`: `{accessToken, refreshToken, expiresIn: 900}`.
- `Device`: `{id: uuid, platform: "android"|"windows"|"linux"|"macos", name?: string}`.

Reglas transversales:

- Toda consulta lleva el `user_id` del token; `DELETE /me/sessions/{deviceId}` comprueba pertenencia y responde `404` si no es suya.
- El identificador público de una sesión es el `deviceId` (estable). El `id` de la fila de `sessions` cambia en cada rotación y nunca sale de la API. `current` se calcula con el claim `fam` del token de acceso.
- `device_id_conflict`: el `device.id` enviado ya existe (de este u otro usuario). Nunca se reasigna; la app genera un UUIDv7 nuevo y reintenta una vez. El mensaje no dice a quién pertenece.
- Registro en dos pasos (decisión de Manuel): el paso 1 no revela nunca si el correo tiene cuenta (mismo código, cuerpo y trabajo en ambos casos). El paso 2 comprueba el código **antes** que cualquier otro dato, así que `username_taken` y `email_taken` solo se devuelven a quien ya ha probado que posee el correo. Algoritmo en `data-model.md`.
- Las URL con `?token=` (recuperación) se registran en los logs sin la consulta, y sus páginas HTML se sirven con `Referrer-Policy: no-referrer` y `Cache-Control: no-store`, sin recursos externos.
- Las rutas `/auth/*` públicas pasan por el limitador de frecuencia (`429` con cabecera `Retry-After`).
- Ninguna respuesta ni log incluye contraseñas, hashes, códigos de registro o tokens salvo el `Tokens` recién emitido.
