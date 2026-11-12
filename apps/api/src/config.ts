import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

loadEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z
    .url()
    .refine((value) => /^postgres(ql)?:/.test(value), 'Use una URL de PostgreSQL'),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(1).default(0),
  ENABLE_DEMO: z.enum(['true', 'false']).default('false'),
  APP_ORIGIN: z.url().default('http://localhost:5173'),
  MAIL_DELIVERY: z.enum(['local', 'smtp']).default('local'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z.enum(['true', 'false']).default('false'),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.email().optional(),
});
export function parseConfig(env: NodeJS.ProcessEnv) {
  const result = schema.safeParse(env);
  if (!result.success)
    throw new Error(
      `Configuración inválida: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
  if (result.data.NODE_ENV === 'production' && result.data.ENABLE_DEMO === 'true') {
    throw new Error('ENABLE_DEMO no está permitido en producción');
  }
  const origin = new URL(result.data.APP_ORIGIN);
  if (origin.origin !== result.data.APP_ORIGIN || origin.username || origin.password)
    throw new Error('APP_ORIGIN debe ser un origen sin ruta ni credenciales');
  if (
    result.data.NODE_ENV === 'production' &&
    (origin.protocol !== 'https:' || result.data.MAIL_DELIVERY !== 'smtp')
  )
    throw new Error('Producción requiere APP_ORIGIN HTTPS y correo SMTP');
  if (result.data.MAIL_DELIVERY === 'smtp' && (!result.data.SMTP_HOST || !result.data.MAIL_FROM))
    throw new Error('SMTP requiere SMTP_HOST y MAIL_FROM');
  if (Boolean(result.data.SMTP_USER) !== Boolean(result.data.SMTP_PASSWORD))
    throw new Error('Configure ambos SMTP_USER y SMTP_PASSWORD');
  return result.data;
}
export type Config = ReturnType<typeof parseConfig>;
export function assertDevelopmentDatabase(env: NodeJS.ProcessEnv) {
  if (env.NODE_ENV === 'production')
    throw new Error('Los datos ficticios están prohibidos en producción');
  const name = new URL(env.DATABASE_URL ?? '').pathname.slice(1);
  if (!/^nexovet_(dev|test)$/.test(name))
    throw new Error('Esta operación requiere nexovet_dev o nexovet_test');
}
