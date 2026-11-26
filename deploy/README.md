# Despliegue en el VPS

Arquitectura: `Internet -> Caddy (80/443, HTTPS automático) -> API (red interna, sin puerto
publicado) -> PostgreSQL en Neon`. Todo con `deploy/docker-compose.prod.yml`. Los valores entre
`<ESTOS_MARCADORES>` los pone quien despliega; en el repositorio nunca hay valores reales.

## Qué no negociar

- **`TRUST_PROXY=true` solo con Caddy delante** y el puerto de la API **sin publicar** (el compose
  de producción no tiene `ports:` en `api`). Si la API fuese accesible directamente, cualquiera
  podría falsear `X-Forwarded-For` y saltarse el limitador por IP.
- La API **no arranca** en producción con el `JWT_SECRET` de `.env.example`. Genera uno real:
  `openssl rand -base64 48`.
- Imagen de producción: solo dependencias de producción, usuario `node` (no root), sistema de
  ficheros de solo lectura en el compose.
- El `.env` del VPS contiene secretos: legible solo por el usuario de despliegue (`chmod 600`).

## Preparar el VPS (una vez, lo hace quien administra el VPS)

1. Docker Engine y el plugin Compose instalados.
2. DNS: un registro `A` (y `AAAA` si hay IPv6) de `<API_DOMAIN>` hacia la IP del VPS. Puertos 80 y
   443 abiertos en el cortafuegos (el 80 lo necesita Let's Encrypt).
3. Usuario sin privilegios, solo para desplegar, en el grupo `docker`:
   ```bash
   sudo adduser --disabled-password --gecos "" <DEPLOY_USER>
   sudo usermod -aG docker <DEPLOY_USER>
   ```
   Estar en el grupo `docker` equivale a root en ese equipo: no reutilices este usuario ni esta
   clave para nada más y no le des contraseña ni `sudo`.
4. Clave SSH **dedicada** (sin frase de paso, solo para este despliegue), generada fuera del VPS:
   `ssh-keygen -t ed25519 -f taskillo_deploy -C taskillo-deploy`. La pública va a
   `~<DEPLOY_USER>/.ssh/authorized_keys` (permisos `700` en `.ssh` y `600` en el fichero); la privada
   va solo al secreto de GitHub `DEPLOY_SSH_KEY` y se borra del equipo local.
5. Directorio de despliegue y `.env` (copia de `.env.example` con valores reales):
   ```bash
   sudo mkdir -p <DEPLOY_PATH> && sudo chown <DEPLOY_USER>: <DEPLOY_PATH>
   cd <DEPLOY_PATH>
   # copia aquí deploy/docker-compose.prod.yml y deploy/Caddyfile (el workflow los sincroniza)
   cp .env.example .env && chmod 600 .env   # y edítalo
   ```
   Variables a fijar en el `.env` del VPS: `API_DOMAIN`, `ACME_EMAIL`, `API_IMAGE`,
   `PUBLIC_BASE_URL=https://<API_DOMAIN>`, `DATABASE_URL` (Neon, con `?sslmode=require`),
   `JWT_SECRET` real, `MAIL_DRIVER`, `MAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`,
   `SMTP_USER`, `SMTP_PASSWORD`.
6. Huella del servidor para `DEPLOY_KNOWN_HOSTS` (se obtiene desde un equipo de confianza, mejor
   comparándola con la que muestra el panel del proveedor):
   `ssh-keyscan -t ed25519 <DEPLOY_HOST>`.

## Secretos de GitHub Actions (solo los nombres; Settings > Secrets and variables > Actions)

| Secreto | Contenido |
| :--- | :--- |
| `DEPLOY_SSH_KEY` | Clave privada SSH dedicada del usuario de despliegue |
| `DEPLOY_HOST` | Nombre o IP del VPS |
| `DEPLOY_USER` | Usuario de despliegue (`<DEPLOY_USER>`) |
| `DEPLOY_PATH` | Directorio de despliegue en el VPS (`<DEPLOY_PATH>`) |
| `DEPLOY_KNOWN_HOSTS` | Salida de `ssh-keyscan` del paso 6 (la clave del servidor) |

`GITHUB_TOKEN` (para publicar en GHCR) lo da Actions solo. Los tests de CI no usan secretos.
Recomendado: crear un *environment* `produccion` con revisión manual obligatoria y mover ahí los
secretos de despliegue.

## Desplegar

Actions > *Deploy* > *Run workflow* (disparo manual) o subir un tag `v*`. No se ejecuta en ramas ni en PR. El workflow construye y publica
`ghcr.io/<owner>/taskillo-api`, copia el compose y el Caddyfile, y en el VPS ejecuta `pull`,
las migraciones (`node dist/migrate.js`) y `up -d`. El paquete de GHCR es privado por defecto:
o se hace público, o el VPS hace `docker login ghcr.io` una vez con un token de solo lectura
de paquetes.

Comprobación: `curl https://<API_DOMAIN>/health`.

## Despliegue manual (sin Actions)

```bash
cd <DEPLOY_PATH>
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml run --rm api node dist/migrate.js
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml logs -f api
```
