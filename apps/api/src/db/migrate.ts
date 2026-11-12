import { parseConfig } from '../config.js';
import { createPool } from './pool.js';
import { migrate } from './migrations.js';
const pool = createPool(parseConfig(process.env).DATABASE_URL);
try {
  console.info(`Migraciones verificadas: ${await migrate(pool)}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Error de migración');
  process.exitCode = 1;
} finally {
  await pool.end();
}
