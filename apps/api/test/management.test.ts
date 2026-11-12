import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type {
  Role,
  UserAccount,
  OperationsReport,
  BusinessSettings,
  ServiceRecord,
  CategoryRecord,
} from '@nexovet/shared';
import { buildApp } from '../src/app.js';
import { parseConfig } from '../src/config.js';
import { createPool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrations.js';
import { seed } from '../src/db/seeds.js';
import { hashPassword, tokenHash, verifyPassword } from '../src/auth/crypto.js';
import { getDemoOverview } from '../src/demo.js';
const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/nexovet_test')
  throw Error('Administración requiere nexovet_test');
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
let admin: Person,
  rec: Person,
  vet: Person,
  original: BusinessSettings,
  day: string,
  afterDay: string,
  reportProduct: string,
  reportService: string,
  clientId: string,
  petId: string,
  auditEntity: string;
const password = 'Gestión ficticia de pruebas 2026',
  prefix = `Gestion ${randomUUID().slice(0, 8)}`,
  users: string[] = [],
  products: string[] = [],
  services: string[] = [],
  categories: string[] = [],
  appointments: string[] = [],
  tasks: string[] = [];
let auditId: string;
const call = (
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  payload?: unknown,
  person = admin,
) => app.inject({ method, url: path, headers: person.headers, ...(payload ? { payload } : {}) });
async function login(email: string, pass = password): Promise<Person> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin },
    payload: { email, password: pass },
  });
  assert.equal(r.statusCode, 200, r.body);
  return {
    id: r.json().user.id,
    headers: {
      origin,
      cookie: `nexovet_session=${r.cookies[0]!.value}`,
      'x-csrf-token': r.json().csrfToken,
    },
  };
}
const edits = (u: UserAccount, extra: object = {}) => ({
  name: u.name,
  role: u.role,
  active: u.active,
  loginEnabled: u.loginEnabled,
  password: null,
  version: u.version,
  ...extra,
});
async function createUser(role: Role = 'reception') {
  const email = `gestion-${randomUUID()}@example.invalid`,
    r = await call('POST', '/api/admin/users', {
      name: `${prefix} integrante`,
      email,
      role,
      password,
      active: true,
      loginEnabled: true,
    });
  assert.equal(r.statusCode, 201, r.body);
  const u = r.json<UserAccount>();
  users.push(u.id);
  return u;
}
before(async () => {
  await migrate(pool);
  await seed(pool, { NODE_ENV: 'test', DATABASE_URL: url });
  await pool.query('DELETE FROM auth_rate_limits');
  const hash = await hashPassword(password);
  async function person(role: Role) {
    const id = randomUUID(),
      email = `management-${id}@example.invalid`;
    await pool.query(
      'INSERT INTO users(id,name,email,role,password_hash,login_enabled) VALUES($1,$2,$3,$4,$5,true)',
      [id, `${prefix} ${role}`, email, role, hash],
    );
    users.push(id);
    return login(email);
  }
  admin = await person('admin');
  rec = await person('reception');
  vet = await person('veterinarian');
  original = (await call('GET', '/api/admin/business')).json();
  day = (
    await pool.query(
      `SELECT to_char(d,'YYYY-MM-DD') AS day FROM (SELECT date '2080-01-02'+i*3 AS d FROM generate_series(0,10000) i) dates WHERE NOT EXISTS(SELECT 1 FROM sales WHERE status='confirmed' AND confirmed_at>=((d-1)::timestamp AT TIME ZONE 'America/Lima') AND confirmed_at<((d+2)::timestamp AT TIME ZONE 'America/Lima')) ORDER BY d LIMIT 1`,
    )
  ).rows[0].day;
  const instant = Date.parse(`${day}T00:00:00-05:00`),
    start = new Date(instant).toISOString(),
    end = new Date(instant + 86400000).toISOString(),
    before = new Date(instant - 1).toISOString();
  afterDay = new Date(instant + 86400000).toISOString().slice(0, 10);
  reportProduct = randomUUID();
  products.push(reportProduct);
  await pool.query(
    'INSERT INTO products(id,sku,name,sale_price,minimum_stock) VALUES($1,$2,$3,5,200)',
    [reportProduct, `R-${reportProduct.slice(0, 8)}`, '=SUM(1,2)'],
  );
  await pool.query(
    "INSERT INTO stock_movements(product_id,quantity,kind,reason,recorded_by) VALUES($1,100,'opening','Reporte ficticio',$2)",
    [reportProduct, admin.id],
  );
  reportService = randomUUID();
  services.push(reportService);
  await pool.query('INSERT INTO services(id,name,duration_minutes,price) VALUES($1,$2,30,20)', [
    reportService,
    `${prefix} servicio`,
  ]);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    for (const [at, total, kind] of [
      [before, '6', 'cash'],
      [start, '30', 'cash'],
      [end, '8', 'card'],
    ] as const) {
      const id = randomUUID();
      await c.query('INSERT INTO sales(id,number,created_by) VALUES($1,$2,$3)', [
        id,
        `REPORT-${id}`,
        admin.id,
      ]);
      if (at === start) {
        const line = (
          await c.query<{ id: string }>(
            "INSERT INTO sale_lines(sale_id,product_id,description,quantity,unit_price) VALUES($1,$2,'=SUM(1,2)',2,5) RETURNING id",
            [id, reportProduct],
          )
        ).rows[0]!;
        await c.query(
          "INSERT INTO sale_lines(sale_id,service_id,description,quantity,unit_price) VALUES($1,$2,'Servicio reporte',1,20)",
          [id, reportService],
        );
        await c.query(
          "INSERT INTO stock_movements(product_id,quantity,kind,sale_line_id,reason,recorded_by) VALUES($1,-2,'sale',$2,'Venta ficticia de reporte',$3)",
          [reportProduct, line.id, admin.id],
        );
        await c.query(
          "INSERT INTO payments(sale_id,method,amount,reference,recorded_by,paid_at) VALUES($1,'cash',10,NULL,$2,$3),($1,'transfer',20,'REFERENCIA-NO-EXPORTAR',$2,$4)",
          [id, admin.id, start, end],
        );
      } else {
        await c.query(
          "INSERT INTO sale_lines(sale_id,service_id,description,quantity,unit_price) VALUES($1,$2,'Servicio otro día',1,$3)",
          [id, reportService, total],
        );
        await c.query(
          'INSERT INTO payments(sale_id,method,amount,reference,recorded_by,paid_at) VALUES($1,$2,$3,$4,$5,$6)',
          [id, kind, total, kind === 'card' ? 'TARJETA-FICTICIA' : null, admin.id, at],
        );
      }
      await c.query(
        "UPDATE sales SET status='confirmed',confirmed_at=$2,confirmed_by=$3 WHERE id=$1",
        [id, at, admin.id],
      );
    }
    const supplier = (
      await c.query<{ id: string }>('INSERT INTO suppliers(name) VALUES($1) RETURNING id', [
        `${prefix} proveedor`,
      ])
    ).rows[0]!.id;
    const purchase = (
      await c.query<{ id: string }>(
        'INSERT INTO purchase_orders(number,supplier_id,created_by) VALUES($1,$2,$3) RETURNING id',
        [`REPORT-PO-${randomUUID()}`, supplier, admin.id],
      )
    ).rows[0]!.id;
    const line = (
      await c.query<{ id: string }>(
        'INSERT INTO purchase_order_lines(purchase_order_id,product_id,quantity,unit_cost) VALUES($1,$2,2,3.50) RETURNING id',
        [purchase, reportProduct],
      )
    ).rows[0]!.id;
    await c.query(
      "INSERT INTO stock_movements(product_id,quantity,kind,purchase_line_id,reason,recorded_by) VALUES($1,2,'purchase',$2,'Recepción ficticia de reporte',$3)",
      [reportProduct, line, admin.id],
    );
    await c.query(
      "UPDATE purchase_orders SET status='received',received_at=$2,received_by=$3 WHERE id=$1",
      [purchase, start, admin.id],
    );
    await c.query('UPDATE suppliers SET active=false WHERE id=$1', [supplier]);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
  clientId = randomUUID();
  petId = randomUUID();
  await pool.query('INSERT INTO clients(id,name,created_at) VALUES($1,$2,$3)', [
    clientId,
    `${prefix} cliente`,
    start,
  ]);
  await pool.query(
    "INSERT INTO pets(id,client_id,name,species,created_at) VALUES($1,$2,$3,'cat',$4)",
    [petId, clientId, `${prefix} paciente`, start],
  );
  for (const minutes of [-10, 40]) {
    const at = new Date(instant + minutes * 60000).toISOString(),
      endAt = new Date(instant + (minutes + 30) * 60000).toISOString();
    const id = randomUUID();
    await pool.query(
      'INSERT INTO appointments(id,pet_id,professional_id,service_id,starts_at,ends_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [id, petId, vet.id, reportService, at, endAt, admin.id],
    );
    appointments.push(id);
  }
  const aid = randomUUID();
  await pool.query(
    "INSERT INTO appointments(id,pet_id,professional_id,service_id,starts_at,ends_at,status,created_by) VALUES($1,$2,$3,$4,$5,$6,'in_progress',$7)",
    [
      aid,
      petId,
      vet.id,
      reportService,
      new Date(instant + 120 * 60000).toISOString(),
      new Date(instant + 150 * 60000).toISOString(),
      admin.id,
    ],
  );
  appointments.push(aid);
  await pool.query(
    'INSERT INTO encounters(appointment_id,veterinarian_id,closed_at) VALUES($1,$2,$3)',
    [aid, vet.id, new Date(instant + 145 * 60000).toISOString()],
  );
  await pool.query("UPDATE appointments SET status='completed' WHERE id=$1", [aid]);
  for (const status of ['pending', 'completed', 'cancelled']) {
    const id = randomUUID();
    tasks.push(id);
    await pool.query(
      'INSERT INTO follow_up_tasks(id,client_id,pet_id,title,due_at,status,completed_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        id,
        clientId,
        petId,
        `${prefix} tarea`,
        new Date(instant + 12 * 3600000).toISOString(),
        status,
        status === 'completed' ? start : null,
      ],
    );
  }
  auditEntity = randomUUID();
  auditId = (
    await pool.query(
      "INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,created_at,metadata) VALUES($1,'test.report_%_','report_fixture',$2,$3,$4) RETURNING id::text",
      [
        admin.id,
        auditEntity,
        start,
        {
          version: 7,
          total: '30.00',
          fields: ['name', 'password_hash'],
          password: 'SECRETO-NO-DEVOLVER',
          token: 'SECRETO-NO-DEVOLVER',
          reference: 'REFERENCIA-NO-EXPORTAR',
          note: 'NOTA-CLINICA-NO-EXPORTAR',
        },
      ],
    )
  ).rows[0].id;
});
after(async () => {
  if (admin && original) {
    const r = (await call('GET', '/api/admin/business')).json<BusinessSettings>();
    if (r.name !== original.name || r.address !== original.address) {
      const restored = await call('PUT', '/api/admin/business', {
        name: original.name,
        address: original.address,
        version: r.version,
      });
      assert.equal(restored.statusCode, 200);
    }
  }
  await app.close();
  await pool.query('DELETE FROM follow_up_tasks WHERE id=ANY($1::uuid[])', [tasks]);
  await pool.query('DELETE FROM encounters WHERE appointment_id=ANY($1::uuid[])', [appointments]);
  await pool.query('DELETE FROM appointments WHERE id=ANY($1::uuid[])', [appointments]);
  if (petId) await pool.query('DELETE FROM pets WHERE id=$1', [petId]);
  if (clientId) await pool.query('DELETE FROM clients WHERE id=$1', [clientId]);
  for (const id of products) {
    const q = (await pool.query('SELECT quantity FROM product_stock WHERE product_id=$1', [id]))
      .rows[0].quantity;
    if (Number(q) !== 0)
      await pool.query(
        "INSERT INTO stock_movements(product_id,quantity,kind,reason,recorded_by) VALUES($1,-$2::numeric,'adjustment','Compensación de fixture administrativo',$3)",
        [id, q, admin.id],
      );
  }
  await pool.query('UPDATE products SET active=false,category_id=NULL WHERE id=ANY($1::uuid[])', [
    products,
  ]);
  await pool.query('UPDATE services SET active=false WHERE id=ANY($1::uuid[])', [services]);
  await pool.query('DELETE FROM product_categories WHERE id=ANY($1::uuid[])', [categories]);
  await pool.query('UPDATE users SET active=false,login_enabled=false WHERE id=ANY($1::uuid[])', [
    users,
  ]);
  await pool.end();
});
const reportPath = () => `/api/reports/operations?from=${day}&to=${day}`;
test('reporte concilia líneas y pagos sin multiplicarlos; límites Lima son inclusivos/exclusivos', async () => {
  const r = await call('GET', reportPath());
  assert.equal(r.statusCode, 200, r.body);
  const d = r.json<OperationsReport>();
  assert.deepEqual(d.financial, {
    confirmedSales: 1,
    salesTotal: '30.00',
    paymentCount: 1,
    paymentsTotal: '10.00',
    receivedPurchases: 1,
    purchasesTotal: '7.00',
  });
  assert.deepEqual(d.dailySales, [{ date: day, count: 1, total: '30.00' }]);
  assert.equal(d.paymentsByMethod.find((p) => p.method === 'cash')!.total, '10.00');
  assert.equal(d.paymentsByMethod.find((p) => p.method === 'transfer')!.total, '0.00');
  assert.equal(d.topItems.length, 2);
  assert.equal(d.topItems.find((p) => p.kind === 'product')!.quantity, '2.000');
});
test('actividad distingue inicio, cierre, vencimiento y fotografía actual del almacén', async () => {
  const d = (await call('GET', reportPath())).json<OperationsReport>();
  assert.deepEqual(d.activity, { appointments: 2, closedEncounters: 1, newClients: 1, newPets: 1 });
  assert.deepEqual(d.followups, { pending: 1, completed: 1, cancelled: 1, overdue: 0 });
  assert.equal(d.appointmentsByStatus.find((a) => a.status === 'completed')!.count, 1);
  assert.ok(d.inventory.active >= 321);
  assert.ok(d.inventory.low >= 1);
  const empty = (
    await call('GET', '/api/reports/operations?from=2000-01-01&to=2000-01-01')
  ).json<OperationsReport>();
  assert.equal(empty.financial.salesTotal, '0.00');
  assert.deepEqual(empty.inventory, d.inventory);
  assert.deepEqual(empty.dailySales, [{ date: '2000-01-01', count: 0, total: '0.00' }]);
});
test('períodos válidos, inválidos y día siguiente no mezclan fechas de venta y cobro', async () => {
  for (const q of [
    'from=2025-02-30&to=2025-03-01',
    'from=2026-01-02&to=2026-01-01',
    'from=2024-01-01&to=2025-01-01',
    'from=1999-01-01&to=1999-01-02',
    'unknown=1',
  ])
    assert.equal((await call('GET', '/api/reports/operations?' + q)).statusCode, 400);
  const d = (
    await call('GET', `/api/reports/operations?from=${day}&to=${afterDay}`)
  ).json<OperationsReport>();
  assert.equal(d.financial.confirmedSales, 2);
  assert.equal(d.financial.salesTotal, '38.00');
  assert.equal(d.financial.paymentsTotal, '38.00');
  assert.equal(d.dailySales.length, 2);
});
test('CSV exporta importes exactos y neutraliza fórmulas sin referencias privadas', async () => {
  const r = await call('GET', `/api/reports/operations.csv?from=${day}&to=${day}`);
  assert.equal(r.statusCode, 200, r.body);
  assert.match(String(r.headers['content-type']), /text\/csv/);
  assert.match(String(r.headers['content-disposition']), /attachment; filename="nexovet-reporte/);
  assert.ok(r.body.includes('"\'=SUM(1,2)"'));
  assert.ok(r.body.includes('"30.00"'));
  assert.doesNotMatch(
    r.body,
    /REFERENCIA-NO-EXPORTAR|SECRETO-NO-DEVOLVER|password_hash|NOTA-CLINICA/,
  );
});
test('reportes y administración exigen administrador; resumen financiero no llega a otros roles', async () => {
  for (const path of [
    '/api/reports/options',
    reportPath(),
    '/api/reports/operations.csv',
    '/api/admin/business',
    '/api/admin/users',
    '/api/admin/services',
    '/api/admin/categories',
    '/api/admin/audit',
    '/api/admin/audit/options',
  ]) {
    assert.equal((await app.inject(path)).statusCode, 401);
    assert.equal((await call('GET', path, undefined, rec)).statusCode, 403);
    assert.equal((await call('GET', path, undefined, vet)).statusCode, 403);
  }
  for (const p of [rec, vet])
    assert.equal((await call('GET', '/api/overview', undefined, p)).json().adminToday, undefined);
  assert.ok((await call('GET', '/api/overview')).json().adminToday);
});
test('negocio conserva moneda, zona y modo; edición concurrente requiere versión', async () => {
  const b = (await call('GET', '/api/admin/business')).json<BusinessSettings>(),
    r = await call('PUT', '/api/admin/business', {
      name: `${prefix} clínica`,
      address: 'Dirección ficticia de la prueba',
      version: b.version,
    });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().version, b.version + 1);
  assert.equal(r.json().currency, 'PEN');
  assert.equal(r.json().timezone, 'America/Lima');
  assert.equal(r.json().demo, true);
  assert.equal(
    (
      await call('PUT', '/api/admin/business', {
        name: b.name,
        address: b.address,
        version: b.version,
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await call('PUT', '/api/admin/business', {
        name: b.name,
        address: b.address,
        version: b.version + 1,
        demo: false,
      })
    ).statusCode,
    400,
  );
});
test('servicios validan precisión y duración; nombres duplicados y versiones no sobrescriben', async () => {
  const body = { name: `${prefix} Configurado`, durationMinutes: 45, price: '0.10', active: true };
  const r = await call('POST', '/api/admin/services', body);
  assert.equal(r.statusCode, 201, r.body);
  const s = r.json<ServiceRecord>();
  services.push(s.id);
  assert.equal(s.price, '0.10');
  assert.equal(
    (await call('POST', '/api/admin/services', { ...body, name: body.name.toLowerCase() }))
      .statusCode,
    409,
  );
  for (const extra of [
    { durationMinutes: 4 },
    { durationMinutes: 30.5 },
    { price: '1e2' },
    { price: '0.001' },
  ])
    assert.equal(
      (await call('POST', '/api/admin/services', { ...body, name: randomUUID(), ...extra }))
        .statusCode,
      400,
    );
  const edit = { ...body, active: false, version: s.version };
  assert.equal((await call('PUT', `/api/admin/services/${s.id}`, edit)).statusCode, 200);
  assert.equal((await call('PUT', `/api/admin/services/${s.id}`, edit)).statusCode, 409);
  assert.equal(
    (
      await call('GET', `/api/admin/services?status=archived&q=${encodeURIComponent(body.name)}`)
    ).json().total,
    1,
  );
  assert.equal(
    (await call('GET', `/api/sales/items?kind=service&q=${encodeURIComponent(body.name)}`)).json()
      .length,
    0,
  );
});
test('categorías se renombran sin perder productos y se consultan en inventario', async () => {
  const r = await call('POST', '/api/admin/categories', { name: `${prefix} categoría %_` });
  assert.equal(r.statusCode, 201, r.body);
  const c = r.json<CategoryRecord>();
  categories.push(c.id);
  await pool.query('UPDATE products SET category_id=$2 WHERE id=$1', [reportProduct, c.id]);
  const name = `${prefix} categoría revisada`;
  assert.equal(
    (await call('PUT', `/api/admin/categories/${c.id}`, { name, version: 1 })).statusCode,
    200,
  );
  assert.equal(
    (await call('PUT', `/api/admin/categories/${c.id}`, { name: 'Antiguo', version: 1 }))
      .statusCode,
    409,
  );
  assert.equal(
    (await call('POST', '/api/admin/categories', { name: name.toLowerCase() })).statusCode,
    409,
  );
  assert.equal((await call('GET', `/api/products/${reportProduct}`)).json().categoryName, name);
  assert.ok(
    (await call('GET', '/api/inventory/categories'))
      .json()
      .some((v: { id: string }) => v.id === c.id),
  );
});
test('cuentas se crean con scrypt y no devuelven credenciales; correo único e inmutable', async () => {
  const u = await createUser();
  const db = (await pool.query('SELECT password_hash FROM users WHERE id=$1', [u.id])).rows[0];
  assert.ok(await verifyPassword(password, db.password_hash));
  assert.equal(u.hasPassword, true);
  const r = await call('GET', `/api/admin/users/${u.id}`);
  assert.doesNotMatch(r.body, /scrypt\$|password_hash|Gestión ficticia/);
  assert.equal(
    (
      await call('POST', '/api/admin/users', {
        name: 'Duplicado',
        email: u.email.toUpperCase(),
        role: 'reception',
        password,
        active: true,
        loginEnabled: true,
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (await call('PUT', `/api/admin/users/${u.id}`, { ...edits(u), email: 'otro@example.invalid' }))
      .statusCode,
    400,
  );
});
test('rol o acceso cambian con versión y revocan sesiones y recuperación', async () => {
  const u = await createUser(),
    session = await login(u.email);
  const key = tokenHash(randomUUID());
  await pool.query(
    "INSERT INTO password_reset_tokens(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",
    [u.id, key],
  );
  const r = await call('PUT', `/api/admin/users/${u.id}`, edits(u, { role: 'veterinarian' }));
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().version, 2);
  assert.equal((await call('GET', '/api/auth/session', undefined, session)).statusCode, 401);
  assert.ok(
    (await pool.query('SELECT used_at FROM password_reset_tokens WHERE token_hash=$1', [key]))
      .rows[0].used_at,
  );
  assert.equal((await call('PUT', `/api/admin/users/${u.id}`, edits(u))).statusCode, 409);
});
test('contraseñas nuevas habilitan cuentas sin clave y cierran las sesiones anteriores', async () => {
  const id = randomUUID(),
    email = `sin-clave-${id}@example.invalid`;
  await pool.query("INSERT INTO users(id,name,email,role) VALUES($1,$2,$3,'reception')", [
    id,
    `${prefix} sin clave`,
    email,
  ]);
  users.push(id);
  const u = (await call('GET', `/api/admin/users/${id}`)).json<UserAccount>();
  assert.equal(
    (await call('PUT', `/api/admin/users/${id}`, edits(u, { loginEnabled: true }))).statusCode,
    409,
  );
  const r = await call('PUT', `/api/admin/users/${id}`, edits(u, { password, loginEnabled: true }));
  assert.equal(r.statusCode, 200, r.body);
  const session = await login(email);
  const newPassword = 'Nueva contraseña ficticia gestión';
  assert.equal(
    (await call('PUT', `/api/admin/users/${id}`, edits(r.json(), { password: newPassword })))
      .statusCode,
    200,
  );
  assert.equal((await call('GET', '/api/auth/session', undefined, session)).statusCode, 401);
  assert.ok(
    await verifyPassword(
      newPassword,
      (await pool.query('SELECT password_hash FROM users WHERE id=$1', [id])).rows[0].password_hash,
    ),
  );
});
test('un administrador no puede quitarse su rol, actividad o permiso de ingreso', async () => {
  const u = (await call('GET', `/api/admin/users/${admin.id}`)).json<UserAccount>();
  for (const extra of [
    { role: 'reception' },
    { active: false, loginEnabled: false },
    { loginEnabled: false },
  ])
    assert.equal((await call('PUT', `/api/admin/users/${u.id}`, edits(u, extra))).statusCode, 409);
  assert.equal((await call('GET', '/api/auth/session')).statusCode, 200);
  assert.equal((await call('GET', `/api/admin/users/${u.id}`)).json().version, u.version);
});
test('administradores concurrentes revalidan acceso tras el bloqueo; no se deshabilitan mutuamente', async () => {
  const a = await createUser('admin'),
    b = await createUser('admin'),
    sa = await login(a.email),
    sb = await login(b.email);
  const r = await Promise.all([
    call('PUT', `/api/admin/users/${b.id}`, edits(b, { active: false, loginEnabled: false }), sa),
    call('PUT', `/api/admin/users/${a.id}`, edits(a, { active: false, loginEnabled: false }), sb),
  ]);
  assert.equal(r.filter((v) => v.statusCode === 200).length, 1);
  assert.ok(
    r.some((v) => v.statusCode === 401 || v.statusCode === 403),
    r.map((v) => v.body).join(),
  );
  assert.equal(
    (
      await pool.query(
        'SELECT count(*)::int AS n FROM users WHERE id=ANY($1::uuid[]) AND active AND login_enabled',
        [[a.id, b.id]],
      )
    ).rows[0].n,
    1,
  );
});
test('auditoría filtra fechas y texto literal, pagina y proyecta solo metadatos seguros', async () => {
  const path = `/api/admin/audit?from=${day}&to=${day}&q=${encodeURIComponent('%_')}&entityType=report_fixture`;
  const r = await call('GET', path);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().total, 1);
  assert.equal(r.json().items[0].id, auditId);
  assert.deepEqual(r.json().items[0].summary, { version: 7, total: '30.00', fields: ['name'] });
  assert.doesNotMatch(
    r.body,
    /SECRETO-NO-DEVOLVER|password_hash|REFERENCIA-NO-EXPORTAR|NOTA-CLINICA-NO-EXPORTAR|"metadata"/,
  );
  assert.equal(
    (
      await call('GET', path + `&entityId=${auditEntity}&actorId=${admin.id}&page=2&pageSize=1`)
    ).json().items.length,
    0,
  );
  assert.equal((await call('PUT', '/api/admin/audit/' + auditId, {})).statusCode, 404);
  await assert.rejects(
    pool.query("UPDATE audit_logs SET action='cambio' WHERE id=$1", [auditId]),
    (e: unknown) => (e as { code: string }).code === '23514',
  );
});
test('fallo de auditoría revierte datos y versión de configuración', async () => {
  const b = (await call('GET', '/api/admin/business')).json<BusinessSettings>();
  await pool.query(
    `ALTER TABLE audit_logs ADD CONSTRAINT management_test_failure CHECK(actor_id<>'${admin.id}'::uuid) NOT VALID`,
  );
  try {
    assert.equal(
      (
        await call('PUT', '/api/admin/business', {
          name: 'No debe guardarse',
          address: b.address,
          version: b.version,
        })
      ).statusCode,
      500,
    );
    assert.deepEqual((await call('GET', '/api/admin/business')).json(), b);
    assert.equal(
      (
        await call('POST', '/api/admin/services', {
          name: `${prefix} no guardar`,
          durationMinutes: 30,
          price: '1',
          active: true,
        })
      ).statusCode,
      500,
    );
  } finally {
    await pool.query('ALTER TABLE audit_logs DROP CONSTRAINT management_test_failure');
  }
  assert.equal(
    (
      await call('GET', `/api/admin/services?q=${encodeURIComponent(prefix + ' no guardar')}`)
    ).json().total,
    0,
  );
});
test('fallo de auditoría revierte también revocaciones de sesión en cambios de cuenta', async () => {
  const u = await createUser(),
    session = await login(u.email);
  await pool.query(
    `ALTER TABLE audit_logs ADD CONSTRAINT management_test_failure CHECK(actor_id<>'${admin.id}'::uuid) NOT VALID`,
  );
  try {
    assert.equal(
      (await call('PUT', `/api/admin/users/${u.id}`, edits(u, { role: 'veterinarian' })))
        .statusCode,
      500,
    );
    assert.equal((await call('GET', '/api/auth/session', undefined, session)).statusCode, 200);
    assert.equal((await call('GET', `/api/admin/users/${u.id}`)).json().role, 'reception');
  } finally {
    await pool.query('ALTER TABLE audit_logs DROP CONSTRAINT management_test_failure');
  }
  assert.equal(
    (await call('PUT', `/api/admin/users/${u.id}`, edits(u, { role: 'veterinarian' }))).statusCode,
    200,
  );
  assert.equal((await call('GET', '/api/auth/session', undefined, session)).statusCode, 401);
});
test('escrituras exigen CSRF y administrador; parámetros e identificadores inválidos no se aceptan', async () => {
  for (const path of ['/api/admin/users', '/api/admin/services', '/api/admin/categories']) {
    assert.equal((await call('POST', path, {}, rec)).statusCode, 403);
    assert.equal((await call('POST', path, {}, vet)).statusCode, 403);
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: path,
          headers: { origin, cookie: admin.headers.cookie },
          payload: {},
        })
      ).statusCode,
      403,
    );
  }
  assert.equal((await call('GET', '/api/admin/users/invalid')).statusCode, 400);
  assert.equal((await call('GET', '/api/admin/users?pageSize=500')).statusCode, 400);
  assert.equal(
    (await call('GET', '/api/admin/audit?from=2024-01-01&to=2025-01-01')).statusCode,
    400,
  );
});
test('resumen solo ofrece pendientes reales y opciones de período siguen Lima', async () => {
  for (let i = 0; i < 13; i++) {
    const id = randomUUID();
    tasks.push(id);
    await pool.query(
      "INSERT INTO follow_up_tasks(id,client_id,title,due_at,status,completed_at) VALUES($1,$2,'Terminada antigua','2000-01-01T10:00:00-05:00','completed',now())",
      [id, clientId],
    );
  }
  const r = (await call('GET', '/api/overview')).json();
  assert.ok(r.tasks.every((t: { status: string }) => t.status === 'pending'));
  const d = (await call('GET', '/api/reports/options')).json();
  assert.equal(d.timezone, 'America/Lima');
  assert.equal(d.from, d.today.slice(0, 8) + '01');
  assert.equal(d.to, d.today);
  assert.equal(d.maxDays, 366);
});
