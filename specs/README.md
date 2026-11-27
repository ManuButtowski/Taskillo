# Specs de Taskillo

Cada spec sigue el ciclo de Spec-Kit: `spec.md` (qué y por qué) → `plan.md` (cómo, lo
escribe el Director con `/speckit-plan`) → `tasks.md` (lo escribe el Director con
`/speckit-tasks`) → implementación (Desarrollo) → informe de QA → cierre (Director).

## Fase 1 — MVP (PC con Windows + Android)

Se implementan **en este orden**, porque cada una se apoya en la anterior.

| Spec | Módulos | Estado | Depende de |
| :--- | :--- | :--- | :--- |
| [001-cuenta-y-sesiones](001-cuenta-y-sesiones/spec.md) | M01 (correo y contraseña) + base del monorepo | cerrada (PASS de QA; ver `.claude/informes/001-cuenta-y-sesiones/cierre.md`) | — |
| [002-grupos-y-sincronizacion](002-grupos-y-sincronizacion/spec.md) | M02 + M05 | spec escrita | 001 |
| [003-tareas-recurrencias-alarmas](003-tareas-recurrencias-alarmas/spec.md) | M03 | spec escrita | 002 |
| [004-lista-calendario-cuadrante](004-lista-calendario-cuadrante/spec.md) | M04 | spec escrita | 003 |

**Cambio respecto a §6.1 de la especificación:** la sincronización sube del puesto 004 al
002, junto a los grupos. En un diseño local-first todas las escrituras pasan por la cola
de sincronización; montándola pronto, con la entidad más sencilla, las tareas y las vistas
no tienen que rehacer su capa de datos después.

Los criterios de aceptación del MVP (§6.3) quedan repartidos así:

| Criterio §6.3 | Spec |
| :--- | :--- |
| Tarea solo con título, y otra con fecha, hora, duración, grupo y alarma | 003 |
| Recurrente "lunes y jueves a las 18:00" en el calendario de dos meses | 003 (motor) + 004 (vista) |
| Saltar un lunes y mover un jueves a las 20:00 | 003 |
| Tarea a las 23:00 de 120 min en el cuadrante de ambos días | 004 |
| La alarma suena cada ocurrencia y no si ya está completada | 003 |
| Completar en el PC se ve en el móvil en menos de 30 s | 002 (motor) + 003 (completados) |
| Sin conexión: completar dos, borrar una y reflejarlo al reconectar | 002 + 003 |
| Borrar en el PC con el móvil sin conexión desaparece al reconectar | 002 |
| Cerrar sesión en todos invalida los refresh tokens | 001 |

## Fases siguientes (sin spec todavía)

Por el principio de alcance mínimo, estas specs se escriben con `/speckit-specify` cuando
la fase anterior esté cerrada y en uso, partiendo de su módulo en `docs/especificacion.md`.

| Spec prevista | Fase | Módulos |
| :--- | :--- | :--- |
| 005-widget-y-notificacion | 2 | M06 + Google, foto de perfil (R2) y "Recomendar Taskillo" de M01 |
| 006-gamificacion | 3 | M07 (copas, rachas, gráficos, ranking de mis grupos) |
| 007-social-y-privacidad | 4 | M08 + rankings entre amigos de M07 |
| 008-asistente | 5 | M09 |

## Cómo arrancar una spec ya escrita

Las specs 001–004 se escribieron a mano, no con `/speckit-specify`, así que hay que decirle
a Spec-Kit cuál es la spec activa antes de `/speckit-plan`. El Director lo hace solo, pero
a mano es así (desde Git Bash, en la raíz del repositorio):

```bash
git checkout -b 001-cuenta-y-sesiones
echo '{"feature_directory":"specs/001-cuenta-y-sesiones"}' > .specify/feature.json
```

`.specify/feature.json` está en el `.gitignore` de Spec-Kit: es estado local de cada
equipo.
