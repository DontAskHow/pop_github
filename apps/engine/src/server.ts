import { randomUUID } from 'node:crypto';

import fastify, { FastifyInstance } from 'fastify';

import { EngineConfig, loadConfig } from './config';
import { engineMetricsRegister } from './metrics';

export interface EngineServer {
  app: FastifyInstance;
  config: EngineConfig;
}

export const buildServer = (): EngineServer => {
  const config = loadConfig();
    const app = fastify({
    logger: {
      level: config.LOG_LEVEL,
      transport:
        process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined
    },
    genReqId: () => randomUUID()
  });

  app.addHook('onRequest', (request, reply, done) => {
    reply.header('x-request-id', request.id);
    done();
  });

  app.get('/healthz', async () => ({
    status: 'ok',
    uptime: process.uptime()
  }));

  app.get('/metrics', async (_request, reply) => {
    reply.header('content-type', engineMetricsRegister.contentType);
    reply.send(await engineMetricsRegister.metrics());
  });

  return { app, config };
};

export const startServer = async () => {
  const { app, config } = buildServer();
  await app.listen({ port: config.PORT, host: config.HOST });
  app.log.info({ port: config.PORT, host: config.HOST }, 'Semantic engine listening');
  return app;
};
