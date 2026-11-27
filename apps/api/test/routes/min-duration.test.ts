// Suelo de tiempo de respuesta del registro (hallazgo 3 del QA del bloque 3), contra PostgreSQL real.
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/db/client.js';
import { startMinDuration } from '../../src/lib/min-duration.js';
import { buildTestApp } from '../support/app.js';
import { setupTestDb, truncateAll } from '../support/db.js';
import { FakeClock } from '../support/fake-clock.js';
import { codeFrom, postJson } from '../support/http.js';

const ARGON = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA';
const FLOOR = 50;

let db: Database;
let sql: Database['client'];

beforeAll(async () => {
  db = await setupTestDb();
  sql = db.client;
});
beforeEach(async () => {
  await truncateAll(sql);
});
afterAll(async () => {
  await sql.end();
});

function build() {
  const clock = new FakeClock();
  const t = buildTestApp({ db, timing: { clock, floorMs: FLOOR } });
  return { ...t, clock };
}

let nextIp = 1;
const ipHeader = () => ({ 'x-forwarded-for': `10.2.0.${nextIp++}` });

function completeBody(email: string, code: string) {
  return {
    email,
    code,
    username: 'ana_g',
    displayName: 'Ana',
    password: 'una-contrasena-larga-y-rara-7391',
    timezone: 'Europe/Madrid',
    device: { id: uuidv7(), platform: 'windows', name: 'PC' },
  };
}

describe('startMinDuration', () => {
  it('espera lo que falta hasta el suelo y nada si ya pasó', async () => {
    const clock = new FakeClock();
    const wait = startMinDuration({ clock, floorMs: 50 });
    clock.advance(20);
    await wait();
    expect(clock.sleeps).toEqual([30]);
    const late = startMinDuration({ clock, floorMs: 50 });
    clock.advance(80);
    await late();
    expect(clock.sleeps).toEqual([30]);
  });
});

describe('POST /auth/register: suelo de tiempo', () => {
  it('correo nuevo y cuenta existente esperan el mismo suelo antes del 202', async () => {
    await sql`INSERT INTO users (id, email, password_hash, username, display_name)
              VALUES (${uuidv7()}, 'existe@example.com', ${ARGON}, 'existe', 'E')`;
    const a = build();
    const b = build();
    expect((await postJson(a.app, '/auth/register', { email: 'existe@example.com' }, ipHeader())).status).toBe(202);
    expect((await postJson(b.app, '/auth/register', { email: 'nuevo@example.com' }, ipHeader())).status).toBe(202);
    expect(a.clock.sleeps).toEqual([FLOOR]);
    expect(b.clock.sleeps).toEqual([FLOOR]);
  });

  it('con el suelo real, la respuesta tarda al menos el suelo', async () => {
    const t = buildTestApp({ db, timing: { clock: { now: () => performance.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) }, floorMs: 60 } });
    for (const email of ['a@example.com', 'a@example.com']) {
      const start = performance.now();
      await postJson(t.app, '/auth/register', { email }, ipHeader());
      expect(performance.now() - start).toBeGreaterThanOrEqual(58);
    }
  });

  it('422 (correo mal formado) responde sin esperar el suelo', async () => {
    const t = build();
    expect((await postJson(t.app, '/auth/register', { email: 'no-es-correo' }, ipHeader())).status).toBe(422);
    expect(t.clock.sleeps).toEqual([]);
  });
});

describe('POST /auth/register/complete: suelo de tiempo', () => {
  it('invalid_code sin código pendiente y con código pendiente incorrecto esperan el mismo suelo', async () => {
    const sinFila = build();
    const res1 = await postJson(sinFila.app, '/auth/register/complete', completeBody('nadie@example.com', 'AAAA-BBBB'), ipHeader());
    expect(res1.status).toBe(400);

    const conFila = build();
    await postJson(conFila.app, '/auth/register', { email: 'ana@example.com' }, ipHeader());
    expect(codeFrom(conFila.mailer.last())).toBeTruthy();
    conFila.clock.sleeps.length = 0;
    const res2 = await postJson(conFila.app, '/auth/register/complete', completeBody('ana@example.com', 'AAAA-BBBB'), ipHeader());
    expect(res2.status).toBe(400);

    expect(sinFila.clock.sleeps).toEqual([FLOOR]);
    expect(conFila.clock.sleeps).toEqual([FLOOR]);
  });

  it('el alta correcta no espera suelo en el paso 2', async () => {
    const t = build();
    await postJson(t.app, '/auth/register', { email: 'ana@example.com' }, ipHeader());
    const code = codeFrom(t.mailer.last())!;
    t.clock.sleeps.length = 0;
    const res = await postJson(t.app, '/auth/register/complete', completeBody('ana@example.com', code), ipHeader());
    expect(res.status).toBe(201);
    expect(t.clock.sleeps).toEqual([]);
  });
});
