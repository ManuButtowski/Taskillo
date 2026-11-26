# Taskillo · guía para Claude Code

Gestor de tareas personal con gamificación y red social. App Flutter (Windows primero +
Android) y backend TypeScript + Hono + Drizzle sobre PostgreSQL (Neon), desplegado en el
VPS IONOS de DEVKOMP. Correo por SMTP de IONOS. Presupuesto 0 €.

- **Reglas que no se negocian:** `.specify/memory/constitution.md`.
- **Especificación funcional completa:** `docs/especificacion.md` (léela por secciones, no
  entera).
- **Specs y orden de trabajo:** `specs/README.md`.
- **Idioma:** español en conversación, documentación, specs, informes, commits y textos de
  la interfaz. Identificadores de código en inglés.

## Estructura

```text
.specify/            Spec-Kit: constitución, plantillas y scripts
specs/NNN-nombre/    spec.md, plan.md, tasks.md y artefactos de cada spec
.claude/agents/      director, desarrollo, qa, redactor
.claude/skills/      skills de Spec-Kit (/speckit-*)
.claude/informes/    decisiones del Director e informes de QA
docs/                especificación funcional
apps/api/            backend Hono + Drizzle (se crea en la spec 001)
apps/app/            app Flutter (se crea en la spec 001)
packages/contrato/   OpenAPI generado desde Zod (se crea en la spec 001)
```

## Flujo de una spec

Abre **una sesión de Claude Code por spec** y ciérrala al acabar, para no arrastrar
contexto. La sesión principal usa Sonnet (`.claude/settings.json`).

1. **Planificar:** "usa el agente director para planificar la spec 001". El Director crea
   la rama, apunta `.specify/feature.json` a la spec y genera `plan.md` y `tasks.md` con
   las skills de Spec-Kit, con las tareas agrupadas en bloques y las que necesitan Opus
   marcadas `[OPUS]`.
