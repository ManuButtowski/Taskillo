# Feature Specification: Grupos y sincronización

**Feature Branch**: `002-grupos-y-sincronizacion`

**Created**: 2026-11-25

**Status**: Draft

**Fase**: 1 (MVP) · **Módulos**: M02 (parte de Fase 1) y M05 · **Fuente**: `docs/especificacion.md` §3 M02 y M05, §5.1, §5.2 (`task_groups`), §5.4

**Input**: Grupos con nombre, color e icono, y el motor de sincronización local-first entre PC y Android (SQLite local, cola de cambios, `push`/`pull` por cursor, borrado lógico y conflictos). Los grupos son la primera entidad que se sincroniza; las tareas, excepciones y completados de la spec 003 usan el mismo motor sin cambiarlo.

> **Por qué la sincronización va aquí y no al final:** en un diseño local-first toda
> escritura pasa por la cola de cambios. Si la sincronización llegara después de las
> tareas, habría que escribir primero una API REST por entidad y tirarla luego. Montando
> el motor con la entidad más sencilla (grupos), las specs 003 y 004 solo añaden tablas.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Crear y organizar grupos (Priority: P1)

El usuario crea grupos como Trabajo, Gimnasio o Estudios, les da un color y, si quiere, un
icono. Los ordena a su gusto, los edita y los borra.

**Why this priority**: el color del grupo identifica las tareas en la lista, el cuadrante y
el calendario.

**Independent Test**: crear tres grupos, reordenarlos, cambiar el color de uno y borrar
otro, todo sin conexión; al cerrar y reabrir la app siguen igual.

**Acceptance Scenarios**:

1. **Given** la pantalla de grupos, **When** el usuario crea uno con nombre y color,
   **Then** aparece al instante en la lista, aunque no haya conexión.
2. **Given** varios grupos, **When** el usuario cambia su orden, **Then** el nuevo orden se
   conserva y se ve igual en todos sus dispositivos.
3. **Given** un grupo con tareas, **When** el usuario lo borra, **Then** la app pregunta si
   borrar también sus tareas o dejarlas sin grupo, y hace lo elegido. *(Hasta que exista
   la spec 003 no hay tareas; la pregunta se implementa allí o aquí según decida el
   Director, pero el comportamiento queda fijado.)*
4. **Given** una tarea sin grupo, **When** se muestra, **Then** usa un color neutro.

---

### User Story 2 - Ver en un dispositivo lo que hice en el otro (Priority: P1)

Con el PC y el móvil abiertos, el usuario crea o cambia un grupo en uno y lo ve en el otro
en menos de 30 segundos, sin hacer nada.

**Why this priority**: es el criterio "completar en el PC se ve en el móvil en menos de
30 s con ambos abiertos" (§6.3), probado aquí con grupos.

**Independent Test**: dos dispositivos con la misma cuenta; crear un grupo en el PC y
cronometrar cuánto tarda en aparecer en Android.

**Acceptance Scenarios**:

1. **Given** PC y Android abiertos con conexión, **When** el usuario crea un grupo en el PC,
   **Then** aparece en Android en menos de 30 s.
2. **Given** la app en primer plano, **When** pasan 30 s, **Then** la app hace `pull` de
   los cambios nuevos.
3. **Given** la app se abre o recupera la conexión, **When** ocurre, **Then** sincroniza en
   ese momento, sin esperar al siguiente intervalo.
4. **Given** un cambio local, **When** se guarda, **Then** se intenta subir en ese momento.

---

### User Story 3 - Trabajar sin conexión (Priority: P1)

El usuario usa la app en el móvil sin conexión: crea, edita y borra grupos. Al volver la
red, todo llega al PC. Si mientras tanto borró algo en el PC, el móvil se entera al
reconectar.

**Why this priority**: local-first es un principio de la constitución y dos criterios de
aceptación del MVP dependen de ello.

**Independent Test**: modo avión en el móvil, tres cambios; borrar un grupo en el PC;
quitar el modo avión y comprobar ambos lados.

**Acceptance Scenarios**:

1. **Given** el móvil sin conexión, **When** el usuario hace varios cambios, **Then** se
   guardan en local y quedan en la cola, y la app funciona con normalidad.
2. **Given** cambios en cola, **When** vuelve la conexión, **Then** se suben en orden y el
   otro dispositivo los recibe.
3. **Given** un grupo borrado en el PC mientras el móvil estaba sin conexión, **When** el
   móvil reconecta, **Then** el grupo desaparece del móvil.
4. **Given** el servidor no responde o tarda, **When** la app sincroniza, **Then** muestra
   un indicador discreto de "sincronizando" y la app sigue usable.

---

### User Story 4 - Conflictos sin sorpresas (Priority: P2)

