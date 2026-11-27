# T031 · Verificación de extremo a extremo · 2026-11-27

Recorrido de `quickstart.md` con Manuel en local: API y PostgreSQL 16 en Docker, Mailpit,
app Flutter en Windows (debug y `--profile`) y en el emulador Android `Taskillo_Pixel`
(API en `10.0.2.2:3000`). Cada paso se contrastó con el log de la API, la base de datos y
Mailpit, no solo con lo que mostraba la pantalla.

## Preparación del PC

- NDK 28.2.13676358 instalado. Con las Android CLI nuevas el paquete es `ndk/28.2.13676358`;
  `ndk;28.2...` da "not found".
- Modo desarrollador de Windows activado (lo pide Flutter para los plugins).
- Componente **C++ ATL** añadido a Visual Studio Build Tools 2022
  (`Microsoft.VisualStudio.Component.VC.ATL`): sin él `flutter_secure_storage_windows` no
  compila (`atlstr.h`). Conviene añadirlo a la guía de entorno.

## Resultados por paso

| Paso | Resultado | Evidencia |
| :--- | :--- | :--- |
| 6. Registro en dos pasos (Windows) | OK | `register` 202, código en Mailpit, `register/complete` 201 (hubo un 422 previo por validación) |
| 6. Repetir registro con el mismo correo | OK | Mismo mensaje en la app; "Ya tienes una cuenta en Taskillo" en Mailpit |
| 7. Reabrir con sesión guardada y sin red | OK | Con la API parada, la app abre en "Hola, Manuel" |
| 8. Login en Android y dos dispositivos | OK | `login` 200 desde el emulador; Perfil lista Windows y Android |
| Cerrar sesión de otro dispositivo | OK | `DELETE /me/sessions/{id}` 204; el móvil vuelve a login con "Tu sesión ha caducado" en su siguiente renovación (`refresh` 401) |
| 9. Cerrar sesión en todos | OK | `logout-all` 204; sesiones revocadas en la base de datos |
| 10. He olvidado mi contraseña | OK | `forgot-password` 202, correo en Mailpit, `GET` y `POST reset-password` 200, login con la nueva 200 |

El primer intento del paso 10 no llegó a enviar el formulario (ninguna petición en el log);
el segundo, vigilado en directo, funcionó completo.

## Criterios de éxito

- **SC-001 (cuenta en menos de 2 min): sin medir con cronómetro.** Desde el correo con el
  código hasta la cuenta creada pasaron unos 3 minutos, con un 422 intermedio y leyendo las
  instrucciones por primera vez. Repetir la medición con el flujo ya conocido antes de darlo
  por cumplido.
- **SC-004 (abrir sin conexión con sesión guardada en menos de 2 s): cumple.** Windows,
  `--profile --trace-startup`, API parada: primer fotograma pintado a 0,39 s
  (`timeToFirstFrameMicros` 90 060, `timeToFirstFrameRasterizedMicros` 388 824), y la
  pantalla mostrada es "Hola, Manuel".
- SC-002, SC-003 y SC-005 están cubiertos por los tests de la API (QA de los bloques 2 a 4).

## Secretos

Solo `.env.example` está versionado. `git grep` de patrones de claves y tokens (claves
privadas, `ghp_`, `github_pat_`, `AKIA`, `sk_live_`, `re_`, `xox`) en todo el historial: sin
coincidencias reales (solo el texto del informe de QA que enumera los patrones).

## Deuda técnica y decisiones para el cierre

1. **Cierre de sesión remoto no inmediato:** el access token sigue valiendo hasta 15 min tras
   cerrar la sesión de otro dispositivo, porque el middleware no consulta la base de datos.
   Es el diseño actual (el quickstart lo describe así). Decidir si se comprueba la familia en
   cada petición (una consulta más) o se acepta.
2. **SC-001** pendiente de medir con cronómetro.
3. **T025:** reformular la tarea (el enlace del correo abre una página de la API, la app no
   lo conoce) y decidir si se quita `url_launcher`, que no se usa.
4. **Contrato:** documentar los errores generales (`invalid_json`, `unsupported_media_type`,
   `bad_request`, `internal_error`) y que un cambio de contraseña correcto puede recibir 429
   con 5 fallos en curso.
5. **Tests:** dos `reset-password` simultáneos con el mismo enlace (solo comprobado a mano) y
   429 en el login desde la app.
6. **`device_id`** nuevo en cada login: deja dispositivos huérfanos al volver a entrar tras
   caducar; la spec de sincronización necesitará uno estable por instalación.
7. **Logout sin red:** la sesión del servidor sigue viva hasta que caduca.
8. **`https` en release de Windows:** nada impide una `API_BASE_URL` con `http`.
9. **Despliegue:** grupo `docker` del usuario SSH (decisión de Rafa), Caddy sin healthcheck,
   actions por versión mayor en vez de SHA, entorno `produccion` con revisores por configurar.
10. **Diseño (leves de QA):** "Cambiar correo" tras el paso 1 del registro, campos editables
    durante el envío, botón de mostrar contraseña en el orden de tabulación, texto "Enviando"
    fijo en los botones.
11. **"Hace falta conexión"** no distingue sin red de servidor sin respuesta.
12. **Entorno:** documentar ATL, NDK 28.2 y Modo desarrollador en la guía de instalación.
