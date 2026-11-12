import Fastify from 'fastify';
import type { DemoOverview, Role } from '@nexovet/shared';
import { registerAuth, type AuthOptions } from './auth/routes.js';

interface Options {
  production?: boolean;
  enableDemo?: boolean;
  logger?: boolean;
  ready: () => Promise<void>;
  overview: (role: Role) => Promise<DemoOverview | null>;
  auth?: Omit<AuthOptions, 'overview'>;
}
export function buildApp(options: Options) {
  if (options.production && options.enableDemo)
    throw new Error('Vista previa prohibida en producción');
  const app = Fastify({
    logger: options.logger
      ? { redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'] }
      : false,
    bodyLimit: 16384,
  });
  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'no-store');
    reply.header('Referrer-Policy', 'no-referrer');
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
  if (options.auth)
    void app.register(async (scope) =>
      registerAuth(scope, { ...options.auth!, overview: options.overview }),
    );
  app.setErrorHandler((error, _request, reply) => {
    // No registrar consultas SQL/valores de entrada ni errores SMTP con credenciales.
    app.log.error({ code: (error as { code?: string }).code }, 'Solicitud fallida');
    const status = (error as { statusCode?: number }).statusCode;
    void reply
      .code(status && status >= 400 && status < 500 ? status : 500)
      .send({ message: 'Ocurrió un error al procesar la solicitud.' });
  });
  return app;
}
