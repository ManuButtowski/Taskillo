# Feature Specification: Lista del día, calendario y cuadrante

**Feature Branch**: `004-lista-calendario-cuadrante`

**Created**: 2026-11-25

**Status**: Draft

**Fase**: 1 (MVP) · **Módulo**: M04 · **Fuente**: `docs/especificacion.md` §3 M04

**Input**: Las tres vistas principales de la app: la lista del día (pantalla de inicio), el calendario mensual y semanal, y el cuadrante horario diario con su bandeja "Sin hora". Todas se alimentan del motor de ocurrencias de la spec 003 y funcionan sin conexión.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ver qué tengo hoy (Priority: P1)

Al abrir la app, el usuario ve las tareas de hoy ordenadas por hora y, después, las que no
tienen hora, cada una con el color de su grupo. Completa una con un toque.

**Why this priority**: es la pantalla de inicio y la que más se usa.

**Independent Test**: con tareas puntuales y recurrentes para hoy, abrir la app sin
conexión y comprobar orden, colores y que completar con un toque funciona.

**Acceptance Scenarios**:

1. **Given** tareas de hoy con y sin hora, **When** se abre la app, **Then** aparecen
   primero las que tienen hora, ordenadas, y después las que no tienen hora.
2. **Given** una tarea de hoy, **When** el usuario toca su casilla, **Then** queda
   completada al instante, aunque no haya conexión.
3. **Given** una ocurrencia saltada hoy, **When** se abre la lista, **Then** no aparece.
4. **Given** una ocurrencia de otro día movida a hoy, **When** se abre la lista, **Then**
   aparece con su hora nueva.
5. **Given** tareas en la bandeja "Sin fecha", **When** el usuario la abre, **Then** las ve
   y puede asignarles fecha.

---

### User Story 2 - Planificar en el cuadrante horario (Priority: P1)

El usuario abre el cuadrante de un día: un eje vertical de 00:00 a 24:00 donde cada tarea
con hora y duración es un bloque proporcional con el color de su grupo. Las tareas sin
duración son una marca fina a su hora. Encima, la bandeja "Sin hora" contiene las tareas
del día sin hora; arrastrar una al cuadrante le asigna hora. Pulsar una franja libre crea
una tarea a esa hora.

**Why this priority**: el cuadrante es lo que diferencia a Taskillo de una lista simple.

**Independent Test**: un día con tres tareas solapadas, una sin duración y una que cruza
la medianoche; comprobar el dibujo y arrastrar una tarea desde "Sin hora".

**Acceptance Scenarios**:

1. **Given** una tarea de 10:00 a 11:30, **When** se abre el cuadrante, **Then** se dibuja
   un bloque de 10:00 a 11:30 con el color de su grupo.
2. **Given** una tarea a las 23:00 con 120 min, **When** se abren los cuadrantes de ese día
   y del siguiente, **Then** aparece de 23:00 a 24:00 en el primero y de 00:00 a 01:00 en
   el segundo (§6.3).
3. **Given** dos tareas que se solapan, **When** se dibujan, **Then** se muestran en
   columnas, una junto a otra.
4. **Given** una tarea con hora y sin duración, **When** se dibuja, **Then** es una marca
   fina (línea o chip con el título) que no ocupa franja ni cuenta como solapamiento.
5. **Given** una tarea en la bandeja "Sin hora", **When** el usuario la arrastra a las
   16:00, **Then** la tarea pasa a empezar a las 16:00 (en una recurrente, la app pregunta
   "solo esta" o "esta y las siguientes").
6. **Given** una franja libre, **When** el usuario la pulsa, **Then** se abre la creación de
   tarea con esa hora ya puesta.

---

### User Story 3 - Ver el mes y la semana (Priority: P2)

El usuario abre el calendario mensual o semanal. Cada día muestra puntos con los colores de
los grupos que tienen tareas ese día. Al pulsar un día se abre su cuadrante.

**Why this priority**: da la vista general; las acciones se hacen en la lista y el
cuadrante.

