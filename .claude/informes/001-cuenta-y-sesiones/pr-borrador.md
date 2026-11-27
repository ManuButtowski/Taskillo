**Título:** Spec 001: cuenta y sesiones (borrador)

Borrador para que corra la CI mientras se cierra la spec. No fusionar todavía.

## Qué incluye

- **API** (bloques 1-4, QA en PASS): registro en dos pasos con código por correo, login,
  sesiones con refresh token rotatorio y detección de reutilización, cierre de sesión en uno
  o en todos los dispositivos, recuperación y cambio de contraseña, limitadores, contrato
  OpenAPI generado.
- **App Flutter** (bloques 5-6, QA en PASS): cliente con renovación transparente, sesión con
  Riverpod, pantallas de registro, login, recuperación y perfil, estados de red y error.
- **CI y despliegue** (bloque 7): `ci.yml` (API con PostgreSQL 16 y app), imagen y compose de
  producción con Caddy, `deploy.yml` (manual o por etiqueta `v*`).

## Pendiente antes de fusionar

- [ ] CI en verde.
- [ ] T031: verificación de extremo a extremo (PC y Android).
- [ ] QA del bloque 7 y cierre de la spec por el Director.
- [ ] Primer despliegue: VPS, subdominio, usuario SSH, SMTP y secretos (Rafa).
