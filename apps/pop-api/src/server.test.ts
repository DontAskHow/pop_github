import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildServer } from './server';

describe('POP API server', () => {
  const originalEnv = { ...process.env };
  const server = buildServer().app;

  beforeAll(async () => {
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    process.env = originalEnv;
  });

  it('responds to /healthz', async () => {
    const response = await server.inject({ method: 'GET', url: '/healthz' });

    expect(response.statusCode).toBe(200);
    const payload = response.json<{ status: string }>();
    expect(payload.status).toBe('ok');
  });

  it('exposes prometheus metrics', async () => {
    const response = await server.inject({ method: 'GET', url: '/metrics' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.payload).toContain('agent_state_cache_hit');
  });
});
