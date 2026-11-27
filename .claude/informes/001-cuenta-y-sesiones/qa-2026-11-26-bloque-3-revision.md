# QA 001-cuenta-y-sesiones · bloque 3 · re-revisión · 2026-11-26

**Resultado:** PASS (los hallazgos 1, 2 y 3 del informe `qa-2026-11-26-bloque-3.md` quedan corregidos; el bloque 3 pasa)

Commits revisados: 5c32824 (hallazgos 1 y 2) y ee93f14 (hallazgo 3).

## Tests ejecutados
- `pnpm test` (batería completa, BD de Docker en el 5433): 20 ficheros, 245 tests aprobados, 1 `todo`, 0 fallidos (antes 234; los 11 nuevos son de `error-handling.test.ts` y `min-duration.test.ts`).
- `pnpm -r typecheck`: sin errores. `pnpm build`: compila. `git status` limpio.
- Tests escritos primero: copié `error-handling.test.ts`, `min-duration.test.ts` y `fake-clock.ts` sobre el código de bbb9af4 (copia temporal, ya eliminada). Fallan 5 de 5 en `error-handling` (500 en vez de 400/415; el log trae `name: "Error"` con `message` completo, incluido correo y enlace en `mail_send_failed`) y `min-duration` ni compila (falta `min-duration.js`). Los tests detectan el defecto original.

## Hallazgo 1 (grave, log de errores internos): corregido
Con la API reconstruida (`docker compose up -d --build`) provoqué fallos reales de consulta renombrando tablas en la BD de dev (revertido después) y comprobé `docker logs taskillo-api-1`:
- Paso 1 (`POST /auth/register`, tabla `users` ausente), `POST /auth/login` y `POST /auth/refresh` (tabla `sessions` ausente, con un usuario real y su contraseña) y paso 2 (`email_tokens` ausente): los cuatro dan 500 `internal_error` y el log trae solo `{"name":"DrizzleQueryError","code":"42P01","cause":"PostgresError","stack":[6 líneas "at ..."]}`.
- Búsqueda en todo el log de correos de prueba, contraseña, `Failed query`, `params`, `$argon2`: 0 coincidencias.
- `DrizzleQueryError` con parámetros directos: cubierto por `error-handling.test.ts` (solo nombre, código y restricción; sin SQL ni hash).
- `mail_send_failed`: cubierto por test (error con correo, enlace y código en `message`/`response`/`command`: nada aparece). En vivo con Mailpit parado no conseguí que el envío fallara en 30 s (el 202 sale y no hay log de fallo; probablemente el reintento/espera de nodemailer), así que la comprobación en vivo de esa rama queda en el test; el código es el mismo `logger.error` con `redact`, que ya resume el error.
- Revisado `summarizeError`: lista blanca (name, code, constraint, table, cause como nombre de clase, pila filtrada a líneas `at `). Residuo asumido: la pila puede incluir rutas de ficheros; no es un secreto.

## Hallazgo 2 (medio, HTTPException como 500): corregido
- `POST /auth/register` con `{"email":` y `Content-Type: application/json`: 400 `{"error":{"code":"invalid_json",...}}`.
- Sin `Content-Type`: 415 `unsupported_media_type`. Con `text/plain`: 415 `unsupported_media_type`.
- El log de nivel `error` no aumentó (4 líneas antes y después, todas de las pruebas del hallazgo 1); las tres peticiones quedan solo como `request` `info`.

## Hallazgo 3 (medio, fuga por tiempo): corregido
Mediciones con `curl -w %{time_total}` contra la API en Docker, dos tandas con la API reiniciada antes de cada una (limitador a cero):

| Caso | Tanda a (s) | Tanda b (s) |
| :--- | :--- | :--- |
| Paso 1, correo con cuenta (3) | 0,0535 · 0,0558 · 0,0535 | 0,0530 · 0,0532 · 0,0525 |
| Paso 1, correo nuevo (5) | 0,0525 · 0,0542 · 0,0534 · 0,0531 · 0,0529 | 0,0529 · 0,0534 · 0,0535 · 0,0533 · 0,0528 |
| Paso 2, `invalid_code` con código pendiente (5) | 0,0534 · 0,0528 · 0,0524 · 0,0525 · 0,0536 | 0,0554 · 0,0542 · 0,0538 · 0,0527 · 0,0523 |
| Paso 2, `invalid_code` sin código pendiente (4) | 0,0540 · 0,0519 · 0,0528 · 0,0521 | 0,0540 · 0,0538 · 0,0521 · 0,0531 |

Antes: 5,5-6,4 ms frente a 9,4-12,4 ms. Ahora todos quedan en 52-56 ms (suelo de 50 ms más curl y red local); las medias de cada par difieren menos de 1 ms, dentro del ruido. La diferencia queda tapada.

Qué queda fuera del suelo y si delata algo:
- 422 `validation_error` (Zod): se decide antes del manejador y no depende de la cuenta ni del código. Sin fuga.
- 422 `weak_password` / 409 `username_taken` del paso 2: solo se alcanzan con un código válido (se comprueba antes), así que quien llega ahí ya posee el código. Sin fuga de existencia.
- 429: el limitador va antes del manejador y cuenta por correo/IP sin consultar la BD; responde igual exista o no la cuenta. Sin fuga. Solo informa de que se agotó el cupo propio.
- 201 del paso 2: exige código válido.
- Login (`401` con relleno de hash) y refresh no entran en este hallazgo; el primer relleno perezoso sigue como hallazgo leve 5 del informe anterior.
- Observación leve: si una petición real tarda más de 50 ms (BD lenta), el suelo no la iguala. Con las diferencias actuales (~4 ms) no es explotable; no requiere acción.

## Git
`git log main..` (26 commits): ninguno lleva `Co-Authored-By`, "Claude" ni "Generated with".

## Hallazgos nuevos
Ninguno.

## Pendiente para el Director (sin cambios respecto al informe anterior)
- Hallazgo 4 (medio): principio VII, tests de ruta de `logout-all` (T015) y rutas de T012 escritos después del código; exigir tests primero en T017 y T018. Lo valora el Director. Nota: los tests de esta corrección sí se escribieron primero (ver arriba).
- Desviación 1: ratificar los códigos de error nuevos (`invalid_refresh_token`, `not_found`, `rate_limited`, `unauthorized`, `weak_password`, `validation_error`, `internal_error`) y añadir también `invalid_json`, `unsupported_media_type` y `bad_request` a `contracts/api.md` en T019. Comprobar que `openapi.json` los refleja si procede.
- Hallazgos leves 5 a 9 del informe anterior, sin cambios.
