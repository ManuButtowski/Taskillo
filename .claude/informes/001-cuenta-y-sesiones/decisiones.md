# Decisiones técnicas · 001-cuenta-y-sesiones

| Fecha | Decisión | Por qué | Modelo |
| :--- | :--- | :--- | :--- |
| 2026-11-25 | Tabla `email_tokens` única (verificación y recuperación) con hash SHA-256, caducidad 24 h / 1 h y `used_at` | Un solo sitio para ambos flujos y tokens de un solo uso | Sonnet |
| 2026-11-25 | No crear `sync_seq` ni disparadores en esta spec | Las tablas de la spec no son sincronizables; llegan en la spec 002 (principio VI) | Sonnet |
| 2026-11-25 | JWT HS256 con `jose` y `JWT_SECRET`; sin consulta a BD por petición | Un solo servicio; el acceso revocado vale hasta 15 min (aceptado en §4.5) | Sonnet |
| 2026-11-25 | Refresh opaco de 32 bytes con SHA-256 en BD; rotación atómica con `UPDATE ... WHERE rotated_at IS NULL` | Alta entropía basta con hash rápido; atomicidad evita carreras; reutilización revoca la familia | Sonnet |
| 2026-11-25 | Sin periodo de gracia en la rotación; la app serializa renovaciones con un cerrojo | Simplicidad y seguridad; el caso legítimo concurrente lo evita el cliente | Sonnet |
| 2026-11-25 | `@node-rs/argon2` con parámetros OWASP (19 MiB, t=2, p=1) | Binarios precompilados, sin `node-gyp` en Windows/Docker | Sonnet |
| 2026-11-25 | Contraseña: mínimo 10, máximo 128, lista de ~1000 comunes, sin reglas de composición | NIST 800-63B; la spec delega la política en el plan | Sonnet |
| 2026-11-25 | El cliente genera un UUIDv7 de dispositivo en cada login y lo borra al cerrar sesión | Un id de dispositivo nunca pasa entre usuarios; coherente con IDs de cliente | Sonnet |
| 2026-11-25 | Cerrar sesión borra la familia y el dispositivo; "cerrar todas" marca `revoked_at` | §4.5 ("cerrar sesión borra la sesión") y rastro mínimo para el resto | Sonnet |
| 2026-11-25 | Registro con correo duplicado: `409` genérico; usuario duplicado: mensaje claro | Spec pide no revelar datos de la cuenta existente; los usernames serán públicos. Fuga mínima aceptada, abierta a Manuel | Sonnet |
| 2026-11-25 | Limitador de frecuencia propio en memoria, por IP y correo; `X-Forwarded-For` solo con `TRUST_PROXY` | Una sola instancia en el VPS; sin dependencia ni Redis (YAGNI) | Sonnet |
| 2026-11-25 | Interfaz `Mailer` con `SmtpMailer` (nodemailer), `ResendMailer` (fetch, sin SDK) y `FakeMailer`; envío sin bloquear la respuesta | Principio V y FR-014; un SMTP lento no frena el registro | Sonnet |
| 2026-11-25 | Verificación consume el token en el `GET`; recuperación usa formulario con `POST` | Enlaces servidos por la API sin deep linking (supuesto de la spec) | Sonnet |
| 2026-11-25 | Contrato: `@hono/zod-openapi` → `openapi.json` versionado + test de actualidad; modelos Dart con `swagger_parser` | Principio VIII; `swagger_parser` es Dart puro y no exige Java | Sonnet |
| 2026-11-25 | La app no usa `drift` en esta spec: tokens en almacenamiento seguro, perfil en `shared_preferences` | Alcance mínimo; `drift` llega con la sincronización (spec 002) | Sonnet |
| 2026-11-25 | Proxy Caddy con Let's Encrypt; despliegue por SSH con migraciones en un `run --rm` previo | Certificados automáticos sin coste; migrar antes de reiniciar | Sonnet |
| 2026-11-25 | Tareas con `[OPUS]`: T004 (esquema de datos nuevo) y T009 (rotación de refresh tokens), esta última por decisión de Manuel. Recomendado revisar `data-model.md` con Opus antes de implementarlo | Regla: cambios de esquema los decide/revisa el Director con Opus | Sonnet |
