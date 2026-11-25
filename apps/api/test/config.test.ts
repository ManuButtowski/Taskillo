import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  JWT_SECRET: 'x'.repeat(32),
};

describe('loadConfig', () => {
  it('acepta una configuración mínima y aplica valores por defecto', () => {
    const c = loadConfig(base);
    expect(c.PORT).toBe(3000);
    expect(c.TRUST_PROXY).toBe(false);
    expect(c.MAIL_DRIVER).toBe('smtp');
  });

  it('falla si falta JWT_SECRET', () => {
    expect(() => loadConfig({ DATABASE_URL: base.DATABASE_URL })).toThrow(/JWT_SECRET/);
  });

  it('falla si JWT_SECRET es corto, sin revelar su valor', () => {
    const corto = 'secreto-corto';
    let msg = '';
    try {
      loadConfig({ ...base, JWT_SECRET: corto });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/JWT_SECRET/);
    expect(msg).not.toContain(corto);
  });

  it('trata una variable vacía como ausente', () => {
    expect(() => loadConfig({ ...base, JWT_SECRET: '' })).toThrow(/JWT_SECRET/);
  });

  it('exige RESEND_API_KEY con MAIL_DRIVER=resend', () => {
    expect(() => loadConfig({ ...base, MAIL_DRIVER: 'resend' })).toThrow(/RESEND_API_KEY/);
    const c = loadConfig({ ...base, MAIL_DRIVER: 'resend', RESEND_API_KEY: 're_x' });
    expect(c.MAIL_DRIVER).toBe('resend');
  });
});
