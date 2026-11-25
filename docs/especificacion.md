# TASKILLO — Especificación funcional y técnica (v2.1)

> **Propósito:** fuente única de verdad para desarrollar Taskillo con **Spec-Kit (SDD)** y un harness de agentes en **Claude Code (plan Pro)**, con **presupuesto 0 €**.
>
> **Cambios respecto a la v1.0 (borrador con Gemini):** MVP recortado por fases, iOS fuera del MVP, stack de frontend simplificado (una sola cadena de compilación), datos en Neon + Cloudflare R2, esquema corregido (hora de inicio + duración, excepciones de recurrencia, dispositivos, sesiones, borrado lógico y versionado para sincronizar sin conexión), puntos anti-abuso, asistente con parser local primero y harness ahorrador.
>
> **Cambios en la v2.1 (2026-11-25):** el backend se despliega desde el MVP en el VPS IONOS de DEVKOMP (Render queda descartado), el correo sale por el SMTP de IONOS desde `no-reply@devkomp.es` (Resend queda como alternativa detrás de la misma interfaz) y se añade la gestión de secretos (§4.6). Ya no hace falta comprar dominio.
>
> **Leyenda:**
> - ✅ **DECIDIDO**: acordado con Manuel.
> - ⏳ **PENDIENTE**: decisión de Manuel antes de empezar esa parte.
> - 💡 **SUPOSICIÓN**: valor razonable que he elegido yo; se puede cambiar sin rehacer nada.

---

## 1. Visión del producto

Taskillo es un gestor de tareas para **PC y móvil** sincronizado mediante **PostgreSQL**. Combina planificación flexible (tareas puntuales, recurrencias, alarmas, cuadrante horario y calendario), visibilidad pasiva en el móvil (widget y notificación persistente), un asistente por texto y voz, y una capa social gamificada (copas, rachas, rankings y timeline de amigos) con control fino de la privacidad.

### Principios (irán a la constitución de Spec-Kit)

1. **Fricción cero.** Crear o completar una tarea lleva segundos.
2. **Privacidad soberana.** El usuario decide qué comparte. El filtrado se hace siempre en el backend, nunca en el cliente.
3. **Local-first.** La app abre y funciona sin conexión; sincroniza al volver la red.
4. **Coste 0 €.** Nada que requiera pago obligatorio. Las capas gratuitas se revisan al empezar cada fase, porque cambian a menudo.
5. **Portabilidad.** Solo PostgreSQL estándar y almacenamiento compatible S3, para poder migrar al VPS sin reescribir código.
6. **Alcance mínimo.** Cada fase se cierra y se usa antes de empezar la siguiente.

---

## 2. Alcance y fases

| Fase | Contenido | Plataformas |
| :--- | :--- | :--- |
| **1 — MVP** | Cuenta con correo y contraseña, grupos con color, tareas puntuales y recurrentes (con excepciones), alarmas, lista del día, cuadrante horario, calendario, sincronización PC ↔ Android con modo sin conexión | PC + Android |
| **2 — Móvil pasivo y cuenta completa** | Widget de pantalla de inicio, notificación persistente "Tareas de hoy", login con Google, foto de perfil (R2), botón "Recomendar Taskillo" | PC + Android |
| **3 — Gamificación personal** | Copas, rachas 🔥, gráficos mensual/anual, ranking de mis grupos | PC + Android |
| **4 — Social y privacidad** | Amigos, visibilidad por grupo, cuadrante del amigo con `OCUPADO`/`OCULTO`, foto y comentario al completar, timeline, rankings entre amigos | PC + Android |
| **5 — Asistente** | Texto y voz, parser local + LLM de respaldo | PC + Android |
| **Fuera del plan actual** | iOS (cuenta Apple Developer 99 €/año y un Mac para compilar), Live Activities, varias alarmas por tarea | — |

✅ **DECIDIDO (2026-11-24):** el orden de las fases 2 a 5. Lo he ordenado por valor para el uso diario y por dependencias (los rankings entre amigos necesitan el módulo social y las copas). Google pasa a la fase 2 porque el login con Google en escritorio exige un flujo OAuth algo más laborioso y no bloquea el MVP.

✅ **DECIDIDO (2026-11-24):** "PC" significa Windows en primer lugar. Linux y macOS se compilarían igual, pero solo se prueban si Manuel los usa.

---

## 3. Especificación funcional por módulos

Cada módulo indica la fase en la que entra.

### M01. Cuenta y perfil — Fase 1 (Google y foto en Fase 2)

- **Registro e inicio de sesión con correo y contraseña.** Contraseña con hash `Argon2id`. Registro en dos pasos: primero solo el correo (la respuesta es siempre la misma, exista o no la cuenta) y después un código de un solo uso enviado por correo con el que se completa el alta, que deja el correo verificado. Recuperación de contraseña por enlace.
  - ✅ **DECIDIDO (2026-11-25) — correo por el SMTP de IONOS** (`smtp.ionos.es:587`, STARTTLS) desde un buzón dedicado `no-reply@devkomp.es`, incluido en el alojamiento de DEVKOMP (0 €). El backend envía a través de una interfaz propia de envío con dos implementaciones: SMTP (la de uso) y **Resend** (alternativa, por si el SMTP da problemas de entrega o de límites). Se cambia con una variable de entorno, sin tocar el código. En desarrollo los correos se capturan en local con Mailpit (Docker Compose), sin enviar nada fuera.
- **Login con Google (Fase 2).** OpenID Connect validado en el backend. Si el correo ya existe y está verificado, se vincula a la misma cuenta.
- **Perfil:** cambiar nombre visible, foto (Fase 2) y contraseña (solo cuentas con contraseña). Cerrar sesión en un dispositivo o en todos.
- **Estadísticas en el perfil (Fase 3):** copas totales y por grupo, racha actual y máxima 🔥, gráficos mensual y anual.
- **Recomendar Taskillo (Fase 2):** botón que abre el menú nativo de compartir (WhatsApp, redes, mensajería, copiar enlace).
- **Interruptor social (Fase 4):** activa o desactiva por completo la parte de amigos.

