import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import { assertDevelopmentDatabase } from '../config.js';
import { databaseDirectory } from './migrations.js';
export async function seed(pool: Pool, env: NodeJS.ProcessEnv) {
  assertDevelopmentDatabase(env);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('nexovet:seed'))");
    const occupied = await client.query('SELECT 1 FROM business_settings WHERE NOT is_demo');
    if (occupied.rowCount) throw new Error('La base contiene un negocio que no es de demostración');
    await client.query(await readFile(`${databaseDirectory}/seeds/demo.sql`, 'utf8'));
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
