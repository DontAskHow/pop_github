import client from 'prom-client';

const register = new client.Registry();
register.setDefaultLabels({ service: 'pop-api' });
client.collectDefaultMetrics({ register });

const getOrCreateCounter = (name: string, help: string) => {
  const existing = register.getSingleMetric(name) as client.Counter<string> | undefined;
  if (existing) return existing;
  return new client.Counter({ name, help, registers: [register] });
};

const getOrCreateGauge = (name: string, help: string) => {
  const existing = register.getSingleMetric(name) as client.Gauge<string> | undefined;
  if (existing) return existing;
  return new client.Gauge({ name, help, registers: [register] });
};

export const metrics = {
  agentStateCacheHit: getOrCreateCounter(
    'agent_state_cache_hit',
    'Count of cache hits for agent state lookups.',
  ),
  agentStateCacheMiss: getOrCreateCounter(
    'agent_state_cache_miss',
    'Count of cache misses for agent state lookups.',
  ),
  agentStateCacheStore: getOrCreateCounter(
    'agent_state_cache_store',
    'Count of cache writes for agent state data.',
  ),
  agentStateCacheSize: getOrCreateGauge(
    'agent_state_cache_size',
    'Estimated number of cached agent state entries.',
  ),
  sseActiveClients: getOrCreateGauge(
    'sse_active_clients',
    'Number of active SSE clients connected to the POP API.',
  ),
  agentStateUpdateTotal: getOrCreateCounter(
    'agent_state_update_total',
    'Total agent_state_update events published to clients.',
  ),
  congregatorBreakerState: getOrCreateGauge(
    'congregator_breaker_state',
    'Circuit breaker state for upstream congregator calls (0=closed,1=open).',
  ),
};

metrics.sseActiveClients.set(0);
metrics.congregatorBreakerState.set(0);
metrics.agentStateCacheSize.set(0);

export const popMetricsRegister = register;
