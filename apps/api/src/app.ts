import Fastify from 'fastify';
import type { DemoOverview } from '@nexovet/shared';

interface Options {
  production?: boolean;
  enableDemo?: boolean;
  logger?: boolean;
  ready: () => Promise<void>;
  overview: () => Promise<DemoOverview | null>;
}
export function buildApp(options: Options) {
  if (options.production && options.enableDemo)
    throw new Error('Vista previa prohibida en producción');
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 65536 });
  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'no-store');
  });
  app.get('/api/health', async () => ({ status: 'ok', service: 'nexovet-api' }));
  app.get('/api/ready', async (_request, reply) => {
    try {
      await options.ready();
      return { status: 'ready' };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });
  if (options.enableDemo && !options.production)
    app.get('/api/demo/overview', async (_request, reply) => {
      try {
        const data = await options.overview();
        if (!data)
          return reply.code(409).send({ message: 'No hay una base de demostración preparada.' });
        return data;
      } catch (error) {
        app.log.error({ err: error }, 'No se pudo cargar la vista previa');
        return reply
          .code(503)
          .send({ message: 'No se pudo cargar la vista previa. Intenta nuevamente.' });
      }
    });
  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    void reply.code(500).send({ message: 'Ocurrió un error al procesar la solicitud.' });
  });
  return app;
}
