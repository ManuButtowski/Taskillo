#!/bin/sh
# Crea la base exclusiva de los tests (taskillo_test) si no existe. Es idempotente.
# - Volumen nuevo: PostgreSQL ejecuta este script solo (/docker-entrypoint-initdb.d).
# - Volumen ya creado: `pnpm db:test:crear` lo vuelve a ejecutar dentro del contenedor.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
SELECT 'CREATE DATABASE taskillo_test' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'taskillo_test')\gexec
SQL
