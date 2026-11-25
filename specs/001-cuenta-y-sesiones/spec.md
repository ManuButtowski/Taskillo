# Feature Specification: Cuenta y sesiones

**Feature Branch**: `001-cuenta-y-sesiones`

**Created**: 2026-11-25

**Status**: Draft

**Fase**: 1 (MVP) · **Módulo**: M01 (parte de Fase 1) · **Fuente**: `docs/especificacion.md` §3 M01, §4.5, §5.2 (`users`, `devices`, `sessions`)

**Input**: Registro en dos pasos con verificación del correo, inicio de sesión con correo y contraseña, recuperación de contraseña, perfil básico y gestión de sesiones por dispositivo. Esta spec también deja montada la base del monorepo (API, app, contrato, Docker Compose y CI) sobre la que se construyen las demás.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Crear cuenta e iniciar sesión (Priority: P1)

Manuel instala Taskillo en el PC y escribe su correo. Recibe un código, lo escribe en la app
junto a un nombre de usuario, un nombre visible y una contraseña, y entra con la cuenta ya
verificada. Después instala la app en el móvil e inicia sesión con la misma cuenta.

*Registro en dos pasos: decisión de Manuel (2026-11-26), para no revelar nunca si un correo
tiene cuenta.*

**Why this priority**: sin cuenta no hay sincronización entre PC y Android, que es la razón
de ser del MVP.

**Independent Test**: registrar una cuenta en el PC con el código recibido en Mailpit,
cerrar la app, volver a abrirla (sigue dentro) e iniciar sesión en Android con las mismas
credenciales.

**Acceptance Scenarios**:

1. **Given** un correo cualquiera, **When** se pide registrarlo (paso 1), **Then** la app
   muestra siempre el mismo mensaje ("te hemos enviado un correo"), tenga o no cuenta, y la
   respuesta de la API es idéntica en los dos casos.
2. **Given** un correo no registrado, **When** el usuario escribe el código recibido, un
   nombre de usuario, un nombre visible y una contraseña válida (paso 2), **Then** la cuenta
   se crea con el correo ya verificado y la sesión queda iniciada en ese dispositivo.
3. **Given** un correo ya registrado, **When** alguien pide registrarlo, **Then** no se crea
   nada y al titular le llega un correo "ya tienes cuenta: inicia sesión o recupera la
   contraseña".
4. **Given** un código erróneo, caducado (30 min), ya usado o con 5 intentos fallidos,
   **When** se envía el paso 2, **Then** se rechaza con el mismo error en todos los casos y
   el usuario puede pedir un código nuevo repitiendo el paso 1.
5. **Given** una cuenta existente, **When** el usuario inicia sesión en otro dispositivo con
   las credenciales correctas, **Then** entra y ese dispositivo queda registrado con su
   plataforma (`windows` o `android`).
6. **Given** una contraseña incorrecta, **When** el usuario intenta entrar, **Then** ve un
   error genérico ("correo o contraseña incorrectos") y no se revela si el correo existe.
7. **Given** una sesión iniciada, **When** el usuario cierra y reabre la app (incluso sin
   conexión), **Then** sigue dentro sin volver a escribir la contraseña.

---

### User Story 2 - Recuperar la contraseña (Priority: P2)

Si el usuario olvida la contraseña, pide un enlace de recuperación y elige una nueva. (La
verificación del correo ya no es un paso aparte: va dentro del registro, US1.)

**Why this priority**: la recuperación evita perder la cuenta.

**Independent Test**: en local, recibir el correo en Mailpit y completar el flujo. Cuando exista el buzón `no-reply@devkomp.es`, repetirlo con el SMTP de IONOS.

**Acceptance Scenarios**:

1. **Given** un correo cualquiera, **When** se pide recuperar la contraseña, **Then** la
   respuesta es la misma exista o no la cuenta; si existe, llega un enlace de un solo uso.
2. **Given** un enlace de recuperación caducado (1 h) o ya usado, **When** se abre o se
   envía, **Then** se muestra un error y la opción de pedir otro.
3. **Given** un enlace de recuperación válido, **When** el usuario fija una contraseña nueva,
   **Then** la contraseña cambia y se revocan todas las sesiones de la cuenta.

---

### User Story 3 - Gestionar perfil y sesiones (Priority: P2)

El usuario cambia su nombre visible o su contraseña, ve en qué dispositivos tiene la sesión
abierta y cierra la sesión en uno o en todos.