Si el usuario edita el mismo grupo en los dos dispositivos sin conexión, al reconectar
ambos acaban mostrando la misma versión: la última que llegó al servidor.

**Why this priority**: uso personal; basta con que nunca queden dos versiones distintas.

**Independent Test**: test de integración del protocolo con dos clientes simulados.

**Acceptance Scenarios**:

1. **Given** el mismo grupo editado en dos dispositivos sin conexión, **When** ambos suben
   sus cambios, **Then** gana el último en llegar al servidor y el otro dispositivo recibe
   esa versión final en su siguiente `pull`.
2. **Given** un cambio enviado con una `version` antigua, **When** el servidor lo aplica,
   **Then** devuelve la fila final para que el cliente la guarde.

### Edge Cases

- Un dispositivo lleva más de 90 días sin sincronizar (las filas borradas ya se purgaron):
  hace una resincronización completa.
- El mismo cambio llega dos veces (reintento tras un corte): aplicarlo de nuevo no cambia
  el resultado.
- Se corta la conexión a mitad de un `push`: los cambios no confirmados siguen en la cola.
- Un `pull` devuelve muchas filas: se pagina y el cursor solo avanza con lo ya guardado.
- Cerrar sesión en un dispositivo borra su base local y su cola.
- Un cliente intenta subir filas de otro usuario: el servidor las rechaza (cada consulta
  filtra por el `user_id` del token).

## Requirements *(mandatory)*

### Functional Requirements

**Grupos**

- **FR-001**: El usuario MUST poder crear, editar, reordenar y borrar grupos con nombre
  (hasta 80 caracteres), color (`#RRGGBB`) e icono opcional.
- **FR-002**: Borrar un grupo MUST hacerse por borrado lógico y, si tiene tareas, preguntar
  si borrarlas o dejarlas sin grupo.
- **FR-003**: Las columnas de privacidad (Fase 4) y de widget (Fase 2) NO se crean en esta
  spec.

**Sincronización**

- **FR-004**: Toda escritura MUST guardarse primero en la base local (SQLite con `drift`) y
  encolarse para el servidor.
- **FR-005**: Los IDs MUST generarse en el cliente como UUIDv7.
- **FR-006**: Toda tabla sincronizable MUST tener `updated_at`, `deleted_at`, `version` y
  `server_seq`, mantenidas en el servidor por un disparador común con la secuencia global
  `sync_seq`.
- **FR-007**: El servidor MUST ofrecer `POST /sync/push`, que recibe la cola de cambios
  (fila completa + `version` de partida) y devuelve la versión final de cada fila.
- **FR-008**: En conflicto de versiones, el servidor MUST aplicar igualmente el cambio
  (gana el último en llegar) sin fusionar campos.
- **FR-009**: El servidor MUST ofrecer `GET /sync/pull?since=<server_seq>`, que devuelve
  todas las filas del usuario con `server_seq` mayor, incluidas las borradas, y el nuevo
  cursor.
- **FR-010**: La app MUST sincronizar al abrir, al recuperar la conexión, tras cada cambio
  local y cada 30 s mientras está en primer plano.
- **FR-011**: El servidor MUST purgar las filas borradas hace más de 90 días, y un cliente
  con el cursor anterior a la purga MUST hacer una resincronización completa.
- **FR-012**: El motor de sincronización MUST ser genérico: añadir una tabla sincronizable
  (spec 003) no debe exigir cambiar el protocolo.
- **FR-013**: La app MUST mostrar un indicador discreto del estado de sincronización
  (sincronizado, sincronizando, sin conexión, error).

### Key Entities

- **Grupo** (`task_groups`): pertenece a un usuario; nombre, color, icono, orden y
  columnas de sincronización.
- **Cambio en cola** (solo en el cliente): entidad, fila, operación, `version` de partida y
  fecha.
- **Cursor de sincronización**: último `server_seq` recibido por cada dispositivo
  (`devices.last_sync_seq` en el servidor y su copia en el cliente).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un cambio hecho en un dispositivo aparece en el otro en menos de 30 s con
  ambos abiertos y con conexión.
- **SC-002**: Tras un periodo sin conexión, el 100 % de los cambios hechos en el móvil
  llegan al PC al reconectar, y los borrados del PC llegan al móvil.
- **SC-003**: Repetir un `push` completo no cambia el estado del servidor (idempotencia).
- **SC-004**: Crear o editar un grupo responde en la interfaz en menos de 100 ms, con o sin
  conexión.

## Assumptions

- Sin push (FCM) en la Fase 1: basta el sondeo cada 30 s. Sin WebSockets ni SSE.
- El tamaño de página del `pull` y el formato exacto de la cola los fija el Director en
  `plan.md` (con Opus, por ser diseño de sincronización).
- El usuario tiene a lo sumo unos pocos dispositivos; no se optimiza para decenas.
