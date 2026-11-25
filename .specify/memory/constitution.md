<!--
Informe de impacto de sincronización
- Versión: plantilla → 1.0.0 (ratificación inicial)
- Principios añadidos: I–VIII (todos nuevos)
- Secciones añadidas: Stack y restricciones técnicas, Reglas de datos y sincronización,
  Reglas de privacidad, Flujo de trabajo y agentes, Gobierno
- Plantillas revisadas: plan-template.md ✅ (su "Constitution Check" se rellena con los
  principios de aquí), spec-template.md ✅, tasks-template.md ✅ (sin cambios de estructura)
- Pendiente: dominio verificado para Resend (ver "Decisiones abiertas")
-->

# Constitución de Taskillo

Taskillo es un gestor de tareas personal para PC (Windows primero) y Android, sincronizado
mediante PostgreSQL, con gamificación y una capa social opcional. La fuente funcional
completa está en `docs/especificacion.md` (v2.0). Esta constitución recoge lo que **no se
negocia** al planificar o programar cualquier spec.

## Principios fundamentales

### I. Fricción cero

Crear o completar una tarea lleva segundos.

- Solo el título es obligatorio al crear una tarea; todo lo demás es opcional.
- Completar una tarea desde la lista del día es un solo toque.
- Ninguna pantalla bloquea al usuario esperando al servidor: la respuesta de la interfaz
  es inmediata con los datos locales.

### II. Privacidad soberana (NO NEGOCIABLE)

El usuario decide qué comparte, y el filtrado se hace **siempre en el backend**.

- El cliente nunca recibe datos que el usuario no pueda ver. Ocultar en la interfaz algo
  que viaja en la respuesta HTTP es un fallo de seguridad, no una opción de diseño.
- Por defecto todo es privado: grupos no visibles para amigos, interruptor social
  apagado, casilla "Publicar en el timeline" desmarcada, tareas sin grupo tratadas como
  no visibles en modo `OCUPADO`.
- Cualquier cambio en las reglas de §5.5 de la especificación pasa por el Director y se
  revisa con Opus.

### III. Local-first

La app abre y funciona sin conexión y sincroniza al volver la red.

- Toda escritura se guarda primero en SQLite local (`drift`) y se encola para el servidor.
- Los IDs se generan en el cliente (UUIDv7).
- La app tolera que el servidor tarde en despertar (Render free): muestra un indicador
  discreto de "sincronizando" y nunca un bloqueo.

### IV. Coste 0 €

Nada que requiera un pago obligatorio.

- Solo servicios con capa gratuita: Neon, Cloudflare R2, Resend, Render, GitHub Actions,
  Firebase Cloud Messaging.
- Al empezar cada fase se revisan los límites de las capas gratuitas, porque cambian.
- Toda dependencia nueva de pago, o con riesgo de serlo, necesita aprobación expresa de
  Manuel y queda anotada en `.claude/informes/`.

### V. Portabilidad

Solo PostgreSQL estándar y almacenamiento compatible con S3.

- Nada de extensiones o funciones propias de Neon. Extensiones permitidas: `citext`.
- El backend corre igual en Render, en Docker Compose local y en el VPS.
- Migrar al VPS es `pg_dump` + `pg_restore` + cambiar la cadena de conexión, sin tocar
  código.
- La configuración llega por variables de entorno; ningún secreto en el repositorio.

### VI. Alcance mínimo

Cada fase se cierra y se usa antes de empezar la siguiente.

- Una spec solo implementa lo que su `spec.md` pide. Las columnas o pantallas de fases
  posteriores no se crean "por si acaso"; llegan con su migración cuando toque.
- iOS, Live Activities y varias alarmas por tarea están fuera del plan.
- YAGNI: si algo no lo pide un criterio de aceptación, no se programa.

### VII. Tests primero en la lógica crítica (NO NEGOCIABLE)

Estas piezas se escriben con tests antes que el código y no se cierran sin ellos:

