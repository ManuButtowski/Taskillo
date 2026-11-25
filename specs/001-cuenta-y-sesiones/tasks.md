# Tasks: Cuenta y sesiones

**Input**: `specs/001-cuenta-y-sesiones/` (spec.md, plan.md, research.md, data-model.md, contracts/api.md, quickstart.md)

**Formato**: `- [ ] Txxx [P?] [USn?] [OPUS?] Descripción con ruta`. Una tarea, sus tests y un commit.
`[P]` = se podría hacer en paralelo (pero no se lanzan agentes en paralelo: ahorro del plan Pro).
`[OPUS]` = requiere Opus. "Tests primero" = principio VII: se escriben antes que el código.

QA revisa al acabar cada bloque. Los bloques se hacen en orden.

## Bloque 1 — Monorepo y base de la API (FR-015, FR-017)

- [ ] T001 Raíz del monorepo: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.env.example` con todas las variables de `research.md` y los comandos reales en `CLAUDE.md` (sección "Comandos").
- [ ] T002 `apps/api`: esqueleto Hono, `config.ts` que valida las variables de entorno con Zod (falla si falta `JWT_SECRET` o es corto), `GET /health`, logger JSON con censura de campos sensibles, Vitest configurado y un test de `/health`.
- [ ] T003 [P] `docker-compose.yml` (PostgreSQL 16, Mailpit, API) y `apps/api/Dockerfile`; la API arranca en Compose y responde en `/health`.
- [ ] T004 [OPUS] Esquema Drizzle de `users`, `devices`, `sessions`, `email_tokens` según `data-model.md`, migración 0000 (con `citext`), `db/client.ts`, `migrate.ts` y scripts `db:generate`/`db:migrate`. Tests: restricciones (`UNIQUE` sin distinguir mayúsculas, `CHECK` de plataforma, cascadas). Cualquier desviación del modelo se consulta al Director.
- [ ] T005 Utilidades de test: conexión a PostgreSQL real, limpieza entre tests, `FakeMailer` y fábrica de la app con dependencias inyectables.
- [ ] T006 `packages/contrato`: base con `@hono/zod-openapi` en la API, script `generar` que vuelca `openapi.json`, test que falla si el fichero versionado no coincide con el generado, `GET /health` ya documentado.

## Bloque 2 — Núcleo de seguridad (FR-002, FR-005, FR-006, FR-013, FR-014; tests primero)

- [ ] T007 [US1] Servicio de contraseñas `auth/passwords.ts`: Argon2id (parámetros de `research.md`), política de contraseña (longitud, lista de comunes, distinta del correo y usuario). Tests primero.
- [ ] T008 [US4] Servicio de tokens `auth/tokens.ts`: JWT de acceso de 15 min con `jose` (verifica caducidad, firma y `alg`), refresh token opaco de 32 bytes y su hash SHA-256. Tests primero, incluido token caducado y manipulado.
- [ ] T009 [US4] [OPUS] Sesiones y rotación `auth/sessions.ts`: crear sesión, rotar con `UPDATE ... WHERE rotated_at IS NULL`, detectar reutilización y revocar la familia, borrar familia, revocar todas. Tests primero: rotación normal, reutilización revoca la familia, token caducado, dos rotaciones simultáneas (una gana, la otra revoca), "cerrar todas".
- [ ] T010 Middleware de autenticación `auth/middleware.ts` (Bearer, inyecta `userId` y `familyId`) y limitador de frecuencia `lib/rate-limit.ts` con la política de `research.md` y soporte de `TRUST_PROXY`. Tests: ruta protegida sin token, con token caducado y límite que devuelve `429` con `Retry-After`.
- [ ] T011 Interfaz `Mailer` en `mail/`: `SmtpMailer` (nodemailer), `ResendMailer` (`fetch`), selección por `MAIL_DRIVER`, plantillas en español de verificación y recuperación. Tests: plantillas, selección de driver y envío real a Mailpit solo cuando `MAILPIT_URL` esté definida.

## Bloque 3 — Registro, login y sesiones (US1, US4, US3 en parte)

- [ ] T012 [US1] `POST /auth/register` con Zod, validaciones de `data-model.md`, alta de usuario y dispositivo, emisión de tokens, correo de verificación (sin bloquear la respuesta). Tests de integración: alta correcta, correo duplicado sin pistas, usuario duplicado sin distinguir mayúsculas, contraseña débil, sin `password_hash` en la respuesta.
- [ ] T013 [US1] [US4] `POST /auth/login` y `POST /auth/refresh`. Tests: error genérico igual para correo inexistente y contraseña errónea, `device` registrado con su plataforma, refresh rotado y reutilización (la segunda falla y revoca la familia), actualización de `last_seen_at`.
- [ ] T014 [US3] `POST /auth/logout`, `POST /auth/logout-all`, `GET /me/sessions` y `DELETE /me/sessions/{id}`. Tests: tras `logout-all` ningún refresh anterior vale (SC-002), no se puede borrar la sesión de otro usuario (`404`), la lista marca `current`.
- [ ] T015 Test transversal de SC-005: ninguna respuesta ni línea de log contiene contraseñas, hashes ni tokens (salvo `Tokens` recién emitidos), y la limitación de frecuencia actúa en login, registro y recuperación.

## Bloque 4 — Correo y perfil en la API (US2, US3)

- [ ] T016 [US2] Servicio `auth/email-tokens.ts` (crear, consumir de un solo uso, invalidar pendientes, caducidad) y `POST /auth/resend-verification` + `GET /auth/verify-email` con página HTML. Tests: válido, caducado, ya usado, reenvío.
- [ ] T017 [US2] `POST /auth/forgot-password` (respuesta idéntica exista o no el correo) y `GET`/`POST /auth/reset-password` con página HTML; al restablecer se revocan todas las sesiones (FR-008). Tests: respuesta igual en ambos casos, enlace de un solo uso, sesiones revocadas.
- [ ] T018 [US3] `GET /me`, `PATCH /me` (nombre visible) y `POST /me/password` (exige la actual, revoca las demás sesiones y conserva la actual). Tests.
- [ ] T019 Regenerar `packages/contrato/openapi.json` y comprobar que cubre todas las rutas de `contracts/api.md` (test que compara la lista de rutas); ajustar `contracts/api.md` solo si el Director lo aprueba.

## Bloque 5 — Base de la app Flutter y cliente (FR-010, FR-011; US1, US4)

- [ ] T020 `apps/app`: `flutter create` con Windows y Android, estructura `core/`, `data/`, `features/`, dependencias del plan, lints, tema y `go_router` con rutas vacías; `flutter analyze` y un test de humo en verde.
- [ ] T021 Generación de modelos Dart con `swagger_parser` desde `packages/contrato/openapi.json` a `lib/data/generated/`; script de regeneración y nota en `CLAUDE.md`. Sin modelos escritos a mano.
- [ ] T022 [US4] Cliente de API (`dio`) con URL base configurable por `--dart-define`, almacenamiento seguro del refresh token (`flutter_secure_storage`) y interceptor de renovación transparente con cerrojo (una sola renovación a la vez, reintento único, fallo de red no cierra sesión). Tests con adaptador de dio simulado.
- [ ] T023 [US1] Repositorio y estado de sesión (Riverpod): registro, login (genera UUIDv7 de dispositivo, plataforma, nombre y zona horaria), arranque con sesión guardada sin esperar al servidor, cierre de sesión que borra tokens y perfil cacheado. Tests unitarios, incluido arranque sin conexión.

## Bloque 6 — Pantallas (US1, US2, US3)

- [ ] T024 [US1] Pantallas de registro e inicio de sesión: validación local, mensajes de error en español, indicador de espera, aviso "hace falta conexión" sin red. Tests de widget.
- [ ] T025 [US2] Aviso de correo sin verificar con "Reenviar correo" y pantalla "He olvidado mi contraseña" (envía la petición y explica que llegará un correo; el enlace abre el navegador con `url_launcher`). Tests de widget.
- [ ] T026 [US3] Perfil: cambiar nombre visible, cambiar contraseña, lista de dispositivos con "Cerrar sesión" en uno y "Cerrar sesión en todos", cerrar sesión local. Pantalla principal provisional "Hola, nombre". Tests de widget.
- [ ] T027 Estados de red y error: servidor caído o sin respuesta en login/registro (mensaje y reintento), sesión expirada que vuelve a login, indicador discreto durante la renovación. Test de widget de cada estado.

## Bloque 7 — CI, despliegue y cierre (FR-014, FR-016, FR-017)

- [ ] T028 `.github/workflows/ci.yml`: job API (service `postgres:16`, `pnpm test`, contrato al día) y job app (`flutter analyze`, `flutter test`, `flutter build apk --debug`) en Linux; hook `pre-push` opcional documentado como plan B.
- [ ] T029 Imagen de producción y `deploy/docker-compose.prod.yml` + `deploy/Caddyfile` (HTTPS con Let's Encrypt en `API_DOMAIN`), variables de producción documentadas en `.env.example` y `deploy/README.md` con el runbook (usuario SSH sin privilegios, `.env` del VPS legible solo por ese usuario).
- [ ] T030 `.github/workflows/deploy.yml`: construye y publica en GHCR, entra por SSH con `DEPLOY_SSH_KEY`, `DEPLOY_HOST`, `DEPLOY_USER`, ejecuta `pull`, migraciones y `up -d`. Validado con `actionlint`; el primer despliegue real queda pendiente de Rafa (subdominio y usuario SSH).
- [ ] T031 Verificación del `quickstart.md` de extremo a extremo (Mailpit, PC y Android), medición de SC-001 y SC-004, revisión de que no hay secretos en el repositorio y lista de deuda técnica para el cierre.

## Dependencias y orden

- Bloque 1 antes que todos. Bloque 2 antes que el 3; el 3 antes que el 4. El 4 (T019) antes del bloque 5 (T021).
- Bloques 5-6 dependen del contrato cerrado en T019.
- Bloque 7 puede empezar tras el 3 (CI), pero el despliegue real depende de Rafa.
- Tareas `[OPUS]`: T004 y T009.
