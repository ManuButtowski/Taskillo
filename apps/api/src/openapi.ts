// Documento OpenAPI de la API, generado desde las rutas (Zod). Es la única fuente del contrato:
// `pnpm --filter contrato generar` lo vuelca a packages/contrato/openapi.json y un test comprueba
// que el fichero versionado coincide.
import { createApp } from './app.js';
import { createLogger } from './lib/logger.js';

export function buildOpenApiDocument() {
  const app = createApp({ logger: createLogger({ write: () => {} }) });
  return app.getOpenAPI31Document({
    openapi: '3.1.0',
    info: { title: 'Taskillo API', version: '0.1.0', description: 'API de Taskillo.' },
  });
}

/** Serialización estable del contrato (misma para el script y para el test). */
export function serializeOpenApi(doc: unknown): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}
