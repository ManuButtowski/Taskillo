// POST /auth/register/complete (T013, paso 2 del registro) contra PostgreSQL real.
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { verifyAccessToken } from '../../src/auth/tokens.js';
import type { Database } from '../../src/db/client.js';
import { buildTestApp, TEST_JWT_SECRET } from '../support/app.js';
import { setupTestDb, truncateAll } from '../support/db.js';
import { codeFrom, postJson } from '../support/http.js';

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

const PASSWORD = 'una-contrasena-larga-y-rara-7391';

/** Paso 1 completo: pide el código y lo lee del correo. */
async function requestCode(t: ReturnType<typeof buildTestApp>, email: string) {
  await postJson(t.app, '/auth/register', { email });
  return codeFrom(t.mailer.last());
}

function body(email: string, code: string, extra: Record<string, unknown> = {}) {
  return {
    email,
    code,
    username: 'ana_g',
    displayName: 'Ana García',
    password: PASSWORD,
    timezone: 'Europe/Madrid',
    device: { id: uuidv7(), platform: 'windows', name: 'Portátil de Ana' },
    ...extra,
  };
}

let nextIp = 1;
// Cada petición sale de una IP distinta salvo que el test fije la suya (el límite por IP es de 10).
const complete = (t: ReturnType<typeof buildTestApp>, payload: unknown, headers: Record<string, string> = {}) =>
  postJson(t.app, '/auth/register/complete', payload, { 'x-forwarded-for': `10.1.0.${nextIp++}`, ...headers });

async function errorOf(res: Response) {
  return ((await res.json()) as { error: { code: string; message: string } }).error;
}

describe('alta correcta', () => {
  it('201 con user y tokens; cuenta ya verificada; dispositivo y sesión creados', async () => {
    const t = buildTestApp({ db });
    const code = await requestCode(t, 'ana@example.com');
    const payload = body('ana@example.com', code);
    const res = await complete(t, payload);
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      user: Record<string, unknown>;
      tokens: { accessToken: string; refreshToken: string; expiresIn: number };
    };
    expect(Object.keys(json.user).sort()).toEqual(['displayName', 'email', 'id', 'timezone', 'username']);
    expect(json.user).toMatchObject({
      email: 'ana@example.com',
      username: 'ana_g',
      displayName: 'Ana García',
      timezone: 'Europe/Madrid',
    });
    expect(json.tokens.expiresIn).toBe(900);

    const [user] = await sql<{ id: string; verified: boolean; hash: string }[]>`
      SELECT id, email_verified_at IS NOT NULL AS verified, password_hash AS hash FROM users`;
    expect(user!.id).toBe(json.user.id);
    expect(user!.verified).toBe(true);
    expect(user!.hash).toMatch(/^\$argon2id\$/);

    const claims = await verifyAccessToken(json.tokens.accessToken, TEST_JWT_SECRET);
    expect(claims?.userId).toBe(user!.id);
    const [session] = await sql<{ family_id: string; device_id: string }[]>`SELECT family_id, device_id FROM sessions`;
    expect(claims?.familyId).toBe(session!.family_id);
    expect(session!.device_id).toBe(payload.device.id);
    const [device] = await sql<{ platform: string; name: string }[]>`SELECT platform, name FROM devices`;
    expect(device).toEqual({ platform: 'windows', name: 'Portátil de Ana' });
    const [token] = await sql<{ used: boolean }[]>`SELECT used_at IS NOT NULL AS used FROM email_tokens`;
    expect(token!.used).toBe(true);
  });

  it('la respuesta no lleva hash ni contraseña, y el código se acepta con guion y minúsculas', async () => {
    const t = buildTestApp({ db });
    const code = await requestCode(t, 'ana@example.com');
    const res = await complete(t, body('Ana@Example.com', code.toLowerCase()));
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(text).not.toMatch(/argon2|password|hash/i);
    expect(text).not.toContain(PASSWORD);
  });

  it('normaliza nombre de usuario a minúsculas, recorta el nombre visible y usa Europe/Madrid por defecto', async () => {
    const t = buildTestApp({ db });
    const code = await requestCode(t, 'ana@example.com');
    const payload = body('ana@example.com', code, { username: 'Ana_G', displayName: '  Ana  ' });
    delete (payload as { timezone?: string }).timezone;
    const res = await complete(t, payload);
    expect(res.status).toBe(201);
    expect(((await res.json()) as { user: unknown }).user).toMatchObject({
      username: 'ana_g',
      displayName: 'Ana',
      timezone: 'Europe/Madrid',
    });
  });

  it('el código es de un solo uso: repetir la misma petición falla', async () => {
    const t = buildTestApp({ db });
    const code = await requestCode(t, 'ana@example.com');
    expect((await complete(t, body('ana@example.com', code))).status).toBe(201);
    const again = await complete(t, body('ana@example.com', code, { username: 'otra' }));
    expect(again.status).toBe(400);
    expect((await errorOf(again)).code).toBe('invalid_code');
  });
});

