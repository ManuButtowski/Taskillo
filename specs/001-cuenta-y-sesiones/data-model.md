# Modelo de datos · 001 Cuenta y sesiones

Parte del esquema de `docs/especificacion.md` §5.2, recortado a la Fase 1 y a esta spec
(principio VI). IDs UUIDv7 generados en el cliente cuando los crea el cliente (`devices`);
en el servidor para `users`, `sessions` y `email_tokens`.

**Ninguna de estas tablas es sincronizable** (no hay `version`, `server_seq` ni `deleted_at`),
así que esta spec no crea `sync_seq` ni disparadores; llegan en la spec 002.

## Migración 0000

```sql
CREATE EXTENSION IF NOT EXISTS citext;
```

## users

| Columna | Tipo | Notas |
| :--- | :--- | :--- |
| id | UUID PK | UUIDv7 generado en el servidor |
| email | CITEXT UNIQUE NOT NULL | |
| email_verified_at | TIMESTAMPTZ | NULL hasta verificar |
| password_hash | TEXT | Argon2id; la columna admite NULL (cuentas solo-Google en Fase 2) pero en esta spec siempre se rellena |
| username | CITEXT UNIQUE NOT NULL | 3-30 caracteres, `[a-z0-9_]` (sin distinguir mayúsculas) |
| display_name | VARCHAR(100) NOT NULL | |
| timezone | VARCHAR(64) NOT NULL DEFAULT 'Europe/Madrid' | IANA |
| created_at, updated_at | TIMESTAMPTZ NOT NULL DEFAULT now() | `updated_at` lo actualiza la aplicación |

Sin `google_sub`, `avatar_key`, columnas de racha, `social_enabled`, `share_schedule` ni
`assistant_llm_opt_in` (fases 2-5).

## devices

| Columna | Tipo | Notas |
| :--- | :--- | :--- |
| id | UUID PK | generado en el cliente en cada inicio de sesión |
| user_id | UUID NOT NULL FK users ON DELETE CASCADE | |
| platform | VARCHAR(10) NOT NULL CHECK IN ('android','windows','linux','macos') | |
| name | VARCHAR(100) | p. ej. "PC de Manuel" |
| last_sync_seq | BIGINT NOT NULL DEFAULT 0 | lo usa la spec 002 |
| last_seen_at | TIMESTAMPTZ NOT NULL DEFAULT now() | se actualiza al renovar token |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |

Sin `fcm_token` (Fase 2).

## sessions

Como §5.2, sin cambios: `id`, `user_id`, `device_id` (FK ON DELETE CASCADE), `family_id`,
`refresh_token_hash` UNIQUE, `expires_at`, `rotated_at`, `revoked_at`, `created_at`.
Índice parcial `idx_sessions_user ON sessions(user_id) WHERE revoked_at IS NULL`.
Se añade el índice `idx_sessions_family ON sessions(family_id)` para revocar y borrar
familias.

Una fila por cada refresh token emitido; al rotar se marca `rotated_at` en la anterior y se
inserta la nueva con el mismo `family_id` y `device_id`.

## email_tokens (nueva; decisión del Director)

| Columna | Tipo | Notas |
| :--- | :--- | :--- |
| id | UUID PK | |
| user_id | UUID NOT NULL FK users ON DELETE CASCADE | |
| type | VARCHAR(20) NOT NULL CHECK IN ('verify_email','reset_password') | |
| token_hash | TEXT UNIQUE NOT NULL | SHA-256 del token en claro |
| expires_at | TIMESTAMPTZ NOT NULL | 24 h (verificación), 1 h (recuperación) |
| used_at | TIMESTAMPTZ | NULL = pendiente |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |

Índice `idx_email_tokens_user_type ON email_tokens(user_id, type) WHERE used_at IS NULL`.

Un token nuevo marca `used_at` en los pendientes anteriores del mismo `(user_id, type)`.
Limpieza de filas caducadas: fuera de alcance (deuda técnica anotada para la spec 002, que
añade las tareas de purga).

## Reglas de validación

- Correo: formato válido, minúsculas al guardar, máximo 254.
- Nombre de usuario: `^[a-z0-9_]{3,30}$` tras pasar a minúsculas.
- Nombre visible: 1-100 caracteres tras recortar espacios.
- Contraseña: ver `research.md`.
