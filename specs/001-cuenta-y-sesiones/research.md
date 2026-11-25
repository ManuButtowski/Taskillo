# Investigación y decisiones · 001 Cuenta y sesiones

Cada punto: decisión, motivo y alternativa descartada.

## API

- **Gestor y Node.** pnpm workspaces y Node 22 LTS. Alternativa: npm workspaces; pnpm es más rápido y estricto con dependencias.
- **Argon2id.** `@node-rs/argon2` (binarios precompilados, sin `node-gyp` en Windows ni en Docker alpine/slim). Parámetros OWASP: memoria 19456 KiB, 2 iteraciones, 1 hilo.
- **Política de contraseña.** Mínimo 10 caracteres, máximo 128; se rechazan las de una lista de unas 1000 contraseñas comunes incluida en el repo (`common-passwords.ts`) y las iguales al correo o al nombre de usuario. Sin reglas de composición (mayúsculas, símbolos), siguiendo NIST 800-63B.
- **JWT.** `jose`, HS256 con `JWT_SECRET` (mínimo 32 bytes), `exp` 15 min, claims `sub` (user id) y `fam` (family id). Un solo servicio firma y verifica, así que no hace falta asimétrico. El token de acceso no se consulta en BD, de modo que tras revocar una sesión sigue valiendo hasta 15 min; es lo aceptado en la especificación (§4.5) y SC-002 habla de refresh tokens.
- **Refresh token.** 32 bytes aleatorios (`crypto.randomBytes`) en base64url; en BD solo `SHA-256` hex (basta un hash rápido porque el token tiene alta entropía).
- **Rotación.** `UPDATE sessions SET rotated_at = now() WHERE refresh_token_hash = $1 AND rotated_at IS NULL AND revoked_at IS NULL AND expires_at > now() RETURNING ...`, y se inserta la sesión nueva en la misma transacción. Si no devuelve fila pero el hash existe con `rotated_at` relleno, es reutilización: se marcan `revoked_at` todas las filas de la `family_id`. Sin periodo de gracia: dos renovaciones simultáneas con el mismo token cuentan como reutilización (la app serializa sus renovaciones para que no ocurra).
- **Cerrar sesión.** Borra todas las filas de la familia y el dispositivo (§4.5: "cerrar sesión borra la sesión"). "Cerrar todas" pone `revoked_at` a todas las sesiones vivas del usuario (se conservan como rastro hasta que caduquen).
- **Dispositivo.** El cliente genera un UUIDv7 nuevo en cada inicio de sesión o registro y lo envía con plataforma y nombre; el servidor crea la fila `devices`. Al cerrar sesión se elimina, así que un mismo id nunca pasa de un usuario a otro.
- **Tokens de un solo uso.** Tabla `email_tokens` (ver data-model). Verificación caduca a 24 h, recuperación a 1 h. Un token nuevo del mismo tipo invalida los anteriores pendientes del usuario. Se guarda el hash SHA-256.
- **Registro con correo duplicado.** Devuelve `409` con mensaje genérico ("No se ha podido crear la cuenta con esos datos") sin decir qué campo falla en el caso del correo. El nombre de usuario ocupado sí se indica claro (el edge case lo pide y los nombres de usuario serán públicos en la Fase 4). Se asume la fuga mínima de existencia de correo en el alta a cambio de no enviar correo al titular; si Manuel prefiere cero fuga, habría que pasar a registro en dos pasos (decisión abierta, baja prioridad).
- **Limitación de frecuencia.** Limitador propio en memoria (ventana deslizante) por IP y por correo: login 10 por 15 min por IP y 5 por 15 min por correo; registro 5 por hora por IP; recuperación y reenvío 3 por hora por correo y 10 por hora por IP. Con una sola instancia en el VPS la memoria basta (YAGNI); si algún día hay varias instancias, pasa a PostgreSQL. La IP se toma de `X-Forwarded-For` solo si `TRUST_PROXY=true` (tras Caddy).
- **Correo.** Interfaz `Mailer { send({to, subject, text, html}) }` con `SmtpMailer` (nodemailer, STARTTLS en 587), `ResendMailer` (`fetch` a la API de Resend) y `FakeMailer` (tests). Se elige con `MAIL_DRIVER=smtp|resend`. Texto y HTML en español, plantillas en `templates.ts`. El envío no bloquea la respuesta (se lanza sin `await` con captura de errores en el log), para que un SMTP lento no ralentice el registro.
- **Enlaces de correo.** Apuntan a `${PUBLIC_BASE_URL}/auth/verify-email?token=...` y `/auth/reset-password?token=...`, páginas HTML sencillas servidas por la API (supuesto de la spec). La de verificación consume el token en el `GET`; la de recuperación muestra un formulario que hace `POST` y confirma.
- **Logs.** `pino`-like mínimo propio sobre `console` en JSON, con una lista de campos censurados (`password`, `token`, `authorization`, `refreshToken`). Test de SC-005 que lo comprueba.
- **Migraciones.** `drizzle-kit generate` y SQL versionado en `apps/api/drizzle/`; `src/migrate.ts` las aplica y se ejecuta en el despliegue. La primera migración crea `citext`.
- **Contrato.** `@hono/zod-openapi` define rutas y esquemas; un script vuelca `packages/contrato/openapi.json`; un test falla si el fichero versionado difiere del generado. Seguridad: esquema `bearerAuth`.