describe('código no válido (siempre 400 invalid_code igual)', () => {
  async function failures() {
    const t = buildTestApp({ db });
    const results: { label: string; res: Response }[] = [];

    // Erróneo
    const code = await requestCode(t, 'ana@example.com');
    results.push({ label: 'erróneo', res: await complete(t, body('ana@example.com', 'ZZZZ-ZZZZ')) });
    // Mal formado
    results.push({ label: 'mal formado', res: await complete(t, body('ana@example.com', 'x')) });
    // Sin código pedido
    results.push({ label: 'sin código', res: await complete(t, body('nadie@example.com', code)) });
    // Caducado
    await sql`UPDATE email_tokens SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour'`;
    results.push({ label: 'caducado', res: await complete(t, body('ana@example.com', code)) });
    // Usado
    const code2 = await requestCode(t, 'bea@example.com');
    expect((await complete(t, body('bea@example.com', code2, { username: 'bea' }))).status).toBe(201);
    results.push({ label: 'usado', res: await complete(t, body('bea@example.com', code2, { username: 'bea2' })) });
    // Agotado
    const code3 = await requestCode(t, 'cris@example.com');
    for (let i = 0; i < 5; i++) await complete(t, body('cris@example.com', 'ZZZZ-ZZZZ', { username: 'cris' }));
    results.push({ label: 'agotado', res: await complete(t, body('cris@example.com', code3, { username: 'cris' })) });
    return results;
  }

  it('erróneo, mal formado, inexistente, caducado, usado y agotado dan la misma respuesta', async () => {
    const results = await failures();
    const texts = new Set<string>();
    for (const { label, res } of results) {
      expect(res.status, label).toBe(400);
      texts.add(await res.text());
    }
    expect(texts.size).toBe(1);
    expect([...texts][0]).toContain('invalid_code');
  });

  it('el intento fallido persiste y al quinto el código queda agotado', async () => {
    const t = buildTestApp({ db });
    const code = await requestCode(t, 'ana@example.com');
    await complete(t, body('ana@example.com', 'ZZZZ-ZZZZ'));
    const [one] = await sql<{ attempts: number }[]>`SELECT attempts FROM email_tokens`;
    expect(one!.attempts).toBe(1);
    for (let i = 0; i < 4; i++) await complete(t, body('ana@example.com', 'ZZZZ-ZZZZ'));
    const [five] = await sql<{ attempts: number; used: boolean }[]>`
      SELECT attempts, used_at IS NOT NULL AS used FROM email_tokens`;
    expect(five).toEqual({ attempts: 5, used: true });
    expect((await complete(t, body('ana@example.com', code))).status).toBe(400);
    expect(await sql`SELECT 1 FROM users`).toHaveLength(0);
  });

  it('sin código válido no se revela si el nombre está ocupado ni si el correo tiene cuenta', async () => {
    const t = buildTestApp({ db });
    const codeBea = await requestCode(t, 'bea@example.com');
    expect((await complete(t, body('bea@example.com', codeBea, { username: 'ocupado' }))).status).toBe(201);
    await requestCode(t, 'ana@example.com');
    const res = await complete(t, body('ana@example.com', 'ZZZZ-ZZZZ', { username: 'OCUPADO' }));
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe('invalid_code');
    // Un correo que ya tiene cuenta también responde invalid_code, no email_taken.
    const res2 = await complete(t, body('bea@example.com', 'ZZZZ-ZZZZ', { username: 'nuevo' }));
    expect((await errorOf(res2)).code).toBe('invalid_code');
  });

  it('el código se comprueba antes que los datos: código malo + contraseña débil → invalid_code', async () => {
    const t = buildTestApp({ db });
    await requestCode(t, 'ana@example.com');
    const res = await complete(t, body('ana@example.com', 'ZZZZ-ZZZZ', { password: 'corta', timezone: 'Marte/Olimpo' }));
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe('invalid_code');
  });
});

