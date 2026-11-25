import { createHash } from 'node:crypto';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from '../../src/auth/tokens.js';

const secret = 'secreto-de-test-con-mas-de-32-bytes-de-longitud';
const otherSecret = 'otro-secreto-de-test-con-mas-de-32-bytes-ok';
const ids = { userId: '0192f0c8-0000-7000-8000-000000000001', familyId: '0192f0c8-0000-7000-8000-000000000002' };
const key = new TextEncoder().encode(secret);

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

describe('token de acceso (JWT)', () => {
  it('firma y verifica: devuelve sub y fam', async () => {
    const token = await signAccessToken(ids, secret);
    expect(await verifyAccessToken(token, secret)).toEqual(ids);
  });

  it('caduca a los 15 minutos', async () => {
    expect(ACCESS_TOKEN_TTL_SECONDS).toBe(900);
    const token = await signAccessToken(ids, secret);
    const payload = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString());
    expect(payload.exp - payload.iat).toBe(900);
    expect(payload.sub).toBe(ids.userId);
    expect(payload.fam).toBe(ids.familyId);
  });

  it('rechaza un token caducado', async () => {
    const old = new Date(Date.now() - 16 * 60 * 1000);
    const token = await signAccessToken(ids, secret, old);
    expect(await verifyAccessToken(token, secret)).toBeNull();
  });

  it('acepta un token emitido hace 14 minutos', async () => {
    const recent = new Date(Date.now() - 14 * 60 * 1000);
    const token = await signAccessToken(ids, secret, recent);
    expect(await verifyAccessToken(token, secret)).toEqual(ids);
  });

  it('rechaza un token con la firma manipulada', async () => {
    const token = await signAccessToken(ids, secret);
    const [h, p, s] = token.split('.');
    const flipped = s!.slice(0, -2) + (s!.endsWith('AA') ? 'BB' : 'AA');
    expect(await verifyAccessToken(`${h}.${p}.${flipped}`, secret)).toBeNull();
  });

  it('rechaza un token con el cuerpo manipulado (otro usuario)', async () => {
    const token = await signAccessToken(ids, secret);
    const [h, p, s] = token.split('.');
    const payload = JSON.parse(Buffer.from(p!, 'base64url').toString());
    payload.sub = '0192f0c8-0000-7000-8000-0000000000ff';
    expect(await verifyAccessToken(`${h}.${b64url(payload)}.${s}`, secret)).toBeNull();
  });

  it('rechaza un token firmado con otro secreto', async () => {
    const token = await signAccessToken(ids, otherSecret);
    expect(await verifyAccessToken(token, secret)).toBeNull();
  });

  it('rechaza alg=none', async () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = { sub: ids.userId, fam: ids.familyId, iat: now, exp: now + 900 };
    const token = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(payload)}.`;
    expect(await verifyAccessToken(token, secret)).toBeNull();
  });

  it('rechaza otro algoritmo HMAC (HS512) aunque la firma sea válida', async () => {
    const token = await new SignJWT({ fam: ids.familyId })
      .setProtectedHeader({ alg: 'HS512' })
      .setSubject(ids.userId)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(key);
    expect(await verifyAccessToken(token, secret)).toBeNull();
  });

  it('rechaza un token sin sub, sin fam o sin caducidad', async () => {
    const base = () => new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setIssuedAt();
    const sinFam = await base().setSubject(ids.userId).setExpirationTime('15m').sign(key);
    const sinSub = await new SignJWT({ fam: ids.familyId })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(key);
    const sinExp = await new SignJWT({ fam: ids.familyId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(ids.userId)
      .setIssuedAt()
      .sign(key);
    expect(await verifyAccessToken(sinFam, secret)).toBeNull();
    expect(await verifyAccessToken(sinSub, secret)).toBeNull();
    expect(await verifyAccessToken(sinExp, secret)).toBeNull();
  });

  it('rechaza basura sin lanzar', async () => {
    for (const t of ['', 'abc', 'a.b.c', '....']) expect(await verifyAccessToken(t, secret)).toBeNull();
  });
});

describe('refresh token opaco', () => {
  it('son 32 bytes aleatorios en base64url (43 caracteres) y distintos cada vez', () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(a.token, 'base64url')).toHaveLength(32);
    expect(a.token).not.toBe(b.token);
  });

  it('el hash es SHA-256 hexadecimal (64 caracteres) del token y no lo contiene', () => {
    const { token, hash } = generateRefreshToken();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(hash).toBe(hashRefreshToken(token));
    expect(hash).not.toContain(token);
  });

  it('hashRefreshToken es determinista y distinto para tokens distintos', () => {
    expect(hashRefreshToken('abc')).toBe(hashRefreshToken('abc'));
    expect(hashRefreshToken('abc')).not.toBe(hashRefreshToken('abd'));
  });
});
