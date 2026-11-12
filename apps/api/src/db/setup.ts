import { parseConfig } from '../config.js';
import { createPool } from './pool.js';
import { initializeBusiness } from './initialize.js';
const pool = createPool(parseConfig(process.env).DATABASE_URL);
try {
  await initializeBusiness(pool, {
    name: process.env.BUSINESS_NAME,
    address: process.env.BUSINESS_ADDRESS,
  });
  console.info('Veterinaria vacía creada. Continúa con el primer administrador.');
} catch {
  console.error(
    'No se inicializó: revisa BUSINESS_NAME, BUSINESS_ADDRESS, migraciones y que la base esté vacía.',
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