### M02. Grupos — Fase 1 (campos de privacidad en Fase 4)

- El usuario crea, edita, ordena y borra grupos (Trabajo, Gimnasio, Estudios…).
- Atributos: `nombre`, `color` (identifica sus tareas en lista, cuadrante, calendario y widget), `icono` opcional.
- Atributos de privacidad (Fase 4): `visible_amigos` y `modo_privado_cuadrante` (`OCUPADO` | `OCULTO`).
- Atributo de widget (Fase 2): `visible_en_widget`, para ocultar grupos sensibles.
- Una tarea sin grupo se muestra con un color neutro.
- Al borrar un grupo se pregunta si borrar sus tareas o dejarlas sin grupo.

### M03. Tareas, recurrencias y alarmas — Fase 1

**Atributos.** Solo el título es obligatorio. Lo demás es opcional:

| Atributo | Descripción |
| :--- | :--- |
| `grupo` | Opcional. |
| `fecha` | Para tareas puntuales. Si no hay fecha ni recurrencia, la tarea va a una bandeja "Sin fecha". |
| `recurrencia` | Para plantillas (ver abajo). |
| `hora_inicio` + `duracion_min` | Opcionales. Sin hora, la tarea no ocupa franja en el cuadrante. Con hora pero sin duración, la tarea no tiene duración: es un evento puntual a esa hora (✅ **DECIDIDO**, ver M04). |
| `alarma` | Una por tarea (ver abajo). |
| `notas` | Texto libre. |

✅ **DECIDIDO — hora de inicio + duración en minutos.** Sirve igual para tareas puntuales y recurrentes, y permite cruzar la medianoche: una tarea a las 23:00 con 120 min termina a la 01:00 del día siguiente. En el cuadrante se dibuja en ambos días.

✅ **DECIDIDO (2026-11-24) — hora "de reloj".** Fecha y hora se guardan como hora local del usuario (`DATE` + `TIME`) junto a su zona horaria. Así "todos los lunes a las 9:00" sigue siendo a las 9:00 tras el cambio de hora de verano. La conversión a instante exacto (`TIMESTAMPTZ`) se hace al programar alarmas.

**Recurrencias.**

- Diaria.
- Días de la semana elegidos (por ejemplo L, X, V).
- Entre semana (L–V) y fines de semana (S–D), como atajos de lo anterior.
- Mensual por día del mes (por ejemplo el 15).
  - ✅ **DECIDIDO (2026-11-24):** si el mes no tiene ese día (31 en abril), la tarea cae el último día del mes.
- Fecha de inicio obligatoria y fecha de fin opcional.

**Excepciones de recurrencia (nuevo).** Sobre una ocurrencia concreta el usuario puede:

- **Saltarla** ("este lunes no").
- **Moverla** a otra fecha u hora, o cambiar su duración, solo esa vez.
- Editar la plantilla con dos opciones: "solo esta" (crea una excepción) o "esta y las siguientes" (cierra la plantilla y crea una nueva desde ese día). ✅ **DECIDIDO (2026-11-24):** no se ofrece "todas, incluidas las pasadas", para no reescribir el historial.

**Completado.**

- Completar crea un registro ligado a la fecha de la ocurrencia. En una recurrente, completar hoy no afecta a otros días.
- Desmarcar borra ese registro (borrado lógico, para que se sincronice).
- Foto y comentario al completar llegan en la Fase 4.

**Alarmas.**

✅ **DECIDIDO — una alarma por tarea**, que se repite con la recurrencia. Si la tarea es lunes y jueves, la alarma salta lunes y jueves.

- Con hora de inicio: la alarma es "N minutos antes" (0 = a la hora).
- Sin hora de inicio: la alarma es una hora fija del día.
- Las alarmas son notificaciones locales que programa cada dispositivo a partir de sus datos sincronizados, sin servidor de push. Al completar la tarea se cancela la alarma pendiente de esa ocurrencia.
- ✅ **DECIDIDO (2026-11-24):** cada dispositivo programa las alarmas de los **próximos 14 días** y lo renueva al abrir la app, tras cada sincronización y una vez al día en segundo plano.
  - Android limita a unas 500 las alarmas pendientes por app. Por eso se programan como máximo las 400 más próximas (✅ **DECIDIDO 2026-11-24**); si en 14 días hay más, las siguientes se programan al ir renovando.
  - Alarmas exactas: la app pide el permiso de alarmas exactas de Android (`SCHEDULE_EXACT_ALARM`) la primera vez que se crea una alarma.
  - En PC solo suenan si la app está abierta o minimizada en la bandeja del sistema.

### M04. Lista del día, calendario y cuadrante — Fase 1

- **Lista del día (pantalla de inicio):** tareas de hoy ordenadas por hora, después las que no tienen hora. Color del grupo en cada una. Completar con un toque.
- **Calendario mensual y semanal:** en cada día, puntos con los colores de los grupos que tienen tareas. Al pulsar un día se abre su cuadrante.
- **Cuadrante horario diario:** eje vertical 00:00–24:00. Cada tarea con hora y duración es un bloque proporcional a su duración, con el color de su grupo. Una tarea con hora pero sin duración se dibuja como una marca fina a esa hora (línea o chip con el título), sin ocupar franja. Las tareas solapadas se dibujan en columnas. ✅ **DECIDIDO (2026-11-24):** las tareas sin duración no cuentan como solapamiento al avisar de conflictos horarios.
- **Bandeja "Sin hora":** encima del cuadrante, con las tareas del día sin hora. Arrastrar una tarea al cuadrante le asigna hora.
- Crear tarea desde el cuadrante pulsando sobre una franja libre.

### M05. Sincronización — Fase 1

- Todo cambio (crear, editar, completar, desmarcar, borrar) se guarda primero en local y se envía al servidor en cuanto hay red.
- El PC y el móvil reciben los cambios del otro (ver §5.4 para el mecanismo).
- Un cambio hecho sin conexión se conserva y se envía después. Un borrado hecho en un dispositivo llega a los demás aunque estuvieran sin conexión.
- **Conflictos:** si dos dispositivos editan la misma tarea sin conexión, gana la última escritura que llega al servidor y el otro dispositivo recibe la versión final. ✅ **DECIDIDO (2026-11-24):** suficiente para un uso personal; no se fusionan campos.
- Completar es idempotente: completar la misma ocurrencia en dos dispositivos deja un único completado.