describe('datos de la cuenta (con código válido)', () => {
  it('username_taken sin distinguir mayúsculas, sin gastar el código ni contar intento', async () => {
    const t = buildTestApp({ db });
    const codeBea = await requestCode(t, 'bea@example.com');
    await complete(t, body('bea@example.com', codeBea, { username: 'ocupado' }));

    const code = await requestCode(t, 'ana@example.com');
    const res = await complete(t, body('ana@example.com', code, { username: 'OCUPADO' }));
    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe('username_taken');
    const [row] = await sql<{ attempts: number; used: boolean }[]>`
      SELECT attempts, used_at IS NOT NULL AS used FROM email_tokens WHERE email = 'ana@example.com'`;
    expect(row).toEqual({ attempts: 0, used: false });
    expect(await sql`SELECT 1 FROM users WHERE email = 'ana@example.com'`).toHaveLength(0);

    // Con otro nombre, el mismo código vale.
    expect((await complete(t, body('ana@example.com', code, { username: 'ana_nueva' }))).status).toBe(201);
  });

  it('email_taken si la cuenta se creó entre los dos pasos', async () => {
    const t = buildTestApp({ db });
    const code = await requestCode(t, 'ana@example.com');
    await sql`INSERT INTO users (id, email, password_hash, username, display_name)
              VALUES (${uuidv7()}, 'ana@example.com', '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA', 'otro', 'Otro')`;
    const res = await complete(t, body('ana@example.com', code));
    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe('email_taken');
    expect(await sql`SELECT 1 FROM users`).toHaveLength(1);
  });

  it('contraseña débil → 422 sin gastar el código', async () => {
    const t = buildTestApp({ db });
    const code = await requestCode(t, 'ana@example.com');
    for (const password of ['corta', 'password123', 'ana@example.com']) {
      const res = await complete(t, body('ana@example.com', code, { password }));
      expect(res.status, password).toBe(422);
      expect((await errorOf(res)).code).toBe('weak_password');
    }
    const [row] = await sql<{ attempts: number; used: boolean }[]>`SELECT attempts, used_at IS NOT NULL AS used FROM email_tokens`;
    expect(row).toEqual({ attempts: 0, used: false });
    expect((await complete(t, body('ana@example.com', code))).status).toBe(201);
  });

  it('zona horaria no IANA → 422', async () => {
    const t = buildTestApp({ db });
    const code = await requestCode(t, 'ana@example.com');
    for (const timezone of ['Marte/Olimpo', '+01:00', 'basura', '']) {
      const res = await complete(t, body('ana@example.com', code, { timezone }));
      expect(res.status, timezone).toBe(422);
    }
    expect(await sql`SELECT 1 FROM users`).toHaveLength(0);
  });

  it('nombre de usuario o nombre visible no válidos → 422', async () => {
    const t = buildTestApp({ db });
    const code = await requestCode(t, 'ana@example.com');
    for (const extra of [{ username: 'ab' }, { username: 'con espacio' }, { username: 'ñandú' }, { displayName: '   ' }]) {
      const res = await complete(t, body('ana@example.com', code, extra));
      expect(res.status, JSON.stringify(extra)).toBe(422);
    }
  });

  it('cuerpo estructuralmente inválido (plataforma, id de dispositivo, campos que faltan) → 422', async () => {
    const t = buildTestApp({ db });
    const code = await requestCode(t, 'ana@example.com');
    for (const extra of [
      { device: { id: 'no-uuid', platform: 'windows' } },
      { device: { id: uuidv7(), platform: 'ios' } },
      { device: undefined },
      { username: undefined },
    ]) {
      expect((await complete(t, body('ana@example.com', code, extra))).status).toBe(422);
    }
  });
});