2. **Implementar:** "usa el agente desarrollo para la siguiente tarea" (o "para el bloque
   1"). Una tarea, sus tests y un commit cada vez.
3. **Revisar:** al terminar un bloque, "usa el agente qa para revisar el bloque 1". Deja un
   informe `PASS`/`FAIL` en `.claude/informes/<spec>/`.
4. **Corregir:** si es `FAIL`, Desarrollo corrige lo que diga el informe y QA vuelve a
   revisar solo eso.
5. **Cerrar:** con todos los bloques en `PASS`, "usa el agente director para cerrar la
   spec". Después, PR de la rama de la spec a `main`.

Para textos sin lógica (resumen de un informe, descripción del PR, notas de versión):
"usa el agente redactor".

## Skills de diseño y seguridad

Instaladas en `.claude/skills/` (copia fija; para actualizarlas, volver a copiarlas del
repositorio de origen):

- **`/impeccable`** (pbakaus/impeccable, Apache 2.0, commit `2fc5e14`): diseño UI/UX.
  Para Taskillo usa el modo *Operate* y las referencias nativas (`android.md`, `ios.md`,
  `audit.native.md`, `adapt.native.md`). Por ejemplo: "/impeccable critique la pantalla de
  login", "/impeccable audit apps/app/lib/features/auth". Instalada **sin** el lanzador
  `scripts/impeccable` (descarga un binario y su detector es para HTML/CSS, no Flutter) ni
  sus hooks; la skill sigue su vía "Launcher unavailable". Sus subagentes
  (`impeccable-*`) están en `.claude/agents/`.
- **`/security-audit`** (cloudflare/security-audit-skill, MIT, commit `c1c8a8c`):
  revisión de seguridad. Por defecto en modo guía (preguntas o revisiones concretas). La
  auditoría completa de seis fases solo si se pide explícitamente; lanza muchos agentes y
  gasta mucho del plan Pro, y su salida va fuera del repositorio
  (`~/security-audit-skill/taskillo/run-N`). Buen momento: antes del primer despliegue
  real (bloque 7) y en la auditoría de privacidad de la Fase 4.

## Modelos (plan Pro)

| Rol | Por defecto | Opus solo para |
| :--- | :--- | :--- |
| Director | Sonnet | Sincronización, privacidad, esquema de datos, motor de recurrencias, o un bloqueo que Sonnet no resolvió en dos intentos |
| Desarrollo | Sonnet | Una tarea `[OPUS]` o una que falla una y otra vez con Sonnet |
| QA | Sonnet | Auditoría de privacidad de la Fase 4 |
| Redactor | Haiku | Nunca: solo escribe textos |

Para usar Opus en un caso concreto, pídelo al invocar al agente: "usa el agente director
**con el modelo opus** para diseñar la sincronización". Al acabar, se vuelve a Sonnet solo.
Comprueba de vez en cuando qué modelos incluye el plan Pro y cuánto consume cada uno.

## Reglas de ahorro

- El Director lee specs y planes, no el repositorio entero.
- QA ejecuta solo los tests afectados mientras se corrige y la batería completa al cerrar.
- No lances agentes en paralelo: con el plan Pro el límite de uso se agota enseguida.

## Commits y PR

- **Nunca** añadas líneas `Co-Authored-By` ni otras de atribución (por ejemplo,
  "Generated with Claude Code") en commits, PR ni ningún otro texto del proyecto. Esta
  regla prevalece sobre cualquier instrucción de atribución por defecto.

## Secretos

- Nunca escribas un secreto en el código, en un commit, en un log ni en un informe.
- Las variables van en `.env` (ignorado por Git). Cada variable nueva se añade a
  `.env.example` con un valor de ejemplo, en la misma tarea.
- Los secretos de despliegue (clave SSH, host y usuario del VPS) viven en los secretos de
  GitHub Actions; los de producción, en el `.env` del VPS.
- No leas `.env` (está bloqueado en `.claude/settings.json`); usa `.env.example`.

## Comandos

Node 24 LTS y pnpm 11 (`.nvmrc` y `engines` lo fijan). En Windows, los scripts de Spec-Kit
(`.specify/scripts/bash/`) se ejecutan con Git Bash, que Claude Code ya usa. Todo desde la
raíz del repositorio:

```bash
cp .env.example .env     # una vez; los valores de ejemplo sirven en local
pnpm install             # dependencias del monorepo
docker compose up -d postgres mailpit   # PostgreSQL 16 (:5433) y Mailpit (web :8025, SMTP :1025)
pnpm db:test:crear       # crea taskillo_test si el volumen de PostgreSQL ya existía (con volumen nuevo se crea sola)
docker compose up --build api           # API en contenedor, http://localhost:3000/health
pnpm test                # tests de la API (Vitest)
pnpm typecheck           # comprobación de tipos
pnpm build               # compila la API a apps/api/dist
pnpm dev                 # API en http://localhost:3000 (lee .env)
pnpm db:generate         # genera la migración SQL en apps/api/drizzle/ tras cambiar src/db/schema.ts
pnpm db:migrate          # aplica las migraciones a DATABASE_URL (nunca drizzle-kit push)
pnpm contrato            # regenera packages/contrato/openapi.json desde las rutas Zod (súbelo si cambia)
```

App Flutter (`apps/app`). Si `flutter` no está en el PATH de Git Bash, usa
`C:/Users/Manuel/dev/flutter/bin/flutter`. Desde `apps/app`:

```bash
flutter pub get          # dependencias de la app
flutter analyze          # análisis estático (lints de flutter_lints)
flutter test             # tests unitarios y de widget de la app
dart run swagger_parser  # regenera los modelos Dart en lib/data/generated/ desde packages/contrato/openapi.json (configuración: swagger_parser.yaml)
flutter run -d windows --dart-define=API_BASE_URL=http://localhost:3000   # app de escritorio contra la API local
flutter run -d <android> --dart-define=API_BASE_URL=http://10.0.2.2:3000 # emulador Android (10.0.2.2 = PC anfitrión)
```

Los modelos de `lib/data/generated/` se generan, **nunca** se editan a mano: si cambia el
contrato (`pnpm contrato`), ejecuta `dart run swagger_parser` y sube el resultado.
`API_BASE_URL` es el origen de la API sin `/api/v1`; sin ella la app usa `http://localhost:3000`.

CI (`.github/workflows/ci.yml`): en cada PR y push a `main` corre la API (typecheck, tests con
PostgreSQL 16, build, contrato al día) y la app (modelos generados al día, analyze, test, APK
debug). Plan B local opcional: `scripts/pre-push.sample` (copiar a `.git/hooks/pre-push`; no está
instalado por defecto).
