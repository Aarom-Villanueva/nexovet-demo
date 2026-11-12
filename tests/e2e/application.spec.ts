import { test, expect, type Page } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { assertDevelopmentDatabase, parseConfig } from '../../apps/api/src/config';

const root = fileURLToPath(new URL('../../', import.meta.url));
assertDevelopmentDatabase(process.env);
const databaseUrl = parseConfig(process.env).DATABASE_URL;
const database = new URL(databaseUrl).pathname.slice(1);
const credentials: { accounts: Array<{ email: string; role: string; password: string }> } =
  JSON.parse(await readFile(`${root}/.local/demo-credentials-${database}.json`, 'utf8'));
let agendaDoctor: { id: string; name: string; email: string };
test.beforeAll(async () => {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    if (!(await pool.query('SELECT 1 FROM business_settings WHERE is_demo')).rowCount)
      throw new Error('E2E requiere una veterinaria ficticia');
    const doctorEmail = credentials.accounts.find(
      (account) => account.role === 'veterinarian',
    )!.email;
    agendaDoctor = (
      await pool.query('SELECT id,name,email FROM users WHERE lower(email)=$1', [doctorEmail])
    ).rows[0];
    // Aísla la repetición de la suite; no modifica límites de cuentas reales.
    const keys = credentials.accounts.map((account) =>
      createHash('sha256').update(`login:email:${account.email}`).digest('hex'),
    );
    await pool.query('DELETE FROM auth_rate_limits WHERE key=ANY($1::text[])', [keys]);
  } finally {
    await pool.end();
  }
});
// Cada caso empieza sin bloqueos heredados de las cuentas sintéticas de esta suite.
// No cambia los límites de la API ni elimina los de otras cuentas.
test.beforeEach(async () => {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    if (!(await pool.query('SELECT 1 FROM business_settings WHERE is_demo')).rowCount)
      throw new Error('E2E requiere una veterinaria ficticia');
    const keys = credentials.accounts.map((account) =>
      createHash('sha256').update(`login:email:${account.email}`).digest('hex'),
    );
    await pool.query('DELETE FROM auth_rate_limits WHERE key=ANY($1::text[])', [keys]);
  } finally {
    await pool.end();
  }
});
async function login(page: Page, role = 'admin') {
  const account = credentials.accounts.find((account) => account.role === role)!;
  await page.goto('/');
  await page.getByLabel('Correo electrónico', { exact: true }).fill(account.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Todo listo para recibirlos.' })).toBeVisible();
}
test('login, navegación con PostgreSQL, persistencia al recargar y cierre de sesión', async ({
  page,
}) => {
  await login(page);
  await expect(page.getByText('320', { exact: true })).toBeVisible();
  await expect(page.getByText('400', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Revisar agenda' }).click();
  await expect(page).toHaveURL(/\/agenda$/);
  await expect(page.getByRole('heading', { name: 'Agenda de hoy' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Consulta general' }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Agenda de hoy' })).toBeVisible();
  await page.getByRole('link', { name: 'Clientes y mascotas' }).click();
  await expect(page.getByRole('heading', { name: 'Clientes', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mascotas', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mascotas', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Inventario', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'NV-0001', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Administración', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Accesos del equipo' })).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'admin@example.invalid', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Qué bueno verte de nuevo.' })).toBeVisible();
  await page.goto('/inventario');
  await expect(page.getByRole('heading', { name: 'Qué bueno verte de nuevo.' })).toBeVisible();
  expect((await page.request.get('/api/overview')).status()).toBe(401);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
});
test('muestra el error de conexión y permite reintentar sin inventar métricas', async ({
  page,
}) => {
  await page.route('**/api/overview', (route) =>
    route.fulfill({ status: 503, json: { message: 'No disponible' } }),
  );
  const account = credentials.accounts.find((account) => account.role === 'admin')!;
  await page.goto('/');
  await page.getByLabel('Correo electrónico', { exact: true }).fill(account.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'No pudimos cargar la vista previa' }),
  ).toBeVisible();
  await expect(page.getByText('320', { exact: true })).toHaveCount(0);
  await page.unroute('**/api/overview');
  await page.getByRole('button', { name: 'Intentar nuevamente' }).click();
  await expect(page.getByRole('heading', { name: 'Todo listo para recibirlos.' })).toBeVisible();
});
test('login y navegación móvil no desbordan el documento', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Ingresar', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await login(page);
  await page.getByRole('button', { name: 'Abrir menú' }).click();
  await page.getByRole('link', { name: 'Clientes y mascotas' }).click();
  await expect(page.getByRole('heading', { name: 'Clientes', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Abrir menú' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
});
test('recepción no accede a administración ni reportes, tampoco por URL directa', async ({
  page,
}) => {
  await login(page, 'reception');
  await expect(page.getByRole('link', { name: 'Administración', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Reportes', exact: true })).toHaveCount(0);
  await page.goto('/administracion');
  await expect(page.getByRole('heading', { name: 'Acceso restringido' })).toBeVisible();
  expect((await page.request.get('/api/users')).status()).toBe(403);
});
test('veterinario consulta mascotas sin correos de clientes ni precios y no accede a inventario', async ({
  page,
}) => {
  await login(page, 'veterinarian');
  await expect(page.getByRole('link', { name: 'Inventario', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Mascotas', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mascotas', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Clientes', exact: true })).toHaveCount(0);
  const response = await page.request.get('/api/overview');
  const body = await response.text();
  expect(body).not.toMatch(/"email"|"price"|@example/);
  expect((await page.request.get('/api/clients')).status()).toBe(403);
  expect((await page.request.get('/api/products')).status()).toBe(403);
  await page.goto('/inventario');
  await expect(page.getByRole('heading', { name: 'Acceso restringido' })).toBeVisible();
});
test('contraseña incorrecta muestra un error y permite mostrar/ocultar la entrada', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Correo electrónico', { exact: true }).fill('no-existe@example.invalid');
  await page.getByLabel('Contraseña', { exact: true }).fill('Incorrecta para pruebas');
  await page.getByRole('button', { name: 'Mostrar contraseña' }).click();
  await expect(page.getByLabel('Contraseña', { exact: true })).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Correo o contraseña incorrectos.');
});
test('una sesión que termina durante el uso vuelve al login sin mostrar datos', async ({
  page,
}) => {
  await login(page);
  await page.route('**/api/overview', (route) =>
    route.fulfill({ status: 401, json: { message: 'Sesión terminada' } }),
  );
  await page.getByRole('link', { name: 'Revisar agenda' }).click();
  await expect(page.getByRole('heading', { name: 'Qué bueno verte de nuevo.' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Tu sesión terminó. Ingresa para continuar.');
  await expect(page.getByText('320', { exact: true })).toHaveCount(0);
});
test('recuperación escribe en buzón privado local y el formulario cambia la contraseña con un enlace real', async ({
  page,
}) => {
  // Usuario efímero de prueba: no cambia contraseñas de las cuatro cuentas de demo.
  const { default: pg } = await import('pg');
  const { hashPassword, tokenHash } = await import('../../apps/api/src/auth/crypto');
  const { randomUUID } = await import('node:crypto');
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const email = `recovery-${randomUUID()}@example.invalid`;
  const inserted = await pool.query(
    "INSERT INTO users(name,email,role,password_hash,login_enabled) VALUES ('Recuperación de prueba',$1,'reception',$2,true) RETURNING id",
    [email, await hashPassword('Contraseña inicial de prueba')],
  );
  const userId = inserted.rows[0].id;
  try {
    await page.goto('/');
    await page.getByRole('link', { name: '¿Olvidaste tu contraseña?' }).click();
    await expect(page).toHaveURL(/\/recuperar$/);
    await expect(
      page.getByRole('heading', { name: 'Recupera tu acceso.', exact: true }),
    ).toBeVisible();
    await page.getByLabel('Correo electrónico', { exact: true }).fill(email);
    await expect(page.getByLabel('Correo electrónico', { exact: true })).toHaveValue(email);
    await page.getByRole('button', { name: 'Enviar enlace' }).click();
    await expect(page.getByRole('status')).toContainText('Si el correo tiene acceso habilitado');
    let mail: { to: string; url: string } | undefined;
    await expect
      .poll(async () => {
        for (const name of await readdir(`${root}/.local/mail`).catch(() => [])) {
          const item = JSON.parse(await readFile(`${root}/.local/mail/${name}`, 'utf8'));
          if (item.to === email) mail = item;
        }
        return !!mail;
      })
      .toBe(true);
    const token = new URLSearchParams(new URL(mail!.url).hash.slice(1)).get('token')!;
    expect(
      (
        await pool.query('SELECT 1 FROM password_reset_tokens WHERE token_hash=$1', [
          tokenHash(token),
        ])
      ).rowCount,
    ).toBe(1);
    await page.goto(mail!.url.replace('http://localhost:5173', 'http://127.0.0.1:5173'));
    await expect(page.getByRole('heading', { name: 'Una nueva contraseña.' })).toBeVisible();
    await expect(page).toHaveURL(/\/restablecer$/);
    await page
      .getByLabel('Nueva contraseña', { exact: true })
      .fill('Nueva contraseña para prueba 2026');
    await page.getByLabel('Confirma la contraseña').fill('Nueva contraseña para prueba 2026');
    await page.getByRole('button', { name: 'Guardar contraseña' }).click();
    await expect(page.getByRole('status')).toContainText('Contraseña actualizada');
    await page.getByRole('link', { name: 'Volver a ingresar' }).click();
    await page.getByLabel('Correo electrónico', { exact: true }).fill(email);
    await page.getByLabel('Contraseña', { exact: true }).fill('Nueva contraseña para prueba 2026');
    await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Todo listo para recibirlos.' })).toBeVisible();
  } finally {
    await pool.query('UPDATE users SET active=false,login_enabled=false WHERE id=$1', [userId]);
    await pool.end();
  }
});

const createdClients: string[] = [];
const createdPets: string[] = [];
const createdAppointments: string[] = [];
test.afterAll(async () => {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    await pool.query('DELETE FROM contact_events WHERE client_id=ANY($1::uuid[])', [
      createdClients,
    ]);
    await pool.query('DELETE FROM follow_up_tasks WHERE client_id=ANY($1::uuid[])', [
      createdClients,
    ]);
    await pool.query('DELETE FROM encounters WHERE appointment_id=ANY($1::uuid[])', [
      createdAppointments,
    ]);
    await pool.query('DELETE FROM appointments WHERE id=ANY($1::uuid[])', [createdAppointments]);
    await pool.query('DELETE FROM pets WHERE id=ANY($1::uuid[])', [createdPets]);
    await pool.query('DELETE FROM clients WHERE id=ANY($1::uuid[])', [createdClients]);
  } finally {
    await pool.end();
  }
});
const clientBody = (name: string) => ({
  name,
  email: null,
  phone: null,
  documentType: null,
  documentNumber: null,
  address: null,
  contactConsent: false,
  contactConsentNote: null,
  active: true,
});
async function writeFromBrowser(page: Page, path: string, body: unknown, method = 'POST') {
  const session = await page.request.get('/api/auth/session');
  const response = await page.request.fetch(path, {
    method,
    headers: { origin: 'http://127.0.0.1:5173', 'x-csrf-token': (await session.json()).csrfToken },
    data: body,
  });
  return response;
}
async function fixtureClient(page: Page, name: string, extra: object = {}) {
  const response = await writeFromBrowser(page, '/api/clients', { ...clientBody(name), ...extra });
  expect(response.status()).toBe(201);
  const record = await response.json();
  createdClients.push(record.id);
  return record;
}
async function clientsPage(page: Page) {
  await page.getByRole('link', { name: 'Clientes y mascotas', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Clientes', exact: true })).toBeVisible();
}
test('registra cliente y mascota desde su ficha, edita datos y conserva cambios al recargar', async ({
  page,
}) => {
  await login(page);
  await clientsPage(page);
  const clientName = `Familia E2E ${randomUUID().slice(0, 8)}`;
  const petName = `Luna E2E ${randomUUID().slice(0, 8)}`;
  await page.getByRole('button', { name: 'Nuevo cliente', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre completo *', { exact: true }).fill(clientName);
  await dialog.getByLabel('Teléfono', { exact: true }).fill('000000000');
  await dialog
    .getByLabel('Correo electrónico', { exact: true })
    .fill('familia-demo@example.invalid');
  await dialog.getByLabel('Autoriza contacto para seguimientos y recordatorios').check();
  await dialog
    .getByLabel('Cómo se obtuvo la autorización *')
    .fill('Autorización ficticia durante la prueba');
  const clientResponse = page.waitForResponse(
    (response) => response.url().endsWith('/api/clients') && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Registrar cliente', exact: true }).click();
  const client = await (await clientResponse).json();
  createdClients.push(client.id);
  await expect(page.getByRole('dialog', { name: clientName, exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Registrar mascota', exact: true }).click();
  await dialog.getByLabel('Nombre de la mascota *').fill(petName);
  await dialog.getByLabel('Especie *').selectOption('cat');
  await dialog.getByLabel('Sexo', { exact: true }).selectOption('female');
  await dialog.getByLabel('Fecha de nacimiento', { exact: true }).fill('2023-04-15');
  await dialog
    .getByLabel('Alergias y observaciones relevantes')
    .fill('Observación clínica de prueba');
  const petResponse = page.waitForResponse(
    (response) => response.url().endsWith('/api/pets') && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Registrar mascota', exact: true }).click();
  const pet = await (await petResponse).json();
  createdPets.push(pet.id);
  expect(pet.clientId).toBe(client.id);
  await expect(page.getByRole('dialog', { name: petName, exact: true })).toBeVisible();
  await expect(dialog.getByText(clientName, { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Editar mascota', exact: true }).click();
  await dialog
    .getByLabel('Alergias y observaciones relevantes')
    .fill('Observación corregida y persistente');
  await dialog.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(
    dialog.getByText('Observación corregida y persistente', { exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: `Ver ficha de ${petName}`, exact: true }).click();
  await expect(
    dialog.getByText('Observación corregida y persistente', { exact: true }),
  ).toBeVisible();
});
test('recepción puede registrar; documento duplicado muestra error y conserva el formulario', async ({
  page,
}) => {
  await login(page, 'reception');
  const doc = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
  await fixtureClient(page, `Duplicado E2E ${doc}`, { documentType: 'CE', documentNumber: doc });
  await clientsPage(page);
  await page.getByRole('button', { name: 'Nuevo cliente', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre completo *', { exact: true }).fill('Nombre que debe conservarse');
  await dialog.getByLabel('Tipo de documento', { exact: true }).selectOption('CE');
  await dialog.getByLabel('Número de documento', { exact: true }).fill(doc);
  await dialog.getByRole('button', { name: 'Registrar cliente', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Ya existe un cliente');
  await expect(dialog.getByLabel('Nombre completo *', { exact: true })).toHaveValue(
    'Nombre que debe conservarse',
  );
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});
test('conflicto de versión conserva el borrador y permite cargar la ficha actual', async ({
  page,
}) => {
  await login(page);
  const record = await fixtureClient(page, `Concurrente E2E ${randomUUID().slice(0, 8)}`);
  await clientsPage(page);
  await page.getByLabel('Buscar clientes', { exact: true }).fill(record.name);
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await page.getByRole('button', { name: `Editar a ${record.name}`, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre completo *', { exact: true }).fill('Mi borrador sin perder');
  const other = await writeFromBrowser(
    page,
    `/api/clients/${record.id}`,
    { ...clientBody('Edición de otra recepción'), version: record.version },
    'PUT',
  );
  expect(other.status()).toBe(200);
  await dialog.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Otra persona actualizó esta ficha');
  await expect(dialog.getByLabel('Nombre completo *', { exact: true })).toHaveValue(
    'Mi borrador sin perder',
  );
  await dialog.getByRole('button', { name: 'Recargar ficha actual', exact: true }).click();
  await expect(dialog.getByLabel('Nombre completo *', { exact: true })).toHaveValue(
    'Edición de otra recepción',
  );
  await dialog.getByLabel('Nombre completo *', { exact: true }).fill('Versión final revisada');
  await dialog.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Versión final revisada', exact: true }),
  ).toBeVisible();
  expect((await (await page.request.get(`/api/clients/${record.id}`)).json()).version).toBe(3);
});
test('busca al responsable para registrar una mascota desde el directorio', async ({ page }) => {
  await login(page, 'reception');
  const owner = await fixtureClient(page, `Responsable E2E ${randomUUID().slice(0, 8)}`);
  await clientsPage(page);
  await page.getByRole('button', { name: 'Nueva mascota', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const name = `Toby E2E ${randomUUID().slice(0, 8)}`;
  await dialog.getByLabel('Nombre de la mascota *', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Registrar mascota', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Selecciona al responsable');
  await dialog.getByLabel('Buscar responsable *', { exact: true }).fill(owner.name);
  await dialog.getByRole('button', { name: `Seleccionar a ${owner.name}`, exact: true }).click();
  const response = page.waitForResponse(
    (response) => response.url().endsWith('/api/pets') && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Registrar mascota', exact: true }).click();
  const record = await (await response).json();
  createdPets.push(record.id);
  expect(record.clientId).toBe(owner.id);
  await expect(page.getByRole('dialog', { name, exact: true })).toBeVisible();
});
test('fallo de red y retorno a la pestaña conservan el borrador y permiten guardar después', async ({
  page,
}) => {
  await login(page);
  await clientsPage(page);
  await page.getByRole('button', { name: 'Nuevo cliente', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const name = `Borrador E2E ${randomUUID().slice(0, 8)}`;
  await dialog.getByLabel('Nombre completo *', { exact: true }).fill(name);
  await page.route('**/api/clients', (route) =>
    route.request().method() === 'POST' ? route.abort() : route.continue(),
  );
  await dialog.getByRole('button', { name: 'Registrar cliente', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Tus cambios siguen en el formulario');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(dialog.getByLabel('Nombre completo *', { exact: true })).toHaveValue(name);
  await page.unroute('**/api/clients');
  const response = page.waitForResponse(
    (response) => response.url().endsWith('/api/clients') && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Registrar cliente', exact: true }).click();
  const saved = await (await response).json();
  createdClients.push(saved.id);
  await expect(page.getByRole('dialog', { name, exact: true })).toBeVisible();
});
test('formulario móvil permite guardar, archivar y encontrar el registro con filtros', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 'reception');
  await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
  await clientsPage(page);
  await page.getByRole('button', { name: 'Nuevo cliente', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const name = `Móvil E2E ${randomUUID().slice(0, 8)}`;
  await dialog.getByLabel('Nombre completo *', { exact: true }).fill(name);
  await dialog
    .getByLabel('Dirección', { exact: true })
    .fill('Dirección sintética de la prueba móvil');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const response = page.waitForResponse(
    (response) => response.url().endsWith('/api/clients') && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Registrar cliente', exact: true }).click();
  const record = await (await response).json();
  createdClients.push(record.id);
  await dialog.getByRole('button', { name: 'Editar cliente', exact: true }).click();
  await dialog.getByLabel('Estado del cliente', { exact: true }).selectOption('false');
  await dialog.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(dialog.getByText('Cliente archivado', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'No encontramos registros', exact: true }),
  ).toBeVisible();
  await page.getByRole('combobox', { name: 'Estado', exact: true }).selectOption('archived');
  await expect(
    page.getByRole('button', { name: `Ver ficha de ${name}`, exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

async function fixtureAgendaPatient(page: Page) {
  const owner = await fixtureClient(page, `Responsable agenda ${randomUUID().slice(0, 8)}`);
  const name = `Paciente agenda ${randomUUID().slice(0, 8)}`;
  const response = await writeFromBrowser(page, '/api/pets', {
    name,
    clientId: owner.id,
    species: 'dog',
    breed: null,
    sex: 'unknown',
    birthDate: null,
    microchip: null,
    allergies: null,
    active: true,
  });
  expect(response.status()).toBe(201);
  const patient = await response.json();
  createdPets.push(patient.id);
  return patient;
}
async function bookingInput(
  page: Page,
  patientId: string,
  day = '2040-04-01',
  startTime = '10:00',
) {
  const options = await (await page.request.get('/api/agenda/options')).json();
  return {
    petId: patientId,
    professionalId: agendaDoctor.id,
    serviceId: options.services[0].id,
    date: day,
    startTime,
    durationMinutes: 30,
    reason: 'Visita de prueba con datos ficticios',
  };
}
async function fixtureAppointment(page: Page, patientId: string, day: string, startTime: string) {
  const input = await bookingInput(page, patientId, day, startTime);
  const response = await writeFromBrowser(page, '/api/appointments', input);
  expect(response.status()).toBe(201);
  const record = await response.json();
  createdAppointments.push(record.id);
  return record;
}
async function fillBooking(page: Page, patient: { name: string }, day: string, startTime: string) {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Buscar paciente *', { exact: true }).fill(patient.name);
  await dialog
    .getByRole('button', { name: `Seleccionar paciente ${patient.name}`, exact: true })
    .click();
  await dialog.getByLabel('Veterinario *', { exact: true }).selectOption(agendaDoctor.id);
  const options = await (await page.request.get('/api/agenda/options')).json();
  await dialog.getByLabel('Servicio *', { exact: true }).selectOption(options.services[0].id);
  await dialog.getByLabel('Fecha *', { exact: true }).fill(day);
  await dialog.getByLabel('Hora de inicio *', { exact: true }).fill(startTime);
  await dialog.getByLabel('Duración en minutos *', { exact: true }).fill('30');
}
async function saveBooking(page: Page) {
  const pending = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/appointments') && response.request().method() === 'POST',
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar cita', exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(201);
  const record = await response.json();
  createdAppointments.push(record.id);
  return record;
}
async function logoutUI(page: Page) {
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Qué bueno verte de nuevo.' })).toBeVisible();
}
function nearSlot(minutes = 10) {
  const instant = new Date(Date.now() + minutes * 60000);
  return {
    day: new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Lima',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(instant),
    time: new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/Lima',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(instant),
  };
}
async function readyCare(page: Page) {
  await login(page, 'reception');
  const patient = await fixtureAgendaPatient(page);
  const slot = nearSlot();
  let record = await fixtureAppointment(page, patient.id, slot.day, slot.time);
  const arrived = await writeFromBrowser(page, `/api/appointments/${record.id}/status`, {
    version: record.version,
    status: 'arrived',
  });
  expect(arrived.status()).toBe(200);
  record = await arrived.json();
  await logoutUI(page);
  await login(page, 'veterinarian');
  await page.goto(`/agenda?date=${slot.day}&q=${encodeURIComponent(patient.name)}`);
  await page.getByRole('button', { name: `Abrir cita de ${patient.name}`, exact: true }).click();
  const pending = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/appointments/${record.id}/start`) &&
      response.request().method() === 'POST',
  );
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Iniciar atención', exact: true })
    .click();
  const response = await pending;
  expect(response.status()).toBe(201);
  return { patient, record, encounter: await response.json() };
}
test('agenda: recepción programa, confirma, reprograma y cancela una cita', async ({ page }) => {
  await login(page, 'reception');
  const patient = await fixtureAgendaPatient(page);
  await page.getByRole('link', { name: 'Agenda', exact: true }).click();
  await page.getByRole('button', { name: 'Nueva cita', exact: true }).click();
  await fillBooking(page, patient, '2040-04-01', '10:00');
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Comprobar horario', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Sin cruces');
  const record = await saveBooking(page);
  await expect(
    page.getByRole('dialog', { name: `Cita de ${patient.name}`, exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirmar cita', exact: true }).click();
  await expect(dialog.getByText('Confirmada', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Reprogramar cita', exact: true }).click();
  await dialog.getByLabel('Hora de inicio *', { exact: true }).fill('11:00');
  await dialog.getByRole('button', { name: 'Guardar horario', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: `Cita de ${patient.name}`, exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText('Programada', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancelar cita', exact: true }).click();
  await expect(dialog.getByText('Cancelada', { exact: true })).toBeVisible();
  const stored = await (await page.request.get(`/api/appointments/${record.id}`)).json();
  expect(stored.startTime).toBe('11:00');
  expect(stored.status).toBe('cancelled');
});
test('agenda: un horario ocupado avisa sin perder el formulario y permite elegir otro', async ({
  page,
}) => {
  await login(page);
  const first = await fixtureAgendaPatient(page);
  await fixtureAppointment(page, first.id, '2040-04-02', '10:00');
  const second = await fixtureAgendaPatient(page);
  await page.goto('/agenda');
  await page.getByRole('button', { name: 'Nueva cita', exact: true }).click();
  await fillBooking(page, second, '2040-04-02', '10:00');
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Comprobar horario', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Hay otra cita');
  await dialog.getByRole('button', { name: 'Guardar cita', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Ese horario se cruza');
  await expect(dialog.getByLabel('Hora de inicio *', { exact: true })).toHaveValue('10:00');
  await dialog.getByLabel('Hora de inicio *', { exact: true }).fill('10:30');
  await saveBooking(page);
  await expect(
    page.getByRole('dialog', { name: `Cita de ${second.name}`, exact: true }),
  ).toBeVisible();
});
test('atención: recepción registra llegada; veterinario guarda y cierra; historia conserva la consulta', async ({
  page,
}) => {
  test.setTimeout(60000);
  await login(page, 'reception');
  const patient = await fixtureAgendaPatient(page);
  const slot = nearSlot();
  const record = await fixtureAppointment(page, patient.id, slot.day, slot.time);
  await page.goto(`/agenda?date=${slot.day}&q=${encodeURIComponent(patient.name)}`);
  await page.getByRole('button', { name: `Abrir cita de ${patient.name}`, exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Registrar llegada', exact: true }).click();
  await expect(dialog.getByText('En espera', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await logoutUI(page);
  await login(page, 'veterinarian');
  await page.goto(`/agenda?date=${slot.day}&q=${encodeURIComponent(patient.name)}`);
  await expect(page.getByRole('button', { name: 'Nueva cita', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: `Abrir cita de ${patient.name}`, exact: true }).click();
  await dialog.getByRole('button', { name: 'Iniciar atención', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: `Atención de ${patient.name}`, exact: true }),
  ).toBeVisible();
  await dialog.getByLabel('Peso (kg)', { exact: true }).fill('8.125');
  await dialog.getByLabel('Temperatura (°C)', { exact: true }).fill('38.2');
  await dialog
    .getByLabel('Hallazgos de la consulta', { exact: true })
    .fill('Hallazgos ficticios para probar el sistema.');
  await dialog
    .getByLabel('Evaluación / diagnóstico', { exact: true })
    .fill('Evaluación de demostración, sin consejo clínico.');
  await dialog
    .getByLabel('Plan e indicaciones', { exact: true })
    .fill('Texto de prueba, no usar como indicación médica.');
  await expect(dialog.getByRole('button', { name: 'Cerrar atención', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Guardar atención', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Cambios de la atención guardados');
  await dialog.getByRole('button', { name: 'Cerrar atención', exact: true }).click();
  await expect(dialog.getByText('Atención cerrada', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Evaluación / diagnóstico', { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Programar seguimiento', exact: true }).click();
  await dialog
    .getByLabel('Qué hay que hacer *', { exact: true })
    .fill('Control posterior a consulta ficticia');
  const followupSaved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/follow-ups') && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Crear seguimiento', exact: true }).click();
  const followupResponse = await followupSaved;
  expect(followupResponse.status()).toBe(201);
  const followup = await followupResponse.json();
  expect(followup.petId).toBe(patient.id);
  expect(followup.assignedTo).toBe(agendaDoctor.id);
  await expect(dialog.getByText('Atención cerrada', { exact: true })).toBeVisible();
  const persisted = await (await page.request.get(`/api/appointments/${record.id}`)).json();
  expect(persisted.status).toBe('completed');
  await page.reload();
  await page.goto(`/clientes?tab=pets&q=${encodeURIComponent(patient.name)}`);
  await page.getByRole('button', { name: `Ver ficha de ${patient.name}`, exact: true }).click();
  await dialog.getByRole('button', { name: 'Historia clínica', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: `Historia de ${patient.name}`, exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Ver atención', exact: true }).click();
  await expect(
    dialog.getByText('Evaluación de demostración, sin consejo clínico.', { exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Volver', exact: true }).click();
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await logoutUI(page);
  await login(page, 'reception');
  expect((await page.request.get(`/api/encounters/${persisted.encounterId}`)).status()).toBe(403);
  expect((await page.request.get(`/api/pets/${patient.id}/history`)).status()).toBe(403);
});
test('atención: una edición simultánea conserva el borrador y permite recuperar la versión actual', async ({
  page,
}) => {
  const care = await readyCare(page);
  const dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('Hallazgos de la consulta', { exact: true })
    .fill('Borrador local por conservar');
  const other = await writeFromBrowser(
    page,
    `/api/encounters/${care.encounter.id}`,
    {
      version: 1,
      weightKg: null,
      temperatureC: null,
      findings: 'Guardado desde otra pestaña',
      diagnosis: 'Registro ficticio',
      treatment: 'Plan ficticio',
    },
    'PUT',
  );
  expect(other.status()).toBe(200);
  await dialog.getByRole('button', { name: 'Guardar atención', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Otra persona actualizó este registro');
  await expect(dialog.getByLabel('Hallazgos de la consulta', { exact: true })).toHaveValue(
    'Borrador local por conservar',
  );
  await dialog.getByRole('button', { name: 'Recargar ficha actual', exact: true }).click();
  await expect(dialog.getByLabel('Hallazgos de la consulta', { exact: true })).toHaveValue(
    'Guardado desde otra pestaña',
  );
  await dialog.getByRole('button', { name: 'Cerrar atención', exact: true }).click();
  await expect(dialog.getByText('Atención cerrada', { exact: true })).toBeVisible();
});
test('agenda móvil: programa una cita, cambia a semana y filtra por profesional', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 'reception');
  const patient = await fixtureAgendaPatient(page);
  await page.goto('/agenda');
  await page.getByRole('button', { name: 'Nueva cita', exact: true }).click();
  await fillBooking(page, patient, '2040-04-05', '11:00');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await saveBooking(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByRole('button', { name: 'Semana', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Agenda de la semana', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: `Abrir cita de ${patient.name}`, exact: true }),
  ).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Veterinario de agenda', exact: true })
    .selectOption(agendaDoctor.id);
  await expect(
    page.getByRole('button', { name: `Abrir cita de ${patient.name}`, exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('agenda: muestra fallo de lectura y permite reintentar sin inventar citas', async ({
  page,
}) => {
  await login(page);
  await page.route('**/api/appointments?*', (route) =>
    route.fulfill({ status: 503, json: { message: 'Agenda temporalmente no disponible' } }),
  );
  await page.goto('/agenda');
  await expect(page.getByRole('alert')).toContainText('Agenda temporalmente no disponible');
  await expect(page.getByRole('button', { name: 'Abrir cita', exact: true })).toHaveCount(0);
  await page.unroute('**/api/appointments?*');
  await page.getByRole('button', { name: 'Intentar nuevamente', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Visitas programadas', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

async function fixtureFollowup(
  page: Page,
  patient: { id: string; clientId: string },
  extra: object = {},
) {
  const response = await writeFromBrowser(page, '/api/follow-ups', {
    clientId: patient.clientId,
    petId: patient.id,
    assignedTo: null,
    title: `Control E2E ${randomUUID().slice(0, 8)}`,
    description: 'Gestión ficticia para la prueba',
    date: '2040-04-07',
    time: '10:30',
    ...extra,
  });
  expect(response.status()).toBe(201);
  return response.json();
}
async function openFollowup(page: Page, task: { title: string }) {
  await page.goto(`/seguimiento?q=${encodeURIComponent(task.title)}&status=all`);
  await page.getByRole('button', { name: `Abrir seguimiento ${task.title}`, exact: true }).click();
}
async function saveContact(page: Page) {
  const pending = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/contact-events') && response.request().method() === 'POST',
  );
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Guardar contacto', exact: true })
    .click();
  const response = await pending;
  expect(response.status()).toBe(201);
  return response.json();
}
test('seguimientos: recepción busca paciente, asigna, reprograma y completa con persistencia', async ({
  page,
}) => {
  await login(page, 'reception');
  const patient = await fixtureAgendaPatient(page);
  await page.goto('/seguimiento');
  await page.getByRole('button', { name: 'Nuevo seguimiento', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Buscar mascota *', { exact: true }).fill(patient.name);
  await dialog
    .getByRole('button', { name: `Seleccionar seguimiento de ${patient.name}`, exact: true })
    .click();
  const title = `Coordinación E2E ${randomUUID().slice(0, 8)}`;
  await dialog.getByLabel('Qué hay que hacer *', { exact: true }).fill(title);
  await dialog.getByLabel('Responsable del equipo', { exact: true }).selectOption(agendaDoctor.id);
  await dialog.getByLabel('Fecha límite *', { exact: true }).fill('2040-04-08');
  await dialog.getByLabel('Hora límite *', { exact: true }).fill('11:30');
  const pending = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/follow-ups') && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Crear seguimiento', exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(201);
  const task = await response.json();
  expect(task.assignedTo).toBe(agendaDoctor.id);
  await expect(page.getByRole('dialog', { name: title, exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Editar seguimiento', exact: true }).click();
  await dialog.getByLabel('Fecha límite *', { exact: true }).fill('2040-04-09');
  await dialog.getByRole('button', { name: 'Guardar seguimiento', exact: true }).click();
  await expect(page.getByRole('dialog', { name: title, exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Completar seguimiento', exact: true }).click();
  await expect(dialog.getByText('Completado', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByLabel('Estado del seguimiento', { exact: true }).selectOption('completed');
  await page.getByRole('button', { name: `Abrir seguimiento ${title}`, exact: true }).click();
  await expect(dialog.getByText('Completado', { exact: true })).toBeVisible();
  const stored = await (await page.request.get(`/api/follow-ups/${task.id}`)).json();
  expect(stored.date).toBe('2040-04-09');
  expect(stored.version).toBe(3);
});
test('seguimientos: veterinario solo ve sus tareas y no tiene acceso a contactos', async ({
  page,
}) => {
  await login(page, 'reception');
  const patient = await fixtureAgendaPatient(page);
  const own = await fixtureFollowup(page, patient, { assignedTo: agendaDoctor.id });
  const hidden = await fixtureFollowup(page, patient);
  await logoutUI(page);
  await login(page, 'veterinarian');
  await page.goto('/seguimiento?status=all');
  await expect(page.getByRole('heading', { name: 'Mis seguimientos', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: `Abrir seguimiento ${own.title}`, exact: true }),
  ).toBeVisible();
  await expect(page.getByText(hidden.title, { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Contactos registrados', exact: true }),
  ).toHaveCount(0);
  expect((await page.request.get(`/api/follow-ups/${hidden.id}`)).status()).toBe(404);
  expect((await page.request.get('/api/contact-events')).status()).toBe(403);
  await page.getByRole('button', { name: `Abrir seguimiento ${own.title}`, exact: true }).click();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Registrar contacto', exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Completar seguimiento', exact: true })
    .click();
  await expect(page.getByRole('dialog').getByText('Completado', { exact: true })).toBeVisible();
});
test('contactos: sin respuesta conserva pendiente y contacto efectivo completa y aparece en la ficha', async ({
  page,
}) => {
  await login(page, 'reception');
  const patient = await fixtureAgendaPatient(page);
  const task = await fixtureFollowup(page, patient);
  await openFollowup(page, task);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Registrar contacto', exact: true }).click();
  await expect(
    dialog.getByText('Sin autorización de contacto registrada', { exact: true }),
  ).toBeVisible();
  await dialog.getByLabel('Canal utilizado *', { exact: true }).selectOption('phone');
  await dialog.getByLabel('Resultado *', { exact: true }).selectOption('no_answer');
  await dialog
    .getByLabel('Nota del contacto', { exact: true })
    .fill('Intento ficticio, sin respuesta.');
  await saveContact(page);
  await expect(page.getByRole('dialog', { name: task.title, exact: true })).toBeVisible();
  await expect(dialog.getByText('Pendiente', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Intento ficticio, sin respuesta.', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Registrar contacto', exact: true }).click();
  await dialog.getByLabel('Canal utilizado *', { exact: true }).selectOption('whatsapp');
  await dialog.getByLabel('Resultado *', { exact: true }).selectOption('contacted');
  await dialog
    .getByLabel('Nota del contacto', { exact: true })
    .fill('Coordinación ficticia confirmada.');
  await dialog.getByLabel('Marcar también el seguimiento como completado', { exact: true }).check();
  await saveContact(page);
  await expect(page.getByRole('dialog', { name: task.title, exact: true })).toBeVisible();
  await expect(dialog.getByText('Completado', { exact: true })).toBeVisible();
  await expect(
    dialog.getByText('Coordinación ficticia confirmada.', { exact: true }),
  ).toBeVisible();
  const client = await (await page.request.get(`/api/clients/${patient.clientId}`)).json();
  await page.goto(`/clientes?q=${encodeURIComponent(client.name)}`);
  await page.getByRole('button', { name: `Ver ficha de ${client.name}`, exact: true }).click();
  await dialog.getByRole('button', { name: 'Historial de contactos', exact: true }).click();
  await expect(
    dialog.getByText('Coordinación ficticia confirmada.', { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText('Intento ficticio, sin respuesta.', { exact: true })).toBeVisible();
});
test('contactos: respuesta perdida tras guardar permite reintento sin duplicar ni completar dos veces', async ({
  page,
}) => {
  await login(page, 'reception');
  const patient = await fixtureAgendaPatient(page);
  const task = await fixtureFollowup(page, patient);
  await openFollowup(page, task);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Registrar contacto', exact: true }).click();
  await dialog.getByLabel('Canal utilizado *', { exact: true }).selectOption('phone');
  await dialog.getByLabel('Resultado *', { exact: true }).selectOption('contacted');
  await dialog.getByLabel('Nota del contacto', { exact: true }).fill('Un único registro ficticio.');
  await dialog.getByLabel('Marcar también el seguimiento como completado', { exact: true }).check();
  await page.route('**/api/contact-events', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await route.abort();
  });
  await dialog.getByRole('button', { name: 'Guardar contacto', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Tus cambios siguen en el formulario');
  await expect(dialog.getByLabel('Nota del contacto', { exact: true })).toBeDisabled();
  await expect(dialog.getByLabel('Nota del contacto', { exact: true })).toHaveValue(
    'Un único registro ficticio.',
  );
  await page.unroute('**/api/contact-events');
  const pending = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/contact-events') && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Reintentar registro', exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(201);
  expect(response.headers()['idempotent-replay']).toBe('true');
  await expect(page.getByRole('dialog', { name: task.title, exact: true })).toBeVisible();
  await expect(dialog.getByText('Un único registro ficticio.', { exact: true })).toHaveCount(1);
  const stored = await (await page.request.get(`/api/follow-ups/${task.id}`)).json();
  expect(stored.contactCount).toBe(1);
  expect(stored.version).toBe(2);
});
test('seguimientos móvil: programa desde mascota y conserva borrador ante edición simultánea', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 'reception');
  const patient = await fixtureAgendaPatient(page);
  await page.goto(`/clientes?tab=pets&q=${encodeURIComponent(patient.name)}`);
  await page.getByRole('button', { name: `Ver ficha de ${patient.name}`, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Nuevo seguimiento', exact: true }).click();
  const title = `Móvil seguimiento ${randomUUID().slice(0, 8)}`;
  await dialog.getByLabel('Qué hay que hacer *', { exact: true }).fill(title);
  const pending = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/follow-ups') && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Crear seguimiento', exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(201);
  const task = await response.json();
  expect(task.petId).toBe(patient.id);
  await expect(dialog).toHaveCount(0);
  await openFollowup(page, task);
  await dialog.getByRole('button', { name: 'Editar seguimiento', exact: true }).click();
  await dialog
    .getByLabel('Qué hay que hacer *', { exact: true })
    .fill('Mi borrador de seguimiento');
  const updated = await writeFromBrowser(
    page,
    `/api/follow-ups/${task.id}`,
    {
      title: 'Actualizado en otra sesión',
      description: task.description,
      date: task.date,
      time: task.time,
      assignedTo: null,
      version: task.version,
    },
    'PUT',
  );
  expect(updated.status()).toBe(200);
  await dialog.getByRole('button', { name: 'Guardar seguimiento', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Otra persona actualizó este seguimiento');
  await expect(dialog.getByLabel('Qué hay que hacer *', { exact: true })).toHaveValue(
    'Mi borrador de seguimiento',
  );
  await dialog.getByRole('button', { name: 'Recargar ficha actual', exact: true }).click();
  await expect(dialog.getByLabel('Qué hay que hacer *', { exact: true })).toHaveValue(
    'Actualizado en otra sesión',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('seguimientos: un fallo de lectura se puede reintentar sin mostrar tareas inventadas', async ({
  page,
}) => {
  await login(page);
  await page.route('**/api/follow-ups?*', (route) =>
    route.fulfill({ status: 503, json: { message: 'Seguimientos temporalmente no disponibles' } }),
  );
  await page.goto('/seguimiento');
  await expect(page.getByRole('alert')).toContainText('Seguimientos temporalmente no disponibles');
  await expect(page.getByRole('button', { name: /^Abrir seguimiento / })).toHaveCount(0);
  await page.unroute('**/api/follow-ups?*');
  await page.getByRole('button', { name: 'Intentar nuevamente', exact: true }).click();
  await expect(page.getByRole('columnheader', { name: 'Seguimiento', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
