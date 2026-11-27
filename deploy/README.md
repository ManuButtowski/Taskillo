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

## Secretos de GitHub Actions y entorno `produccion` (solo los nombres)

| Secreto | Contenido |
| :--- | :--- |
| `DEPLOY_SSH_KEY` | Clave privada SSH dedicada del usuario de despliegue |
| `DEPLOY_HOST` | Nombre o IP del VPS |
| `DEPLOY_USER` | Usuario de despliegue (`<DEPLOY_USER>`) |
| `DEPLOY_PATH` | Directorio de despliegue en el VPS (`<DEPLOY_PATH>`) |
| `DEPLOY_KNOWN_HOSTS` | Salida de `ssh-keyscan` del paso 6 (la clave del servidor) |

`GITHUB_TOKEN` (para publicar en GHCR) lo da Actions solo. Los tests de CI no usan secretos.
Los cinco `DEPLOY_*` se crean como secretos **del entorno `produccion`**, no del repositorio
(Settings > Environments > produccion), para que solo los vea un job que haya pasado sus reglas.
Reglas obligatorias del entorno `produccion`:

- *Required reviewers*: al menos un revisor que apruebe cada despliegue.
- *Deployment branches and tags*: solo `main` y el patrón de tags `v*`. (El job también lo
  comprueba con `if:`, pero la regla del entorno es la barrera real.)

### Decisión pendiente de Rafa: privilegios del usuario de despliegue

Un usuario en el grupo `docker` equivale a root en el VPS (puede montar `/` en un contenedor).
Si la clave `DEPLOY_SSH_KEY` se filtrase, el atacante controlaría todo el VPS. Alternativas, de
menos a más trabajo:

1. **Aceptar el riesgo** con las medidas de arriba (entorno con revisores, clave dedicada, usuario
   solo para esto, VPS solo para Taskillo). Es lo que describe este runbook.
2. **`restrict,command=` en `authorized_keys`**: la clave solo puede ejecutar un script fijo
   (`<DEPLOY_PATH>/deploy.sh`) que hace `pull`, migraciones y `up -d` con la imagen recibida en
   `SSH_ORIGINAL_COMMAND` (validada con una expresión regular). Requiere adaptar `deploy.yml`.
3. **Docker rootless** para el usuario de despliegue: un compromiso queda limitado a ese usuario,
   a costa de configurar los puertos 80/443 (p. ej. `net.ipv4.ip_unprivileged_port_start=80`).

## Desplegar

Actions > *Deploy* > *Run workflow* (disparo manual) o subir un tag `v*`. No se ejecuta en ramas ni en PR. El workflow construye y publica
`ghcr.io/<owner>/taskillo-api`, copia el compose y el Caddyfile, y en el VPS ejecuta `pull`,
las migraciones (`node dist/migrate.js`) y `up -d`. El paquete de GHCR es privado por defecto:
o se hace público, o el VPS hace `docker login ghcr.io` una vez con un token de solo lectura
de paquetes.

Comprobación: `curl https://<API_DOMAIN>/health`.

El workflow escribe la imagen desplegada (`API_IMAGE=ghcr.io/<owner>/taskillo-api:sha-<sha>`) en el
`.env` del VPS y guarda la anterior en `<DEPLOY_PATH>/.deploy-previous-image`. Tras desplegar, solo
se conservan en el VPS la imagen actual y la anterior; el resto de imágenes de la API se borran
(las de otros proyectos no se tocan).

## Despliegue manual y vuelta atrás

El `.env` ya lleva el `API_IMAGE` (sha) del último despliegue, así que el despliegue manual usa la
misma imagen que el workflow:

```bash
cd <DEPLOY_PATH>
grep '^API_IMAGE=' .env   # comprueba qué imagen se va a usar
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml run --rm -T api node dist/migrate.js </dev/null
docker compose -f docker-compose.prod.yml up -d --wait --wait-timeout 120
docker compose -f docker-compose.prod.yml logs -f api
```

**Volver al SHA anterior**: las migraciones solo avanzan, así que solo es seguro si la migración
nueva es compatible con el código anterior.

```bash
cd <DEPLOY_PATH>
anterior=$(cat .deploy-previous-image)
sed -i "s|^API_IMAGE=.*|API_IMAGE=${anterior}|" .env
docker compose -f docker-compose.prod.yml up -d --wait --wait-timeout 120
```
