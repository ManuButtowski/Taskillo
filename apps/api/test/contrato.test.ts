// El contrato versionado (packages/contrato/openapi.json) debe coincidir con el generado desde Zod.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument, serializeOpenApi } from '../src/openapi.js';

const CONTRATO = fileURLToPath(new URL('../../../packages/contrato/openapi.json', import.meta.url));

describe('contrato OpenAPI', () => {
  it('openapi.json está al día: ejecuta `pnpm --filter contrato generar` y súbelo', () => {
    const versionado = readFileSync(CONTRATO, 'utf8').replace(/\r\n/g, '\n');
    expect(versionado).toBe(serializeOpenApi(buildOpenApiDocument()));
  });

  it('documenta GET /health', () => {
    const doc = buildOpenApiDocument();
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.paths?.['/health']?.get?.responses?.['200']).toBeDefined();
  });
});