### M06. Widget y notificación persistente — Fase 2 (solo Android)

- **Widget de pantalla de inicio:** tareas pendientes de hoy (ordenadas por hora y después sin hora), con color del grupo. Casilla para completar sin abrir la app. Pulsar el título abre la app en esa tarea. Botón `+` para crear tarea (y abrir el asistente cuando exista).
- **Notificación persistente "Tareas de hoy"** (activable en ajustes): número de pendientes y lista desplegable, con acciones `Completar siguiente` y `Añadir`.
- Ambos se actualizan al instante cuando el cambio se hace en el móvil, y en segundo plano cuando llega del PC (mensaje de datos de FCM que dispara una sincronización).
- Ajustes: activar o desactivar la notificación y elegir qué grupos se muestran.

### M07. Gamificación — Fase 3 (rankings entre amigos en Fase 4)

**Copas 🏆.**

- Cada ocurrencia completada da **1 copa**, incluidas las tareas creadas ese mismo día.
  - ✅ **DECIDIDO (2026-11-24) — tope diario de 20 copas**, configurable en el servidor. Es la única regla anti-abuso.
- La copa se decide en el servidor al completar y se guarda en el propio completado. Desmarcar la quita.
- ✅ **DECIDIDO (2026-11-24):** las tareas completadas después de alcanzar el tope siguen contando en las estadísticas de cumplimiento personales, pero no suman copas.

**Rachas 🔥.**

- Un día mantiene la racha si el usuario consigue al menos `meta_diaria` copas ese día (por defecto 1), según su zona horaria.
- Si un día termina sin alcanzar la meta, la racha vuelve a 0.
- Se muestran la racha actual y la máxima.

**Gráficos y rankings.**

- Copas por día, semana y mes en vista mensual y anual, globales o por grupo.
- Ranking de mis grupos por copas (histórico y por periodo).
- Rankings entre amigos semanal, mensual y anual por copas, mostrando su racha (Fase 4). Solo aparecen el propio usuario y sus amigos aceptados con la parte social activa.
  - ✅ **DECIDIDO (2026-11-24):** cuentan **todas** las copas del usuario, también las de grupos no visibles. Al ver el detalle de un amigo, solo se desglosan las copas de sus grupos visibles; el resto aparece agrupado como "Otros", sin nombre ni color de grupo.
  - ✅ **DECIDIDO:** no hay ranking por grupos entre amigos (cada usuario crea los suyos). El ranking por grupos es solo personal.

### M08. Social y privacidad — Fase 4

- **Amigos:** buscar por nombre de usuario o enlace de invitación, enviar, aceptar, rechazar, eliminar y bloquear.
- **Interruptor social:** apagado, el usuario no aparece en búsquedas, no ve ni es visto, y sale de los rankings de amigos.
- **Compartir horario:** opción `compartir_cuadrante` independiente del interruptor social.
- **Cuadrante de un amigo** (filtrado en el backend, ver §5.5):
  - Grupo visible → título, grupo y color.
  - Grupo no visible con modo `OCUPADO` → bloque gris "OCUPADO" sin título ni grupo.
  - Grupo no visible con modo `OCULTO` → no se envía.
- **Completar con foto y comentario:** al completar se puede adjuntar una foto (comprimida en el cliente a WebP de menos de 300 KB) y un comentario.
- **Publicar en el timeline (✅ DECIDIDO 2026-11-24):** que un grupo sea visible no publica nada por sí solo. El usuario decide en cada completado si se publica:
  - Al completar desde la ficha de la tarea hay una casilla "Publicar en el timeline", solo disponible si el grupo es visible.
  - ✅ **DECIDIDO (2026-11-24):** la casilla viene desmarcada por defecto. Completar con un toque desde la lista, el widget o la notificación nunca publica.
  - Una vez publicada, el completado muestra un indicador visible (icono de timeline) en la lista, el historial y la ficha, para saber de un vistazo qué está publicado.
  - Se puede publicar o retirar una publicación después, desde el historial de completados. Retirarla oculta también sus comentarios y me gusta.
  - Si el grupo deja de ser visible, sus publicaciones dejan de mostrarse a los amigos.
- **Timeline:** publicaciones de amigos en orden cronológico, con avatar, nombre, tarea, grupo, hora, comentario y foto.
- **Me gusta y comentarios (✅ DECIDIDO 2026-11-24):** en cada publicación, los amigos que pueden verla pueden dar o quitar un me gusta (uno por persona) y escribir comentarios.
  - Cada publicación muestra el número de me gusta y los comentarios en orden cronológico.
  - El autor de un comentario puede borrarlo; el dueño de la publicación puede borrar cualquier comentario de su publicación.
  - ✅ **DECIDIDO (2026-11-24):** comentarios de texto de hasta 500 caracteres, sin respuestas anidadas ni fotos. Sin editar: se borra y se vuelve a escribir.
  - ✅ **DECIDIDO (2026-11-24):** el dueño ve en la app un aviso de me gusta y comentarios nuevos; las notificaciones push de esto quedan para más adelante.
  - Si se deja de ser amigos, los comentarios y me gusta antiguos se conservan pero solo los ve quien todavía tiene acceso a la publicación.

### M09. Asistente por texto y voz — Fase 5

- Botón flotante con entrada de texto y micrófono.
- **Voz:** reconocimiento nativo del sistema (Android SpeechRecognizer; en PC, el dictado del sistema operativo). Coste 0 €.
- **Interpretación en dos pasos:**
  1. **Parser local.** Código de la propia app que reconoce frases típicas sin IA: "mañana", "el día 27", "de 9 a 9:30", "los lunes y jueves", "entre semana", "en Gimnasio". Las convierte en fecha, hora, duración, recurrencia y grupo. Es gratis, instantáneo y funciona sin internet. Hay librerías de este tipo, como `chrono-node` en JavaScript. Como la app es Flutter, el parser se escribe en Dart con las reglas más comunes en español (o se usa una librería Dart equivalente si hay una madura), en un paquete propio con muchos tests.
  2. **LLM de respaldo.** Solo si el parser no entiende la frase. Se pide al modelo una salida JSON con los mismos campos.
