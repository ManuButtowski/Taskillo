// Aplica las migraciones SQL versionadas de `apps/api/drizzle/` (nunca `drizzle-kit push`).
// En el despliegue: `node dist/migrate.js`; en local: `pnpm db:migrate`.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type postgres from 'postgres';
import { createSqlClient } from './db/client.js';
import { createLogger } from './lib/logger.js';

// Desde src/ y desde dist/ la carpeta queda en el mismo sitio relativo.
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url));

export async function runMigrations(
  databaseUrl: string,
  options: postgres.Options<{}> = {},
): Promise<void> {
  const client = createSqlClient(databaseUrl, { ...options, max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await client.end();
  }
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const logger = createLogger();
  const url = process.env.DATABASE_URL;
  if (!url) {
    logger.error('Falta DATABASE_URL');
    process.exit(1);
  }
  try {
    await runMigrations(url, { onnotice: () => {} });
    logger.info('migraciones aplicadas');
  } catch (err) {
    // Solo nombre y mensaje del error, nunca la URL de conexión.
    logger.error('fallo al aplicar las migraciones', { error: err });
    process.exit(1);
  }
}
