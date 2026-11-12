import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { SaleInput, SaleDetail, Role } from '@nexovet/shared';
import { buildApp } from '../src/app.js';
import { parseConfig } from '../src/config.js';
import { createPool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrations.js';
import { seed } from '../src/db/seeds.js';
import { hashPassword } from '../src/auth/crypto.js';
import { getDemoOverview } from '../src/demo.js';
const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/nexovet_test') throw Error('Ventas requiere nexovet_test');
const pool = createPool(url),
  origin = 'http://127.0.0.1:5173';
const app = buildApp({
  ready: async () => {},
  overview: (r, id) => getDemoOverview(pool, r, id),
  auth: {
    pool,
    config: parseConfig({ DATABASE_URL: url, NODE_ENV: 'test', APP_ORIGIN: origin }),
    sendMail: async () => {},
  },
});
type Person = { id: string; headers: Record<string, string> };
let admin: Person, rec: Person, vet: Person;
const users: string[] = [],
  products: string[] = [],
  services: string[] = [],
  clients: string[] = [],
  sales: string[] = [];
const prefix = `Sales ${randomUUID().slice(0, 8)}`;
before(async () => {
  await migrate(pool);
  await seed(pool, { NODE_ENV: 'test', DATABASE_URL: url });
  await pool.query('DELETE FROM auth_rate_limits');
  const hash = await hashPassword('Ventas ficticias para prueba 2026');
  async function person(role: Role) {
    const id = randomUUID(),
      email = `sales-${id}@example.invalid`;
    await pool.query(
      'INSERT INTO users(id,name,email,role,password_hash,login_enabled) VALUES ($1,$2,$3,$4,$5,true)',
      [id, `${prefix} ${role}`, email, role, hash],
    );
    users.push(id);
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin },
      payload: { email, password: 'Ventas ficticias para prueba 2026' },
    });
    assert.equal(r.statusCode, 200);
    return {
      id,
      headers: {
        origin,
        cookie: `nexovet_session=${r.cookies[0]!.value}`,
        'x-csrf-token': r.json().csrfToken,
      },
    };
  }
  admin = await person('admin');
  rec = await person('reception');
  vet = await person('veterinarian');
});
after(async () => {
  await app.close();
  for (const id of products) {
    const q = (await pool.query('SELECT quantity FROM product_stock WHERE product_id=$1', [id]))
      .rows[0].quantity;
    if (Number(q) !== 0)
      await pool.query(
        "INSERT INTO stock_movements(product_id,quantity,kind,reason,recorded_by) VALUES ($1,-$2::numeric,'adjustment','Compensación de fixture de ventas',$3)",
        [id, q, admin.id],
      );
  }
  await pool.query('UPDATE products SET active=false WHERE id=ANY($1::uuid[])', [products]);
  await pool.query('UPDATE services SET active=false WHERE id=ANY($1::uuid[])', [services]);
  await pool.query(
    "UPDATE sales SET client_id=NULL WHERE client_id=ANY($1::uuid[]) AND status='draft'",
    [clients],
  );
  await pool.query(
    "UPDATE sales SET status='cancelled',version=version+1 WHERE id=ANY($1::uuid[]) AND status='draft'",
    [sales],
  );
  await pool.query('DELETE FROM clients WHERE id=ANY($1::uuid[])', [clients]);
  await pool.query('UPDATE users SET active=false,login_enabled=false WHERE id=ANY($1::uuid[])', [
    users,
  ]);
  await pool.end();
});
const call = (method: 'GET' | 'POST' | 'PUT', path: string, payload?: unknown, actor = rec) =>
  app.inject({ method, url: path, headers: actor.headers, ...(payload ? { payload } : {}) });
