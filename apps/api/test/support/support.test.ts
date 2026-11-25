// Prueba las propias utilidades de test: guarda de TEST_DATABASE_URL, base real, FakeMailer y fábrica.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../src/db/client.js';
import { buildTestApp } from './app.js';
import { assertTestDatabaseUrl, setupTestDb, testDatabaseUrl, truncateAll } from './db.js';
import { FakeMailer } from './fake-mailer.js';

describe('assertTestDatabaseUrl', () => {
  const prod = 'postgres://u:p@localhost:5433/taskillo';

  it('se niega a arrancar si falta TEST_DATABASE_URL', () => {
    expect(() => assertTestDatabaseUrl(undefined, prod)).toThrow('Falta TEST_DATABASE_URL');
    expect(() => assertTestDatabaseUrl('', prod)).toThrow('Falta TEST_DATABASE_URL');
  });

  it('se niega si coincide con DATABASE_URL (idéntica o misma base con otras credenciales)', () => {
    const prodTest = 'postgres://u:p@localhost:5433/taskillo_test';
    expect(() => assertTestDatabaseUrl(prodTest, prodTest)).toThrow('no puede coincidir');
    expect(() => assertTestDatabaseUrl('postgres://otro:otra@localhost:5433/taskillo_test?x=1', prodTest)).toThrow(
      'no puede coincidir',
    );
  });

  it('se niega si el nombre de la base no termina en _test', () => {
    expect(() => assertTestDatabaseUrl(prod, undefined)).toThrow('_test');
    expect(() => assertTestDatabaseUrl('postgres://u:p@localhost:5433/taskillo_test_x', prod)).toThrow('_test');
    expect(() => assertTestDatabaseUrl('postgres://u:p@localhost:5433/', prod)).toThrow('_test');
  });

  it('no incluye ninguna URL en el mensaje de error', () => {
    try {
      assertTestDatabaseUrl(prod, prod);
    } catch (e) {
      expect(String(e)).not.toContain('postgres://');
    }
  });

  it('acepta una base distinta', () => {
    const test = 'postgres://u:p@localhost:5433/taskillo_test';
    expect(assertTestDatabaseUrl(test, prod)).toBe(test);
    expect(assertTestDatabaseUrl(test, undefined)).toBe(test);
  });

  it('el entorno de test cumple la guarda', () => {
    expect(() => testDatabaseUrl()).not.toThrow();
  });
});

describe('base de datos de tests', () => {
  let db: Database;
  beforeAll(async () => {
    db = await setupTestDb();
  });
  afterAll(async () => {
    await db?.client.end();
  });

  it('aplica las migraciones y truncateAll vacía todas las tablas', async () => {
    const [row] = await db.client<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`;
    expect(row?.n).toBeGreaterThanOrEqual(4);
    await db.client`INSERT INTO users (id, email, password_hash, username, display_name)
      VALUES (gen_random_uuid(), 'a@example.com', '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA', 'ana_t', 'Ana')`;
    await truncateAll(db.client);
    const [after] = await db.client<{ total: number }[]>`SELECT count(*)::int AS total FROM users`;
    expect(after?.total).toBe(0);
  });
});

describe('FakeMailer y buildTestApp', () => {
  it('FakeMailer guarda y filtra los correos', async () => {
    const m = new FakeMailer();
    await m.send({ to: 'a@x.es', subject: 's', text: 't', html: 'h' });
    await m.send({ to: 'b@x.es', subject: 's2', text: 't', html: 'h' });
    expect(m.last()?.to).toBe('b@x.es');
    expect(m.to('a@x.es')).toHaveLength(1);
    m.clear();
    expect(m.sent).toHaveLength(0);
  });

  it('buildTestApp devuelve una app funcional con FakeMailer y logs capturados', async () => {
    const { app, mailer, logs } = buildTestApp();
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(mailer).toBeInstanceOf(FakeMailer);
    expect(logs.some((l) => l.includes('"msg":"request"'))).toBe(true);
  });

  it('permite sustituir dependencias', async () => {
    const custom = new FakeMailer();
    const { app } = buildTestApp({ mailer: custom });
    expect((await app.request('/health')).status).toBe(200);
  });
});
