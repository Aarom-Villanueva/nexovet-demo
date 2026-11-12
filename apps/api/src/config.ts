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
  ENABLE_DEMO: z.enum(['true', 'false']).default('false'),
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
  return result.data;
}
export function assertDevelopmentDatabase(env: NodeJS.ProcessEnv) {
  if (env.NODE_ENV === 'production')
    throw new Error('Los datos ficticios están prohibidos en producción');
  const name = new URL(env.DATABASE_URL ?? '').pathname.slice(1);
  if (!/^nexovet_(dev|test)$/.test(name))
    throw new Error('Esta operación requiere nexovet_dev o nexovet_test');
}
