import type { Pool } from 'pg';
import { z } from 'zod';

export const businessInput = z
  .object({
    name: z.string().trim().min(2).max(150),
    address: z.string().trim().min(2).max(300),
  })
  .strict();

export async function initializeBusiness(pool: Pool, input: unknown) {
  const data = businessInput.parse(input);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT pg_advisory_xact_lock(hashtext('nexovet:initialize'))");
    if ((await c.query('SELECT 1 FROM business_settings')).rowCount)
      throw new Error('Ya existe una veterinaria; no se modificó');
    // No convertir una base con datos anteriores o ficticios en otra clínica.
    const occupied = (
      await c.query(
        `SELECT EXISTS(SELECT 1 FROM users) OR EXISTS(SELECT 1 FROM clients) OR EXISTS(SELECT 1 FROM products) OR EXISTS(SELECT 1 FROM services) OR EXISTS(SELECT 1 FROM suppliers) OR EXISTS(SELECT 1 FROM product_categories) OR EXISTS(SELECT 1 FROM auth_rate_limits) OR EXISTS(SELECT 1 FROM audit_logs) AS occupied`,
      )
    ).rows[0].occupied;
    if (occupied) throw new Error('La base no está vacía');
    await c.query('INSERT INTO business_settings(name,address,is_demo) VALUES ($1,$2,false)', [
      data.name,
      data.address,
    ]);
    await c.query(
      "INSERT INTO audit_logs(action,entity_type) VALUES ('operations.business_initialized','business_settings')",
    );
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