**Independent Test**: con la recurrente "lunes y jueves a las 18:00" y tareas puntuales de
varios grupos, revisar los dos próximos meses.

**Acceptance Scenarios**:

1. **Given** tareas de dos grupos en un día, **When** se ve el mes, **Then** ese día tiene
   un punto de cada color.
2. **Given** la recurrente "lunes y jueves", **When** se ven los dos próximos meses,
   **Then** todos los lunes y jueves tienen su punto (§6.3).
3. **Given** el calendario, **When** el usuario pulsa un día, **Then** se abre el cuadrante
   de ese día.
4. **Given** el calendario, **When** el usuario cambia entre vista mensual y semanal,
   **Then** se conserva el periodo que estaba mirando.

### Edge Cases

- Día sin tareas: la lista muestra un estado vacío amable con un botón para crear tarea.
- Muchas tareas solapadas (más de 4) en la misma franja: las columnas siguen siendo
  legibles o se agrupan con un indicador "+N".
- Una tarea que cruza la medianoche en el último día del mes aparece en el primer día del
  mes siguiente.
- Cambio de hora de verano: el eje del cuadrante sigue mostrando 00:00–24:00 y las tareas
  conservan su hora de reloj.
- La lista del día cambia de fecha si la app sigue abierta al pasar la medianoche.
- Pantallas pequeñas (Android) y ventanas anchas (Windows): el cuadrante y el calendario
  se adaptan a ambos.
- Arrastrar a una franja que ya tiene tareas: se permite y la app avisa del solapamiento
  (las tareas sin duración no cuentan).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: La pantalla de inicio MUST ser la lista del día: tareas de hoy ordenadas por
  hora, después las que no tienen hora, con el color del grupo y completar con un toque.
- **FR-002**: La app MUST ofrecer acceso a la bandeja "Sin fecha".
- **FR-003**: La app MUST ofrecer un calendario mensual y otro semanal con puntos de los
  colores de los grupos con tareas en cada día; pulsar un día abre su cuadrante.
- **FR-004**: El cuadrante diario MUST tener un eje de 00:00 a 24:00 y dibujar cada tarea
  con hora y duración como un bloque proporcional, con el color de su grupo.
- **FR-005**: Las tareas que cruzan la medianoche MUST dibujarse en los dos días.
- **FR-006**: Las tareas solapadas MUST dibujarse en columnas.
- **FR-007**: Las tareas con hora y sin duración MUST dibujarse como una marca fina y no
  contar como solapamiento.
- **FR-008**: Encima del cuadrante MUST estar la bandeja "Sin hora" con las tareas del día
  sin hora; arrastrar una al cuadrante le asigna esa hora.
- **FR-009**: Pulsar una franja libre del cuadrante MUST abrir la creación de una tarea con
  esa fecha y hora.
- **FR-010**: Todas las vistas MUST funcionar sin conexión con los datos locales y
  actualizarse cuando llegan cambios por sincronización.
- **FR-011**: Todas las vistas MUST obtener las ocurrencias del motor de la spec 003, sin
  lógica de recurrencia propia.

### Key Entities

- No añade tablas. Usa las ocurrencias calculadas (spec 003) y los grupos (spec 002).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: La lista del día se muestra en menos de 1 segundo al abrir la app, con o sin
  conexión.
- **SC-002**: Completar desde la lista es un solo toque y se refleja en menos de 100 ms.
- **SC-003**: El calendario de un mes con 50 tareas recurrentes se dibuja sin tirones
  (60 fps en un Android de gama media).
- **SC-004**: Una tarea a las 23:00 de 120 min aparece en los cuadrantes de ambos días
  (§6.3).

## Assumptions

- El diseño visual (tipografía, iconos, modo oscuro) lo define el Director en el plan con
  un estilo sencillo y coherente con Material 3; no hay diseñador.
- El aviso de solapamiento es informativo y nunca impide guardar.
- El widget de Android y la notificación persistente "Tareas de hoy" reutilizarán la lógica
  de la lista del día en la Fase 2 (spec 005); aquí no se implementan.
