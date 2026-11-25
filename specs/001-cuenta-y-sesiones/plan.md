# Implementation Plan: Cuenta y sesiones

**Branch**: `001-cuenta-y-sesiones` | **Date**: 2026-11-25 | **Spec**: [spec.md](spec.md)

**Input**: `specs/001-cuenta-y-sesiones/spec.md` (fuente funcional: `docs/especificacion.md` §3 M01, §4.5, §5.2)

## Summary

Se monta el monorepo (API Hono + Drizzle, app Flutter, contrato OpenAPI, Docker Compose, CI y
despliegue al VPS) y sobre él se implementa la cuenta: registro, login, verificación de
correo, recuperación de contraseña, perfil, sesiones por dispositivo y rotación de refresh
tokens con detección de reutilización. El contrato se genera desde Zod; los modelos Dart se
generan desde el contrato. La lógica crítica (contraseñas, tokens, rotación) se escribe con
tests primero (principio VII).

## Technical Context

**Language/Version**: TypeScript 5.x sobre Node.js 22 LTS (API); Dart 3 / Flutter estable (app)

**Primary Dependencies**: API: Hono, `@hono/zod-openapi`, Zod, Drizzle ORM + drizzle-kit, `postgres` (driver), `@node-rs/argon2`, `jose` (JWT), `nodemailer`. App: `dio`, `flutter_riverpod`, `go_router`, `flutter_secure_storage`, `shared_preferences`, `url_launcher`, `swagger_parser` (generación de modelos), `uuid`. Gestor: pnpm workspaces. Resend se llama por `fetch`, sin SDK.

**Storage**: PostgreSQL 16 (Docker local, Neon en producción). La app no usa `drift` todavía (llega en la spec 002); en esta spec solo guarda tokens en almacenamiento seguro y el perfil en `shared_preferences`.

**Testing**: API: Vitest contra un PostgreSQL real (Compose local, service container en CI) y un `FakeMailer`. App: `flutter test` (unitarios y de widget).

**Target Platform**: API en Linux (Docker, VPS IONOS); app en Windows 10/11 y Android.

**Project Type**: Monorepo con servicio web (API) + app móvil/escritorio.

**Performance Goals**: SC-001 (alta en menos de 1 min) y SC-004 (abrir sin conexión en menos de 2 s). Argon2id con parámetros OWASP (m=19 MiB, t=2, p=1), unos 50-100 ms por hash.

**Constraints**: coste 0 €; un solo VPS con una sola instancia de la API; ningún secreto en el repo; sin servidores de terceros de pago.

**Scale/Scope**: usuarios en decenas; 4 tablas; unos 14 endpoints; 6 pantallas.

## Constitution Check

*GATE: pasa antes de la investigación y se revalida tras el diseño.*

| Principio | Veredicto | Notas |
| :--- | :--- | :--- |
| I. Fricción cero | Pasa | Registro con 4 campos; sesión persistente; la app abre sin esperar al servidor. |
| II. Privacidad soberana | Pasa | Respuestas genéricas (no revelan si existe el correo), `404`/`401` sin detalle, `user_id` siempre del token. Sin datos sociales todavía. |
| III. Local-first | Pasa (parcial justificado) | Con sesión guardada la app abre sin red y pospone la renovación. Registro y login exigen red por naturaleza. La cola de escritura y `drift` llegan con la spec 002. |
| IV. Coste 0 € | Pasa | Nodemailer, jose, Argon2, Caddy, GHCR, Actions: todo gratuito. Sin dependencias de pago. |
| V. Portabilidad | Pasa | Solo `citext`; config por variables de entorno; correo tras interfaz con SMTP/Resend; mismo contenedor en Compose local y VPS. |
| VI. Alcance mínimo | Pasa | No se crean columnas de Google, avatar, racha, social ni asistente; ni `sync_seq` ni disparadores de sincronización (las tablas de esta spec no son sincronizables). |
| VII. Tests primero | Pasa | TDD en contraseñas, tokens, rotación y reutilización, `logout-all` (tareas marcadas "tests primero"). |
| VIII. Un contrato, dos lenguajes | Pasa | Rutas definidas con `@hono/zod-openapi` → `packages/contrato/openapi.json` → modelos Dart generados. Un test comprueba que el contrato versionado está al día. |

Revalidado tras el diseño (data-model y contrato): sin violaciones.

## Project Structure

### Documentation (this feature)

```text
specs/001-cuenta-y-sesiones/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── api.md
└── tasks.md
```

### Source Code (repository root)

```text
package.json, pnpm-workspace.yaml, tsconfig.base.json, .env.example
docker-compose.yml                      # postgres 16 + mailpit + api (local)
deploy/
├── docker-compose.prod.yml             # api + caddy (VPS)
└── Caddyfile
.github/workflows/
├── ci.yml                              # tests API + contrato + Flutter + APK
└── deploy.yml                          # GHCR + SSH + migraciones
apps/api/
├── Dockerfile
├── drizzle/                            # migraciones SQL versionadas
├── src/
│   ├── index.ts, app.ts, config.ts, migrate.ts
│   ├── db/ (schema.ts, client.ts)
│   ├── auth/ (passwords.ts, tokens.ts, sessions.ts, email-tokens.ts, middleware.ts)
│   ├── mail/ (mailer.ts, smtp.ts, resend.ts, templates.ts)
│   ├── routes/ (auth.ts, me.ts, pages.ts, health.ts)
│   └── lib/ (rate-limit.ts, logger.ts, common-passwords.ts)
└── test/
packages/contrato/
├── openapi.json                        # generado, versionado
└── scripts/generar.ts
apps/app/
├── lib/
│   ├── core/ (api cliente dio, almacenamiento seguro, tema, router)
│   ├── data/generated/                 # modelos Dart generados
│   └── features/auth/ (estado, repositorio, pantallas)
└── test/
```

**Structure Decision**: monorepo de la constitución. La API y el contrato en TypeScript; la app en Dart. El contrato es la única frontera.

## Complexity Tracking

Sin violaciones que justificar.
