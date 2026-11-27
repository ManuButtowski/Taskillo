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

// T019 · el OpenAPI cubre contracts/api.md: mismas rutas y los códigos de la sección "Errores".
const API_MD = fileURLToPath(new URL('../../../specs/001-cuenta-y-sesiones/contracts/api.md', import.meta.url));
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/** Rutas `MÉTODO /ruta` de la tabla de api.md, con el prefijo /api/v1 salvo `(sin prefijo)`. */
function rutasDeApiMd(): string[] {
  const rutas: string[] = [];
  for (const linea of readFileSync(API_MD, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\| `(GET|POST|PUT|PATCH|DELETE) (\/[^\s`?]*)(?:\?[^`]*)?`( \(sin prefijo\))?/);
    if (m) rutas.push(`${m[1]} ${m[3] ? '' : '/api/v1'}${m[2]}`);
  }
  return rutas.sort();
}

function operaciones() {
  const doc = buildOpenApiDocument() as any;
  const ops: Record<string, any> = {};
  for (const [ruta, item] of Object.entries<any>(doc.paths ?? {})) {
    for (const m of METHODS) if (item[m]) ops[`${m.toUpperCase()} ${ruta}`] = item[m];
  }
  return { doc, ops };
}

const esErrorComun = (r: any) => r?.content?.['application/json']?.schema?.$ref === '#/components/schemas/Error';

describe('cobertura de contracts/api.md (T019)', () => {
  it('la lista de rutas del OpenAPI es exactamente la de api.md', () => {
    const esperadas = rutasDeApiMd();
    expect(esperadas.length).toBeGreaterThanOrEqual(15);
    expect(Object.keys(operaciones().ops).sort()).toEqual(esperadas);
  });

  it('401 con el esquema de error común (y WWW-Authenticate) en todas las rutas Bearer', () => {
    const bearer = Object.entries(operaciones().ops).filter(([, op]) => op.security);
    expect(bearer.length).toBe(7);
    for (const [clave, op] of bearer) {
      expect(esErrorComun(op.responses['401']), clave).toBe(true);
      expect(op.responses['401'].headers?.['WWW-Authenticate'], clave).toBeDefined();
    }
  });

  it('401 en login y refresh; 403 en /me/password; 404 en DELETE /me/sessions/{deviceId}', () => {
    const { ops } = operaciones();
    for (const clave of ['POST /api/v1/auth/login', 'POST /api/v1/auth/refresh']) expect(esErrorComun(ops[clave].responses['401']), clave).toBe(true);
    expect(esErrorComun(ops['POST /api/v1/me/password'].responses['403'])).toBe(true);
    expect(esErrorComun(ops['DELETE /api/v1/me/sessions/{deviceId}'].responses['404'])).toBe(true);
  });

  it('422 con el esquema de error en toda ruta con cuerpo o parámetros validados', () => {
    const { ops } = operaciones();
    const con422 = [
      'POST /api/v1/auth/register',
      'POST /api/v1/auth/register/complete',
      'POST /api/v1/auth/login',
      'POST /api/v1/auth/refresh',
      'POST /api/v1/auth/forgot-password',
      'POST /api/v1/auth/reset-password',
      'PATCH /api/v1/me',
      'POST /api/v1/me/password',
    ];
    for (const clave of con422) expect(esErrorComun(ops[clave].responses['422']), clave).toBe(true);
  });

  it('429 con el esquema de error y Retry-After en las rutas limitadas', () => {
    const { ops } = operaciones();
    const limitadas = [
      'POST /api/v1/auth/register',
      'POST /api/v1/auth/register/complete',
      'POST /api/v1/auth/login',
      'POST /api/v1/auth/forgot-password',
      'POST /api/v1/auth/reset-password',
      'POST /api/v1/me/password',
    ];
    for (const clave of limitadas) {
      expect(esErrorComun(ops[clave].responses['429']), clave).toBe(true);
      expect(ops[clave].responses['429'].headers?.['Retry-After'], clave).toBeDefined();
    }
  });

  it('reset-password POST admite cuerpo JSON y de formulario con el mismo esquema', () => {
    const contenido = operaciones().ops['POST /api/v1/auth/reset-password'].requestBody.content;
    expect(Object.keys(contenido).sort()).toEqual(['application/json', 'application/x-www-form-urlencoded']);
    expect(contenido['application/json'].schema.$ref).toBe('#/components/schemas/ResetPasswordRequest');
    expect(contenido['application/x-www-form-urlencoded'].schema.$ref).toBe('#/components/schemas/ResetPasswordRequest');
  });

  it('reset-password devuelve HTML en GET y las respuestas de formulario del POST son HTML', () => {
    const { ops } = operaciones();
    expect(ops['GET /api/v1/auth/reset-password'].responses['200'].content['text/html']).toBeDefined();
    expect(ops['GET /api/v1/auth/reset-password'].responses['400'].content['text/html']).toBeDefined();
  });
});