- Motor de ocurrencias (§5.3): meses de 28 a 31 días, día 31 en meses cortos (cae el
  último día), cambio de hora de verano, cruce de medianoche, excepciones `SKIP` y `MOVE`.
- Protocolo de sincronización (§5.4): idempotencia de completados, conflictos (gana el
  último en llegar), borrados con dispositivos sin conexión.
- Autenticación: rotación del refresh token, reutilización de un token rotado (revoca la
  familia), "cerrar todas las sesiones".
- Privacidad (Fase 4): los tests comprueban el **cuerpo JSON de la respuesta**, no la
  pantalla.

El resto del código lleva tests unitarios junto a cada tarea, sin exigir TDD estricto.

### VIII. Un contrato, dos lenguajes

El backend (TypeScript) y la app (Dart) no comparten código, así que comparten contrato.

- El contrato OpenAPI se genera desde los esquemas Zod del backend y vive en
  `packages/contrato/`.
- Los modelos Dart de la app se generan desde ese contrato; no se escriben a mano.
- Cambiar el contrato es una decisión del Director, no de Desarrollo.

## Stack y restricciones técnicas

| Capa | Elección |
| :--- | :--- |
| App (PC + Android) | Flutter (Dart). Windows primero; Linux y macOS sin pruebas. Widget de Android en Kotlin/XML con `home_widget` (Fase 2) |
| Caché local | SQLite con `drift` |
| Backend | TypeScript + Node.js + Hono |
| Acceso a datos | Drizzle ORM con migraciones SQL versionadas |
| Validación y contrato | Zod → OpenAPI → modelos Dart generados |
| Base de datos | PostgreSQL 16: Neon (nube) y Docker Compose (local) |
| Fotos | Cloudflare R2 con URLs prefirmadas (Fase 2 y 4) |
| Autenticación | Propia: Argon2id + JWT de acceso de 15 min + refresh token opaco rotativo de 30 días |
| Correo | Resend (dominio de pruebas en desarrollo) |
| Push de datos a Android | Firebase Cloud Messaging (Fase 2) |
| Hosting | Render free durante el MVP; después VPS con Docker Compose |
| CI | GitHub Actions: tests + APK en Linux en cada cambio; build de Windows solo en releases. Plan B: hook `pre-push` local |

**Estructura del monorepo:**

```text
apps/api/            Backend Hono + Drizzle + migraciones
apps/app/            App Flutter (PC + Android)
packages/contrato/   OpenAPI y esquemas compartidos
docker-compose.yml   PostgreSQL 16 + API para desarrollo local y VPS
specs/               Una carpeta por spec de Spec-Kit
docs/                Especificación funcional
```

## Reglas de datos y sincronización

- **Hora de reloj.** Fechas y horas de tareas se guardan como hora local (`DATE` + `TIME`)
  junto a la zona horaria del usuario. Solo se convierten a `TIMESTAMPTZ` para programar
  alarmas.
- **Duración en minutos**, de 1 a 1440. Con hora y sin duración, la tarea es una marca
  puntual: no ocupa franja ni cuenta como solapamiento.
- **Columnas de sincronización** en toda tabla sincronizable: `updated_at`, `deleted_at`,
  `version`, `server_seq` (secuencia global `sync_seq`), mantenidas por un disparador común.
- **Borrado lógico** siempre en tablas sincronizables. Purga a los 90 días; un dispositivo
  con más de 90 días sin sincronizar hace una resincronización completa.
- **Ocurrencias** de las recurrentes: nunca se guardan, se calculan al vuelo con un único
  motor por lado (cliente y servidor) y la misma batería de casos de prueba.
- **Recurrencias:** diaria, días de la semana, mensual por día del mes (día inexistente →
  último día del mes). Editar solo "esta" o "esta y las siguientes"; nunca se reescriben
  ocurrencias pasadas.
- **Conflictos:** gana la última escritura que llega al servidor, sin fusionar campos.
- **Completar es idempotente:** único por `(task_id, occurrence_date)`.
- **Sincronización en Fase 1:** al abrir, al reconectar, tras cada cambio local y cada
  30 s en primer plano. Push por FCM en Fase 2. Sin WebSockets ni SSE.
