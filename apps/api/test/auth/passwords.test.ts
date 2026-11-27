import { describe, expect, it } from 'vitest';
import {
  ARGON2_PARAMS,
  hashPassword,
  validatePasswordPolicy,
  verifyPassword,
} from '../../src/auth/passwords.js';
import { COMMON_PASSWORDS } from '../../src/auth/common-passwords.js';

describe('hashPassword / verifyPassword', () => {
  it('genera un hash Argon2id con los parámetros de research.md', async () => {
    const hash = await hashPassword('una-contraseña-larga-1');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).toContain('m=19456,t=2,p=1');
    expect(ARGON2_PARAMS).toEqual({ memoryCost: 19456, timeCost: 2, parallelism: 1 });
  });

  it('no repite el hash para la misma contraseña (sal aleatoria) y no contiene la contraseña', async () => {
    const a = await hashPassword('una-contraseña-larga-1');
    const b = await hashPassword('una-contraseña-larga-1');
    expect(a).not.toBe(b);
    expect(a).not.toContain('una-contraseña');
  });

  it('verifica la contraseña correcta y rechaza la incorrecta', async () => {
    const hash = await hashPassword('una-contraseña-larga-1');
    expect(await verifyPassword(hash, 'una-contraseña-larga-1')).toBe(true);
    expect(await verifyPassword(hash, 'una-contraseña-larga-2')).toBe(false);
    expect(await verifyPassword(hash, '')).toBe(false);
  });

  it('devuelve false (sin lanzar) ante un hash mal formado', async () => {
    expect(await verifyPassword('esto-no-es-un-hash', 'cualquiera-larga-1')).toBe(false);
    expect(await verifyPassword('', 'cualquiera-larga-1')).toBe(false);
  });
});

describe('validatePasswordPolicy', () => {
  const ctx = { email: 'ana.perez@example.com', username: 'ana_perez' };

  it('acepta una contraseña correcta', () => {
    expect(validatePasswordPolicy('correct horse battery', ctx)).toEqual({ ok: true });
  });

  it('rechaza menos de 10 caracteres y acepta justo 10', () => {
    expect(validatePasswordPolicy('abcd1234x', ctx)).toEqual({ ok: false, reason: 'too_short' });
    expect(validatePasswordPolicy('qzxv-wplm9', ctx)).toEqual({ ok: true });
  });

  it('rechaza más de 128 caracteres y acepta justo 128', () => {
    expect(validatePasswordPolicy('x7Q'.repeat(43), ctx)).toEqual({ ok: false, reason: 'too_long' });
    expect(validatePasswordPolicy(('x7Q' + 'k').repeat(32), ctx)).toEqual({ ok: true });
  });

  it('cuenta caracteres, no bytes (emoji y acentos)', () => {
    expect(validatePasswordPolicy('ñññññññññ', ctx)).toEqual({ ok: false, reason: 'too_short' });
    expect(validatePasswordPolicy('ñandú-ñoño-ç', ctx)).toEqual({ ok: true });
  });

  it('rechaza contraseñas comunes sin distinguir mayúsculas', () => {
    expect(validatePasswordPolicy('password123', ctx)).toEqual({ ok: false, reason: 'common' });
    expect(validatePasswordPolicy('PassWord123', ctx)).toEqual({ ok: false, reason: 'common' });
  });

  it('la lista de comunes existe y solo tiene entradas en minúsculas', () => {
    expect(COMMON_PASSWORDS.size).toBeGreaterThanOrEqual(500);
    for (const p of COMMON_PASSWORDS) expect(p).toBe(p.toLowerCase());
  });

  it('rechaza una contraseña igual al correo o al usuario (sin distinguir mayúsculas)', () => {
    expect(validatePasswordPolicy('ana.perez@example.com', ctx)).toEqual({ ok: false, reason: 'same_as_identity' });
    expect(validatePasswordPolicy('ANA.PEREZ@EXAMPLE.COM', ctx)).toEqual({ ok: false, reason: 'same_as_identity' });
    expect(validatePasswordPolicy('ana_perez', { ...ctx, username: 'ana_perez' }).ok).toBe(false);
    expect(validatePasswordPolicy('ana_perez_2024', ctx)).toEqual({ ok: true });
  });

  it('sin contexto solo aplica longitud y lista de comunes', () => {
    expect(validatePasswordPolicy('correct horse battery')).toEqual({ ok: true });
  });

  it('no exige reglas de composición (NIST 800-63B)', () => {
    expect(validatePasswordPolicy('solo minusculas y espacios', ctx)).toEqual({ ok: true });
  });
});
