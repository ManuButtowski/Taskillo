import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';

const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  tags: ['Sistema'],
  summary: 'Comprueba que la API responde',
  responses: {
    200: {
      description: 'La API está en marcha',
      content: {
        'application/json': { schema: z.object({ status: z.literal('ok') }).openapi('Health') },
      },
    },
  },
});

export const health = new OpenAPIHono().openapi(healthRoute, (c) => c.json({ status: 'ok' as const }, 200));
