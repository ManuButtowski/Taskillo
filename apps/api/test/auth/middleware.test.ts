import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { requireAuth, type AuthVariables } from '../../src/auth/middleware.js';
import { signAccessToken } from '../../src/auth/tokens.js';

const SECRET = 'secreto-de-test-con-al-menos-32-caracteres-ok';

function build() {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use('/p/*', requireAuth(SECRET));
  app.get('/p/yo', (c) => c.json({ userId: c.get('userId'), familyId: c.get('familyId') }));
  return app;
}

describe('requireAuth', () => {
  it('rechaza la petición sin token con 401 y formato de error', async () => {
    const res = await build().request('/p/yo');
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('unauthorized');
  });

  it('rechaza esquemas distintos de Bearer y tokens manipulados', async () => {
    const app = build();
    expect((await app.request('/p/yo', { headers: { authorization: 'Basic abc' } })).status).toBe(401);
    expect((await app.request('/p/yo', { headers: { authorization: 'Bearer basura' } })).status).toBe(401);
  });

  it('rechaza un token caducado', async () => {
    const viejo = await signAccessToken({ userId: 'u1', familyId: 'f1' }, SECRET, new Date(Date.now() - 3600_000));
    const res = await build().request('/p/yo', { headers: { authorization: `Bearer ${viejo}` } });
    expect(res.status).toBe(401);
  });

  it('rechaza un token firmado con otro secreto', async () => {
    const ajeno = await signAccessToken({ userId: 'u1', familyId: 'f1' }, 'otro-secreto-distinto-de-32-caracteres-xx');
    const res = await build().request('/p/yo', { headers: { authorization: `Bearer ${ajeno}` } });
    expect(res.status).toBe(401);
  });

  it('con token válido inyecta userId y familyId', async () => {
    const token = await signAccessToken({ userId: 'u1', familyId: 'f1' }, SECRET);
    const res = await build().request('/p/yo', { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: 'u1', familyId: 'f1' });
  });
});
