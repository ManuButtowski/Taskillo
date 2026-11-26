# Contrato de la API · 001 Cuenta y sesiones

Descripción de diseño. El contrato real es `packages/contrato/openapi.json`, generado desde
Zod (principio VIII). Esta lista fija qué rutas, esquemas y códigos debe tener. Errores en
JSON: `{ "error": { "code": string, "message": string } }`, con mensajes en español.

Base: `/api/v1`. Autenticación: cabecera `Authorization: Bearer <access>` salvo donde se
indique "pública".

| Método y ruta | Auth | Petición | Respuesta |
| :--- | :--- | :--- | :--- |
| `GET /health` (sin prefijo) | pública | | `200 {status:"ok"}` |
| `POST /auth/register` | pública | `{email}` | `202 {}` siempre igual, exista o no la cuenta y con tiempo mínimo de 50 ms (si no existe, envía el código; si existe, el aviso "ya tienes cuenta") · `422` correo mal formado · `429` |
| `POST /auth/register/complete` | pública | `{email, code, username, displayName, password, timezone?, device:{id, platform, name?}}` | `201 {user, tokens}` (cuenta creada ya verificada y sesión iniciada) · `400 invalid_code` código erróneo, caducado, usado o agotado (siempre igual, con tiempo mínimo de 50 ms) · `409 username_taken` · `409 email_taken` · `409 device_id_conflict` · `422` validación · `429` |
| `POST /auth/login` | pública | `{email, password, device:{id, platform, name?}}` | `200 {user, tokens}` · `401 invalid_credentials` genérico · `409 device_id_conflict` · `429` |
| `POST /auth/refresh` | pública | `{refreshToken}` | `200 {tokens}` · `401 invalid_refresh_token` inválido, caducado, rotado o revocado (la reutilización además revoca la familia) |
| `POST /auth/logout` | Bearer | | `204` borra el dispositivo de la sesión actual (y en cascada todas sus filas de sesión); idempotente |
| `POST /auth/logout-all` | Bearer | | `204` revoca todas las sesiones del usuario |
| `POST /auth/forgot-password` | pública | `{email}` | `202` siempre igual, exista o no, con tiempo mínimo de 50 ms · `429` |
| `GET /auth/reset-password?token=` | pública | | `200` HTML con formulario (no consume el token) |
| `POST /auth/reset-password` | pública | `{token, newPassword}` como `application/json` o `application/x-www-form-urlencoded` | `200` (JSON si la petición fue JSON; página HTML si fue formulario) y revoca todas las sesiones e invalida los demás enlaces de recuperación pendientes · `400 invalid_token` inválido, caducado o ya usado · `422 weak_password` contraseña no válida (no gasta el enlace) · `429` |
| `GET /me` | Bearer | | `200 {user}` |
| `PATCH /me` | Bearer | `{displayName}` | `200 {user}` |
| `POST /me/password` | Bearer | `{currentPassword, newPassword}` | `204`, revoca las demás sesiones e invalida los enlaces de recuperación pendientes · `403 invalid_credentials` si la actual falla · `422 weak_password` · `429` |
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
- Las URL con `?token=` (recuperación) se registran en los logs sin la consulta. Las páginas HTML de recuperación (GET y la respuesta HTML del POST) se sirven sin recursos externos y con `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` y `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'`.
- Las rutas `/auth/*` públicas pasan por el limitador de frecuencia (`429 rate_limited` con cabecera `Retry-After`); `POST /me/password` lleva además un límite por usuario (ver `research.md`).
- Tiempo mínimo de respuesta de 50 ms (decisión de Manuel, cierra la fuga por tiempo): el `202` del paso 1 del registro, el `202` de `forgot-password` y el `400 invalid_code` del paso 2. Los `422` y `429` responden sin retardo porque no dependen de la cuenta ni del código.
- Ninguna respuesta ni log incluye contraseñas, hashes, códigos de registro o tokens salvo el `Tokens` recién emitido.

## Errores

Formato común de toda respuesta de error JSON: `{ "error": { "code": string, "message": string } }`, con `message` en español para mostrar al usuario. La app decide por `code` y por el estado HTTP, nunca por `message`. Los mensajes no incluyen valores enviados (contraseñas, códigos, tokens). Los códigos están en inglés, en minúsculas con guion bajo.

| Estado | `code` | Dónde | Significado |
| :--- | :--- | :--- | :--- |
| 400 | `invalid_code` | register/complete | Código erróneo, caducado, usado o agotado (siempre igual) |
| 400 | `invalid_token` | reset-password | Enlace inválido, caducado o ya usado |
| 400 | `invalid_json` | cualquier ruta con cuerpo | JSON mal formado |
| 400 | `bad_request` | cualquiera | Otro error 4xx del framework sin código propio |
| 401 | `invalid_credentials` | login | Correo inexistente o contraseña errónea (genérico) |
| 401 | `invalid_refresh_token` | refresh | Refresh token inválido, caducado, rotado o revocado |
| 401 | `unauthorized` | rutas Bearer | Falta el token de acceso o no vale; lleva `WWW-Authenticate: Bearer`. La app lo trata como "access caducado" e intenta `refresh` |
| 403 | `invalid_credentials` | `POST /me/password` | La contraseña actual no coincide (ver decisión abajo) |
| 404 | `not_found` | `DELETE /me/sessions/{deviceId}` | No existe o no es del usuario (mismo mensaje) |
| 409 | `username_taken`, `email_taken`, `device_id_conflict` | register/complete, login | Ver reglas transversales |
| 415 | `unsupported_media_type` | rutas con cuerpo | `Content-Type` ausente o no admitido |
| 422 | `validation_error` | cualquiera | Datos no válidos según el esquema; el mensaje nombra los campos, no los valores |
| 422 | `weak_password` | register/complete, reset-password, `/me/password` | Contraseña que no cumple la política (longitud o lista de comunes) |
| 429 | `rate_limited` | rutas limitadas | Demasiados intentos; cabecera `Retry-After` en segundos |
| 500 | `internal_error` | cualquiera | Error no previsto; el cuerpo no da detalles y el log solo resume el error |

Decisión sobre `403` en `POST /me/password`: se mantiene `403` y no `401`. La contraseña actual errónea no es un fallo de autenticación de la sesión (el token es válido); un `401` activaría el interceptor de la app (renovar y, si falla, cerrar la sesión) y expulsaría al usuario por equivocarse al teclear. La app muestra el mensaje sin tocar la sesión. `invalid_credentials` se reutiliza porque el significado (credencial errónea) es el mismo.