- **Aviso de privacidad:** en el paso 2 el texto de la frase sale del dispositivo hacia un tercero. El usuario debe activarlo de forma explícita en ajustes, con una explicación clara, y puede usar el asistente solo con el parser local. Las capas gratuitas de los LLM pueden cambiar o desaparecer, así que el asistente debe funcionar sin ellas.
- **Confirmación:** se muestra una tarjeta con la tarea interpretada, editable, y se crea con un toque. Avisa si la fecha ya pasó o si se solapa con otra tarea.

---

## 4. Stack tecnológico

### 4.1. Resumen

| Capa | Elección | Estado |
| :--- | :--- | :--- |
| **App (PC + Android)** | **Flutter** (Dart), un solo código para PC y Android | ✅ **DECIDIDO** |
| **Caché local / sin conexión** | SQLite en el dispositivo con `drift` | ✅ |
| **Backend** | **TypeScript** sobre Node.js, con el framework **Hono** | ✅ **DECIDIDO** |
| **Acceso a datos** | Drizzle ORM con migraciones SQL versionadas | ✅ **DECIDIDO** |
| **Base de datos** | **Neon** (PostgreSQL gestionado, capa gratuita) | ✅ **DECIDIDO** |
| **Fotos** | **Cloudflare R2** con URLs prefirmadas | ✅ **DECIDIDO** |
| **Autenticación** | Propia: Argon2id + token de acceso JWT corto + refresh token rotativo | ✅ **DECIDIDO** |
| **Correo transaccional** | **SMTP de IONOS** desde `no-reply@devkomp.es`; Resend como alternativa tras la misma interfaz; Mailpit en desarrollo | ✅ **DECIDIDO** (2026-11-25) |
| **Push de datos a Android** | Firebase Cloud Messaging (gratis) | Fase 2 |
| **Desarrollo local** | Docker Compose (PostgreSQL 16 + API + Mailpit) | ✅ |
| **Hosting del backend** | **VPS IONOS de DEVKOMP** desde el MVP, con Docker Compose; base de datos en Neon | ✅ **DECIDIDO** (2026-11-25) |
| **Despliegue** | GitHub Actions por SSH con clave, usando secretos de GitHub | ✅ **DECIDIDO** (2026-11-25) |
| **CI** | GitHub Actions: tests y APK de Android en Linux en cada cambio; build de Windows solo al publicar versión. Si se agotan los minutos gratuitos (repositorio privado), los tests pasan a un hook `pre-push` local | ✅ **DECIDIDO** |

### 4.2. Frontend: Flutter ✅ DECIDIDO

La v1.0 proponía Svelte + Tauri (PC) + Capacitor (móvil) + Kotlin + Swift: cinco cadenas de compilación. Se descarta. Quedan dos opciones con **un solo código para PC y Android**:

**Elegido — Flutter.**
- Un único código Dart para Android y Windows (y Linux/macOS si hace falta).
- Rendimiento muy fluido en listas, calendario y cuadrante.
- Paquetes maduros para lo que más pesa en Taskillo: `home_widget` (widget de pantalla de inicio), `flutter_local_notifications` (alarmas y notificación persistente), `drift` (SQLite), `share_plus` (compartir), `speech_to_text` (voz), `firebase_messaging` (FCM).
- Aun así, el diseño del widget de Android se escribe en Kotlin/XML. `home_widget` reduce el puente al mínimo: Flutter escribe los datos y el widget solo los pinta.
- Contra: Dart es un lenguaje nuevo si no lo conoces, y no se comparten tipos con un backend en TypeScript (se generan desde un contrato OpenAPI).

**Descartado — Tauri v2 en PC y Android.**
- Interfaz web (Svelte o React) en ambos, con Tauri v2 también en Android, sin Capacitor.
- Comparte lenguaje (TypeScript) y tipos con el backend, y puede usar `chrono-node` directamente.
- Contra: el soporte de Tauri en móvil es más joven; el widget, la notificación persistente y las tareas en segundo plano exigen escribir plugins propios en Kotlin, que es justo lo más importante de la app en el móvil.

**Decisión (2026-11-24):** Flutter, porque el widget, las alarmas y la notificación persistente son el corazón de la experiencia en el móvil y ahí tiene más camino hecho.

### 4.3. Backend

- **TypeScript + Hono + Drizzle** (✅ **DECIDIDO 2026-11-24**). Hono es ligero y corre igual en Node.js (Docker, VPS) que en entornos serverless. Así el MVP no ata a ningún proveedor.
- **Contrato de API en OpenAPI**, generado a partir de los esquemas de validación (Zod). De ahí se generan los clientes para la app.
- **Fotos:** el cliente pide una URL prefirmada al backend y sube directamente a R2. En la base de datos solo se guarda la clave del objeto.
- ✅ **DECIDIDO (2026-11-24) — backend en TypeScript**, el más rápido de iterar con Claude Code. Los modelos Dart de la app Flutter se generan desde el contrato OpenAPI, para que cliente y servidor no se desincronicen.

### 4.4. Infraestructura a 0 €

