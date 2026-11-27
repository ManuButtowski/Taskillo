# Modelo de datos · 001 Cuenta y sesiones

Parte del esquema de `docs/especificacion.md` §5.2, recortado a la Fase 1 y a esta spec
(principio VI). Revisado con Opus el 2026-11-25 (ver `decisiones.md`). **El SQL de abajo es
la referencia**: el esquema Drizzle (T004) debe generar una migración equivalente; cualquier
desviación se consulta al Director.

**Ninguna de estas tablas es sincronizable** (no hay `version`, `server_seq` ni `deleted_at`),
así que esta spec no crea `sync_seq` ni disparadores; llegan en la spec 002. Ninguna tabla
sincronizable futura referencia a `devices` ni a `sessions`, de modo que borrar dispositivos
o sesiones nunca afecta a la sincronización.

## Convenciones de esta spec

- **IDs UUIDv7.** PostgreSQL 16 no tiene `uuidv7()` (llega en la 18), así que **ninguna
  columna `id` tiene `DEFAULT` en la base de datos**: la API los genera con la función `v7`
  del paquete `uuid` (gratuito) mediante `$defaultFn` de Drizzle. `devices.id` lo genera el
  cliente (Dart, paquete `uuid`); la API lo valida como UUID.
- **Tiempo.** Todas las columnas de fecha son `TIMESTAMPTZ`. En Drizzle se declaran con
  `timestamp(..., { withTimezone: true })` (el valor por defecto de Drizzle es *sin* zona y
  no vale). La conexión fija `TimeZone=UTC`. Las caducidades y comparaciones se calculan
  **en SQL con `now()`** (`now() + interval '30 days'`, `expires_at > now()`), no con el reloj
  de Node, para que un desfase entre la API y Neon no abra ni cierre ventanas.
- **Hashes.** Solo se guardan hashes SHA-256 en hexadecimal en minúsculas (64 caracteres);
  un `CHECK` lo impone, así que guardar un token en claro por error falla en la base de
  datos (refuerza SC-005).
- **Sin `UPSERT` sobre filas de identidad.** Nunca `ON CONFLICT DO UPDATE` en `users`,
  `devices` ni `sessions`: un id de dispositivo enviado por el cliente que ya existe es un
  conflicto (`409 device_id_conflict`), nunca una reasignación.
- **Migraciones.** Solo `drizzle-kit generate` + `migrate.ts`; nunca `drizzle-kit push`.
  `CREATE EXTENSION` no lo genera drizzle-kit: va al principio de la 0000 (migración
  personalizada o añadida a mano antes del primer `CREATE TABLE`). Los nombres de
  restricciones de abajo se fijan explícitamente para que los tests los puedan comprobar.

## Migración 0000

