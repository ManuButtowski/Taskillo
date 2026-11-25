import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { clientIp, MAX_WINDOW_MS, rateLimit, schedulePrune, SlidingWindowLimiter } from '../../src/lib/rate-limit.js';

const limit = { max: 3, windowMs: 60_000 };

describe('SlidingWindowLimiter', () => {
  it('permite hasta el máximo y bloquea el siguiente con retryAfter', () => {
    let t = 1_000_000;
    const l = new SlidingWindowLimiter(() => t);
    for (let i = 0; i < 3; i++) expect(l.hit('k', limit).allowed).toBe(true);
    expect(l.hit('k', limit)).toEqual({ allowed: false, retryAfterSeconds: 60 });
    t += 20_000;
    expect(l.hit('k', limit)).toEqual({ allowed: false, retryAfterSeconds: 40 });
  });

  it('la ventana se desliza: al expirar el primer intento vuelve a permitir', () => {
    let t = 0;
    const l = new SlidingWindowLimiter(() => t);
    l.hit('k', limit);
    t = 30_000;
    l.hit('k', limit);
    l.hit('k', limit);
    expect(l.hit('k', limit).allowed).toBe(false);
    t = 60_001;
    expect(l.hit('k', limit).allowed).toBe(true);
  });

  it('las claves son independientes y prune libera las caducadas', () => {
    let t = 0;
    const l = new SlidingWindowLimiter(() => t);
    for (let i = 0; i < 3; i++) l.hit('a', limit);
    expect(l.hit('b', limit).allowed).toBe(true);
    t = 120_000;
    l.prune(60_000);
    expect(l.hit('a', limit).allowed).toBe(true);
  });
});

describe('rateLimit (middleware)', () => {
  function build(trustProxy: boolean) {
    const limiter = new SlidingWindowLimiter();
    const app = new Hono();
    app.use(
      '/x',
      rateLimit(limiter, [{ name: 'ip', limit: { max: 2, windowMs: 60_000 }, key: (c) => clientIp(c, trustProxy) }]),
    );
    app.post('/x', (c) => c.json({ ok: true }));
    return app;
  }
  const post = (app: Hono, ip: string) => app.request('/x', { method: 'POST', headers: { 'x-forwarded-for': ip } });

  it('devuelve 429 con Retry-After y formato de error al superar el límite', async () => {
    const app = build(true);
    expect((await post(app, '1.1.1.1')).status).toBe(200);
    expect((await post(app, '1.1.1.1')).status).toBe(200);
    const res = await post(app, '1.1.1.1');
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('rate_limited');
  });

  it('con TRUST_PROXY=true cada IP de X-Forwarded-For tiene su contador', async () => {
    const app = build(true);
    await post(app, '1.1.1.1');
    await post(app, '1.1.1.1');
    expect((await post(app, '2.2.2.2')).status).toBe(200);
  });

  it('con TRUST_PROXY=false ignora X-Forwarded-For (falsearla no evita el límite)', async () => {
    const app = build(false);
    await post(app, '1.1.1.1');
    await post(app, '2.2.2.2');
    expect((await post(app, '3.3.3.3')).status).toBe(429);
  });

  it('una regla con clave null no limita', async () => {
    const limiter = new SlidingWindowLimiter();
    const app = new Hono();
    app.use('*', rateLimit(limiter, [{ name: 'e', limit: { max: 1, windowMs: 1000 }, key: () => null }]));
    app.get('/', (c) => c.text('ok'));
    for (let i = 0; i < 3; i++) expect((await app.request('/')).status).toBe(200);
  });
});

describe('schedulePrune', () => {
  it('purga el limitador cada intervalo y su timer no impide cerrar el proceso', () => {
    vi.useFakeTimers();
    try {
      const l = new SlidingWindowLimiter();
      const prune = vi.spyOn(l, 'prune');
      const timer = schedulePrune(l, { intervalMs: 1000, maxWindowMs: 5000 });
      expect(timer.hasRef()).toBe(false);
      vi.advanceTimersByTime(3500);
      expect(prune).toHaveBeenCalledTimes(3);
      expect(prune).toHaveBeenCalledWith(5000);
      clearInterval(timer);
      vi.advanceTimersByTime(5000);
      expect(prune).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('por defecto usa la ventana mayor de la política (1 h)', () => {
    expect(MAX_WINDOW_MS).toBe(60 * 60_000);
  });
});
