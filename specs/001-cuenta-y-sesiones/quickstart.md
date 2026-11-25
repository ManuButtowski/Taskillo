# Quickstart · 001 Cuenta y sesiones

Escenario de validación de extremo a extremo, en local (Git Bash en la raíz del repositorio).
Los comandos exactos se fijan en la tarea T001/T003 y se copian a `CLAUDE.md`.

**Todo en local mientras Rafa no prepare el VPS, el subdominio y el buzón SMTP.** Nada de
esta guía necesita IONOS: el correo se captura en Mailpit y la base de datos es local o una
rama de desarrollo de Neon.

1. `cp .env.example .env` y ajustar solo si hace falta (los valores de ejemplo funcionan en local).
   - Base de datos: **PostgreSQL 16 en Docker** (`docker compose up -d postgres`), la vía
     elegida. Alternativa si Docker no está disponible: una rama de desarrollo de Neon
     (`DATABASE_URL` con su cadena y `sslmode=require`), nunca la de producción.
   - `TEST_DATABASE_URL` apunta a **otra** base de datos (los tests la vacían en cada ejecución).
   - Correo: `MAIL_DRIVER=smtp` hacia Mailpit (`SMTP_HOST=localhost`, `SMTP_PORT=1025`, sin
     TLS ni credenciales), con Docker (`docker compose up -d mailpit`).
2. `pnpm install`.
3. `pnpm --filter api db:migrate` y `pnpm --filter api dev` (API en `http://localhost:3000`).
4. `pnpm test` (API) y `cd apps/app && flutter test`.
5. `cd apps/app && flutter run -d windows` (y, con un móvil o emulador, `-d android`;
   en el emulador la API es `http://10.0.2.2:3000`).
6. Registrar una cuenta en la app en dos pasos: escribir el correo, copiar el código del
   correo que llega a Mailpit (`http://localhost:8025`) y completar nombre de usuario,
   nombre visible y contraseña; la app entra directamente. Repetir el paso 1 con el mismo
   correo: la app muestra el mismo mensaje y en Mailpit llega el aviso "ya tienes cuenta".
7. Cerrar la app y reabrirla (también con la red cortada): sigue dentro.
8. Iniciar sesión con la misma cuenta en Android. En Perfil, ver los dos dispositivos.
9. "Cerrar sesión en todos" desde el PC: el móvil vuelve a login en su siguiente renovación.
10. "He olvidado mi contraseña": recibir el correo en Mailpit, fijar una nueva y comprobar que
    todas las sesiones se cierran.
11. Con el contrato: `pnpm --filter contrato generar` no debe producir cambios en Git.

Criterios: SC-001 a SC-005 de `spec.md`. SC-004 se mide con la app en modo `--profile`.
