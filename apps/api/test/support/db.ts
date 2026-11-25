// Utilidades comunes para los tests que usan PostgreSQL real.
// La base sale SIEMPRE de TEST_DATABASE_URL y se vacía en cada ejecución: por eso se niegan a
// arrancar si falta o si apunta a la misma base que DATABASE_URL (nunca tocar datos reales).
import { createDb, type Database } from '../../src/db/client.js';
import { runMigrations } from '../../src/migrate.js';

const quiet = { onnotice: () => {} };

function sameDatabase(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.hostname === ub.hostname && ua.port === ub.port && ua.pathname === ub.pathname;
  } catch {
    return false;
  }
}

/** Valida las URLs y devuelve la de tests. Lanza un error sin incluir ninguna URL (llevan credenciales). */
export function assertTestDatabaseUrl(testUrl: string | undefined, databaseUrl: string | undefined): string {
  if (!testUrl) {
    throw new Error('Falta TEST_DATABASE_URL: los tests de base de datos necesitan su propia base');
  }
  if (databaseUrl && sameDatabase(testUrl, databaseUrl)) {
    throw new Error('TEST_DATABASE_URL no puede coincidir con DATABASE_URL');
  }
  return testUrl;
}

export function testDatabaseUrl(): string {
  return assertTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL);
}

/** Parte de cero: borra los esquemas, aplica las migraciones reales y devuelve la conexión. */
export async function setupTestDb(): Promise<Database> {
  const url = testDatabaseUrl();
  const admin = createDb(url, { max: 1, ...quiet });
  try {
    await admin.client.unsafe(
      'DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;',
    );
  } finally {
    await admin.client.end();
  }
  await runMigrations(url, quiet);
  return createDb(url, quiet);
}

/** Vacía todas las tablas del esquema public (también las que añadan specs futuras). */
export async function truncateAll(sql: Database['client']): Promise<void> {
  const rows = await sql<{ name: string }[]>`
    SELECT quote_ident(tablename) AS name FROM pg_tables WHERE schemaname = 'public'`;
  if (rows.length === 0) return;
  await sql.unsafe(`TRUNCATE ${rows.map((r) => r.name).join(', ')} CASCADE`);
}