describe('device_id_conflict', () => {
  it('409 sin crear el usuario; el código sigue valiendo con otro id', async () => {
    const t = buildTestApp({ db });
    const codeBea = await requestCode(t, 'bea@example.com');
    const deviceId = uuidv7();
    await complete(t, body('bea@example.com', codeBea, { username: 'bea', device: { id: deviceId, platform: 'android' } }));

    const code = await requestCode(t, 'ana@example.com');
    const res = await complete(t, body('ana@example.com', code, { device: { id: deviceId, platform: 'windows' } }));
    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe('device_id_conflict');
    expect(await sql`SELECT 1 FROM users WHERE email = 'ana@example.com'`).toHaveLength(0);
    // El dispositivo existente sigue siendo de Bea.
    const [d] = await sql<{ email: string }[]>`SELECT u.email FROM devices d JOIN users u ON u.id = d.user_id WHERE d.id = ${deviceId}`;
    expect(d!.email).toBe('bea@example.com');

    const ok = await complete(t, body('ana@example.com', code));
    expect(ok.status).toBe(201);
  });
});

describe('limitación de frecuencia y logs', () => {
  it('10 peticiones por IP cada 15 min; la 11.ª → 429 con Retry-After', async () => {
    const t = buildTestApp({ db });
    for (let i = 0; i < 10; i++) {
      const res = await complete(t, body('ana@example.com', 'ZZZZ-ZZZZ'), { 'x-forwarded-for': '9.9.9.9' });
      expect(res.status).toBe(400);
    }
    const res = await complete(t, body('ana@example.com', 'ZZZZ-ZZZZ'), { 'x-forwarded-for': '9.9.9.9' });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).not.toBeNull();
    const other = await complete(t, body('ana@example.com', 'ZZZZ-ZZZZ'), { 'x-forwarded-for': '8.8.8.8' });
    expect(other.status).toBe(400);
  });

  it('ni la contraseña ni el código aparecen en el log', async () => {
    const t = buildTestApp({ db });
    const code = await requestCode(t, 'ana@example.com');
    await complete(t, body('ana@example.com', code));
    const log = t.logs.join('\n');
    expect(log).not.toContain(PASSWORD);
    expect(log).not.toContain(code);
    expect(log).not.toContain(code.replace('-', ''));
  });
});

describe('concurrencia', () => {
  it('dos altas simultáneas con el mismo código: solo una crea la cuenta', async () => {
    for (let i = 0; i < 3; i++) {
      await truncateAll(sql);
      const t = buildTestApp({ db });
      const code = await requestCode(t, 'ana@example.com');
      const [a, b] = await Promise.all([
        complete(t, body('ana@example.com', code, { username: 'ana_uno' })),
        complete(t, body('ana@example.com', code, { username: 'ana_dos' })),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 400]);
      expect(await sql`SELECT 1 FROM users`).toHaveLength(1);
    }
  });
});
