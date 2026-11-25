# Tasks: Cuenta y sesiones

**Input**: `specs/001-cuenta-y-sesiones/` (spec.md, plan.md, research.md, data-model.md, contracts/api.md, quickstart.md)

**Formato**: `- [ ] Txxx [P?] [USn?] [OPUS?] Descripción con ruta`. Una tarea, sus tests y un commit.
`[P]` = se podría hacer en paralelo (pero no se lanzan agentes en paralelo: ahorro del plan Pro).
`[OPUS]` = requiere Opus. "Tests primero" = principio VII: se escriben antes que el código.

QA revisa al acabar cada bloque. Los bloques se hacen en orden.

## Bloque 1 — Monorepo y base de la API (FR-015, FR-017)

- [x] T001 Raíz del monorepo: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.env.example` con todas las variables de `research.md` y los comandos reales en `CLAUDE.md` (sección "Comandos").
- [x] T002 `apps/api`: esqueleto Hono, `config.ts` que valida las variables de entorno con Zod (falla si falta `JWT_SECRET` o es corto), `GET /health`, logger JSON con censura de campos sensibles (y rutas registradas sin la cadena de consulta), Vitest configurado y un test de `/health`.
- [x] T003 [P] `docker-compose.yml` (PostgreSQL 16, Mailpit, API) y `apps/api/Dockerfile`; la API arranca en Compose y responde en `/health`.
- [x] T004 [OPUS] Esquema Drizzle de `users`, `devices`, `sessions`, `email_tokens` que genere una migración 0000 equivalente al SQL de referencia de `data-model.md` (con `CREATE EXTENSION citext` al principio, nombres de restricciones explícitos, `CHECK`, FK compuesta `sessions(device_id, user_id)`, índices parciales con `WHERE`, `TIMESTAMPTZ` con `withTimezone: true`, ids sin `DEFAULT` en BD y `$defaultFn` con UUIDv7 del paquete `uuid`). `db/client.ts` (conexión con `TimeZone=UTC`), `migrate.ts` y scripts `db:generate`/`db:migrate` (nunca `push`). Tests contra PostgreSQL real: `UNIQUE` de correo y usuario sin distinguir mayúsculas; `CHECK` de plataforma, usuario en minúsculas, correo en minúsculas, `password_hash` Argon2id y hashes de 64 hex en `sessions` y `email_tokens` (un token en claro se rechaza); FK compuesta (una sesión con `device_id` de otro usuario se rechaza); `uq_sessions_family_live` (no caben dos tokens vivos en una familia, sí tras marcar `rotated_at`); `email_tokens_user_type_chk` (`register` sin usuario, `reset_password` con usuario); `uq_email_tokens_register_pending` (un solo código pendiente por correo); cascadas (borrar el usuario borra todo; borrar el dispositivo borra sus sesiones); las columnas de fecha son `timestamptz` (consulta a `information_schema`). Cualquier desviación del modelo se consulta al Director.
- [x] T005 Utilidades de test: conexión a PostgreSQL real por `TEST_DATABASE_URL` (los tests se niegan a arrancar si falta o si coincide con `DATABASE_URL`), migraciones aplicadas al empezar, limpieza entre tests, `FakeMailer` y fábrica de la app con dependencias inyectables.
- [x] T006 `packages/contrato`: base con `@hono/zod-openapi` en la API, script `generar` que vuelca `openapi.json`, test que falla si el fichero versionado no coincide con el generado, `GET /health` ya documentado.

## Bloque 2 — Núcleo de seguridad (FR-002, FR-005, FR-006, FR-013, FR-014; tests primero)

- [x] T007 [US1] Servicio de contraseñas `auth/passwords.ts`: Argon2id (parámetros de `research.md`), política de contraseña (longitud, lista de comunes, distinta del correo y usuario). Tests primero.
- [x] T008 [US4] Servicio de tokens `auth/tokens.ts`: JWT de acceso de 15 min con `jose` (verifica caducidad, firma y `alg`), refresh token opaco de 32 bytes y su hash SHA-256. Tests primero, incluido token caducado y manipulado.
- [x] T009 [US4] [OPUS] Sesiones y rotación `auth/sessions.ts` siguiendo "Ciclo de vida de sesiones y dispositivos" de `data-model.md`: crear dispositivo + familia + primer token (`INSERT` simple; id de dispositivo repetido → error `device_id_conflict`, nunca `UPSERT`), rotar en una transacción `READ COMMITTED` (`UPDATE ... WHERE rotated_at IS NULL AND revoked_at IS NULL AND expires_at > now() RETURNING` + `INSERT` + `last_seen_at`), detectar reutilización y revocar la familia **confirmando la revocación aunque la respuesta sea `401`**, cerrar sesión borrando el dispositivo (cascada), revocar todas (con o sin conservar la familia actual) y listar dispositivos activos. Fechas siempre con `now()` de PostgreSQL. Tests primero: rotación normal (la nueva conserva `family_id` y `device_id`, caduca a 30 días), reutilización revoca la familia y la revocación persiste, token caducado, token revocado, token inexistente, dos rotaciones simultáneas con dos conexiones reales (una gana, la otra revoca toda la familia, incluida la recién emitida), id de dispositivo repetido, "cerrar todas" y "revocar las demás".
- [x] T010 Middleware de autenticación `auth/middleware.ts` (Bearer, inyecta `userId` y `familyId`) y limitador de frecuencia `lib/rate-limit.ts` con la política de `research.md` y soporte de `TRUST_PROXY`. Tests: ruta protegida sin token, con token caducado y límite que devuelve `429` con `Retry-After`.
- [ ] T011 Interfaz `Mailer` en `mail/`: `SmtpMailer` (nodemailer), `ResendMailer` (`fetch`), selección por `MAIL_DRIVER`, plantillas en español de código de registro, "ya tienes cuenta" y recuperación. Tests: plantillas, selección de driver y envío real a Mailpit solo cuando `MAILPIT_URL` esté definida.

## Bloque 3 — Registro, login y sesiones (US1, US4, US3 en parte)

- [ ] T012 [US1] Servicio `auth/email-tokens.ts` según "Tokens de correo" de `data-model.md` (código de registro Crockford base32 de 8 caracteres con hash ligado al correo, token de recuperación de 32 bytes, crear invalidando pendientes, consumir con filtro de `type`, intentos, caducidad con `now()`, purga de `register` caducados) y paso 1 del registro `POST /auth/register {email}`: `202` idéntico exista o no la cuenta; código si no existe, aviso "ya tienes cuenta" si existe; envío sin bloquear. Tests primero del servicio; tests de integración: cuerpo, código y cabeceras iguales en ambos casos (y el `FakeMailer` recibe el correo correcto en cada uno), repetir invalida el código anterior, dos peticiones simultáneas dejan un solo código, límite de frecuencia por correo e IP, el código nunca aparece en la respuesta ni en el log.
- [ ] T013 [US1] Paso 2 `POST /auth/register/complete` según `data-model.md`: valida el código **antes** que los datos, crea usuario (`email_verified_at = now()`), dispositivo y sesión en una transacción y devuelve `{user, tokens}`. Tests de integración: alta correcta con correo verificado, código erróneo, caducado, usado y agotado (5 intentos) con el mismo `400 invalid_code`, el intento fallido persiste, `username_taken` sin distinguir mayúsculas no gasta el código, sin código válido no se revela si el nombre está ocupado, `email_taken` si la cuenta se creó entre pasos, contraseña débil, zona horaria no IANA (`422`), `device_id_conflict` sin crear el usuario, sin `password_hash` en la respuesta.
- [ ] T014 [US1] [US4] `POST /auth/login` y `POST /auth/refresh`. Tests: error genérico igual para correo inexistente y contraseña errónea, `device` registrado con su plataforma, refresh rotado y reutilización (la segunda falla y revoca la familia), actualización de `last_seen_at`.
- [ ] T015 [US3] `POST /auth/logout`, `POST /auth/logout-all`, `GET /me/sessions` y `DELETE /me/sessions/{deviceId}`. Tests: tras `logout-all` ningún refresh anterior vale (SC-002), no se puede borrar la sesión de otro usuario (`404`), la lista identifica por `deviceId`, marca `current`, no incluye dispositivos sin token vivo y el `deviceId` no cambia tras una rotación.
- [ ] T016 Test transversal de SC-005: ninguna respuesta ni línea de log contiene contraseñas, hashes, códigos de registro ni tokens (salvo `Tokens` recién emitidos), y la limitación de frecuencia actúa en login, los dos pasos del registro y recuperación.

## Bloque 4 — Recuperación y perfil en la API (US2, US3)

- [ ] T017 [US2] `POST /auth/forgot-password` (respuesta idéntica exista o no el correo) y `GET`/`POST /auth/reset-password` con página HTML (`Referrer-Policy: no-referrer`, `Cache-Control: no-store`), usando el servicio de T012; al restablecer se revocan todas las sesiones (FR-008). El `GET` no consume el token. Tests: respuesta igual en ambos casos, enlace de un solo uso, caducado, un código `register` no sirve para restablecer, sesiones revocadas.
- [ ] T018 [US3] `GET /me`, `PATCH /me` (nombre visible) y `POST /me/password` (exige la actual, revoca las demás sesiones, conserva la actual e invalida los enlaces de recuperación pendientes). Tests.
- [ ] T019 Regenerar `packages/contrato/openapi.json` y comprobar que cubre todas las rutas de `contracts/api.md` (test que compara la lista de rutas); ajustar `contracts/api.md` solo si el Director lo aprueba.

## Bloque 5 — Base de la app Flutter y cliente (FR-010, FR-011; US1, US4)

- [ ] T020 `apps/app`: `flutter create` con Windows y Android, estructura `core/`, `data/`, `features/`, dependencias del plan, lints, tema y `go_router` con rutas vacías; `flutter analyze` y un test de humo en verde.
- [ ] T021 Generación de modelos Dart con `swagger_parser` desde `packages/contrato/openapi.json` a `lib/data/generated/`; script de regeneración y nota en `CLAUDE.md`. Sin modelos escritos a mano.
- [ ] T022 [US4] Cliente de API (`dio`) con URL base configurable por `--dart-define`, almacenamiento seguro del refresh token (`flutter_secure_storage`) y interceptor de renovación transparente con cerrojo (una sola renovación a la vez, reintento único, fallo de red no cierra sesión). Tests con adaptador de dio simulado.
- [ ] T023 [US1] Repositorio y estado de sesión (Riverpod): registro en dos pasos (pedir código; completar con código y datos, que inicia la sesión), login (genera UUIDv7 de dispositivo, plataforma, nombre y zona horaria; ante `409 device_id_conflict` genera otro y reintenta una vez), arranque con sesión guardada sin esperar al servidor, cierre de sesión que borra tokens y perfil cacheado. Tests unitarios, incluido arranque sin conexión.

## Bloque 6 — Pantallas (US1, US2, US3)

- [ ] T024 [US1] Pantallas de registro en dos pasos e inicio de sesión. Registro paso 1: solo correo y "Te hemos enviado un correo" (mismo texto siempre, con "Volver a enviar" e "Iniciar sesión"). Paso 2: código (acepta con o sin guion y en minúsculas), nombre de usuario, nombre visible y contraseña; "código no válido o caducado" con opción de pedir otro, y nombre de usuario ocupado marcado en su campo. Validación local, mensajes de error en español, indicador de espera, aviso "hace falta conexión" sin red. Tests de widget.
- [ ] T025 [US2] Pantalla "He olvidado mi contraseña" (envía la petición y explica que llegará un correo; el enlace abre el navegador con `url_launcher`). Tests de widget.
- [ ] T026 [US3] Perfil: cambiar nombre visible, cambiar contraseña, lista de dispositivos con "Cerrar sesión" en uno y "Cerrar sesión en todos", cerrar sesión local. Pantalla principal provisional "Hola, nombre". Tests de widget.
- [ ] T027 Estados de red y error: servidor caído o sin respuesta en login/registro (mensaje y reintento), sesión expirada que vuelve a login, indicador discreto durante la renovación. Test de widget de cada estado.

## Bloque 7 — CI, despliegue y cierre (FR-014, FR-016, FR-017)

- [ ] T028 `.github/workflows/ci.yml`: job API (service `postgres:16`, `pnpm test`, contrato al día) y job app (`flutter analyze`, `flutter test`, `flutter build apk --debug`) en Linux; hook `pre-push` opcional documentado como plan B.
- [ ] T029 Imagen de producción y `deploy/docker-compose.prod.yml` + `deploy/Caddyfile` (HTTPS con Let's Encrypt en `API_DOMAIN`), variables de producción documentadas en `.env.example` y `deploy/README.md` con el runbook (usuario SSH sin privilegios, `.env` del VPS legible solo por ese usuario). El arranque en producción debe negarse a usar el `JWT_SECRET` de ejemplo de `.env.example` (hallazgo 4 del QA del bloque 1).
- [ ] T030 `.github/workflows/deploy.yml`: construye y publica en GHCR, entra por SSH con `DEPLOY_SSH_KEY`, `DEPLOY_HOST`, `DEPLOY_USER`, ejecuta `pull`, migraciones y `up -d`. Validado con `actionlint`; el primer despliegue real queda pendiente de Rafa (subdominio y usuario SSH).
- [ ] T031 Verificación del `quickstart.md` de extremo a extremo (Mailpit, PC y Android), medición de SC-001 y SC-004, revisión de que no hay secretos en el repositorio y lista de deuda técnica para el cierre.

## Dependencias y orden

- Bloque 1 antes que todos. Bloque 2 antes que el 3; el 3 antes que el 4. El 4 (T019) antes del bloque 5 (T021).
- Bloques 5-6 dependen del contrato cerrado en T019.
- Bloque 7 puede empezar tras el 3 (CI), pero el despliegue real depende de Rafa.
- Tareas `[OPUS]`: T004 y T009.
- Registro en dos pasos (decisión de Manuel, 2026-11-26): T012 y T013 sustituyen al antiguo registro de un paso y a la verificación posterior; T016 pasó a ser el test de SC-005 y desaparecen `resend-verification` y `verify-email`.
