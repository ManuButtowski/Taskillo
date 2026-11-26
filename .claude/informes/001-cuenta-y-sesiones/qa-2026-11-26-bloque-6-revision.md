# QA 001-cuenta-y-sesiones · bloque 6 (revisión) · 2026-11-26

**Resultado:** PASS

Revisión de los hallazgos 1 y 2 (y los tests opcionales de router y cierre de dispositivo) corregidos en 55c50c4.

## Tests ejecutados
- `flutter analyze` en apps/app: sin problemas.
- `flutter test` en apps/app: 97 aprobados, 0 fallidos (antes 89).
- `git diff 16f6dc5 55c50c4 -- apps/app/lib`: vacío. El commit solo toca 4 ficheros de test (`router_test.dart`, `campo_clave_test.dart`, `register_screen_test.dart`, `profile_screen_test.dart`); no cambia comportamiento.

## Mutaciones repetidas en un árbol temporal
| Mutación | Resultado |
| :--- | :--- |
| Usuario ocupado en el aviso general en vez de en su campo (hallazgo 1) | Detectada |
| `CampoClave` con `obscureText: false` (hallazgo 2) | Detectada (2 tests) |
| `autocorrect: true` en `CampoClave` | Detectada |
| `enableSuggestions: true` en `CampoClave` | Detectada |
| Router: anónimo llega a cualquier ruta | Detectada |
| Router: con sesión se ven login/registro | Detectada |

Con el código real los tests pasan.

## Criterios de aceptación
- [x] T024, usuario ocupado marcado en su campo: ahora el test lo distingue del aviso general.
- [x] Campos de contraseña ocultos, sin autocorrección ni sugerencias, con botón que alterna: cubierto.
- [x] Router (hallazgo 3) y cierre de otro dispositivo con 404 y error genérico (hallazgo 4): cubiertos.

## Hallazgos
Ninguno nuevo. Siguen abiertos solo los leves ya anotados y no bloqueantes: `url_launcher` sin uso y texto de T025 para el Director, 429 en login sin test, y los apuntes de diseño del informe del bloque 6.
