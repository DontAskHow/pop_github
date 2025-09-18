import { z } from 'zod';

const configSchema = z.object({
  PORT: z.coerce.number().int().min(0).max(65535).default(8789),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z
    .enum(['debug', 'info', 'warn', 'error', 'fatal', 'trace', 'silent'])
    .default('info')
});

export type EngineConfig = z.infer<typeof configSchema>;

export const loadConfig = (): EngineConfig => {
  const parsed = configSchema.safeParse(process.env);

  if (!parsed.success) {
    throw new Error(`Invalid engine configuration: ${parsed.error.message}`);
  }

  return parsed.data;
};