async function product(price = '0.10', balance = '5') {
  const id = randomUUID();
  await pool.query(
    'INSERT INTO products(id,sku,name,sale_price,minimum_stock) VALUES ($1,$2,$3,$4,1)',
    [id, `S-${id.slice(0, 8)}`, `${prefix} producto`, price],
  );
  products.push(id);
  if (balance !== '0')
    await pool.query(
      "INSERT INTO stock_movements(product_id,quantity,kind,reason,recorded_by) VALUES ($1,$2,'opening','Saldo ficticio de ventas',$3)",
      [id, balance, admin.id],
    );
  return id;
}
async function service(price = '2.00') {
  const id = randomUUID();
  await pool.query('INSERT INTO services(id,name,duration_minutes,price) VALUES ($1,$2,30,$3)', [
    id,
    `${prefix} servicio ${services.length}`,
    price,
  ]);
  services.push(id);
  return id;
}
const input = (id: string, quantity = '1', kind: 'product' | 'service' = 'product'): SaleInput => ({
  clientId: null,
  note: 'Venta ficticia',
  lines: [{ kind, itemId: id, quantity }],
});
async function create(body: SaleInput, requestId = randomUUID()) {
  const r = await call('POST', '/api/sales', { ...body, requestId });
  assert.equal(r.statusCode, 201, r.body);
  const record = r.json<SaleDetail>();
  if (!sales.includes(record.id)) sales.push(record.id);
  return record;
}
const cash = (amount: string) => [{ method: 'cash', amount, reference: null }];
const confirm = (
  s: SaleDetail,
  payments: unknown = cash(s.total),
  requestId = randomUUID(),
  actor = rec,
) => call('POST', `/api/sales/${s.id}/confirm`, { version: s.version, requestId, payments }, actor);
const stock = async (id: string) =>
  (await pool.query('SELECT quantity FROM product_stock WHERE product_id=$1', [id])).rows[0]
    .quantity;