- **Desarrollo:** todo en local con Docker Compose (PostgreSQL 16 + API). Neon se usa como base de datos "en la nube" cuando haga falta probar desde el móvil fuera de casa.
- **Backend online:** ✅ **DECIDIDO (2026-11-25) — VPS IONOS de DEVKOMP desde el MVP**, con permiso de Rafa (DEVKOMP). Sustituye a Render, que se dormía tras 15 min sin uso.
  - La API corre en Docker Compose detrás de un proxy inverso con HTTPS automático (Let's Encrypt), en un subdominio de `devkomp.es` (por ejemplo `api.taskillo.devkomp.es`).
  - **Base de datos:** se mantiene en **Neon**. Así el VPS de DEVKOMP no carga con PostgreSQL ni con sus copias de seguridad, y la base sigue accesible desde el desarrollo local. Si más adelante conviene, se pasa al PostgreSQL del VPS con `pg_dump` + `pg_restore` y cambiando la cadena de conexión, sin tocar código.
  - **Convivencia con el servidor de DEVKOMP:** usuario propio sin privilegios para Taskillo, límites de memoria y CPU en los contenedores, solo los puertos 80/443 abiertos y logs con rotación.
  - Aunque el servidor ya no se duerme, la app sigue tolerando que no responda: abre al instante con los datos locales (SQLite) y sincroniza cuando vuelve, con un indicador discreto de "sincronizando".
- **Despliegue (✅ DECIDIDO 2026-11-25):** desde GitHub Actions.
  - El acceso al VPS pasa de contraseña a **clave SSH**: una clave dedicada al despliegue, con un usuario propio en el VPS. La clave privada vive solo en los secretos de GitHub.
  - Flujo: al fusionar en `main` (o al publicar versión), Actions construye la imagen Docker de la API, la publica en GitHub Container Registry, entra por SSH en el VPS y ejecuta `docker compose pull && docker compose up -d`. Las migraciones de Drizzle se aplican en ese paso.
  - Plan B si se agotan los minutos gratuitos: el mismo script de despliegue se lanza a mano desde el PC.
- **Valorado y descartado:** Render (se duerme) y Cloudflare Workers (el plan gratuito limita el CPU por petición a unos 10 ms y Argon2id tarda bastante más).
- **Fotos:** Cloudflare R2 (10 GB gratis, salida de datos sin coste). Límites a revisar al empezar la Fase 2.
- **Portabilidad:** R2 se puede sustituir por almacenamiento local o MinIO (compatible S3) sin tocar el código, y Neon por el PostgreSQL del VPS con `pg_dump`.
- **Correo:** buzón `no-reply@devkomp.es` en el SMTP de IONOS. Antes de enviar a otras personas hay que comprobar que `devkomp.es` tiene SPF, DKIM y DMARC bien configurados, para que los correos no acaben en spam.

### 4.6. Secretos ✅ DECIDIDO (2026-11-25)

- **Nunca en el repositorio.** Ni en el código, ni en los commits, ni en los logs.
- **Local:** fichero `.env` (ignorado por Git) a partir de un `.env.example` que sí se sube, con todas las variables y valores de ejemplo.
- **CI y despliegue:** secretos de GitHub Actions (clave SSH de despliegue, host y usuario del VPS).
- **Producción:** fichero `.env` en el VPS, legible solo por el usuario de Taskillo (cadena de Neon, secreto JWT, credenciales SMTP, claves de R2).
- Cambiar un secreto (por ejemplo, la contraseña del buzón) no exige tocar código: se cambia en el `.env` del VPS y se reinicia la API.

### 4.5. Autenticación

- **Contraseñas:** Argon2id.
- **Sesiones:** token de acceso JWT de 15 min + refresh token opaco de 30 días (✅ **DECIDIDO 2026-11-24**), guardado en el dispositivo en almacenamiento seguro (Android Keystore / almacén de credenciales del sistema).
- **Rotación:** cada uso del refresh token lo invalida y emite uno nuevo. Si se reutiliza uno ya rotado, se revoca toda la cadena de esa sesión (señal de robo).
- **Revocación:** cerrar sesión borra la sesión; "cerrar todas" revoca todas las del usuario. Cambiar la contraseña revoca las demás sesiones.
- **Google (Fase 2):** OpenID Connect con PKCE; el backend valida el ID token. En escritorio, flujo con redirección a `localhost`.
- **Autorización:** cada consulta filtra por `user_id` del token. Los endpoints sociales verifican amistad aceptada, interruptor social y visibilidad del grupo.

---

## 5. Modelo de datos (PostgreSQL)

### 5.1. Convenciones

- IDs `UUID` generados **en el cliente** (UUIDv7), para poder crear filas sin conexión.
- Todas las tablas sincronizables llevan:
  - `updated_at TIMESTAMPTZ` — momento de la última escritura en el servidor.
  - `deleted_at TIMESTAMPTZ` — borrado lógico. Nunca se borra una fila sincronizable con `DELETE` mientras haya dispositivos que puedan no haberse enterado.
  - `version INT` — se incrementa con cada escritura; el cliente la envía para detectar conflictos.
  - `server_seq BIGINT` — número creciente asignado por el servidor (secuencia global) en cada escritura. Es el cursor de sincronización.
- Un disparador (`trigger`) común actualiza `updated_at`, `version` y `server_seq` en cada `INSERT`/`UPDATE`.
- ✅ **DECIDIDO (2026-11-24):** las filas borradas se purgan tras 90 días. Un dispositivo que lleve más de 90 días sin sincronizar hace una resincronización completa.

### 5.2. Esquema

La columna "Fase" indica cuándo se crea cada tabla o columna. Las columnas de fases posteriores se añaden con migraciones cuando toque.

```sql
CREATE EXTENSION IF NOT EXISTS citext;

-- Secuencia global para el cursor de sincronización
CREATE SEQUENCE sync_seq;

-- 1. USUARIOS (Fase 1)
CREATE TABLE users (
    id                  UUID PRIMARY KEY,
    email               CITEXT UNIQUE NOT NULL,
    email_verified_at   TIMESTAMPTZ,
    password_hash       TEXT,                      -- NULL si solo usa Google
    google_sub          TEXT UNIQUE,               -- Fase 2
    username            CITEXT UNIQUE NOT NULL,
    display_name        VARCHAR(100) NOT NULL,
    avatar_key          TEXT,                      -- clave en R2, Fase 2
    timezone            VARCHAR(64) NOT NULL DEFAULT 'Europe/Madrid',
    -- Fase 3
    daily_streak_goal   INT NOT NULL DEFAULT 1 CHECK (daily_streak_goal >= 1),
    current_streak      INT NOT NULL DEFAULT 0,
    longest_streak      INT NOT NULL DEFAULT 0,
    last_streak_date    DATE,
    -- Fase 4
    social_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
    share_schedule      BOOLEAN NOT NULL DEFAULT FALSE,
    -- Fase 5
    assistant_llm_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. DISPOSITIVOS (Fase 1; token FCM en Fase 2)
CREATE TABLE devices (
    id            UUID PRIMARY KEY,
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform      VARCHAR(10) NOT NULL CHECK (platform IN ('android','windows','linux','macos')),
    name          VARCHAR(100),
    fcm_token     TEXT UNIQUE,                      -- NULL en escritorio
    last_sync_seq BIGINT NOT NULL DEFAULT 0,
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. SESIONES / REFRESH TOKENS (Fase 1)
CREATE TABLE sessions (
    id                  UUID PRIMARY KEY,
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id           UUID REFERENCES devices(id) ON DELETE CASCADE,
    family_id           UUID NOT NULL,               -- cadena de rotación
    refresh_token_hash  TEXT UNIQUE NOT NULL,        -- nunca el token en claro
    expires_at          TIMESTAMPTZ NOT NULL,
    rotated_at          TIMESTAMPTZ,                 -- no NULL = ya se usó
    revoked_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sessions_user ON sessions(user_id) WHERE revoked_at IS NULL;

-- 4. GRUPOS (Fase 1; privacidad Fase 4; widget Fase 2)
CREATE TABLE task_groups (
    id                     UUID PRIMARY KEY,
    user_id                UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name                   VARCHAR(80) NOT NULL,
    color_hex              CHAR(7) NOT NULL DEFAULT '#3B82F6',
    icon                   VARCHAR(50),
    sort_order             INT NOT NULL DEFAULT 0,
    is_visible_in_widget   BOOLEAN NOT NULL DEFAULT TRUE,     -- Fase 2
    is_visible_to_friends  BOOLEAN NOT NULL DEFAULT FALSE,    -- Fase 4
    private_schedule_mode  VARCHAR(6) NOT NULL DEFAULT 'BUSY'
                           CHECK (private_schedule_mode IN ('BUSY','HIDDEN')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ,
    version     INT NOT NULL DEFAULT 1,
    server_seq  BIGINT NOT NULL DEFAULT nextval('sync_seq')
);

-- 5. TAREAS: PUNTUALES Y PLANTILLAS RECURRENTES (Fase 1)
CREATE TABLE tasks (
    id                    UUID PRIMARY KEY,
    user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    group_id              UUID REFERENCES task_groups(id) ON DELETE SET NULL,
    title                 VARCHAR(200) NOT NULL,
    notes                 TEXT,
    -- Horario (hora local "de reloj" en users.timezone)
    start_time            TIME,                      -- NULL = sin hora
    duration_minutes      INT CHECK (duration_minutes BETWEEN 1 AND 1440),
    -- Alarma única: relativa al inicio O a hora fija (no ambas)
    alarm_offset_minutes  INT CHECK (alarm_offset_minutes >= 0),
    alarm_time            TIME,
    -- Puntual vs recurrente
    scheduled_date        DATE,                      -- puntual; NULL + sin recurrencia = "Sin fecha"
    recurrence_type       VARCHAR(12)
                          CHECK (recurrence_type IN ('DAILY','WEEKLY','MONTHLY')),
                          -- WEEKLY = días de la semana elegidos (L-V y S-D son atajos de la UI)
    recurrence_days       SMALLINT[],                -- WEEKLY: 1=lunes..7=domingo; MONTHLY: [1..31]
    recurrence_start_date DATE,
    recurrence_end_date   DATE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ,
    version     INT NOT NULL DEFAULT 1,
    server_seq  BIGINT NOT NULL DEFAULT nextval('sync_seq'),
    CHECK (NOT (alarm_offset_minutes IS NOT NULL AND alarm_time IS NOT NULL)),
    CHECK (alarm_offset_minutes IS NULL OR start_time IS NOT NULL),
    CHECK (duration_minutes IS NULL OR start_time IS NOT NULL),
    CHECK (
      (recurrence_type IS NULL AND recurrence_start_date IS NULL)
      OR (recurrence_type IS NOT NULL AND scheduled_date IS NULL AND recurrence_start_date IS NOT NULL)
    )
);
CREATE INDEX idx_tasks_user_date ON tasks(user_id, scheduled_date) WHERE deleted_at IS NULL;
CREATE INDEX idx_tasks_user_recurring ON tasks(user_id) WHERE recurrence_type IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_tasks_sync ON tasks(user_id, server_seq);

-- 6. EXCEPCIONES DE RECURRENCIA (Fase 1)
CREATE TABLE task_exceptions (
    id                  UUID PRIMARY KEY,
    task_id             UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    occurrence_date     DATE NOT NULL,               -- fecha original de la ocurrencia
    kind                VARCHAR(4) NOT NULL CHECK (kind IN ('SKIP','MOVE')),
    -- Solo para MOVE (NULL = se mantiene el valor de la plantilla)
    new_date            DATE,
    new_start_time      TIME,
    new_duration_minutes INT CHECK (new_duration_minutes BETWEEN 1 AND 1440),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ,
    version     INT NOT NULL DEFAULT 1,
    server_seq  BIGINT NOT NULL DEFAULT nextval('sync_seq'),
    UNIQUE (task_id, occurrence_date)
);

-- 7. COMPLETADOS (Fase 1; copas Fase 3; foto y comentario Fase 4)
CREATE TABLE task_completions (
    id               UUID PRIMARY KEY,
    task_id          UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    occurrence_date  DATE NOT NULL,                  -- fecha original de la ocurrencia
    completed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    points_awarded   SMALLINT NOT NULL DEFAULT 0,    -- Fase 3: lo decide el servidor
    comment          TEXT,                           -- Fase 4
    photo_key        TEXT,                           -- Fase 4, clave en R2
    published_at     TIMESTAMPTZ,                    -- Fase 4: NULL = no publicado en el timeline
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ,                         -- desmarcar = borrado lógico
    version     INT NOT NULL DEFAULT 1,
    server_seq  BIGINT NOT NULL DEFAULT nextval('sync_seq'),
    UNIQUE (task_id, occurrence_date)                -- completar es idempotente
);
CREATE INDEX idx_completions_user_date ON task_completions(user_id, occurrence_date DESC) WHERE deleted_at IS NULL;

-- 8. AMISTADES (Fase 4)
CREATE TABLE friendships (
    id            UUID PRIMARY KEY,
    requester_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    addressee_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status        VARCHAR(10) NOT NULL CHECK (status IN ('pending','accepted','blocked')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (requester_id <> addressee_id)
);
-- Una sola relación por pareja, sin importar quién la pidió
CREATE UNIQUE INDEX uq_friendship_pair
    ON friendships (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id));

-- 9. ME GUSTA EN PUBLICACIONES (Fase 4)
CREATE TABLE post_likes (
    completion_id  UUID NOT NULL REFERENCES task_completions(id) ON DELETE CASCADE,
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (completion_id, user_id)              -- un me gusta por persona
);

-- 10. COMENTARIOS EN PUBLICACIONES (Fase 4)
CREATE TABLE post_comments (
    id             UUID PRIMARY KEY,
    completion_id  UUID NOT NULL REFERENCES task_completions(id) ON DELETE CASCADE,
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body           VARCHAR(500) NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at     TIMESTAMPTZ
);
CREATE INDEX idx_post_comments_completion ON post_comments(completion_id, created_at);
CREATE INDEX idx_completions_published ON task_completions(user_id, published_at DESC)
    WHERE published_at IS NOT NULL AND deleted_at IS NULL;
```

**Notas sobre el esquema:**

- **Grupo del completado.** La v1.0 copiaba `group_id` en cada completado. Lo quito: el grupo se obtiene de la tarea. ✅ **DECIDIDO (2026-11-24):** si una tarea cambia de grupo, sus copas pasadas pasan al grupo nuevo.
- **Racha.** Los campos de racha en `users` son una caché que actualiza el servidor al completar o desmarcar, y que un proceso diario corrige.
- **Movimientos.** Una ocurrencia movida conserva su `occurrence_date` original en el completado, así el vínculo con la plantilla no se rompe.

### 5.3. Cálculo de ocurrencias

Las ocurrencias de las recurrentes **no se guardan**: se calculan al vuelo para el rango que se muestra (día, semana o mes), tanto en el cliente (a partir de su copia local) como en el servidor (para widget, rankings y cuadrante de amigos):

1. Generar las fechas de la plantilla dentro del rango, entre `recurrence_start_date` y `recurrence_end_date`.
2. Quitar las que tengan excepción `SKIP`.
3. Sustituir las que tengan excepción `MOVE` por su nueva fecha, hora o duración.
4. Unir las tareas puntuales del rango.
5. Marcar como hechas las que tengan completado no borrado para esa `occurrence_date`.

Este motor vive en un único módulo con muchos tests (meses de 28 a 31 días, cambio de hora, cruce de medianoche, excepciones).

### 5.4. Protocolo de sincronización

- **Subida (`POST /sync/push`).** El cliente envía su cola de cambios. Cada cambio lleva la fila completa y la `version` sobre la que se hizo.
  - Si coincide con la del servidor: se aplica.
  - Si no coincide: gana el último en llegar (se aplica igualmente) y el servidor devuelve la versión final (✅ decidido, ver M05).
  - Completados: se insertan con `ON CONFLICT (task_id, occurrence_date)` para que repetir sea inofensivo.
- **Bajada (`GET /sync/pull?since=<server_seq>`).** Devuelve todas las filas del usuario con `server_seq` mayor que el cursor, incluidas las borradas, y el nuevo cursor.
- **Cuándo se sincroniza (Fase 1):** al abrir la app, al recuperar la conexión, tras cada cambio local y cada 30 s mientras la app está en primer plano (✅ **DECIDIDO 2026-11-24**).
- **Fase 2:** al recibir cambios de otro dispositivo, el servidor envía un mensaje de datos FCM a los Android del usuario, que hacen `pull` en segundo plano y refrescan widget y notificación.
- **Tiempo real con WebSockets o SSE:** se deja para más adelante. Con el sondeo y FCM basta para un uso personal y funciona en cualquier hosting gratuito.

### 5.5. Reglas de privacidad en el backend (contrato crítico, Fase 4)

Cuando el usuario A pide el cuadrante del amigo B para la fecha D:

1. Comprobar que existe amistad `accepted` entre A y B, y que B tiene `social_enabled` y `share_schedule` activos. Si no, `404` (no se revela si B existe).
2. Calcular las ocurrencias de B en D (§5.3) y, para cada una con hora:
   - Grupo visible → `{ title, start, duration, group_name, color_hex }`.
   - Grupo no visible y `BUSY` → `{ id: <aleatorio por petición>, title: "OCUPADO", start, duration, color_hex: "#9CA3AF", masked: true }`, sin `group_id`, `task_id` ni notas. `duration` es `null` si la tarea no tiene duración; el amigo ve entonces una marca "OCUPADO" a esa hora.
   - Grupo no visible y `HIDDEN` → no se incluye.
   - Tarea sin grupo → se trata como no visible y `BUSY`. ✅ **DECIDIDO 2026-11-24** (lo más privado por defecto).
3. El timeline solo devuelve completados con `published_at` no nulo, no borrados y de grupos visibles en ese momento. Dar me gusta, comentar o leer comentarios exige pasar el mismo filtro sobre la publicación. Los rankings de amigos suman todas las copas, pero el desglose por grupo solo incluye grupos visibles; el resto se devuelve como un total "Otros" sin `group_id`, nombre ni color.
4. Las fotos de completados se sirven con URLs prefirmadas de corta duración, solo tras pasar este filtro.

Los tests de QA comprueban el **cuerpo de la respuesta HTTP**, no la pantalla: una tarea `HIDDEN` no debe aparecer en ningún campo del JSON.

---

## 6. Metodología: Spec-Kit + harness de agentes

### 6.1. Estructura del repositorio

```text
taskillo/
├── .specify/
│   └── memory/constitution.md     # Principios de §1, decisiones ✅ y reglas de privacidad
├── specs/                         # Una carpeta por spec (spec.md, plan.md, tasks.md)
│   ├── 001-cuenta-y-sesiones/
│   ├── 002-grupos-y-sincronizacion/      # la sincronización va pronto (local-first)
│   ├── 003-tareas-recurrencias-alarmas/
│   ├── 004-lista-calendario-cuadrante/
│   ├── 005-widget-y-notificacion/        # Fase 2
│   ├── 006-gamificacion/                 # Fase 3
│   ├── 007-social-y-privacidad/          # Fase 4
│   └── 008-asistente/                    # Fase 5
├── .claude/
│   ├── agents/
│   │   ├── director.md
│   │   ├── desarrollo.md
│   │   ├── qa.md
│   │   └── redactor.md                # Haiku, solo para textos
│   └── informes/                  # Decisiones del Director y actas de QA
├── apps/
│   ├── api/                       # Backend Hono + Drizzle + migraciones
│   └── app/                       # App Flutter (PC + Android) + widget Android en Kotlin
├── packages/
│   └── contrato/                  # OpenAPI y esquemas compartidos
└── docker-compose.yml             # PostgreSQL 16 + API para desarrollo local y VPS
```

### 6.2. Harness ajustado al plan Pro

Con el plan Pro, tres agentes trabajando en cada paso agotan el límite de uso muy rápido. Reparto propuesto:

| Rol | Cuándo actúa | Qué hace |
| :--- | :--- | :--- |
| **Director** | **Solo al principio y al final de cada spec** | Al principio: revisa `spec.md`, escribe `plan.md` y `tasks.md`, y deja las decisiones técnicas en `.claude/informes/`. Al final: revisa el informe de QA y cierra la spec o abre tareas de corrección. No escribe código ni participa en cada tarea. |
| **Desarrollo** | En cada tarea de `tasks.md` | Implementa una tarea cada vez, con sus tests unitarios, sin cambiar contratos de API ni reglas de privacidad sin pasar por el Director. |
| **QA** | Al terminar un bloque de tareas (no tras cada una) | Ejecuta tests, revisa criterios de aceptación y casos límite (zonas horarias, meses cortos, medianoche, conflictos sin conexión, fugas de privacidad) y emite un informe `PASS`/`FAIL` con pasos para reproducir. |

**Reglas de ahorro:**

- El Director trabaja con documentos breves: specs y planes, no el repositorio entero.
- Una sesión de Claude Code por spec; se cierra al acabar para no arrastrar contexto.
- QA ejecuta solo los tests afectados mientras se corrige, y la batería completa al cerrar la spec.

**Modelos por rol (✅ DECIDIDO 2026-11-24): Sonnet por defecto y Opus solo cuando la tarea lo pide.**

| Rol | Modelo por defecto | Cuándo subir a Opus |
| :--- | :--- | :--- |
| **Director** | Sonnet | Decisiones de arquitectura o con difícil vuelta atrás: diseño de la sincronización, reglas de privacidad, cambios en el esquema de datos, motor de recurrencias, y bloqueos que Sonnet no ha resuelto en dos intentos. |
| **Desarrollo** | Sonnet | Solo si una tarea concreta falla repetidamente con Sonnet (por ejemplo, un error de concurrencia o de zonas horarias difícil de localizar). |
| **QA** | Sonnet | Auditoría de privacidad de la Fase 4 (comprobar que nada privado viaja en las respuestas). |

- En Claude Code, cada subagente fija su modelo en la cabecera de su archivo `.md` (`model: sonnet`). Para una tarea puntual que necesite Opus, se cambia el modelo de la sesión con `/model` y se vuelve a Sonnet al acabar.
- El Director indica en su plan qué tareas necesitan Opus, para que el cambio de modelo sea una decisión consciente y no un hábito.
- ✅ **DECIDIDO (2026-11-24):** Haiku se usa solo para escribir (informes, resúmenes, mensajes de commit, documentación) y tareas muy fáciles y puntuales. Nunca para lógica de la app, privacidad ni esquema.
- Antes de empezar, conviene comprobar qué modelos incluye tu plan Pro en Claude Code y cuánto consume cada uno, porque cambia a menudo.

### 6.3. Criterios de aceptación del MVP (Fase 1)

- Crear una tarea con solo el título, y otra con fecha, hora, duración, grupo y alarma.
- Crear una recurrente "lunes y jueves a las 18:00" y verla en el calendario de los próximos dos meses.
- Saltar un lunes concreto y mover un jueves concreto a las 20:00, sin afectar a los demás.
- Una tarea a las 23:00 con 120 min aparece en el cuadrante de ambos días.
- La alarma de una recurrente suena cada ocurrencia en Android y no suena si ya está completada.
- Completar en el PC se ve en el móvil en menos de 30 s con ambos abiertos.
- Con el móvil sin conexión: completar dos tareas y borrar otra; al reconectar, el PC refleja los tres cambios.
- Borrar una tarea en el PC con el móvil sin conexión: al reconectar, desaparece del móvil.
- Cerrar sesión en todos los dispositivos invalida el refresh token de los demás.

---

## 7. Decisiones pendientes

| # | Decisión | Opciones | Recomendación |
| :--- | :--- | :--- | :--- |
| 1 | Crear el buzón `no-reply@devkomp.es` en el panel de IONOS | Lo hace Rafa | Necesario antes de probar el correo real; en desarrollo basta con Mailpit. |
| 2 | Comprobar SPF, DKIM y DMARC de `devkomp.es` | Rafa o Manuel desde el panel de IONOS | Necesario antes de enviar correos a otras personas. |
| 3 | Subdominio para la API (por ejemplo `api.taskillo.devkomp.es`) apuntando al VPS | Rafa, registro DNS en IONOS | Necesario para el HTTPS y antes del primer despliegue. |
| 4 | Usuario y clave SSH de despliegue en el VPS | Rafa crea el usuario; Manuel genera la clave | Necesario antes del primer despliegue desde GitHub Actions. |

Ya no hace falta comprar un dominio: el correo y la API usan `devkomp.es`.

## 8. Resumen de suposiciones

Todas las suposiciones del documento se revisaron con Manuel el 2026-11-24 y pasaron a decididas. No queda ninguna abierta.

