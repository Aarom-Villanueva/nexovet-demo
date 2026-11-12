import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { assertDevelopmentDatabase } from '../src/config.js';
import { createPool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrations.js';
import { seed } from '../src/db/seeds.js';
import { getDemoOverview } from '../src/demo.js';
import { buildApp } from '../src/app.js';

const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/nexovet_test')
  throw new Error('Configure TEST_DATABASE_URL para una base nexovet_test separada');
const testEnv = { NODE_ENV: 'test', DATABASE_URL: url };
assertDevelopmentDatabase(testEnv);
const pool = createPool(url);
before(async () => {
  await migrate(pool);
  await seed(pool, testEnv);
});
after(async () => {
  await pool.end();
});

async function transaction(run: (client: PoolClient) => Promise<void>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await run(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}
async function rejectWithCode(action: Promise<unknown>, code: string) {
  await assert.rejects(
    action,
    (error: unknown) =>
      typeof error === 'object' && error !== null && 'code' in error && error.code === code,
  );
}
test('migrar y sembrar dos veces preserva filas, saldo y accesos existentes', async () => {
  const before = await pool.query(
    'SELECT (SELECT count(*) FROM clients) AS clients,(SELECT count(*) FROM pets) AS pets,(SELECT count(*) FROM stock_movements) AS movements,(SELECT sum(quantity) FROM product_stock) AS stock',
  );
  const accessBefore = (
    await pool.query('SELECT id,password_hash,login_enabled FROM users ORDER BY id')
  ).rows;
  await migrate(pool);
  await seed(pool, testEnv);
  const after = await pool.query(
    'SELECT (SELECT count(*) FROM clients) AS clients,(SELECT count(*) FROM pets) AS pets,(SELECT count(*) FROM stock_movements) AS movements,(SELECT sum(quantity) FROM product_stock) AS stock',
  );
  assert.deepEqual(after.rows, before.rows);
  assert.equal(before.rows[0].clients, '320');
  assert.equal(before.rows[0].pets, '400');
  assert.equal((await pool.query('SELECT count(*) FROM products')).rows[0].count, '320');
  assert.deepEqual(
    (await pool.query('SELECT id,password_hash,login_enabled FROM users ORDER BY id')).rows,
    accessBefore,
  );
});
test('no se pueden registrar mascotas de un cliente inexistente', async () =>
  transaction(async (client) => {
    await rejectWithCode(
      client.query(
        "INSERT INTO pets(client_id,name,species) VALUES ($1,'Paciente de prueba','dog')",
        [randomUUID()],
      ),
      '23503',
    );
  }));
test('un seguimiento no puede vincular una mascota con otro propietario', async () =>
  transaction(async (client) => {
    await rejectWithCode(
      client.query(
        "INSERT INTO follow_up_tasks(client_id,pet_id,title,due_at) VALUES (md5('client:2')::uuid,md5('pet:1')::uuid,'Prueba',now())",
      ),
      '23503',
    );
  }));
const insertAppointment = `INSERT INTO appointments(pet_id,professional_id,service_id,starts_at,ends_at,status)
 VALUES (md5('pet:1')::uuid,md5('user:vet1')::uuid,md5('service:consult')::uuid,$1,$2,$3)`;
test('rechaza cruces de agenda del profesional', async () =>
  transaction(async (client) => {
    await client.query(insertAppointment, [
      '2040-01-01T09:00:00-05:00',
      '2040-01-01T10:00:00-05:00',
      'scheduled',
    ]);
    await rejectWithCode(
      client.query(insertAppointment.replace("md5('pet:1')", "md5('pet:2')"), [
        '2040-01-01T09:30:00-05:00',
        '2040-01-01T10:30:00-05:00',
        'confirmed',
      ]),
      '23P01',
    );
  }));
test('rechaza cruces de una mascota con dos profesionales distintos', async () =>
  transaction(async (client) => {
    await client.query(insertAppointment, [
      '2040-01-01T09:00:00-05:00',
      '2040-01-01T10:00:00-05:00',
      'scheduled',
    ]);
    await rejectWithCode(
      client.query(insertAppointment.replace("md5('user:vet1')", "md5('user:vet2')"), [
        '2040-01-01T09:30:00-05:00',
        '2040-01-01T10:30:00-05:00',
        'confirmed',
      ]),
      '23P01',
    );
  }));
test('permite citas consecutivas y reutilizar un horario cancelado', async () =>
  transaction(async (client) => {
    await client.query(insertAppointment, [
      '2040-01-01T09:00:00-05:00',
      '2040-01-01T10:00:00-05:00',
      'cancelled',
    ]);
    await client.query(insertAppointment, [
      '2040-01-01T09:00:00-05:00',
      '2040-01-01T10:00:00-05:00',
      'scheduled',
    ]);
    await client.query(insertAppointment, [
      '2040-01-01T10:00:00-05:00',
      '2040-01-01T11:00:00-05:00',
      'scheduled',
    ]);
  }));
test('recepción no puede figurar como veterinario de la atención', async () =>
  transaction(async (client) => {
    await rejectWithCode(
      client.query(insertAppointment.replace("md5('user:vet1')", "md5('user:reception')"), [
        '2040-01-01T09:00:00-05:00',
        '2040-01-01T10:00:00-05:00',
        'scheduled',
      ]),
      '23514',
    );
  }));
test('no admite stock negativo', async () =>
  transaction(async (client) => {
    await rejectWithCode(
      client.query(
        "INSERT INTO stock_movements(product_id,quantity,kind,reason,recorded_by) VALUES (md5('product:1')::uuid,-999,'adjustment','Prueba',md5('user:admin')::uuid)",
      ),
      '23514',
    );
  }));
test('los movimientos y la auditoría son inmutables', async () =>
  transaction(async (client) => {
    await client.query('SAVEPOINT movement');
    await rejectWithCode(
      client.query("UPDATE stock_movements SET quantity=50 WHERE id=md5('opening:1')::uuid"),
      '23514',
    );
    await client.query('ROLLBACK TO SAVEPOINT movement');
    const log = await client.query(
      "INSERT INTO audit_logs(action,entity_type) VALUES ('test','test') RETURNING id",
    );
    await rejectWithCode(
      client.query('DELETE FROM audit_logs WHERE id=$1', [log.rows[0].id]),
      '23514',
    );
  }));
test('los importes decimales conservan precisión y una línea no mezcla producto y servicio', async () =>
  transaction(async (client) => {
    const result = await client.query(
      "INSERT INTO sale_lines(sale_id,product_id,description,quantity,unit_price) VALUES (md5('sale:1')::uuid,md5('product:2')::uuid,'Prueba',3,0.10) RETURNING line_total",
    );
    assert.equal(result.rows[0].line_total, '0.30');
    await rejectWithCode(
      client.query(
        "INSERT INTO sale_lines(sale_id,product_id,service_id,description,quantity,unit_price) VALUES (md5('sale:1')::uuid,md5('product:2')::uuid,md5('service:consult')::uuid,'Prueba',1,1)",
      ),
      '23514',
    );
  }));
test('dos salidas concurrentes no pueden consumir el mismo saldo', async () => {
  const product = (await pool.query("SELECT md5('product:320')::uuid AS id")).rows[0].id;
  const original = Number(
    (await pool.query('SELECT quantity FROM product_stock WHERE product_id=$1', [product])).rows[0]
      .quantity,
  );
  assert.ok(original > 0);
  const a = await pool.connect();
  const b = await pool.connect();
  try {
    await a.query('BEGIN');
    await b.query('BEGIN');
    const query =
      "INSERT INTO stock_movements(product_id,quantity,kind,reason,recorded_by) VALUES ($1,$2,'adjustment','Prueba concurrente',md5('user:admin')::uuid)";
    await a.query(query, [product, -original]);
    // Se instala el rechazo antes de liberar el bloqueo para evitar rechazos sin manejar.
    const second = rejectWithCode(b.query(query, [product, -original]), '23514');
    await a.query('COMMIT');
    await second;
    await b.query('ROLLBACK');
    assert.equal(
      (await pool.query('SELECT quantity FROM product_stock WHERE product_id=$1', [product]))
        .rows[0].quantity,
      '0.000',
    );
  } finally {
    await a.query('ROLLBACK');
    await b.query('ROLLBACK');
    a.release();
    b.release();
    // Restaura el saldo con una compensación; nunca borra el libro inmutable.
    const current = Number(
      (await pool.query('SELECT quantity FROM product_stock WHERE product_id=$1', [product]))
        .rows[0].quantity,
    );
    if (current !== original)
      await pool.query(
        "INSERT INTO stock_movements(product_id,quantity,kind,reason,recorded_by) VALUES ($1,$2,'adjustment','Compensación de prueba concurrente',md5('user:admin')::uuid)",
        [product, original - current],
      );
  }
});
test('el resumen lee PostgreSQL y ya no expone una ruta pública', async () => {
  const data = await getDemoOverview(pool);
  assert.equal(data?.demo, true);
  assert.equal(data?.totals.clients, 320);
  assert.equal(data?.totals.pets, 400);
  assert.ok(data!.appointments.length > 0);
  assert.ok(data!.products.length > 0);
  const app = buildApp({
    enableDemo: true,
    ready: async () => {},
    overview: (role) => getDemoOverview(pool, role),
  });
  try {
    assert.equal((await app.inject('/api/demo/overview')).statusCode, 404);
  } finally {
    await app.close();
  }
});
