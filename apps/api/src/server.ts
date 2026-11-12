import { parseConfig } from './config.js';
import { createPool } from './db/pool.js';
import { getDemoOverview } from './demo.js';
import { buildApp } from './app.js';
import { createMailer } from './auth/mail.js';
const config = parseConfig(process.env);
const pool = createPool(config.DATABASE_URL);
const app = buildApp({
  production: config.NODE_ENV === 'production',
  enableDemo: config.ENABLE_DEMO === 'true',
  logger: true,
  ready: async () => {
    await pool.query('SELECT 1 FROM business_settings LIMIT 1');
  },
  overview: (role, userId) => getDemoOverview(pool, role, userId),
  auth: { pool, config, sendMail: createMailer(config) },
});
app.addHook('onClose', async () => {
  await pool.end();
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    void app.close();
  });
try {
  await app.listen({ port: config.API_PORT, host: config.API_HOST });
} catch {
  app.log.error('No se pudo iniciar la API. Revisa la configuración y el puerto.');
  await app.close();
  process.exitCode = 1;
}
