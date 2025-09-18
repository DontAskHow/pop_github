import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildServer } from './server';

describe('Semantic Engine server', () => {
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
  });

  it('exposes /metrics with expected counters', async () => {
    const response = await server.inject({ method: 'GET', url: '/metrics' });
    expect(response.statusCode).toBe(200);
    expect(response.payload).toContain('congregator_breaker_state');
    expect(response.payload).toContain('rollup_latency_ms');
  });
});