```sql
CREATE EXTENSION IF NOT EXISTS citext;

-- 1. USUARIOS
CREATE TABLE users (
    id                 UUID PRIMARY KEY,                       -- UUIDv7, API
    email              CITEXT NOT NULL,
    email_verified_at  TIMESTAMPTZ,                            -- now() al crear (registro en dos pasos)
    password_hash      TEXT NOT NULL,                          -- Argon2id; pasa a NULL-able en Fase 2 (Google)
    username           CITEXT NOT NULL,
    display_name       VARCHAR(100) NOT NULL,
    timezone           VARCHAR(64) NOT NULL DEFAULT 'Europe/Madrid',  -- IANA, validada en la API
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),     -- lo actualiza la API
    CONSTRAINT users_email_key    UNIQUE (email),
    CONSTRAINT users_username_key UNIQUE (username),
    CONSTRAINT users_email_chk CHECK (
        char_length(email::text) <= 254
        AND email::text = lower(email::text)
        AND strpos(email::text, '@') > 1),
    CONSTRAINT users_username_chk CHECK (username::text ~ '^[a-z0-9_]{3,30}$'),
    CONSTRAINT users_display_name_chk CHECK (
        char_length(display_name) BETWEEN 1 AND 100
        AND display_name = btrim(display_name)),
    CONSTRAINT users_password_hash_chk CHECK (password_hash LIKE '$argon2id$%')
);

-- 2. DISPOSITIVOS
CREATE TABLE devices (
    id             UUID PRIMARY KEY,                           -- generado en el cliente
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform       VARCHAR(10) NOT NULL,
    name           VARCHAR(100),
    last_sync_seq  BIGINT NOT NULL DEFAULT 0,                  -- lo usa la spec 002
    last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT devices_platform_chk CHECK (platform IN ('android','windows','linux','macos')),
    CONSTRAINT devices_last_sync_seq_chk CHECK (last_sync_seq >= 0),
    CONSTRAINT devices_id_user_key UNIQUE (id, user_id)        -- destino de la FK compuesta
);
CREATE INDEX idx_devices_user ON devices(user_id);

-- 3. SESIONES (una fila por refresh token emitido)
CREATE TABLE sessions (
    id                  UUID PRIMARY KEY,                      -- UUIDv7, API
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id           UUID NOT NULL,
    family_id           UUID NOT NULL,                         -- cadena de rotación (UUIDv7, API)
    refresh_token_hash  TEXT NOT NULL,                         -- SHA-256 hex, nunca el token
    expires_at          TIMESTAMPTZ NOT NULL,                  -- now() + 30 días al emitir
    rotated_at          TIMESTAMPTZ,                           -- no NULL = ya se usó
    revoked_at          TIMESTAMPTZ,                           -- no NULL = revocada
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT sessions_refresh_token_hash_key UNIQUE (refresh_token_hash),
    CONSTRAINT sessions_device_fk FOREIGN KEY (device_id, user_id)
        REFERENCES devices(id, user_id) ON DELETE CASCADE,
    CONSTRAINT sessions_refresh_token_hash_chk CHECK (refresh_token_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT sessions_expires_chk CHECK (expires_at > created_at)
);
-- Como mucho UN token vivo por familia: impone la rotación atómica (hay que marcar
-- rotated_at en el anterior antes de insertar el nuevo, en la misma transacción).
CREATE UNIQUE INDEX uq_sessions_family_live ON sessions(family_id)
    WHERE rotated_at IS NULL AND revoked_at IS NULL;
-- Sesiones vivas del usuario ("cerrar todas", lista de dispositivos).
CREATE INDEX idx_sessions_user_live ON sessions(user_id)
    WHERE rotated_at IS NULL AND revoked_at IS NULL;
-- Revocar o borrar una familia entera.
CREATE INDEX idx_sessions_family ON sessions(family_id);
-- Cascada desde devices (sin índice, cada borrado de dispositivo recorre la tabla).
CREATE INDEX idx_sessions_device ON sessions(device_id);

-- 4. TOKENS DE CORREO (decisión del Director; no está en §5.2)
--    register: código del paso 1 del registro (aún no hay usuario; user_id NULL).
--    reset_password: enlace de recuperación de una cuenta existente.
CREATE TABLE email_tokens (
    id          UUID PRIMARY KEY,                              -- UUIDv7, API
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,   -- NULL solo en 'register'
    email       CITEXT NOT NULL,                               -- dirección a la que se envió
    type        VARCHAR(20) NOT NULL,
    token_hash  TEXT NOT NULL,                                 -- SHA-256 hex (ver "Tokens de correo")
    attempts    SMALLINT NOT NULL DEFAULT 0,                   -- intentos fallidos ('register')
    expires_at  TIMESTAMPTZ NOT NULL,                          -- 30 min registro, 1 h recuperación
    used_at     TIMESTAMPTZ,                                   -- NULL = pendiente; también marca "invalidado"
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT email_tokens_token_hash_key UNIQUE (token_hash),
    CONSTRAINT email_tokens_type_chk CHECK (type IN ('register','reset_password')),
    CONSTRAINT email_tokens_user_type_chk CHECK ((type = 'register') = (user_id IS NULL)),
    CONSTRAINT email_tokens_email_chk CHECK (email::text = lower(email::text)),
    CONSTRAINT email_tokens_token_hash_chk CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT email_tokens_attempts_chk CHECK (attempts BETWEEN 0 AND 5),
    CONSTRAINT email_tokens_expires_chk CHECK (expires_at > created_at)
);
-- Índice completo (no parcial) para que también lo use la cascada desde users.
CREATE INDEX idx_email_tokens_user_type ON email_tokens(user_id, type);
-- Como mucho UN código de registro pendiente por correo (el paso 2 lo busca por correo).
CREATE UNIQUE INDEX uq_email_tokens_register_pending ON email_tokens(email)
    WHERE type = 'register' AND used_at IS NULL;
```

`users.email_verified_at` se rellena con `now()` al crear la cuenta (el paso 2 del registro
ya prueba la posesión del correo). La columna sigue admitiendo NULL como en §5.2, por
compatibilidad con la Fase 2 (vincular Google exige correo verificado) y con un futuro
cambio de correo; en esta spec nunca queda a NULL.

Columnas de fases posteriores que **no** se crean: `users.google_sub`, `avatar_key`,
racha, `social_enabled`, `share_schedule`, `assistant_llm_opt_in`; `devices.fcm_token`.