async function effects(id: string) {
  return (
    await pool.query(
      'SELECT (SELECT count(*)::int FROM payments WHERE sale_id=$1) AS payments,(SELECT count(*)::int FROM stock_movements m JOIN sale_lines l ON l.id=m.sale_line_id WHERE l.sale_id=$1) AS movements,(SELECT status FROM sales WHERE id=$1) AS status',
      [id],
    )
  ).rows[0];
}
test('venta mixta calcula decimales, guarda precios y confirma cobros combinados con salida exacta', async () => {
  const p = await product(),
    svc = await service('50');
  const s = await create({
    ...input(p, '2.125'),
    lines: [...input(p, '2.125').lines, ...input(svc, '1.000', 'service').lines],
  });
  assert.equal(s.total, '50.21');
  assert.equal(await stock(p), '5.000');
  await pool.query('UPDATE products SET sale_price=9,name=$2 WHERE id=$1', [
    p,
    'Producto renombrado',
  ]);
  const r = await confirm(s, [
    { method: 'cash', amount: '0.21', reference: null },
    { method: 'transfer', amount: '50', reference: 'Operación ficticia' },
  ]);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().total, '50.21');
  assert.equal(r.json().paid, '50.21');
  assert.equal(r.json().payments.length, 2);
  assert.equal(r.json().confirmedByName, `${prefix} reception`);
  assert.equal(await stock(p), '2.875');
  assert.equal(
    r.json().lines.find((l: { kind: string }) => l.kind === 'product').description,
    `${prefix} producto`,
  );
  const history = (await call('GET', `/api/products/${p}/movements`)).json();
  assert.equal(history.items[0].saleNumber, s.number);
});
test('editar borrador actualiza precios del catálogo y exige versión sin reservar stock', async () => {
  const p = await product(),
    svc = await service();
  const s = await create({
    ...input(p, '9'),
    lines: [...input(p, '9').lines, ...input(svc, '1', 'service').lines],
  });
  assert.equal(await stock(p), '5.000');
  await pool.query('UPDATE products SET sale_price=0.20 WHERE id=$1', [p]);
  const b = {
    ...input(p, '2'),
    lines: [...input(p, '2').lines, ...input(svc, '1.000', 'service').lines],
    version: 1,
  };
  const r = await call('PUT', `/api/sales/${s.id}`, b);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().total, '2.40');
  assert.equal(r.json().version, 2);
  assert.equal((await call('PUT', `/api/sales/${s.id}`, b)).statusCode, 409);
  assert.equal(await stock(p), '5.000');
});
test('cliente activo opcional, búsqueda literal y paginación mantienen identidad', async () => {
  const p = await product(),
    id = randomUUID();
  await pool.query('INSERT INTO clients(id,name) VALUES ($1,$2)', [id, `${prefix} %_ cliente`]);
  clients.push(id);
  const s = await create({ ...input(p), clientId: id });
  const path = `/api/sales?clientId=${id}&q=${encodeURIComponent('%_ cliente')}&pageSize=1`;
  assert.equal((await call('GET', path)).json().total, 1);
  assert.equal((await call('GET', path + '&page=2')).json().items.length, 0);
  await pool.query('UPDATE clients SET active=false WHERE id=$1', [id]);
  assert.equal((await confirm(s)).statusCode, 409);
  assert.deepEqual(await effects(s.id), { payments: 0, movements: 0, status: 'draft' });
  assert.equal(
    (await call('PUT', `/api/sales/${s.id}`, { ...input(p), version: 1 })).statusCode,
    200,
  );
});
test('valida cantidades, servicios enteros, límites y rechaza precios o identidades impuestos', async () => {
  const p = await product('9999999999.99'),
    svc = await service();
  for (const quantity of ['0', '-1', '1e2', '1.0001'])
    assert.equal(
      (await call('POST', '/api/sales', { ...input(p, quantity), requestId: randomUUID() }))
        .statusCode,
      400,
    );
  assert.equal(
    (await call('POST', '/api/sales', { ...input(svc, '1.5', 'service'), requestId: randomUUID() }))
      .statusCode,
    400,
  );
  assert.equal(
    (await call('POST', '/api/sales', { ...input(p, '2'), requestId: randomUUID() })).statusCode,
    400,
  );
  assert.equal(
    (
      await call('POST', '/api/sales', {
        ...input(p),
        lines: [{ ...input(p).lines[0], unitPrice: '0' }],
        requestId: randomUUID(),
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await call('POST', '/api/sales', {
        ...input(p),
        lines: [...input(p).lines, ...input(p).lines],
        requestId: randomUUID(),
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await call('POST', '/api/sales', {
        ...input(p),
        createdBy: admin.id,
        requestId: randomUUID(),
      })
    ).statusCode,
    400,
  );
});
test('roles, sesión y CSRF protegen listados, búsquedas, cobros y confirmación', async () => {
  const p = await product(),
    s = await create(input(p));
  for (const path of [
    '/api/sales',
    '/api/sales/items?kind=product&q=NV',
    '/api/sales/clients?q=Demo',
    `/api/sales/${s.id}`,
  ]) {
    assert.equal((await call('GET', path, undefined, vet)).statusCode, 403);
    assert.equal((await app.inject(path)).statusCode, 401);
  }
  assert.equal(
    (await call('POST', '/api/sales', { ...input(p), requestId: randomUUID() }, vet)).statusCode,
    403,
  );
  assert.equal((await confirm(s, cash(s.total), randomUUID(), vet)).statusCode, 403);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: `/api/sales/${s.id}/confirm`,
        headers: { origin, cookie: rec.headers.cookie },
        payload: { requestId: randomUUID(), version: 1, payments: cash(s.total) },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await call('POST', `/api/sales/${s.id}/confirm`, {
        requestId: randomUUID(),
        version: 1,
        payments: cash(s.total),
        recordedBy: admin.id,
      })
    ).statusCode,
    400,
  );
});
test('cobros menores o mayores, importes inválidos y referencias ausentes no dejan efectos', async () => {
  const p = await product('2'),
    s = await create(input(p));
  for (const payments of [
    cash('1.99'),
    cash('2.01'),
    cash('0'),
    cash('2.001'),
    [{ method: 'card', amount: '2', reference: null }],
    [{ method: 'transfer', amount: '2', reference: 'X' }],
  ]) {
    assert.equal((await confirm(s, payments)).statusCode, 400);
    assert.deepEqual(await effects(s.id), { payments: 0, movements: 0, status: 'draft' });
  }
  assert.equal(await stock(p), '5.000');
});
test('servicio sin importe se confirma sin cobros ni movimientos de productos', async () => {
  const svc = await service('0'),
    s = await create(input(svc, '1', 'service'));
  assert.equal(s.total, '0.00');
  assert.equal((await confirm(s, cash('0'))).statusCode, 400);
  const r = await confirm(s, []);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().paid, '0.00');
  assert.deepEqual(await effects(s.id), { payments: 0, movements: 0, status: 'confirmed' });
});
test('crear con la misma solicitud concurrente produce un solo borrador', async () => {
  const p = await product(),
    requestId = randomUUID(),
    body = { ...input(p), requestId };
  const r = await Promise.all([
    call('POST', '/api/sales', body),
    call('POST', '/api/sales', { ...body, requestId: requestId.toUpperCase() }),
  ]);
  assert.ok(r.every((v) => v.statusCode === 201));
  assert.equal(r[0].json().id, r[1].json().id);
  sales.push(r[0].json().id);
  assert.equal(
    (await call('POST', '/api/sales', { ...body, note: 'Otro contenido' })).statusCode,
    409,
  );
});
test('confirmación concurrente con UUID equivalente registra una salida y un cobro', async () => {
  const p = await product(),
    s = await create(input(p)),
    key = randomUUID();
  const r = await Promise.all([
    confirm(s, cash(s.total), key),
    confirm(s, cash(s.total), key.toUpperCase()),
  ]);
  assert.ok(
    r.every((v) => v.statusCode === 200),
    r.map((v) => v.body).join(),
  );
  assert.ok(r.some((v) => v.headers['idempotent-replay'] === 'true'));
  assert.equal(await stock(p), '4.000');
  assert.deepEqual(await effects(s.id), { payments: 1, movements: 1, status: 'confirmed' });
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM audit_logs WHERE entity_id=$1 AND action='sale.confirmed'",
        [s.id],
      )
    ).rows[0].n,
    1,
  );
});
test('reutilizar una confirmación con otros datos, actor o venta no duplica cobros', async () => {
  const p = await product(),
    s = await create(input(p)),
    key = randomUUID();
  assert.equal((await confirm(s, cash(s.total), key)).statusCode, 200);
  assert.equal(
    (await confirm(s, [{ method: 'card', amount: s.total, reference: 'Otra operación' }], key))
      .statusCode,
    409,
  );
  assert.equal((await confirm(s, cash(s.total), key, admin)).statusCode, 409);
  const other = await create(input(p));
  assert.equal((await confirm(other, cash(other.total), key)).statusCode, 409);
  assert.equal((await confirm(s)).statusCode, 409);
  assert.equal(await stock(p), '4.000');
});
test('dos ventas concurrentes de la última unidad no sobregiran el saldo', async () => {
  const p = await product('1', '1'),
    a = await create(input(p)),
    b = await create(input(p));
  const r = await Promise.all([confirm(a), confirm(b)]);
  assert.deepEqual(r.map((v) => v.statusCode).sort(), [200, 409]);
  assert.equal(await stock(p), '0.000');
  const states = await Promise.all([effects(a.id), effects(b.id)]);
  assert.equal(
    states.reduce((n, x) => n + x.payments, 0),
    1,
  );
  assert.equal(
    states.reduce((n, x) => n + x.movements, 0),
    1,
  );
});
test('sin stock en una línea se revierte la venta completa con cobros y otras salidas', async () => {
  const p = await product('1', '5'),
    q = await product('1', '0'),
    s = await create({ ...input(p), lines: [...input(p).lines, ...input(q).lines] });
  assert.equal((await confirm(s)).statusCode, 409);
  assert.equal(await stock(p), '5.000');
  assert.equal(await stock(q), '0.000');
  assert.deepEqual(await effects(s.id), { payments: 0, movements: 0, status: 'draft' });
});
test('cancelación y confirmación compiten con una sola transición válida', async () => {
  const p = await product(),
    s = await create(input(p));
  const r = await Promise.all([
    call('POST', `/api/sales/${s.id}/cancel`, { version: 1 }),
    confirm(s),
  ]);
  assert.deepEqual(r.map((v) => v.statusCode).sort(), [200, 409]);
  const state = await effects(s.id);
  assert.equal(await stock(p), state.status === 'confirmed' ? '4.000' : '5.000');
  assert.equal(
    (await call('PUT', `/api/sales/${s.id}`, { ...input(p), version: 2 })).statusCode,
    409,
  );
});
test('archivar producto o servicio impide confirmar el borrador sin efectos parciales', async () => {
  const p = await product(),
    svc = await service(),
    s = await create({
      ...input(p),
      lines: [...input(p).lines, ...input(svc, '1', 'service').lines],
    });
  await pool.query('UPDATE products SET active=false WHERE id=$1', [p]);
  assert.equal((await confirm(s)).statusCode, 409);
  await pool.query('UPDATE products SET active=true WHERE id=$1', [p]);
  await pool.query('UPDATE services SET active=false WHERE id=$1', [svc]);
  assert.equal((await confirm(s)).statusCode, 409);
  assert.deepEqual(await effects(s.id), { payments: 0, movements: 0, status: 'draft' });
});
test('documento confirmado y pagos son inmutables; la base exige conciliación y salidas', async () => {
  const p = await product(),
    demoClient = (await pool.query("SELECT id,name FROM clients WHERE id=md5('client:1')::uuid"))
      .rows[0],
    s = await create({ ...input(p), clientId: demoClient.id });
  const r = await confirm(s);
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().clientName, demoClient.name);
  for (const sql of [
    "UPDATE sales SET note='Cambio' WHERE id=$1",
    'DELETE FROM sale_lines WHERE sale_id=$1',
    'UPDATE payments SET amount=99 WHERE sale_id=$1',
    'DELETE FROM payments WHERE sale_id=$1',
  ]) {
    await assert.rejects(
      pool.query(sql, [s.id]),
      (e: unknown) => (e as { code: string }).code === '23514',
    );
  }
  const other = await create(input(p));
  await assert.rejects(
    pool.query(
      "UPDATE sales SET status='confirmed',confirmed_at=now(),confirmed_by=$2 WHERE id=$1",
      [other.id, admin.id],
    ),
    (e: unknown) => (e as { constraint: string }).constraint === 'sale_confirm_integrity',
  );
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      "INSERT INTO payments(sale_id,method,amount,recorded_by) VALUES ($1,'cash',$2,$3)",
      [other.id, other.total, admin.id],
    );
    await c.query(
      "UPDATE sales SET status='confirmed',confirmed_at=now(),confirmed_by=$2 WHERE id=$1",
      [other.id, admin.id],
    );
    await assert.rejects(
      c.query('COMMIT'),
      (e: unknown) => (e as { constraint: string }).constraint === 'sale_confirm_integrity',
    );
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
  assert.deepEqual(await effects(other.id), { payments: 0, movements: 0, status: 'draft' });
});
test('fallo de auditoría revierte confirmación, pagos y stock; solicitud puede reintentarse', async () => {
  const p = await product(),
    s = await create(input(p)),
    key = randomUUID();
  await pool.query(
    `ALTER TABLE audit_logs ADD CONSTRAINT sales_test_failure CHECK(actor_id<>'${rec.id}'::uuid) NOT VALID`,
  );
  try {
    assert.equal((await confirm(s, cash(s.total), key)).statusCode, 500);
    assert.equal(await stock(p), '5.000');
    assert.deepEqual(await effects(s.id), { payments: 0, movements: 0, status: 'draft' });
  } finally {
    await pool.query('ALTER TABLE audit_logs DROP CONSTRAINT sales_test_failure');
  }
  assert.equal((await confirm(s, cash(s.total), key)).statusCode, 200);
});
test('fallo de auditoría al crear no deja borrador ni consume la solicitud idempotente', async () => {
  const p = await product(),
    key = randomUUID(),
    body = { ...input(p), requestId: key };
  await pool.query(
    `ALTER TABLE audit_logs ADD CONSTRAINT sales_test_failure CHECK(actor_id<>'${rec.id}'::uuid) NOT VALID`,
  );
  try {
    assert.equal((await call('POST', '/api/sales', body)).statusCode, 500);
    assert.equal(
      (await pool.query('SELECT count(*)::int AS n FROM sales WHERE request_id=$1', [key])).rows[0]
        .n,
      0,
    );
  } finally {
    await pool.query('ALTER TABLE audit_logs DROP CONSTRAINT sales_test_failure');
  }
  const r = await call('POST', '/api/sales', body);
  assert.equal(r.statusCode, 201, r.body);
  sales.push(r.json().id);
});