- **Alarmas:** locales en cada dispositivo, una por tarea, programadas a 14 días vista y
  como máximo 400 pendientes en Android.
- **Cada consulta del backend filtra por el `user_id` del token.**

## Reglas de privacidad (Fase 4, contrato crítico)

Resumen de §5.5 de la especificación, que manda en caso de duda:

1. Sin amistad `accepted`, o con `social_enabled`/`share_schedule` apagados, la respuesta
   es `404` (no se revela si el usuario existe).
2. Grupo visible → título, grupo y color. Grupo no visible en `BUSY` → bloque "OCUPADO"
   con id aleatorio por petición, sin `task_id`, `group_id` ni notas. Grupo `HIDDEN` → no
   se envía. Tarea sin grupo → `BUSY`.
3. Timeline: solo completados publicados, no borrados y de grupos visibles en ese momento.
   Me gusta y comentarios pasan el mismo filtro.
4. Rankings de amigos: suman todas las copas; el desglose solo muestra grupos visibles y
   el resto como "Otros".
5. Fotos: URLs prefirmadas de corta duración, solo tras pasar el filtro.

## Flujo de trabajo y agentes

- **Spec-Kit:** cada spec vive en `specs/NNN-nombre/` con `spec.md`, `plan.md`, `tasks.md`
  y los artefactos que genere `/speckit-plan`.
- **Roles** (definidos en `.claude/agents/`):
  - **Director**: al principio de la spec escribe `plan.md` y `tasks.md`; al final revisa
    el informe de QA y cierra la spec. No escribe código de la app.
  - **Desarrollo**: una tarea de `tasks.md` cada vez, con sus tests. No cambia contrato,
    esquema ni reglas de privacidad sin el Director.
  - **QA**: al terminar un bloque de tareas, ejecuta tests y revisa criterios de
    aceptación; emite `PASS` o `FAIL` en `.claude/informes/`.
- **Modelos:** Sonnet por defecto en los tres roles. Opus solo para arquitectura,
  privacidad, esquema de datos, motor de recurrencias, sincronización o un bloqueo que
  Sonnet no resolvió en dos intentos. Haiku solo para redactar (informes, resúmenes,
  commits, documentación) y tareas muy fáciles; nunca para lógica, privacidad ni esquema.
  Las tareas que necesitan Opus se marcan `[OPUS]` en `tasks.md`.
- **Ahorro de uso (plan Pro):** una sesión de Claude Code por spec; el Director lee specs y
  planes, no el repositorio entero; QA ejecuta solo los tests afectados mientras se
  corrige y la batería completa al cerrar.
- **Git:** una rama por spec (`NNN-nombre`), commits pequeños y PR a `main` al cerrar la
  spec. `main` siempre compila y pasa los tests.
- **Idioma:** documentación, specs, informes y mensajes de la interfaz en español. El
  código (identificadores, tablas, columnas) en inglés, como en el esquema de la
  especificación.

## Decisiones abiertas

- Dominio verificado para Resend (subdominio de DEVKOMP o dominio propio). Necesario solo
  antes de abrir la app a otras personas; mientras tanto se usa el dominio de pruebas.

## Gobierno

- Esta constitución prevalece sobre cualquier otra práctica del proyecto. Si una spec o un
  plan la contradicen, gana la constitución hasta que se enmiende.
- Toda enmienda la propone el Director, la aprueba Manuel y queda registrada en el
  informe de impacto de la cabecera, con su versión:
  - MAYOR: se elimina o redefine un principio.
  - MENOR: se añade un principio o una sección, o se amplía de forma material.
  - PARCHE: aclaraciones y redacción.
- El "Constitution Check" de cada `plan.md` verifica los principios I–VIII; cualquier
  excepción se justifica en la tabla "Complexity Tracking" del plan.
- La guía de trabajo diaria está en `CLAUDE.md`.

**Versión**: 1.0.0 | **Ratificada**: 2026-11-25 | **Última enmienda**: 2026-11-25
