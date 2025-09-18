import client from 'prom-client';

const register = new client.Registry();
register.setDefaultLabels({ service: 'semantic-engine' });
client.collectDefaultMetrics({ register });

const getOrCreateGauge = (name: string, help: string, labelNames?: string[]) => {
  const existing = register.getSingleMetric(name) as client.Gauge<string> | undefined;
  if (existing) return existing;
  const options: client.GaugeConfiguration<string> = { name, help, registers: [register] };
  if (labelNames) {
    options.labelNames = labelNames;
  }
  return new client.Gauge(options);
};

const getOrCreateCounter = (name: string, help: string) => {
  const existing = register.getSingleMetric(name) as client.Counter<string> | undefined;
  if (existing) return existing;
  return new client.Counter({ name, help, registers: [register] });
};

const getOrCreateHistogram = (
  name: string,
  help: string,
  buckets: number[],
  labelNames?: string[],
) => {
  const existing = register.getSingleMetric(name) as client.Histogram<string> | undefined;
  if (existing) return existing;
  const options: client.HistogramConfiguration<string> = {
    name,
    help,
    buckets,
    registers: [register],
  };
  if (labelNames) {
    options.labelNames = labelNames;
  }
  return new client.Histogram(options);
};

export const metrics = {
  congregatorBreakerState: getOrCreateGauge(
    'congregator_breaker_state',
    'Circuit breaker state for outbound model calls (0=closed,1=open).',
  ),
  rollupQueueSize: getOrCreateGauge('rollup_queue_size', 'Number of pending rollup jobs.', ['level']),
  rollupLatencyMs: getOrCreateHistogram(
    'rollup_latency_ms',
    'Latency distribution for rollup jobs (milliseconds).',
    [10, 50, 100, 250, 500, 1000, 5000, 10000, 30000],
    ['level'],
  ),
  agentStateUpdateTotal: getOrCreateCounter(
    'agent_state_update_total',
    'Total agent_state_update payloads emitted by the engine.',
  ),
  ingestBatchDurationMs: getOrCreateHistogram(
    'ingest_batch_duration_ms',
    'Duration of POP ingestion batches (milliseconds).',
    [50, 100, 250, 500, 1000, 2000, 5000],
  ),
};

metrics.congregatorBreakerState.set(0);

export const engineMetricsRegister = register;
