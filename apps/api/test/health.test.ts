import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/lib/logger.js';

describe('GET /health', () => {
  it('responde 200 con status ok', async () => {
    const app = createApp({ logger: createLogger({ write: () => {} }) });
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});
