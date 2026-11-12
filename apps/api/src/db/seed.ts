import { parseConfig } from '../config.js';
import { createPool } from './pool.js';
import { seed } from './seeds.js';
const pool = createPool(parseConfig(process.env).DATABASE_URL);
try {
  await seed(pool, process.env);
  console.info('Datos ficticios cargados; repetir no duplica registros.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Error al cargar datos ficticios');
  process.exitCode = 1;
} finally {
  await pool.end();
}
