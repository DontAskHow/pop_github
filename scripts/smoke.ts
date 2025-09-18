import { buildServer as buildEngineServer } from '../apps/engine/src/server';
import { buildServer as buildPopServer } from '../apps/pop-api/src/server';

const run = async () => {
  const originalEnv = { ...process.env };

  const pop = buildPopServer();
  await pop.app.ready();

  const engine = buildEngineServer();
  await engine.app.ready();

  try {
    const popHealth = await pop.app.inject({ method: 'GET', url: '/healthz' });
    if (popHealth.statusCode !== 200) {
      throw new Error(`/healthz failed with status ${popHealth.statusCode}`);
    }

    const popMetrics = await pop.app.inject({ method: 'GET', url: '/metrics' });
    if (popMetrics.statusCode !== 200 || !popMetrics.payload.includes('agent_state_cache_hit')) {
      throw new Error('POP metrics missing expected gauges');
    }

    const engineHealth = await engine.app.inject({ method: 'GET', url: '/healthz' });
    if (engineHealth.statusCode !== 200) {
      throw new Error(`Engine /healthz failed with status ${engineHealth.statusCode}`);
    }

    const engineMetrics = await engine.app.inject({ method: 'GET', url: '/metrics' });
    if (engineMetrics.statusCode !== 200 || !engineMetrics.payload.includes('rollup_latency_ms')) {
      throw new Error('Engine metrics missing expected histogram');
    }
  } finally {
    await pop.app.close();
    await engine.app.close();
    process.env = originalEnv;
  }
};

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Smoke test failed:', error);
  process.exitCode = 1;
});
