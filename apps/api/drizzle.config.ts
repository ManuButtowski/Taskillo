import { defineConfig } from 'drizzle-kit';

// Solo `drizzle-kit generate` (pnpm db:generate); las migraciones se aplican con src/migrate.ts.
// Nunca `drizzle-kit push`.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  strict: true,
});