Diferencias con §5.2 (todas compatibles con lo que viene): `password_hash NOT NULL` (en la
Fase 2 se hace `DROP NOT NULL` y el `CHECK` pasa a `password_hash IS NULL OR ...`);
`sessions.device_id NOT NULL` con FK compuesta `(device_id, user_id)`; índice parcial de
sesiones vivas que excluye también las rotadas; índices y `CHECK` añadidos.

## Ciclo de vida de sesiones y dispositivos

- **Invariante:** un dispositivo ↔ una familia. El paso 2 del registro y el login crean el dispositivo y una
  familia nueva (`family_id` UUIDv7 de la API); la rotación conserva `family_id` y
  `device_id`. Lo garantiza el código y lo comprueba un test de T009.
- **Token vivo:** `rotated_at IS NULL AND revoked_at IS NULL AND expires_at > now()`.
- **Dispositivo activo:** el que tiene un token vivo. `GET /me/sessions` (y, en la Fase 2,
  el envío de FCM) solo usan dispositivos activos.
- **Caducidad deslizante:** cada token nuevo vale 30 días desde su emisión; un dispositivo
  que se usa al menos una vez al mes no caduca nunca.
- **Rotar** (T009, una transacción en `READ COMMITTED`, el nivel por defecto):
  1. `UPDATE sessions SET rotated_at = now() WHERE refresh_token_hash = $1 AND rotated_at IS
     NULL AND revoked_at IS NULL AND expires_at > now() RETURNING id, user_id, device_id,
     family_id`.
  2. Si devuelve fila: `INSERT` de la nueva (mismo `user_id`, `device_id`, `family_id`;
     `expires_at = now() + interval '30 days'`), `UPDATE devices SET last_seen_at = now()`,
     `COMMIT`.
  3. Si no devuelve fila: `SELECT family_id, rotated_at FROM sessions WHERE
     refresh_token_hash = $1`. Si existe y `rotated_at IS NOT NULL` → **reutilización**:
     `UPDATE sessions SET revoked_at = now() WHERE family_id = $2 AND revoked_at IS NULL` y
     se **confirma** esa revocación antes de responder `401` (no puede quedar dentro de una
     transacción que se deshace al lanzar el error). En cualquier otro caso (no existe,
     revocado o caducado sin rotar), `401` sin más.
  - Dos rotaciones simultáneas con el mismo token: la segunda espera al bloqueo de fila de
    la primera, su `UPDATE` no encuentra fila y el paso 3 (otra sentencia, que ya ve la fila
    nueva confirmada) revoca la familia entera, incluida la recién emitida. Con
    `REPEATABLE READ` o `SERIALIZABLE` esto daría error de serialización: no usarlos aquí.
- **Cerrar sesión** (`POST /auth/logout` y `DELETE /me/sessions/{deviceId}`):
  `DELETE FROM devices WHERE id = $1 AND user_id = $2`; la cascada borra todas sus filas de
  sesión. Un refresh de ese dispositivo pasa a "no existe" → `401`.
- **Cerrar todas / cambiar o recuperar contraseña:** `UPDATE sessions SET revoked_at = now()
  WHERE user_id = $1 AND revoked_at IS NULL` (con `AND family_id <> $actual` cuando se
  conserva la sesión actual). Se revocan también las filas rotadas, para que un token viejo
  no dispare nada raro. Los dispositivos se quedan sin token vivo y dejan de listarse.
- **Retención:** las filas rotadas o revocadas se conservan hasta su `expires_at` para
  poder detectar reutilizaciones. La purga de filas caducadas y de dispositivos sin token
  vivo es deuda técnica (llega con las tareas de purga de la spec 002). Con decenas de
  usuarios, unas 3000 filas por dispositivo activo en 30 días no son un problema.

## Tokens de correo

### Registro en dos pasos (decisión de Manuel, 2026-11-26)

Por qué en `email_tokens` y no en una tabla `pending_registrations`: en el paso 1 solo se
conoce el correo, así que no hay datos de cuenta pendientes que guardar (ni hash de
contraseña ni nombre de usuario): la fila pendiente es exactamente un token ligado a una
dirección. Comparte ciclo de vida con la recuperación (crear invalidando el anterior,
consumir atómico, caducar) y un solo servicio (`auth/email-tokens.ts`) cubre ambos. El
coste es `user_id` NULL-able, acotado por el `CHECK` `email_tokens_user_type_chk`. La
columna `email` liga también los enlaces de recuperación a la dirección a la que se
enviaron.

