import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export type SqlClient = postgres.Sql;

/**
 * Cliente `postgres` con la zona de la sesión fijada a UTC: las fechas se guardan como
 * TIMESTAMPTZ y las caducidades se calculan en SQL con now() (data-model.md, "Tiempo").
 */
export function createSqlClient(url: string, options: postgres.Options<{}> = {}): SqlClient {
  return postgres(url, {
    ...options,
    connection: { ...options.connection, TimeZone: 'UTC' },
  });
}

export function createDb(url: string, options: postgres.Options<{}> = {}) {
  const client = createSqlClient(url, options);
  return { client, db: drizzle(client, { schema }) };
}

export type Database = ReturnType<typeof createDb>;
