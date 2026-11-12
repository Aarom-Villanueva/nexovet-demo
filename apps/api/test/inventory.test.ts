import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { parseConfig } from '../src/config.js';
import { createPool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrations.js';
import { seed } from '../src/db/seeds.js';
import { hashPassword } from '../src/auth/crypto.js';
import { getDemoOverview } from '../src/demo.js';
import type {
  Role,
  ProductInput,
  ProductRecord,
  SupplierInput,
  SupplierRecord,
  PurchaseInput,
  PurchaseDetail,
} from '@nexovet/shared';
const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/nexovet_test')
  throw Error('Inventario requiere nexovet_test');
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
  suppliers: string[] = [],
  orders: string[] = [];
const prefix = `Inv-${randomUUID().slice(0, 8)}`;
before(async () => {
  await migrate(pool);
  await seed(pool, { NODE_ENV: 'test', DATABASE_URL: url });
  await pool.query('DELETE FROM auth_rate_limits');
  const hash = await hashPassword('Acceso ficticio inventario 2026');
  async function person(role: Role) {
    const id = randomUUID(),
      email = `inventory-${id}@example.invalid`;
    await pool.query(
      'INSERT INTO users(id,name,email,role,password_hash,login_enabled) VALUES ($1,$2,$3,$4,$5,true)',
      [id, `${prefix} ${role}`, email, role, hash],
    );
    users.push(id);
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin },
      payload: { email, password: 'Acceso ficticio inventario 2026' },
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
    const stock = (await pool.query('SELECT quantity FROM product_stock WHERE product_id=$1', [id]))
      .rows[0]?.quantity;
    if (stock && Number(stock) !== 0)
      await pool.query(
        "INSERT INTO stock_movements(product_id,quantity,kind,reason,recorded_by) VALUES ($1,-$2::numeric,'adjustment','Compensación de fixture de inventario',$3)",
        [id, stock, admin.id],
      );
  }
  await pool.query('UPDATE products SET active=false WHERE id=ANY($1::uuid[])', [products]);
  await pool.query('UPDATE suppliers SET active=false WHERE id=ANY($1::uuid[])', [suppliers]);
  await pool.query(
    "UPDATE purchase_orders SET status='cancelled',version=version+1 WHERE id=ANY($1::uuid[]) AND status='draft'",
    [orders],
  );
  await pool.query('UPDATE users SET active=false,login_enabled=false WHERE id=ANY($1::uuid[])', [
    users,
  ]);
  await pool.end();
});
const call = (method: 'GET' | 'POST' | 'PUT', path: string, payload?: unknown, person = admin) =>
  app.inject({ method, url: path, headers: person.headers, ...(payload ? { payload } : {}) });
const productBody = (extra: Partial<ProductInput> = {}): ProductInput => ({
  sku: `T-${randomUUID().slice(0, 12)}`,
  name: `${prefix} producto`,
  categoryId: null,
  salePrice: '12.50',
  minimumStock: '2',
  active: true,
  ...extra,
});
const supplierBody = (extra: Partial<SupplierInput> = {}): SupplierInput => ({
  name: `${prefix} proveedor`,
  taxId: null,
  email: null,
  phone: null,
  address: null,
  active: true,
  ...extra,
});
async function newProduct(extra: Partial<ProductInput> = {}) {
  const b = productBody(extra),
    r = await call('POST', '/api/products', b);
  assert.equal(r.statusCode, 201, r.body);
  const p = r.json<ProductRecord>();
  products.push(p.id);
  return p;
}
async function newSupplier(extra: Partial<SupplierInput> = {}) {
  const r = await call('POST', '/api/suppliers', supplierBody(extra), rec);
  assert.equal(r.statusCode, 201, r.body);
  const s = r.json<SupplierRecord>();
  suppliers.push(s.id);
  return s;
}
const editProduct = (p: ProductRecord, extra: object = {}) => ({
  sku: p.sku,
  name: p.name,
  categoryId: p.categoryId,
  salePrice: p.salePrice,
  minimumStock: p.minimumStock,
  active: p.active,
  version: p.version,
  ...extra,
});
const editSupplier = (s: SupplierRecord, extra: object = {}) => ({
  name: s.name,
  taxId: s.taxId,
  email: s.email,
  phone: s.phone,
  address: s.address,
  active: s.active,
  version: s.version,
  ...extra,
});
async function newOrder(p: ProductRecord, s: SupplierRecord, extra: Partial<PurchaseInput> = {}) {
  const body = {
    requestId: randomUUID(),
    supplierId: s.id,
    note: 'Compra ficticia',
    lines: [{ productId: p.id, quantity: '2.125', unitCost: '0.10' }],
    ...extra,
  };
  const r = await call('POST', '/api/purchases', body, rec);
  assert.equal(r.statusCode, 201, r.body);
  const o = r.json<PurchaseDetail>();
  orders.push(o.id);
  return { body, order: o };
}
const stock = async (p: string) =>
  (await call('GET', `/api/products/${p}`)).json<ProductRecord>().stock;