- **Paso 1** (`POST /auth/register`, solo correo). Siempre `202` con el mismo cuerpo.
  - Correo **sin cuenta**: en una transacción, `UPDATE email_tokens SET used_at = now()
    WHERE email = $1 AND type = 'register' AND used_at IS NULL` e `INSERT` del nuevo con
    `expires_at = now() + interval '30 minutes'`. Se envía un correo con el **código**.
  - Correo **con cuenta**: no se escribe nada; se envía el correo "Ya tienes una cuenta:
    inicia sesión o recupera la contraseña".
  - Los dos casos hacen el mismo trabajo visible (una consulta y un envío sin esperar), para
    no dar pistas por el tiempo de respuesta. Si dos peticiones simultáneas chocan en
    `uq_email_tokens_register_pending`, la perdedora responde el mismo `202` sin enviar.
  - De paso se borran los `register` caducados hace más de 24 h (`DELETE ... WHERE type =
    'register' AND expires_at < now() - interval '1 day'`): son correos de personas sin
    cuenta y no se guardan más de lo necesario.
- **Código.** 8 caracteres del alfabeto Crockford base32 (sin `I`, `L`, `O`, `U`; unos 40
  bits), mostrado como `ABCD-EFGH` para copiarlo a mano entre el móvil y el PC (no hay
  "deep linking" en el MVP). Se guarda `token_hash = sha256_hex(email + ':' + código)`, de
  modo que dos correos con el mismo código no chocan en el `UNIQUE`. No es adivinable:
  hace falta el correo, la fila caduca a los 30 min y admite 5 intentos fallidos.
- **Paso 2** (`POST /auth/register/complete`, con correo, código y datos de la cuenta), en una
  transacción:
  1. `SELECT ... FROM email_tokens WHERE email = $1 AND type = 'register' AND used_at IS
     NULL AND expires_at > now() FOR UPDATE`.
  2. Si no hay fila, o el hash no coincide (comparación en tiempo constante): `attempts =
     attempts + 1` (y `used_at = now()` al llegar a 5), se **confirma** y se responde
     `400 invalid_code`, igual en todos los casos.
  3. Si coincide: se validan los datos; `INSERT` en `users` (con `email_verified_at =
     now()`), `devices` y `sessions`, y `used_at = now()` en el token. Un `username` ocupado
     deshace la transacción y responde `409 username_taken` **sin gastar el código ni
     contar intento** (el usuario prueba otro nombre). Un correo que se registró entre el
     paso 1 y el 2 (`users_email_key`) responde `409 email_taken`: ya hay prueba de
     posesión, así que no es una fuga.
  - El código se comprueba **antes** que el nombre de usuario: sin poseer el correo, el
    endpoint no sirve para averiguar qué nombres están ocupados.

### Recuperación de contraseña

- **Crear** (una transacción): `UPDATE email_tokens SET used_at = now() WHERE user_id = $1
  AND type = 'reset_password' AND used_at IS NULL`, después `INSERT` con `email` del usuario
  y `expires_at = now() + interval '1 hour'`. Token de 32 bytes en base64url en el enlace.
- **Consumir** (atómico y **siempre con el tipo**, para que un código de registro no sirva
  para recuperar la contraseña): `UPDATE email_tokens SET used_at = now() WHERE token_hash =
  $1 AND type = 'reset_password' AND used_at IS NULL AND expires_at > now() RETURNING
  user_id, email`; si `email` ya no coincide con `users.email`, se rechaza.
- **Al cambiar o recuperar la contraseña** se invalidan (`used_at = now()`) los
  `reset_password` pendientes del usuario.
- Limpieza de filas `reset_password` caducadas: deuda técnica (spec 002).

## Borrado de cuenta

Fuera del alcance de esta spec. El esquema ya lo deja en un solo `DELETE FROM users WHERE
id = $1`: todo cuelga de `users` con `ON DELETE CASCADE` (también las tablas futuras de
§5.2). Los códigos `register` no cuelgan de ningún usuario y se purgan por caducidad.

## Reglas de validación (API, Zod)

- Correo: formato válido, recortado y en minúsculas antes de guardar, máximo 254.
- Nombre de usuario: `^[a-z0-9_]{3,30}$` tras pasar a minúsculas.
- Nombre visible: 1-100 caracteres tras recortar espacios.
- Zona horaria: identificador IANA aceptado por `Intl.DateTimeFormat` (si no, `422`); si
  no llega, `Europe/Madrid`.
- Dispositivo: `id` UUID, `platform` del `CHECK`, `name` opcional de 1-100 caracteres.
- Código de registro: se normaliza (mayúsculas, sin guion ni espacios; `I`/`L` → `1`, `O` →
  `0`) y debe tener 8 caracteres Crockford base32; si no, cuenta como intento fallido.
- Contraseña: ver `research.md`.
