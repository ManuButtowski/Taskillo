import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Los tests leen el .env de la raíz del repo (TEST_DATABASE_URL, etc.). loadEnvFile no pisa las
// variables ya definidas (CI, terminal). Sin .env no pasa nada: los tests que lo necesiten fallarán
// con un mensaje claro.
try {
  process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)));
} catch {
  // sin .env
}

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Todos los ficheros comparten la misma base de tests: se ejecutan de uno en uno.
    fileParallelism: false,
  },
});