## App

- **Estado y navegación.** Riverpod + go_router. Sin generadores de código para el estado.
- **Modelos Dart.** `swagger_parser` (Dart puro; evita exigir Java, que necesita `openapi-generator`) genera clases con `json_serializable` desde `packages/contrato/openapi.json` a `apps/app/lib/data/generated/`. Esos ficheros se versionan y no se editan a mano.
- **Almacenamiento seguro.** `flutter_secure_storage` (Keystore en Android; Credential Manager de Windows). Guarda refresh token, y el perfil cacheado va en `shared_preferences`. Al cerrar sesión se borra todo lo local de la cuenta. Cuando llegue `drift` (spec 002), también se vaciará la BD local.
- **Arranque offline.** Si hay refresh token guardado, la app abre directamente en la pantalla principal con el perfil cacheado y programa la renovación para cuando haya red; no espera al servidor (principios I y III).
- **Renovación transparente.** Interceptor de dio: ante `401` por caducidad hace un único `refresh` (con cerrojo para serializar renovaciones concurrentes), repite la petición una vez y, si el refresh falla con `401`, limpia la sesión y vuelve a login. Un fallo de red no cierra la sesión.
- **Pantalla principal de la spec.** Solo muestra "Hola, <nombre>" con acceso a Perfil; la lista de tareas llega en la spec 003.
- **Zona horaria.** Se envía el identificador IANA del dispositivo en el registro (`flutter_timezone`); si falla, `Europe/Madrid`.

## CI y despliegue

- **CI.** `ci.yml`: job API (service container `postgres:16`, `pnpm test`, comprobación del contrato) y job app (`flutter analyze`, `flutter test`, `flutter build apk --debug` en Linux). El build de Windows queda para releases (constitución). Plan B: hook `pre-push` local con los tests de la API.
- **Proxy.** Caddy (certificados Let's Encrypt automáticos) frente a la API en `deploy/docker-compose.prod.yml`. Dominio por `API_DOMAIN`.
- **Despliegue.** `deploy.yml` en push de tag `v*` o manual: construye y publica `ghcr.io/<owner>/taskillo-api`, entra por SSH con la clave dedicada (`DEPLOY_SSH_KEY`, `DEPLOY_HOST`, `DEPLOY_USER` en secretos de GitHub), ejecuta `docker compose pull`, `docker compose run --rm api node dist/migrate.js` y `docker compose up -d`. El workflow se escribe y valida con `actionlint`; solo se puede ejecutar de verdad cuando Rafa cree el subdominio y el usuario SSH.
- **Neon.** `DATABASE_URL` apunta a Neon en producción con `sslmode=require`; en local, a Compose.

## Variables de entorno (todas a `.env.example`)

`NODE_ENV`, `PORT`, `DATABASE_URL`, `JWT_SECRET`, `PUBLIC_BASE_URL`, `TRUST_PROXY`, `MAIL_DRIVER`, `MAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE`, `RESEND_API_KEY`, `API_DOMAIN`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`.
