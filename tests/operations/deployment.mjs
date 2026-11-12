// Prueba de integración destructiva SOLO para un proyecto/volúmenes nuevos propios.
// Nunca utiliza .env.deploy ni los volúmenes de desarrollo o de una clínica.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium, request, expect } from '@playwright/test';
const root = fileURLToPath(new URL('../../', import.meta.url));
const id = randomUUID().slice(0, 8),
  project = `nexovet-smoke-${id}`;
const directory = `${root}.local/operations-${id}`;
await mkdir(directory, { recursive: true, mode: 0o700 });
const envFile = `${directory}/deployment.env`,
  logFile = `${directory}/commands.log`;
const port = async () => {
  const s = createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
};
const httpsPort = await port(),
  httpPort = await port(),
  origin = `https://localhost:${httpsPort}`;
const secret = randomBytes(32).toString('hex'),
  ownerSecret = randomBytes(32).toString('hex');
const password = randomBytes(32).toString('base64url'),
  adminEmail = `admin-${id}@example.invalid`;
const contents = `DB_OWNER_PASSWORD=${ownerSecret}\nDB_PASSWORD=${secret}\nDB_NAME=nexovet\nAPP_ORIGIN=${origin}\nSITE_ADDRESS=localhost\nSMTP_HOST=smtp.example.invalid\nMAIL_FROM=nexovet@example.invalid\nPUBLISH_HOST=127.0.0.1\nHTTP_PORT=${httpPort}\nHTTPS_PORT=${httpsPort}\nAPI_IMAGE=${process.env.SMOKE_API_IMAGE || 'nexovet-api:operations'}\nWEB_IMAGE=${process.env.SMOKE_WEB_IMAGE || 'nexovet-web:operations'}\n`;
await writeFile(envFile, contents, { mode: 0o600 });
const extraEnv = {
  ...process.env,
  NEXOVET_ENV_FILE: envFile,
  NEXOVET_PROJECT: project,
  BACKUP_DIR: `${directory}/backups`,
};
// Compose da prioridad al entorno del host: no permitir que claves/DB de una
// instalación ajena sustituyan las del proyecto efímero.
for (const line of contents.split('\n')) {
  const key = line.split('=')[0];
  if (key) delete extraEnv[key];
}
function command(program, args, { env = {}, input, fail = false } = {}) {
  const result = spawnSync(program, args, {
    cwd: root,
    env: { ...extraEnv, ...env },
    input,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    timeout: 240000,
  });
  // Los comandos no registran argv ni entorno; SQL contiene solo fixtures propios.
  const safe = (result.stdout || '') + (result.stderr || '');
  const redacted = safe
    .replaceAll(secret, '[redacted]')
    .replaceAll(ownerSecret, '[redacted]')
    .replaceAll(password, '[redacted]');
  assert.ok(Number.isInteger(result.status), `No terminó ${program}; consulta ${logFile}`);
  spawnSync('sh', ['-c', 'umask 077; cat >> "$1"', 'sh', logFile], {
    input: redacted,
    encoding: 'utf8',
  });
  if (fail) {
    assert.notEqual(result.status, 0, 'La operación debía rechazarse');
  } else assert.equal(result.status, 0, `Falló ${program}; consulta el log privado ${logFile}`);
  return result.stdout?.trim() || '';
}
const base = ['compose', '--env-file', envFile, '-p', project, '-f', `${root}deploy/compose.yaml`];
const compose = (args, options) => command('docker', [...base, ...args], options);
const cli = (script, env = {}, fail = false) =>
  compose(
    [
      'run',
      '--rm',
      '--no-deps',
      ...Object.keys(env).flatMap((k) => ['-e', k]),
      'api',
      'node',
      `apps/api/dist/${script}.js`,
    ],
    { env, fail },
  );
const sql = (query, database = 'nexovet') =>
  compose(
    [
      'exec',
      '-T',
      'db',
      'psql',
      '-X',
      '-U',
      'postgres',
      '-d',
      database,
      '-tA',
      '--set=ON_ERROR_STOP=1',
    ],
    { input: query },
  );
