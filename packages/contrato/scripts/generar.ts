// Vuelca el contrato OpenAPI generado desde la API a packages/contrato/openapi.json.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildOpenApiDocument, serializeOpenApi } from '../../../apps/api/src/openapi.js';

const destino = fileURLToPath(new URL('../openapi.json', import.meta.url));
writeFileSync(destino, serializeOpenApi(buildOpenApiDocument()));
console.log(`contrato generado en ${destino}`);