const adjust = (
  p: string,
  q: string,
  requestId = randomUUID(),
  reason = 'Ajuste ficticio de prueba',
) => call('POST', `/api/products/${p}/adjustments`, { requestId, quantity: q, reason });
test('catálogo normaliza SKU, guarda decimales exactos, archivo y versión', async () => {
  const p = await newProduct({
    sku: `abc-${randomUUID().slice(0, 8)}`,
    salePrice: '0.10',
    minimumStock: '1.125',
  });
  assert.match(p.sku, /^ABC-/);
  assert.equal(p.stock, '0.000');
  assert.equal(p.salePrice, '0.10');
  assert.equal(p.minimumStock, '1.125');
  const r = await call('PUT', `/api/products/${p.id}`, editProduct(p, { active: false }));
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().version, 2);
  assert.equal(
    (await call('GET', '/api/overview'))
      .json()
      .products.some((row: { id: string }) => row.id === p.id),
    false,
  );
  assert.equal((await call('PUT', `/api/products/${p.id}`, editProduct(p))).statusCode, 409);
  assert.equal((await call('GET', `/api/products?status=archived&q=${p.sku}`)).json().total, 1);
});
test('proveedor valida contactos y RUC único sin confundirlo con validación SUNAT', async () => {
  const taxId = '0' + Date.now().toString().slice(-10);
  const s = await newSupplier({
    taxId,
    email: 'PROVEEDOR@example.invalid',
    phone: '+51 000 000 000',
  });
  assert.equal(s.email, 'proveedor@example.invalid');
  assert.equal(s.phone, '+51000000000');
  assert.equal(
    (await call('POST', '/api/suppliers', supplierBody({ taxId }), rec)).statusCode,
    409,
  );
  const r = await call('PUT', `/api/suppliers/${s.id}`, editSupplier(s, { active: false }), rec);
  assert.equal(r.statusCode, 200);
  assert.equal((await call('PUT', `/api/suppliers/${s.id}`, editSupplier(s), rec)).statusCode, 409);
});
test('rechaza importes flotantes, exponentes, cantidades cero, desbordes y campos impuestos', async () => {
  for (const salePrice of [1.1, '1e2', '-1', '0.001', '10000000000', '1,25'])
    assert.equal(
      (await call('POST', '/api/products', productBody({ salePrice: salePrice as string })))
        .statusCode,
      400,
    );
  assert.equal(
    (await call('POST', '/api/products', { ...productBody(), stock: '10' })).statusCode,
    400,
  );
  assert.equal(
    (await call('POST', '/api/suppliers', supplierBody({ taxId: '123', phone: 'ABC' }))).statusCode,
    400,
  );
  const p = await newProduct(),
    s = await newSupplier();
  for (const line of [
    { quantity: '0', unitCost: '1' },
    { quantity: '1.0001', unitCost: '1' },
    { quantity: '999999999', unitCost: '9999999999.99' },
  ])
    assert.equal(
      (
        await call('POST', '/api/purchases', {
          requestId: randomUUID(),
          supplierId: s.id,
          note: '',
          lines: [{ productId: p.id, ...line }],
        })
      ).statusCode,
      400,
    );
});
test('búsqueda literal, categoría, stock bajo y paginación estable', async () => {
  const categories = (await call('GET', '/api/inventory/categories')).json();
  const a = await newProduct({ name: `${prefix} %_ literal`, categoryId: categories[0].id });
  await newProduct({ name: `${prefix} %_ literal` });
  const path = `/api/products?q=${encodeURIComponent(`${prefix} %_`)}&pageSize=1`;
  const first = (await call('GET', path)).json(),
    second = (await call('GET', path + '&page=2')).json();
  assert.equal(first.total, 2);
  assert.notEqual(first.items[0].id, second.items[0].id);
  assert.equal(
    (await call('GET', path + `&categoryId=${categories[0].id}&stock=low`)).json().total,
    1,
  );
  assert.equal((await call('GET', `/api/products/${a.id}/movements`)).json().total, 0);
  assert.equal((await call('GET', '/api/products?q=%27%20OR%201=1--')).json().total, 0);
  assert.equal((await call('GET', '/api/products?pageSize=999')).statusCode, 400);
});
test('roles, sesión y CSRF se aplican en todas las rutas comerciales', async () => {
  const p = await newProduct(),
    s = await newSupplier();
  const { order } = await newOrder(p, s);
  for (const path of [
    '/api/products',
    '/api/suppliers',
    '/api/purchases',
    '/api/inventory/categories',
    '/api/inventory/stats',
    `/api/products/${p.id}/movements`,
    `/api/purchases/${order.id}`,
  ]) {
    assert.equal((await call('GET', path, undefined, vet)).statusCode, 403);
    assert.equal((await app.inject(path)).statusCode, 401);
  }
  assert.equal((await call('POST', '/api/products', productBody(), rec)).statusCode, 403);
  assert.equal((await call('PUT', `/api/products/${p.id}`, editProduct(p), rec)).statusCode, 403);
  assert.equal(
    (
      await call(
        'POST',
        `/api/products/${p.id}/adjustments`,
        { requestId: randomUUID(), quantity: '1', reason: 'Prueba permisos' },
        rec,
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/purchases',
        headers: { origin, cookie: admin.headers.cookie },
        payload: {},
      })
    ).statusCode,
    403,
  );
});
test('crear borrador y editar líneas recalcula total sin cambiar stock ni precio de venta', async () => {
  const p = await newProduct(),
    s = await newSupplier();
  const { order } = await newOrder(p, s);
  assert.equal(order.total, '0.21');
  assert.equal(await stock(p.id), '0.000');
  const r = await call(
    'PUT',
    `/api/purchases/${order.id}`,
    {
      supplierId: s.id,
      note: 'Revisado',
      lines: [{ productId: p.id, quantity: '3', unitCost: '0.10' }],
      version: 1,
    },
    rec,
  );
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().total, '0.30');
  assert.equal(
    (
      await call(
        'PUT',
        `/api/purchases/${order.id}`,
        {
          supplierId: s.id,
          note: 'Viejo',
          lines: [{ productId: p.id, quantity: '1', unitCost: '1' }],
          version: 1,
        },
        rec,
      )
    ).statusCode,
    409,
  );
  assert.equal(await stock(p.id), '0.000');
  assert.equal((await call('GET', `/api/products/${p.id}`)).json().salePrice, '12.50');
});
test('solo productos/proveedores activos y líneas distintas; no acepta compras vacías', async () => {
  const p = await newProduct(),
    s = await newSupplier();
  const body = {
    requestId: randomUUID(),
    supplierId: s.id,
    note: '',
    lines: [{ productId: p.id, quantity: '1', unitCost: '2' }],
  };
  assert.equal((await call('POST', '/api/purchases', { ...body, lines: [] })).statusCode, 400);
  assert.equal(
    (await call('POST', '/api/purchases', { ...body, lines: [...body.lines, ...body.lines] }))
      .statusCode,
    400,
  );
  await call('PUT', `/api/products/${p.id}`, editProduct(p, { active: false }));
  assert.equal((await call('POST', '/api/purchases', body)).statusCode, 409);
});
test('crear compra con solicitud repetida concurrente conserva un solo documento', async () => {
  const p = await newProduct(),
    s = await newSupplier();
  const body = {
    requestId: randomUUID(),
    supplierId: s.id,
    note: 'Solicitud única',
    lines: [{ productId: p.id, quantity: '3', unitCost: '4' }],
  };
  const results = await Promise.all([
    call('POST', '/api/purchases', body),
    call('POST', '/api/purchases', { ...body, requestId: body.requestId.toUpperCase() }),
  ]);
  assert.ok(results.every((r) => r.statusCode === 201));
  assert.equal(results[0].json().id, results[1].json().id);
  orders.push(results[0].json().id);
  assert.equal(
    (await call('POST', '/api/purchases', { ...body, note: 'Otro contenido' })).statusCode,
    409,
  );
});
test('recepción concurrente crea una entrada por línea y un solo evento auditado', async () => {
  const p = await newProduct(),
    p2 = await newProduct(),
    s = await newSupplier();
  const { order } = await newOrder(p, s, {
    lines: [
      { productId: p.id, quantity: '2.125', unitCost: '0.10' },
      { productId: p2.id, quantity: '1.005', unitCost: '1' },
    ],
  });
  const r = await Promise.all([
    call('POST', `/api/purchases/${order.id}/receive`, { version: 1 }, rec),
    call('POST', `/api/purchases/${order.id}/receive`, { version: 1 }, rec),
  ]);
  assert.ok(
    r.every((v) => v.statusCode === 200),
    r.map((v) => v.body).join(),
  );
  assert.ok(r.some((v) => v.headers['idempotent-replay'] === 'true'));
  assert.equal(await stock(p.id), '2.125');
  assert.equal(await stock(p2.id), '1.005');
  assert.equal(r[0].json().total, '1.22');
  assert.equal(r[0].json().receivedByName, `${prefix} reception`);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM audit_logs WHERE entity_id=$1 AND action='purchase.received'",
        [order.id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (await call('POST', `/api/purchases/${order.id}/cancel`, { version: 2 })).statusCode,
    409,
  );
  assert.equal(
    (await call('POST', `/api/purchases/${order.id}/receive`, { version: 999 })).statusCode,
    409,
  );
});
test('cancelación y recepción compiten: gana una transición sin stock duplicado', async () => {
  const p = await newProduct(),
    s = await newSupplier(),
    { order } = await newOrder(p, s);
  const r = await Promise.all([
    call('POST', `/api/purchases/${order.id}/cancel`, { version: 1 }),
    call('POST', `/api/purchases/${order.id}/receive`, { version: 1 }),
  ]);
  assert.deepEqual(r.map((v) => v.statusCode).sort(), [200, 409]);
  const saved = (await call('GET', `/api/purchases/${order.id}`)).json();
  assert.equal(await stock(p.id), saved.status === 'received' ? '2.125' : '0.000');
});
test('producto/proveedor archivados bloquean recepción y no dejan movimientos parciales', async () => {
  const p = await newProduct(),
    s = await newSupplier(),
    { order } = await newOrder(p, s);
  await call('PUT', `/api/suppliers/${s.id}`, editSupplier(s, { active: false }));
  assert.equal(
    (await call('POST', `/api/purchases/${order.id}/receive`, { version: 1 })).statusCode,
    409,
  );
  assert.equal(await stock(p.id), '0.000');
  assert.equal((await call('GET', `/api/purchases/${order.id}`)).json().status, 'draft');
});
test('documentos recibidos conservan nombres y rechazan UPDATE en cabecera/líneas', async () => {
  const p = await newProduct(),
    s = await newSupplier(),
    { order } = await newOrder(p, s);
  await call('POST', `/api/purchases/${order.id}/receive`, { version: 1 });
  await call('PUT', `/api/products/${p.id}`, editProduct(p, { name: 'Nombre nuevo' }));
  await call('PUT', `/api/suppliers/${s.id}`, editSupplier(s, { name: 'Proveedor renombrado' }));
  const saved = (await call('GET', `/api/purchases/${order.id}`)).json();
  assert.equal(saved.lines[0].productName, p.name);
  assert.equal(saved.supplierName, s.name);
  for (const query of [
    "UPDATE purchase_orders SET note='Cambio' WHERE id=$1",
    'DELETE FROM purchase_order_lines WHERE purchase_order_id=$1',
  ]) {
    await assert.rejects(
      pool.query(query, [order.id]),
      (e: unknown) => (e as { code: string }).code === '23514',
    );
  }
  assert.equal(
    (await call('POST', `/api/purchases/${order.id}/cancel`, { version: 2 })).statusCode,
    409,
  );
});
test('ajustes con motivo son idempotentes; dos salidas concurrentes no sobregiran saldo', async () => {
  const p = await newProduct(),
    key = randomUUID();
  const first = await Promise.all([
    adjust(p.id, '2.5', key),
    adjust(p.id, '2.5', key.toUpperCase()),
  ]);
  assert.ok(first.every((r) => r.statusCode === 201));
  assert.equal(first[0].json().id, first[1].json().id);
  const r = await Promise.all([adjust(p.id, '-2'), adjust(p.id, '-2')]);
  assert.deepEqual(r.map((v) => v.statusCode).sort(), [201, 409]);
  assert.equal(await stock(p.id), '0.500');
  assert.equal((await adjust(p.id, '1', key)).statusCode, 409);
  assert.equal((await adjust(p.id, '0')).statusCode, 400);
  assert.equal((await adjust(p.id, '1', randomUUID(), '')).statusCode, 400);
});
test('fallo de auditoría revierte recepción completa y ajuste; reintento funciona', async () => {
  const p = await newProduct(),
    s = await newSupplier(),
    { order } = await newOrder(p, s);
  await pool.query(
    `ALTER TABLE audit_logs ADD CONSTRAINT inventory_test_failure CHECK (actor_id <> '${rec.id}'::uuid) NOT VALID`,
  );
  try {
    assert.equal(
      (await call('POST', `/api/purchases/${order.id}/receive`, { version: 1 }, rec)).statusCode,
      500,
    );
    assert.equal(await stock(p.id), '0.000');
    assert.equal((await call('GET', `/api/purchases/${order.id}`)).json().status, 'draft');
  } finally {
    await pool.query('ALTER TABLE audit_logs DROP CONSTRAINT inventory_test_failure');
  }
  assert.equal(
    (await call('POST', `/api/purchases/${order.id}/receive`, { version: 1 }, rec)).statusCode,
    200,
  );
  const key = randomUUID();
  await pool.query(
    `ALTER TABLE audit_logs ADD CONSTRAINT inventory_test_failure CHECK (actor_id <> '${admin.id}'::uuid) NOT VALID`,
  );
  try {
    assert.equal((await adjust(p.id, '1', key)).statusCode, 500);
    assert.equal(await stock(p.id), '2.125');
  } finally {
    await pool.query('ALTER TABLE audit_logs DROP CONSTRAINT inventory_test_failure');
  }
  assert.equal((await adjust(p.id, '1', key)).statusCode, 201);
});
