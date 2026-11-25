# Feature Specification: Tareas, recurrencias y alarmas

**Feature Branch**: `003-tareas-recurrencias-alarmas`

**Created**: 2026-11-25

**Status**: Draft

**Fase**: 1 (MVP) · **Módulo**: M03 · **Fuente**: `docs/especificacion.md` §3 M03, §5.2 (`tasks`, `task_exceptions`, `task_completions`), §5.3

**Input**: Tareas puntuales y recurrentes con hora de inicio y duración opcionales, excepciones de recurrencia (saltar y mover una ocurrencia), edición "solo esta" o "esta y las siguientes", completar y desmarcar por ocurrencia, y una alarma por tarea programada en local. Las tres tablas se sincronizan con el motor de la spec 002.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Crear una tarea en segundos (Priority: P1)

El usuario escribe solo un título y la tarea queda creada. Si quiere, añade fecha, hora de
inicio, duración, grupo, alarma y notas.

**Why this priority**: es el uso básico de la app y el principio de fricción cero.

**Independent Test**: crear una tarea solo con título (va a "Sin fecha") y otra con fecha,
hora, duración, grupo y alarma (criterio de aceptación del MVP).

**Acceptance Scenarios**:

1. **Given** el formulario de nueva tarea, **When** el usuario escribe solo el título y
   guarda, **Then** la tarea se crea y aparece en la bandeja "Sin fecha".
2. **Given** el formulario, **When** el usuario indica fecha, hora 10:00, 45 min, grupo
   Trabajo, alarma 10 min antes y notas, **Then** la tarea se guarda con todos los datos.
3. **Given** una tarea con hora y sin duración, **When** se guarda, **Then** queda como
   evento puntual a esa hora.
4. **Given** una tarea a las 23:00 con 120 min, **When** se guarda, **Then** termina a la
   01:00 del día siguiente.
5. **Given** una tarea sin hora de inicio, **When** el usuario intenta poner duración o una
   alarma "N minutos antes", **Then** la app no lo permite (solo alarma a hora fija).

---

### User Story 2 - Tareas recurrentes (Priority: P1)

El usuario crea una tarea que se repite: a diario, ciertos días de la semana (con atajos
"entre semana" y "fines de semana") o un día concreto de cada mes, con fecha de inicio y,
opcionalmente, de fin.

**Why this priority**: gimnasio, clases o pagos mensuales son el caso de uso central.

**Independent Test**: crear "lunes y jueves a las 18:00" y comprobar con el motor de
ocurrencias que salen las fechas correctas en los próximos dos meses.

**Acceptance Scenarios**:

1. **Given** una recurrente semanal lunes y jueves a las 18:00, **When** se calculan las
   ocurrencias de los próximos dos meses, **Then** salen todos los lunes y jueves del
   rango, y ningún otro día.
2. **Given** una recurrente mensual el día 31, **When** se calculan abril y febrero,
   **Then** caen el 30 de abril y el 28 (o 29) de febrero.
3. **Given** una recurrente semanal a las 9:00 en `Europe/Madrid`, **When** se cruza el
   cambio de hora de verano, **Then** sigue siendo a las 9:00 hora local.
4. **Given** una recurrente con fecha de fin, **When** se calcula un rango posterior,
   **Then** no hay ocurrencias después de esa fecha.

---

### User Story 3 - Cambiar una ocurrencia sin tocar las demás (Priority: P1)

El usuario salta un lunes concreto ("este lunes no") o mueve un jueves concreto a las
20:00. Al editar una recurrente elige "solo esta" o "esta y las siguientes".