let browser, adminContext, recContext, vetContext, probe;
let passed = false;
try {
  console.log('1/7 · Base aislada, migraciones e inicialización sin semilla.');
  compose(['up', '-d', '--wait', 'db']);
  cli('db/migrate');
  cli('server', {}, true);
  sql("INSERT INTO product_categories(name) VALUES ('Categoría huérfana ficticia')");
  cli('db/setup', { BUSINESS_NAME: 'No inicializar', BUSINESS_ADDRESS: 'Base ocupada' }, true);
  assert.equal(sql('SELECT count(*) FROM business_settings'), '0');
  sql("DELETE FROM product_categories WHERE name='Categoría huérfana ficticia'");
  cli('db/setup', {
    BUSINESS_NAME: `Veterinaria Ficticia Operaciones ${id}`,
    BUSINESS_ADDRESS: 'Dirección sintética para pruebas',
  });
  cli(
    'db/setup',
    { BUSINESS_NAME: 'No reemplazar', BUSINESS_ADDRESS: 'Otra dirección ficticia' },
    true,
  );
  assert.equal(sql('SELECT count(*) FROM clients'), '0');
  assert.equal(sql("SELECT rolsuper FROM pg_roles WHERE rolname='nexovet'"), 'f');
  cli('auth/create-user', {
    NEW_USER_EMAIL: adminEmail,
    NEW_USER_NAME: 'Administración ficticia',
    NEW_USER_ROLE: 'admin',
    NEW_USER_PASSWORD: password,
  });
  compose(['up', '-d', '--wait']);
  probe = await request.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  await expect
    .poll(
      async () => {
        try {
          return (await probe.get('/api/ready')).status();
        } catch {
          return 0;
        }
      },
      { timeout: 30000 },
    )
    .toBe(200);
  const responseHeaders = (await probe.get('/api/ready')).headers();
  assert.equal(responseHeaders['x-content-type-options'], 'nosniff');
  assert.equal(responseHeaders['referrer-policy'], 'no-referrer');
  assert.equal(responseHeaders['x-frame-options'], 'DENY');
  assert.equal((await probe.get('/administracion')).status(), 200);
  assert.match((await probe.get('/administracion')).headers()['content-type'], /text\/html/);
  assert.equal((await probe.get('/api/missing')).status(), 404);
  assert.match((await probe.get('/api/missing')).headers()['content-type'], /application\/json/);
  assert.equal((await probe.get('/api/overview')).status(), 401);
  const configText = compose(['ps', '--format', 'json']);
  // Solo web publica puertos; PostgreSQL y Node son accesibles en la red interna.
  const containers = configText
    .split('\n')
    .filter(Boolean)
    .map((s) => JSON.parse(s));
  assert.ok(
    containers
      .filter((c) => c.Service !== 'web')
      .every((c) => !c.Publishers || c.Publishers.every((p) => !p.PublishedPort)),
  );
  browser = await chromium.launch();
  adminContext = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1000 },
  });
  const page = await adminContext.newPage();
  await page.goto('/ingresar');
  await page.getByLabel('Correo electrónico', { exact: true }).fill(adminEmail);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await page.getByRole('heading', { name: 'Todo listo para recibirlos.' }).waitFor();
  assert.equal(await page.locator('.preview-banner').count(), 0);
  const session = await (await page.request.get('/api/auth/session')).json();
  const cookie = (await adminContext.cookies()).find((c) => c.name === 'nexovet_session');
  assert.ok(cookie?.secure && cookie.httpOnly && cookie.sameSite === 'Lax');
  const admin = { ctx: adminContext, csrf: session.csrfToken };
  const api = async (person, method, path, data, status = method === 'POST' ? 201 : 200) => {
    const r = await person.ctx.request.fetch(path, {
      method,
      headers: { origin, 'x-csrf-token': person.csrf },
      ...(data ? { data } : {}),
    });
    assert.equal(r.status(), status, `${method} ${path}: estado inesperado`);
    return r.json();
  };
  const member = async (role) => {
    const email = `${role}-${id}@example.invalid`;
    const u = await api(admin, 'POST', '/api/admin/users', {
      name: `Personal ficticio ${role}`,
      email,
      role,
      password,
      active: true,
      loginEnabled: true,
    });
    const ctx = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
    const r = await ctx.request.post('/api/auth/login', {
      headers: { origin },
      data: { email, password },
    });
    assert.equal(r.status(), 200);
    const session = await r.json();
    return { ctx, csrf: session.csrfToken, id: u.id };
  };
  const rec = await member('reception'),
    vet = await member('veterinarian');
  recContext = rec.ctx;
  vetContext = vet.ctx;
  console.log('2/7 · Cliente, paciente, agenda, atención y seguimiento con tres roles.');
  const service = await api(admin, 'POST', '/api/admin/services', {
    name: 'Consulta de prueba integrada',
    durationMinutes: 30,
    price: '50.00',
    active: true,
  });
  const category = await api(admin, 'POST', '/api/admin/categories', {
    name: 'Categoría integrada',
  });
  const client = await api(rec, 'POST', '/api/clients', {
    name: 'Responsable Ficticio Integración',
    email: null,
    phone: null,
    documentType: null,
    documentNumber: null,
    address: null,
    contactConsent: false,
    contactConsentNote: null,
    active: true,
  });
  const pet = await api(rec, 'POST', '/api/pets', {
    clientId: client.id,
    name: 'Paciente Ficticio',
    species: 'dog',
    breed: null,
    sex: 'unknown',
    birthDate: null,
    microchip: null,
    allergies: null,
    active: true,
  });
  const clock = new Date(Date.now() + 10 * 60000);
  const dateFormat = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const timeFormat = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Lima',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const date = dateFormat.format(clock),
    time = timeFormat.format(clock);
  let appointment = await api(rec, 'POST', '/api/appointments', {
    petId: pet.id,
    professionalId: vet.id,
    serviceId: service.id,
    date,
    startTime: time,
    durationMinutes: 30,
    reason: 'Prueba sintética del flujo',
  });
  appointment = await api(
    rec,
    'POST',
    `/api/appointments/${appointment.id}/status`,
    { version: appointment.version, status: 'arrived' },
    200,
  );
  let encounter = await api(vet, 'POST', `/api/appointments/${appointment.id}/start`, {
    version: appointment.version,
  });
  encounter = await api(vet, 'PUT', `/api/encounters/${encounter.id}`, {
    version: encounter.version,
    weightKg: 10,
    temperatureC: 38,
    findings: 'Hallazgos ficticios para prueba',
    diagnosis: 'Evaluación ficticia de integración',
    treatment: 'Plan ficticio sin indicación clínica',
  });
  encounter = await api(
    vet,
    'POST',
    `/api/encounters/${encounter.id}/close`,
    { version: encounter.version },
    200,
  );
  assert.ok(encounter.closedAt);
  const task = await api(vet, 'POST', '/api/follow-ups', {
    clientId: client.id,
    petId: pet.id,
    assignedTo: vet.id,
    title: 'Seguimiento ficticio de integración',
    description: 'No contactar: fixture sintético',
    date,
    time,
  });
  const occurredAt = new Date();
  await api(rec, 'POST', '/api/contact-events', {
    requestId: randomUUID(),
    clientId: client.id,
    taskId: task.id,
    taskVersion: task.version,
    channel: 'in_person',
    outcome: 'contacted',
    note: 'Registro sintético; no se envió comunicación',
    date: dateFormat.format(occurredAt),
    time: timeFormat.format(occurredAt),
    completeTask: true,
  });
  assert.equal((await api(admin, 'GET', `/api/follow-ups/${task.id}`)).status, 'completed');
  assert.equal((await rec.ctx.request.get(`/api/pets/${pet.id}/history`)).status(), 403);
  assert.equal((await vet.ctx.request.get('/api/reports/operations')).status(), 403);
  console.log('3/7 · Recepción de compra, venta mixta, cobros, stock y reporte conciliados.');
  const product = await api(admin, 'POST', '/api/products', {
    sku: 'INTEGRACION-01',
    name: 'Producto Ficticio Integrado',
    categoryId: category.id,
    salePrice: '20.00',
    minimumStock: '2',
    active: true,
  });
  const supplier = await api(rec, 'POST', '/api/suppliers', {
    name: 'Proveedor Ficticio Integración',
    taxId: null,
    email: null,
    phone: null,
    address: null,
    active: true,
  });
  let purchase = await api(rec, 'POST', '/api/purchases', {
    requestId: randomUUID(),
    supplierId: supplier.id,
    note: 'Compra sintética',
    lines: [{ productId: product.id, quantity: '5', unitCost: '10.00' }],
  });
  purchase = await api(
    rec,
    'POST',
    `/api/purchases/${purchase.id}/receive`,
    { version: purchase.version },
    200,
  );
  assert.equal(purchase.status, 'received');
  const sale = await api(rec, 'POST', '/api/sales', {
    requestId: randomUUID(),
    clientId: client.id,
    note: 'Venta integrada ficticia',
    lines: [
      { kind: 'product', itemId: product.id, quantity: '2' },
      { kind: 'service', itemId: service.id, quantity: '1' },
    ],
  });
  const confirmation = {
    requestId: randomUUID(),
    version: sale.version,
    payments: [
      { method: 'cash', amount: '40.00', reference: null },
      { method: 'transfer', amount: '50.00', reference: 'FICTICIO-INTEGRACION' },
    ],
  };
  const confirmed = await api(rec, 'POST', `/api/sales/${sale.id}/confirm`, confirmation, 200);
  assert.equal(confirmed.total, '90.00');
  assert.equal(confirmed.paid, '90.00');
  await api(rec, 'POST', `/api/sales/${sale.id}/confirm`, confirmation, 200);
  assert.equal((await api(admin, 'GET', `/api/products/${product.id}`)).stock, '3.000');
  const limaDay = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const reportQuery = new URLSearchParams({
    from: limaDay.format(new Date(Date.now() - 86400000)),
    to: limaDay.format(new Date(Date.now() + 86400000)),
  });
  const report = await api(admin, 'GET', `/api/reports/operations?${reportQuery}`);
  assert.equal(report.financial.salesTotal, '90.00');
  assert.equal(report.financial.paymentsTotal, '90.00');
  assert.equal(report.financial.paymentCount, 2);
  assert.equal(report.financial.purchasesTotal, '50.00');
  assert.equal(report.activity.closedEncounters, 1);
  const csv = await page.request.get(`/api/reports/operations.csv?${reportQuery}`);
  assert.equal(csv.status(), 200);
  assert.match(await csv.text(), /90.00/);
  assert.doesNotMatch(await csv.text(), /FICTICIO-INTEGRACION|Evaluación ficticia/);
  await page.goto(`/reportes?${reportQuery}`);
  await page.locator('.report-context').waitFor();
  await page.screenshot({ path: `${directory}/reports-https.png`, fullPage: true });
  await page.reload();
  await page.locator('.report-context').waitFor();
  console.log('4/7 · Caída y recuperación de PostgreSQL sin publicar errores internos.');
  compose(['stop', 'db']);
  assert.equal((await probe.get('/api/health')).status(), 200);
  const unavailable = await probe.get('/api/ready');
  assert.equal(unavailable.status(), 503);
  assert.deepEqual(await unavailable.json(), { status: 'unavailable' });
  compose(['up', '-d', '--wait', 'db']);
  await expect
    .poll(async () => (await probe.get('/api/ready')).status(), { timeout: 30000 })
    .toBe(200);
  // Huellas de todas las tablas, sin copiar información a la salida de la prueba.
  const tables = sql(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('user_sessions','password_reset_tokens','auth_rate_limits') ORDER BY tablename",
  ).split('\n');
  const fingerprints = (database) =>
    Object.fromEntries(
      tables.map((table) => {
        assert.match(table, /^[a-z_]+$/);
        return [
          table,
          sql(
            `SELECT coalesce(md5(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text)),'') FROM "${table}" t ${table === 'audit_logs' ? "WHERE action<>'operations.database_restored'" : ''}`,
            database,
          ),
        ];
      }),
    );
  const before = fingerprints('nexovet');
  const sequences = JSON.parse(
    sql(
      "SELECT json_object_agg(sequencename,last_value) FROM pg_sequences WHERE schemaname='public' AND sequencename<>'audit_logs_id_seq'",
    ),
  );
  console.log('5/7 · Respaldo completo, checksum y rechazos de corrupción/sobrescritura.');
  const dump = command('bash', ['ops/backup.sh']).split('\n').at(-1);
  assert.equal((await stat(dump)).mode & 0o777, 0o600);
  const corrupt = `${directory}/corrupt.dump`;
  await writeFile(corrupt, Buffer.concat([await readFile(dump), Buffer.from('corrupto')]), {
    mode: 0o600,
  });
  await writeFile(`${corrupt}.sha256`, await readFile(`${dump}.sha256`), { mode: 0o600 });
  command('bash', ['ops/restore.sh', corrupt, 'nexovet_restore_corrupt'], { fail: true });
  assert.equal(
    sql("SELECT count(*) FROM pg_database WHERE datname='nexovet_restore_corrupt'"),
    '0',
  );
  command('bash', ['ops/restore.sh', dump, 'nexovet'], { fail: true });
  assert.deepEqual(fingerprints('nexovet'), before);
  console.log('6/7 · Restauración nueva, huellas iguales y sesiones anteriores invalidadas.');
  const target = `nexovet_restore_${id}`;
  command('bash', ['ops/restore.sh', dump, target]);
  assert.deepEqual(fingerprints(target), before);
  assert.deepEqual(
    JSON.parse(
      sql(
        "SELECT json_object_agg(sequencename,last_value) FROM pg_sequences WHERE schemaname='public' AND sequencename<>'audit_logs_id_seq'",
        target,
      ),
    ),
    sequences,
  );
  assert.equal(sql('SELECT count(*) FROM user_sessions', target), '0');
  assert.equal(sql('SELECT count(*) FROM password_reset_tokens', target), '0');
  assert.equal(sql('SELECT count(*) FROM auth_rate_limits', target), '0');
  assert.equal(
    sql("SELECT count(*) FROM audit_logs WHERE action='operations.database_restored'", target),
    '1',
  );
  command('bash', ['ops/restore.sh', dump, target], { fail: true });
  assert.deepEqual(fingerprints(target), before);
  // Únicamente este proyecto efímero cambia de conexión. No existe promoción automática.
  await writeFile(envFile, contents.replace('DB_NAME=nexovet\n', `DB_NAME=${target}\n`), {
    mode: 0o600,
  });
  compose(['up', '-d', '--wait']);
  await expect
    .poll(async () => (await probe.get('/api/ready')).status(), { timeout: 30000 })
    .toBe(200);
  assert.equal((await page.request.get('/api/auth/session')).status(), 401);
  console.log('7/7 · Reingreso HTTPS y comprobación de documentos/historia después de restaurar.');
  await page.goto('/ingresar');
  await page.getByLabel('Correo electrónico', { exact: true }).fill(adminEmail);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await page.getByRole('heading', { name: 'Todo listo para recibirlos.' }).waitFor();
  assert.equal(
    (await (await page.request.get(`/api/sales/${sale.id}`)).json()).status,
    'confirmed',
  );
  assert.equal(
    (await (await page.request.get(`/api/products/${product.id}`)).json()).stock,
    '3.000',
  );
  assert.equal(
    (await (await page.request.get(`/api/pets/${pet.id}/history`)).json()).items[0].diagnosis,
    'Evaluación ficticia de integración',
  );
  const restoredReport = await (
    await page.request.get(`/api/reports/operations?${reportQuery}`)
  ).json();
  assert.deepEqual(restoredReport.financial, report.financial);
  await page.goto('/reportes');
  await page.locator('.report-context').waitFor();
  // Evidencia y respaldos sintéticos quedan en .local, fuera de Git.
  passed = true;
  console.log(
    'Operación completa y recuperación aprobadas en contenedores de producción con datos sintéticos.',
  );
} finally {
  await Promise.allSettled([
    adminContext?.close(),
    recContext?.close(),
    vetContext?.close(),
    probe?.dispose(),
  ]);
  await browser?.close();
  if (!passed) {
    try {
      compose(['logs', '--no-color', '--tail', '80']);
    } catch {}
  }
  // El nombre aleatorio es creado por esta ejecución; nunca se acepta uno externo.
  assert.match(project, /^nexovet-smoke-[a-f0-9]{8}$/);
  compose(['down', '--volumes', '--remove-orphans']);
}
