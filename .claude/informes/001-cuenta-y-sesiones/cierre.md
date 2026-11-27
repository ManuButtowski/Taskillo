# Cierre · 001-cuenta-y-sesiones · 2026-11-27

## Veredicto

**CERRADA (PASS)**, con una condición menor antes de fusionar (ver "Antes de fusionar"). Bloques 1 a 7 en PASS de QA (último: `qa-2026-11-27-bloque-7-revision.md`, 298 tests, typecheck y actionlint limpios), todas las tareas de `tasks.md` en [x], CI en verde y verificación de extremo a extremo en Windows y Android (`t031-verificacion-2026-11-27.md`).

## Qué se entregó

Monorepo (API Hono + Drizzle, app Flutter Windows/Android, contrato OpenAPI desde Zod, Docker Compose, CI y flujo de despliegue); registro en dos pasos con código por correo; login; rotación de refresh tokens con revocación de familia; recuperación de contraseña por página de la API; perfil, cambio de contraseña y sesiones por dispositivo; mailer SMTP/Resend/Fake; limitadores; retardo mínimo de 50 ms anti-fuga.

## Cobertura de requisitos

| Requisito | Estado | Evidencia |
| :--- | :--- | :--- |
| FR-001 a FR-009, FR-012, FR-013 | Cubiertos | Tests de la API (QA bloques 2 a 4) y recorrido T031 |
| FR-010, FR-011 | Cubiertos | App (QA bloques 5 y 6); T031 paso 7: abre sin red con sesión |
| FR-014 | Cubierto | Mailer con tres implementaciones; Mailpit en local. SMTP IONOS real sin probar (Rafa) |
| FR-015 | Cubierto | Estructura y CI en verde |
| FR-016 | Cubierto en código y probado en local | QA bloque 7 (script remoto probado con Docker local); no desplegado en el VPS real (Rafa) |
| FR-017 | Cubierto | `.env.example` único versionado; `git grep` del historial sin secretos (T031) |
| SC-001 | **Aceptado con nota** | Sin cronómetro; ~3 min la primera vez, con un 422 y leyendo instrucciones |
| SC-002, SC-003, SC-005 | Cumplen | Tests de la API |
| SC-004 | Cumple | 0,39 s al primer fotograma, Windows `--profile`, sin red |

**SC-001:** se acepta con nota, no se bloquea el cierre. La primera medición está contaminada (primera vez, un error de validación intermedio) y el flujo es de un solo uso por cuenta. Queda como pendiente de remedir con un flujo conocido durante la siguiente prueba con usuarios reales; si supera 2 min de forma estable, revisar la UX del paso 2 (mensajes de validación previos al envío).

## Decisiones de cierre

- Documentación de contrato: errores generales ya estaban en la tabla de errores de `contracts/api.md`; se añade explicación y el 429 de `POST /me/password` con 5 fallos en curso aunque la contraseña sea correcta. El `openapi.json` no se toca (S2).
- T025 reformulada según lo implementado. `url_launcher` se retira (S1).
- `specs/README.md`: spec 001 marcada como cerrada.

## Deuda técnica de T031 (12 puntos)

| # | Punto | Decisión |
| :-- | :--- | :--- |
| 1 | Cierre de sesión remoto no inmediato (access hasta 15 min) | **Aceptar.** Comprobar la familia en cada petición añade una consulta a la BD por llamada y rompe el diseño sin estado (§4.5 ya acepta la ventana). Se reconsidera en la spec de privacidad/Fase 4 si se necesita revocación inmediata. El quickstart ya lo describe |
| 2 | SC-001 sin cronómetro | Aceptado con nota (arriba) |
| 3 | T025 y `url_launcher` | Hecho (T025); retirar la dependencia: S1 |
| 4 | Contrato: errores generales y 429 | Hecho en `contracts/api.md`; reflejo en `openapi.json`: S2 |
| 5 | Tests: `reset-password` simultáneo y 429 de login en la app | Tarea de seguimiento S3 (no bloquea) |
| 6 | `device_id` nuevo en cada login | Llevar a la **spec 002** (sincronización): id estable por instalación y purga de dispositivos huérfanos (ya en su deuda) |
| 7 | Logout sin red: sesión del servidor viva hasta caducar | Aceptar (30 días, el refresh no se puede usar tras borrar el dato local); revisar en spec 002 cuando haya cola de operaciones pendientes |
| 8 | `https` en release de Windows | Tarea de seguimiento S4 (rechazar `http` en release salvo localhost); no bloquea porque no hay release publicada |
| 9 | Despliegue: grupo `docker`, Caddy sin healthcheck, actions por versión mayor, entorno `produccion` con revisores | **Pendiente de Rafa** (grupo `docker`, entorno con revisores, despliegue real). Caddy sin healthcheck y actions por SHA: aceptar ahora, revisar al desplegar. Además, leves del QA: poner el `if:` por rama/tag también en el job `imagen` y usar `printf '\nAPI_IMAGE=%s\n'` (S5) |
| 10 | Diseño leve (Cambiar correo, campos editables al enviar, tabulación, texto "Enviando") | Llevar a una pasada de pulido de la app en la **spec 002** o posterior; no bloquea |
| 11 | "Hace falta conexión" no distingue sin red de servidor caído | Llevar a la **spec 002** (estado de conexión y sincronización) |
| 12 | Documentar ATL, NDK 28.2 y Modo desarrollador | Tarea de seguimiento S6 (documentación) |

## Tareas de seguimiento

Antes de fusionar (recomendadas, pequeñas y de bajo riesgo):

- **S1 [ANTES DE FUSIONAR]** Retirar `url_launcher` de `apps/app/pubspec.yaml` (y `pubspec.lock`; actualizar la línea de dependencias de `plan.md`). Sin uso en `lib/`.
- **S2 [ANTES DE FUSIONAR]** Reflejar en el esquema Zod de la ruta `POST /me/password` la respuesta `429` y regenerar `packages/contrato/openapi.json` con `pnpm contrato` (la CI tiene test de actualidad). Es la única tarea que toca el contrato; la decide el Director y aquí queda aprobada.
- **S5 [ANTES DE FUSIONAR]** En `deploy.yml`, `if:` por rama/tag también en el job `imagen` y `printf '\nAPI_IMAGE=%s\n'`.

Después de fusionar (sin bloqueo):

- S3 Tests: `reset-password` concurrente (API) y 429 de login (app).
- S4 App: rechazar `API_BASE_URL` con `http` en release de Windows.
- S6 Documentar ATL, NDK 28.2 y Modo desarrollador en la guía de entorno.
- S7 Remedir SC-001 con cronómetro.

Pendientes de Rafa: buzón `no-reply@devkomp.es` y SPF/DKIM/DMARC, subdominio de la API, usuario SSH, decisión del grupo `docker`, entorno `produccion` con revisores, primer despliegue real y prueba con el SMTP de IONOS.

## Antes de fusionar

S1, S2 y S5 (cambios pequeños en código/CI, hechos por Desarrollo con revisión de QA sobre lo afectado). Si Manuel prefiere no retrasar el PR, S1, S2 y S5 pueden pasar a después sin riesgo funcional; el cierre de la spec no depende de ellos.
