# QA 001-cuenta-y-sesiones · bloque 7, revisión de correcciones · 2026-11-27

**Resultado:** PASS

Commits revisados: 0c42036 (hallazgo 3), e180b51 (hallazgos 1, 4 y 5 en deploy.yml), 44e120f (hallazgos 2 y 5 en el runbook). Informe previo: qa-2026-11-27-bloque-7.md.

## Tests ejecutados
- `pnpm test`: 22 ficheros, **298 aprobados, 0 fallidos**.
- `pnpm typecheck`: sin errores.
- `actionlint` (rhysd/actionlint:latest): sin avisos.
- Mutaciones en árbol temporal sobre `config.ts` (sin tocar el repo):
  - A) quitar la comprobación en producción: fallan 5 tests.
  - B) volver al prefijo antiguo `^valor-de-ejemplo`: fallan los 3 tests nuevos (ci.yml, genérico, "cambialo").
  - C) quitar solo `cambialo` de la regex: falla el test de "cambialo".
  Los tests nuevos detectan las regresiones.

## Criterios de aceptación (hallazgos del informe anterior)
- [x] **Hallazgo 1 (grave), corregido.** Extraje el script remoto tal cual de `deploy.yml` y lo envié por tubería a `bash -s` con el compose de producción (imagen API construida localmente, proyecto Compose aparte `qatmp2`, puertos 18080/18443 para no chocar con 80/443; solo se sustituyó el `pull` por `true` porque la imagen es local). Resultado: el script llega a `up -d --remove-orphans --wait`, los contenedores arrancan, se imprime el marcador final y el código de salida es 0; `ps` muestra `api Up (healthy)`.
- [x] `--wait` funciona con el healthcheck de la imagen: espera a que `api` quede `Healthy`. Con la API rota (JWT_SECRET de ejemplo en producción) el script termina con código 1 (`container ... is unhealthy`), así que un despliegue fallido ya pone el job en rojo.
- [x] Script con `set -euo pipefail`: si el `.env` no tiene `API_IMAGE`, el `grep` va dentro de `$(... || true)`, la rama `else` añade la línea y el script sigue (probado: queda una sola línea `API_IMAGE=`). `API_IMAGE` ya no se exporta; el `pull` y el `up` toman la imagen del `.env` reescrito (comprobado: tras el script `.env` contiene la imagen nueva y `.deploy-previous-image` la anterior). El `sed` con `|` es correcto para referencias de imagen (solo letras, dígitos, `/`, `:`, `.`, `-`, `_`); no hay `|`, `&` ni `\` posibles porque el valor lo genera el workflow.
- [x] Limpieza: solo lista `docker image ls <repo de la API>`, excluye la actual y la anterior, y `|| true`. Comprobado en la prueba: intentó borrar otra etiqueta del mismo repo que usaba un contenedor y Docker se negó (error ignorado); nunca se fuerza el borrado ni se tocan otros repositorios.
- [x] **Hallazgo 3 (leve), corregido.** En producción se rechaza todo `JWT_SECRET` que contenga `ejemplo|example|cambialo|changeme` (sin distinguir mayúsculas). Verificado en la imagen: el error nombra solo `JWT_SECRET` y no imprime el valor (test existente "sin revelar su valor" sigue en verde). Falsos positivos: con `openssl rand -base64 48` la probabilidad de contener una de esas palabras es de ~1e-11; 200000 secretos aleatorios simulados dieron 0 coincidencias. Aceptable.
- [x] **Hallazgo 2 (medio), documentado.** El runbook explica que el grupo `docker` equivale a root, con tres alternativas (aceptar con mitigaciones, `restrict,command=` con script fijo, Docker rootless) y la marca como decisión pendiente de Rafa. Los secretos `DEPLOY_*` pasan a ser del entorno `produccion` con revisores obligatorios y restricción a `main` y `v*`; además el job `desplegar` lleva `if:` por rama/tag.
- [x] **Hallazgo 4 (leve), corregido:** limpieza limitada al repositorio de la API, sin `prune` global.
- [x] **Hallazgo 5 (leve), corregido:** `API_IMAGE` escrita en el `.env` del VPS, anterior guardada en `.deploy-previous-image`, y el runbook documenta despliegue manual coherente y vuelta atrás (con la advertencia de que las migraciones solo avanzan).

## Hallazgos nuevos (todos leves, no impiden el PASS)
1. **[leve]** El `if: github.ref == main || v*` está solo en el job `desplegar`. Un `workflow_dispatch` desde otra rama aún ejecuta el job `imagen` (con `packages: write`) y publica una imagen `sha-<commit>` en GHCR, aunque no se despliegue. Recomendación: poner el mismo `if:` en `imagen`.
2. **[leve]** Si el `.env` del VPS no acaba en salto de línea, `echo "API_IMAGE=..." >> .env` (solo cuando falta la variable) pegaría la línea a la última. Poco probable porque el runbook crea el `.env` con `API_IMAGE`. Se puede cubrir con `printf '\nAPI_IMAGE=%s\n'`.
3. **[leve]** Caddy no tiene healthcheck, así que `--wait` solo comprueba que está "running" para él; la API sí se comprueba. Aceptable.
4. La prueba de `--wait` fue local (Docker Desktop, mismo compose y mismo script); no se ha probado contra el VPS real ni con GitHub Actions.
