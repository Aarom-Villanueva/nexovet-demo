import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createPool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrations.js';
import { seed } from '../src/db/seeds.js';
import { checkDatabase } from '../src/db/readiness.js';
import { initializeBusiness } from '../src/db/initialize.js';
const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/nexovet_test')
  throw Error('Operaciones requiere nexovet_test');
const pool = createPool(url);
before(async () => {
  await migrate(pool);
  await seed(pool, { NODE_ENV: 'test', DATABASE_URL: url });
});
after(async () => {
  await pool.end();
});

test('disponibilidad verifica versión y distingue base demostrativa de producción', async () => {
  await checkDatabase(pool);
  await assert.rejects(checkDatabase(pool, true), /demostrativa/);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('UPDATE business_settings SET is_demo=false');
    await checkDatabase(c, true);
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
});
test('disponibilidad rechaza migraciones pendientes, nuevas y checksum cambiado sin aplicar DDL', async () => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      "UPDATE schema_migrations SET checksum=repeat('0',64) WHERE name='008_reports_administration.sql'",
    );
    await assert.rejects(checkDatabase(c), /incompatibles/);
    await c.query('ROLLBACK');
    await c.query('BEGIN');
    await c.query("DELETE FROM schema_migrations WHERE name='008_reports_administration.sql'");
    await assert.rejects(checkDatabase(c), /pendientes/);
    await c.query('ROLLBACK');
    await c.query('BEGIN');
    await c.query(
      "INSERT INTO schema_migrations(name,checksum) VALUES ('999_future.sql',repeat('0',64))",
    );
    await assert.rejects(checkDatabase(c), /incompatibles/);
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
  await checkDatabase(pool);
});
test('una conexión sin veterinaria configurada no se anuncia lista', async () => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('DELETE FROM business_settings');
    await assert.rejects(checkDatabase(c), /Configura/);
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
});
test('inicialización valida entradas y rechaza reemplazar un negocio existente sin cambios', async () => {
  const initial = (await pool.query('SELECT * FROM business_settings')).rows;
  const audit = (await pool.query('SELECT count(*) FROM audit_logs')).rows;
  await assert.rejects(initializeBusiness(pool, { name: ' ', address: ' ' }));
  const outcomes = await Promise.allSettled([
    initializeBusiness(pool, { name: 'No reemplazar', address: 'Dirección de prueba' }),
    initializeBusiness(pool, { name: 'No reemplazar 2', address: 'Otra dirección' }),
  ]);
  assert.ok(outcomes.every((r) => r.status === 'rejected'));
  assert.deepEqual((await pool.query('SELECT * FROM business_settings')).rows, initial);
  assert.deepEqual((await pool.query('SELECT count(*) FROM audit_logs')).rows, audit);
});
