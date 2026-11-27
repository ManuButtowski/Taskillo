# QA 001-cuenta-y-sesiones · bloque 4 (re-revisión del commit f088b96) · 2026-11-26

**Resultado:** PASS

Alcance: solo el commit f088b96 "Corrige hallazgos 1 y 2 del QA del bloque 4". El informe anterior es `qa-2026-11-26-bloque-4.md`.

## Tests ejecutados
- `pnpm test`: 22 ficheros, 291 tests aprobados, 0 fallidos.
- `pnpm -r typecheck`: sin errores (apps/api y packages/contrato).
- `pnpm build`: correcto.
- Principio VII: copia temporal de 48e2d8a (fuera del repo, ya borrada) con los tests de f088b96 superpuestos: 4 fallan (los 3 unitarios de `reserve`, que no existe, y el de 30 peticiones con `expected 30 to be less than or equal to 5`). Con f088b96 pasan los 4. Los tests nuevos son rojos antes y verdes después.
- `git log main..`: 35 commits, ninguno con Co-Authored-By ni atribución. `git status` limpio tras build (el OpenAPI no cambia).

## En vivo (docker compose up -d --build, PostgreSQL 5433, Mailpit)
- Hallazgo 1: cuenta nueva y 30 `POST /me/password` simultáneos con contraseña actual errónea: **5 × 403 y 25 × 429 con `Retry-After: 900`** (antes: las 30 llegaron a Argon2). Un cambio correcto posterior, con los 5 intentos ya gastados, da 429 (límite alcanzado, esperado).
- Hallazgo 2: enlace de recuperación real: una contraseña débil devuelve 422 y no gasta el enlace; 6 `POST /auth/reset-password` simultáneos con el mismo enlace y contraseñas distintas: **1 × 200 y 5 × 400 `invalid_token`**; un séptimo después, 400. Solo la contraseña del ganador entra en el login (las demás dan 401).

## Criterios de aceptación
- [x] Hallazgo 1 corregido: la reserva es síncrona (`hit` + registro sin `await`), así que no hay carrera en un proceso Node de una instancia.
- [x] Hallazgo 2 corregido: Argon2 fuera de la transacción; el consumo es un `UPDATE ... WHERE used_at IS NULL RETURNING` atómico y la perdedora recibe `invalid_token` y revierte. Comprobado en vivo.
- [x] La contraseña débil no consume el enlace (la política se evalúa antes de la transacción). Hay test previo y se verificó en vivo.

## Revisión de código
- `release` es idempotente y por reserva: guarda su marca de tiempo y la quita de la lista de su clave. No toca otras claves (test). Matiz leve: la entrada es un número, así que `indexOf` quita la primera con el mismo valor; si dos reservas comparten milisegundo es equivalente a nivel de recuento, no libera de más. Si la reserva ya salió de la ventana, no hace nada.
- Fugas de reservas: el middleware libera en `finally` salvo 403; Hono convierte las excepciones en 500 dentro de `next()`, que también se libera. 204 y 422 liberan. Un 401 no llega al middleware (el Bearer va antes). No hay fuga.
- Efecto aceptado: con 5 verificaciones fallidas en curso, un cambio correcto simultáneo recibe 429 aunque la contraseña sea buena. Es un cliente legítimo con 5 fallos en vuelo a la vez: coste mínimo y se resuelve reintentando tras liberarse. Se acepta; conviene que el cliente trate 429 con `Retry-After` en esa pantalla.
- TOCTOU de `resetPassword`: entre `peek` y la transacción, el consumo atómico es la única decisión; además se exige que el `userId` consumido coincida con el leído. Una carrera con otro cambio de contraseña del mismo usuario sobrescribe con la última escritura (aceptable: ambos eran válidos). No es explotable.
- Otros limitadores: `rateLimit` (auth.ts 137/143/147, recovery.ts 94/103) hace `hit` síncrono antes de cualquier trabajo asíncrono, así que no tienen la carrera. Confirmado el comentario de Desarrollo. Los demás usos de `limiter` son solo esos y el de `me.ts`.

## Hallazgos
1. **[leve]** No hay test automático de dos `POST /auth/reset-password` simultáneos con el mismo enlace (solo lo cubre la verificación en vivo de este informe). Conviene añadirlo (Promise.all de 2 llamadas a `resetPassword`: un `ok` y un `invalid_token`).
2. **[leve]** Pendiente del informe anterior (hallazgo 3): los errores globales (400/401/429 comunes) no figuran en el OpenAPI generado de forma uniforme. Sigue pendiente para el cierre de la spec; este commit no lo toca.
3. **[leve]** El efecto aceptado (429 a un cambio correcto simultáneo con 5 fallos en curso) no tiene test ni nota en el contrato. Opcional: documentarlo en `contracts/api.md`.