**Why this priority**: criterio de aceptación del MVP ("saltar un lunes y mover un jueves
sin afectar a los demás").

**Independent Test**: tests del motor de ocurrencias con excepciones `SKIP` y `MOVE`.

**Acceptance Scenarios**:

1. **Given** una recurrente lunes y jueves, **When** el usuario salta el lunes 7,
   **Then** ese lunes desaparece y los demás siguen.
2. **Given** la misma recurrente, **When** el usuario mueve el jueves 10 a las 20:00,
   **Then** ese jueves sale a las 20:00 y los demás a las 18:00.
3. **Given** una recurrente, **When** el usuario edita "esta y las siguientes" desde el
   día D, **Then** la plantilla original termina el día anterior a D y se crea una nueva
   desde D; las ocurrencias pasadas no cambian.
4. **Given** una recurrente, **When** el usuario edita "solo esta", **Then** se crea una
   excepción `MOVE` para esa ocurrencia.
5. **Given** la edición de una recurrente, **When** se muestran las opciones, **Then** no
   existe "todas, incluidas las pasadas".

---

### User Story 4 - Completar y desmarcar (Priority: P1)

El usuario marca como hecha una ocurrencia concreta. En una recurrente, completar hoy no
afecta a otros días. Puede desmarcarla.

**Why this priority**: completar es la acción más frecuente de la app.

**Independent Test**: completar la ocurrencia de hoy de una recurrente y comprobar que la
de mañana sigue pendiente; completarla en dos dispositivos deja un único completado.

**Acceptance Scenarios**:

1. **Given** una recurrente, **When** el usuario completa la ocurrencia de hoy, **Then** se
   crea un completado ligado a la fecha original de esa ocurrencia y las demás siguen
   pendientes.
2. **Given** una ocurrencia movida a otro día, **When** se completa, **Then** el completado
   conserva la fecha original de la ocurrencia.
3. **Given** un completado, **When** el usuario desmarca, **Then** el completado se borra
   de forma lógica y el cambio se sincroniza.
4. **Given** la misma ocurrencia completada en el PC y en el móvil sin conexión, **When**
   ambos sincronizan, **Then** queda un único completado.

---

### User Story 5 - Alarmas que suenan cuando toca (Priority: P2)

Cada tarea puede tener una alarma: "N minutos antes" si tiene hora de inicio, o a una hora
fija del día si no la tiene. En una recurrente, la alarma suena en cada ocurrencia, salvo
que ya esté completada.

**Why this priority**: criterio de aceptación del MVP en Android.

**Independent Test**: en Android, una recurrente con alarma; completar la ocurrencia de
hoy antes de la hora y comprobar que no suena, y que la de la siguiente ocurrencia sí.

**Acceptance Scenarios**:

1. **Given** una recurrente con alarma, **When** llega cada ocurrencia, **Then** la alarma
   suena en Android como notificación local.
2. **Given** una ocurrencia completada antes de su alarma, **When** llega la hora, **Then**
   la alarma no suena.
3. **Given** la primera alarma que crea el usuario en Android, **When** la guarda, **Then**
   la app pide el permiso de alarmas exactas (`SCHEDULE_EXACT_ALARM`).
4. **Given** la app abierta, tras una sincronización o una vez al día en segundo plano,
   **When** ocurre, **Then** el dispositivo reprograma las alarmas de los próximos 14 días,
   como máximo las 400 más próximas.
5. **Given** el PC con la app abierta o minimizada en la bandeja, **When** llega una
   alarma, **Then** suena; con la app cerrada no suena (limitación aceptada).
6. **Given** una alarma creada o cambiada en otro dispositivo, **When** llega por
   sincronización, **Then** este dispositivo la programa.

### Edge Cases

- Recurrente mensual el 29, 30 o 31 en meses cortos: último día del mes.
- Recurrente creada con fecha de inicio en un día que no cumple la regla (p. ej. empieza
  un martes y es "lunes y jueves"): la primera ocurrencia es el siguiente día válido.
- Tarea que cruza la medianoche: pertenece al día de inicio (completado y alarma) aunque
  se dibuje en dos días.
- Excepción `MOVE` a un día en el que ya hay otra ocurrencia de la misma plantilla: se
  permite; son dos entradas distintas ese día.
- Alarma "0 minutos antes": suena a la hora de inicio.
- Cambio de zona horaria del usuario: las tareas mantienen su hora de reloj y las alarmas
  se reprograman.
- Más de 400 alarmas en 14 días: se programan las 400 más próximas y el resto al renovar.
- Borrar una recurrente borra (lógicamente) sus excepciones y oculta sus completados.
- Cambiar una tarea de grupo: sus completados pasados pasan al grupo nuevo (el grupo se
  obtiene de la tarea).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Solo el título (hasta 200 caracteres) MUST ser obligatorio. Grupo, fecha,
  recurrencia, hora de inicio, duración, alarma y notas son opcionales.
- **FR-002**: Una tarea sin fecha ni recurrencia MUST ir a la bandeja "Sin fecha".
- **FR-003**: La hora de inicio y la duración (1 a 1440 min) MUST guardarse como hora de
  reloj (`DATE` + `TIME`) en la zona horaria del usuario. La duración exige hora de
  inicio.
- **FR-004**: Las recurrencias MUST admitir: diaria, días de la semana elegidos (con atajos
  L–V y S–D en la interfaz) y mensual por día del mes, con fecha de inicio obligatoria y
  fecha de fin opcional.
- **FR-005**: En la recurrencia mensual, un día inexistente en el mes MUST caer el último
  día de ese mes.
- **FR-006**: El usuario MUST poder saltar (`SKIP`) o mover (`MOVE`: fecha, hora o
  duración) una ocurrencia concreta.
- **FR-007**: Editar una recurrente MUST ofrecer solo "solo esta" (excepción) y "esta y las
  siguientes" (cierra la plantilla y crea una nueva).
- **FR-008**: Las ocurrencias MUST calcularse al vuelo, nunca guardarse, siguiendo los
  pasos de §5.3, con un único motor en la app y otro en el servidor que pasan la misma
  batería de casos de prueba.
- **FR-009**: Completar MUST crear un registro único por `(task_id, occurrence_date)` y
  desmarcar MUST borrarlo de forma lógica.
- **FR-010**: Cada tarea MUST tener como máximo una alarma: relativa al inicio (minutos
  antes, ≥ 0, exige hora de inicio) o a hora fija (sin hora de inicio), nunca ambas.
- **FR-011**: Cada dispositivo MUST programar sus alarmas como notificaciones locales para
  los próximos 14 días (máximo 400 en Android), y renovarlas al abrir la app, tras cada
  sincronización y una vez al día en segundo plano.
- **FR-012**: Al completar una ocurrencia, el dispositivo MUST cancelar su alarma
  pendiente.
- **FR-013**: Tareas, excepciones y completados MUST sincronizarse con el motor de la spec
  002, sin cambiar su protocolo.
- **FR-014**: Las columnas de copas (Fase 3) y de foto, comentario y publicación (Fase 4)
  NO se crean en esta spec.

### Key Entities

- **Tarea** (`tasks`): puntual o plantilla recurrente; título, notas, grupo, hora de inicio,
  duración, alarma, fecha o regla de recurrencia con inicio y fin.
- **Excepción** (`task_exceptions`): sobre una ocurrencia (fecha original) de una
  plantilla; `SKIP` o `MOVE` con nueva fecha, hora o duración.
- **Completado** (`task_completions`): una ocurrencia hecha, ligada a su fecha original.
- **Ocurrencia** (calculada, no se guarda): fecha, hora, duración, grupo y estado
  (pendiente o hecha) de una tarea en un día.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Crear una tarea solo con título lleva menos de 5 segundos.
- **SC-002**: El motor de ocurrencias pasa el 100 % de los casos de prueba de meses cortos,
  cambio de hora, cruce de medianoche y excepciones, en Dart y en TypeScript.
- **SC-003**: "Lunes y jueves a las 18:00" muestra las ocurrencias correctas de los próximos
  dos meses, con un lunes saltado y un jueves movido a las 20:00 (§6.3).
- **SC-004**: La alarma de una recurrente suena en cada ocurrencia en Android y no suena si
  ya está completada (§6.3).
- **SC-005**: Completar la misma ocurrencia en dos dispositivos deja exactamente un
  completado.

## Assumptions

- El diseño del motor de ocurrencias y los casos de prueba compartidos los decide el
  Director con Opus en `plan.md` (constitución, principio VII). Una opción es un fichero
  JSON de casos en `packages/contrato/` que leen los tests de ambos lados.
- En PC, la bandeja del sistema y las notificaciones de Windows bastan para las alarmas;
  no se instala ningún servicio aparte.
- Las tareas con hora pero sin duración no cuentan como solapamiento (se usa en la spec 004
  y en el asistente de la Fase 5).