**Why this priority**: es un criterio de aceptación del MVP ("cerrar sesión en todos los
dispositivos invalida el refresh token de los demás") y protege la cuenta si se pierde el
móvil.

**Independent Test**: con sesión en PC y Android, cerrar todas desde el PC y comprobar que
el móvil pierde el acceso en su siguiente renovación de token.

**Acceptance Scenarios**:

1. **Given** una sesión iniciada, **When** el usuario cambia su nombre visible, **Then** el
   cambio se guarda y se ve en todos sus dispositivos.
2. **Given** una cuenta con contraseña, **When** el usuario la cambia indicando la actual,
   **Then** la contraseña cambia y se revocan las demás sesiones, no la del dispositivo
   actual.
3. **Given** sesiones en PC y Android, **When** el usuario elige "Cerrar sesión en todos los
   dispositivos", **Then** los refresh tokens de todas las sesiones dejan de valer y el otro
   dispositivo vuelve a la pantalla de inicio de sesión al intentar renovar.
4. **Given** una sesión iniciada, **When** el usuario cierra sesión solo en ese dispositivo,
   **Then** se borra su sesión y los datos locales de la cuenta de ese dispositivo.

---

### User Story 4 - Rotación segura de tokens (Priority: P1)

Sin que el usuario lo note, la app renueva el token de acceso cada 15 minutos con un
refresh token que cambia en cada uso. Si alguien reutiliza un refresh token ya usado
(posible robo), se revoca toda la cadena de esa sesión.

**Why this priority**: es la base de seguridad de toda la API.

**Independent Test**: test de integración de la API que usa un refresh token dos veces y
comprueba que la segunda falla y revoca la familia.

**Acceptance Scenarios**:

1. **Given** un refresh token válido, **When** se usa para renovar, **Then** se emite un
   token de acceso nuevo y un refresh token nuevo, y el anterior queda marcado como rotado.
2. **Given** un refresh token ya rotado, **When** se vuelve a usar, **Then** la petición
   falla y se revocan todas las sesiones de esa familia.
3. **Given** un token de acceso caducado, **When** la app hace una petición, **Then** la app
   renueva el token de forma transparente y repite la petición una vez.

### Edge Cases

- El servidor no responde o tarda (VPS caído o en despliegue): el registro y el login
  muestran un estado de espera o error claro, sin bloquear la app si ya había sesión.
- Sin conexión y con sesión iniciada: la app abre con normalidad; la renovación del token
  se pospone hasta que vuelva la red.
- Sin conexión y sin sesión: el registro y el login muestran que hace falta conexión.
- Nombre de usuario ya en uso (sin distinguir mayúsculas): error claro en el paso 2 del
  registro, sin gastar el código.
- El correo llega a otro dispositivo (código en el móvil, app en el PC): el código es corto
  (8 caracteres, `ABCD-EFGH`) para poder escribirlo a mano.
- Contraseña demasiado corta o demasiado común: se rechaza con un mensaje que explica la
  regla.
- Muchos intentos de login fallidos seguidos desde la misma IP o al mismo correo: se
  limitan para frenar ataques de fuerza bruta.
- La zona horaria del dispositivo se guarda en `users.timezone` al registrarse; por
  defecto `Europe/Madrid`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema MUST permitir registrarse en dos pasos: (1) el usuario da solo su
  correo; (2) con el código recibido da nombre de usuario, nombre visible y contraseña, y
  la cuenta se crea con el correo ya verificado. El correo y el nombre de usuario son
  únicos sin distinguir mayúsculas.
- **FR-002**: El sistema MUST guardar las contraseñas solo como hash Argon2id.
- **FR-003**: El paso 1 del registro MUST responder igual exista o no una cuenta con ese
  correo. Si no existe, envía un código de un solo uso que caduca a los 30 minutos y admite
  5 intentos fallidos; si existe, envía un aviso "ya tienes cuenta" con el camino para
  iniciar sesión o recuperar la contraseña. Repetir el paso 1 sustituye el código anterior.
  El nombre de usuario ocupado solo se indica en el paso 2, tras validar el código.
- **FR-004**: El sistema MUST permitir recuperar la contraseña con un enlace de un solo
  uso, sin revelar si el correo está registrado.
- **FR-005**: El sistema MUST emitir un token de acceso JWT de 15 minutos y un refresh
  token opaco de 30 días por sesión, y guardar en la base de datos solo el hash del
  refresh token.
- **FR-006**: El sistema MUST rotar el refresh token en cada uso y, si se reutiliza uno ya
  rotado, revocar todas las sesiones de su familia.
- **FR-007**: El sistema MUST permitir cerrar sesión en el dispositivo actual y en todos
  los dispositivos.
- **FR-008**: Cambiar o recuperar la contraseña MUST revocar las demás sesiones.
- **FR-009**: El sistema MUST registrar cada dispositivo (plataforma y nombre) al iniciar
  sesión y asociarle su sesión.
- **FR-010**: La app MUST guardar el refresh token en el almacenamiento seguro del sistema
  (Android Keystore / almacén de credenciales de Windows).
- **FR-011**: La app MUST abrir sin conexión si hay una sesión guardada.
- **FR-012**: El usuario MUST poder cambiar su nombre visible y su contraseña.
- **FR-013**: El sistema MUST limitar la frecuencia de intentos de login, de los dos pasos
  del registro y de la recuperación.
- **FR-014**: El correo transaccional MUST enviarse a través de una interfaz propia de
  envío con dos implementaciones: SMTP (la de uso: `smtp.ionos.es:587` con STARTTLS desde
  `no-reply@devkomp.es`) y Resend (alternativa). La implementación y sus credenciales se
  eligen con variables de entorno, sin tocar el código. En desarrollo, el SMTP apunta a
  Mailpit en Docker Compose.
- **FR-015** *(base del monorepo)*: El repositorio MUST quedar con `apps/api` (Hono +
  Drizzle), `apps/app` (Flutter, Windows + Android), `packages/contrato` (OpenAPI generado
  desde Zod), `docker-compose.yml` (PostgreSQL 16 + API) y un flujo de GitHub Actions que
  ejecuta los tests y compila el APK en Linux.
- **FR-016** *(despliegue)*: Un flujo de GitHub Actions MUST desplegar la API en el VPS IONOS
  de DEVKOMP: construir la imagen Docker, publicarla en GitHub Container Registry, entrar
  por SSH con una clave dedicada y ejecutar `docker compose pull && docker compose up -d`,
  aplicando las migraciones. La API queda tras un proxy con HTTPS en un subdominio de
  `devkomp.es`. La base de datos sigue en Neon.
- **FR-017** *(secretos)*: Ningún secreto MUST estar en el repositorio. El repositorio
  incluye `.env.example` con todas las variables; los valores reales van en `.env` local,
  en los secretos de GitHub y en el `.env` del VPS.

### Key Entities

- **Usuario** (`users`): correo, nombre de usuario, nombre visible, hash de contraseña,
  fecha de verificación del correo (se rellena al crearla) y zona horaria. Las columnas de fases posteriores
  (racha, social, asistente, Google, avatar) no se crean en esta spec.
- **Dispositivo** (`devices`): pertenece a un usuario; plataforma, nombre, último cursor de
  sincronización y última vez visto.
- **Sesión** (`sessions`): pertenece a un usuario y a un dispositivo; familia de rotación,
  hash del refresh token, caducidad, fecha de rotación y de revocación.
- **Token de un solo uso** (código de registro y enlace de recuperación): correo al que se
  envió, usuario (vacío en el registro), hash del token, tipo, intentos, caducidad y fecha
  de uso. El esquema de la especificación no lo detalla; el Director lo fija en
  `data-model.md`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un usuario nuevo crea su cuenta y entra en la app en menos de 2 minutos,
  incluido recibir el código y escribirlo (antes 1 minuto, con un solo paso).
- **SC-002**: Tras "cerrar sesión en todos los dispositivos", ningún refresh token anterior
  vale (criterio de aceptación del MVP, §6.3).
- **SC-003**: Reutilizar un refresh token rotado revoca su familia en el 100 % de los tests.
- **SC-004**: La app abre sin conexión con sesión guardada en menos de 2 segundos.
- **SC-005**: Ninguna respuesta de la API ni ningún log contiene contraseñas, hashes o
  tokens en claro.

## Assumptions

- Mientras Rafa no cree el buzón `no-reply@devkomp.es` ni el subdominio de la API, todo se
  prueba en local (Mailpit y Docker Compose). El despliegue (FR-016) puede quedar listo y
  probarse en cuanto estén el subdominio y el usuario SSH.
- Antes de enviar correos a otras personas se comprueban SPF, DKIM y DMARC de
  `devkomp.es`.
- El enlace de recuperación abre una página sencilla servida por la API, y el registro usa
  un código que se escribe en la app; no hace falta "deep linking" en la app para el MVP.
- La política de contraseña mínima (longitud y lista de contraseñas comunes) la fija el
  Director en el plan.
- Login con Google, foto de perfil y "Recomendar Taskillo" quedan para la Fase 2.
