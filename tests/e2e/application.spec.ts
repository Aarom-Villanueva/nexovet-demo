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
let clinicalUserId: string | undefined;
let originalBusiness: { name: string; address: string };
const ownedBusinessNames = new Set<string>();
test.beforeAll(async () => {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    if (!(await pool.query('SELECT 1 FROM business_settings WHERE is_demo')).rowCount)
      throw new Error('E2E requiere una veterinaria ficticia');
    originalBusiness = (await pool.query('SELECT name,address FROM business_settings')).rows[0];
    // La agenda clínica usa un profesional propio de la suite. Los horarios
    // próximos a "ahora" no deben competir con las citas de la semilla.
    const { hashPassword } = await import('../../apps/api/src/auth/crypto');
    const email = `e2e-clinical-${randomUUID()}@example.invalid`;
    const password = `E2E-${randomUUID()}-${randomUUID()}`;
    agendaDoctor = (
      await pool.query(
        "INSERT INTO users(name,email,role,password_hash,login_enabled) VALUES ($1,$2,'veterinarian',$3,true) RETURNING id,name,email",
        [`Veterinario E2E ${randomUUID().slice(0, 8)}`, email, await hashPassword(password)],
      )
    ).rows[0];
    clinicalUserId = agendaDoctor.id;
    const account = credentials.accounts.find((account) => account.role === 'veterinarian')!;
    account.email = email;
    account.password = password;
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
const createdProducts: string[] = [];
const createdSuppliers: string[] = [];
const createdPurchases: string[] = [];
const createdSales: string[] = [];
const createdConfigUsers: string[] = [];
const createdConfigServices: string[] = [];
const createdConfigCategories: string[] = [];
test.afterAll(async () => {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    if (clinicalUserId)
      await pool.query('UPDATE users SET active=false,login_enabled=false WHERE id=$1', [
        clinicalUserId,
      ]);
    // El libro de stock y las compras finalizadas no se borran. Los fixtures se
    // compensan y archivan; conservan trazabilidad sin alterar productos de la semilla.
    const actor = (await pool.query("SELECT id FROM users WHERE email='admin@example.invalid'"))
      .rows[0].id;
    for (const id of createdProducts) {
      const stock = (
        await pool.query('SELECT quantity FROM product_stock WHERE product_id=$1', [id])
      ).rows[0]?.quantity;
      if (stock && Number(stock) !== 0)
        await pool.query(
          "INSERT INTO stock_movements(product_id,quantity,kind,reason,recorded_by) VALUES ($1,-$2::numeric,'adjustment','Compensación de fixture E2E',$3)",
          [id, stock, actor],
        );
    }
    await pool.query(
      "UPDATE sales SET status='cancelled',version=version+1 WHERE id=ANY($1::uuid[]) AND status='draft'",
      [createdSales],
    );
    await pool.query('UPDATE products SET active=false WHERE id=ANY($1::uuid[])', [
      createdProducts,
    ]);
    await pool.query('UPDATE suppliers SET active=false WHERE id=ANY($1::uuid[])', [
      createdSuppliers,
    ]);
    await pool.query(
      "UPDATE purchase_orders SET status='cancelled',version=version+1 WHERE id=ANY($1::uuid[]) AND status='draft'",
      [createdPurchases],
    );
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
    await pool.query('UPDATE products SET category_id=NULL WHERE id=ANY($1::uuid[])', [
      createdProducts,
    ]);
    await pool.query('UPDATE services SET active=false WHERE id=ANY($1::uuid[])', [
      createdConfigServices,
    ]);
    await pool.query('DELETE FROM product_categories WHERE id=ANY($1::uuid[])', [
      createdConfigCategories,
    ]);
    await pool.query(
      'UPDATE user_sessions SET revoked_at=now() WHERE user_id=ANY($1::uuid[]) AND revoked_at IS NULL',
      [createdConfigUsers],
    );
    await pool.query('UPDATE users SET active=false,login_enabled=false WHERE id=ANY($1::uuid[])', [
      createdConfigUsers,
    ]);
    const b = (await pool.query('SELECT name FROM business_settings')).rows[0];
    if (originalBusiness && ownedBusinessNames.has(b.name)) {
      await pool.query('BEGIN');
      try {
        const restored = await pool.query(
          'UPDATE business_settings SET name=$1,address=$2,version=version+1,updated_at=now() WHERE name=$3',
          [originalBusiness.name, originalBusiness.address, b.name],
        );
        if (restored.rowCount)
          await pool.query(
            "INSERT INTO audit_logs(actor_id,action,entity_type,metadata) VALUES($1,'test.business_restored','settings','{}')",
            [actor],
          );
        await pool.query('COMMIT');
      } catch (e) {
        await pool.query('ROLLBACK');
        throw e;
      }
    }
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

async function inventoryFixtures(page: Page) {
  const productResponse = await writeFromBrowser(page, '/api/products', {
    sku: `E2E-${randomUUID().slice(0, 8)}`,
    name: `Alimento E2E ${randomUUID().slice(0, 8)}`,
    categoryId: null,
    salePrice: '15.50',
    minimumStock: '2',
    active: true,
  });
  expect(productResponse.status()).toBe(201);
  const product = await productResponse.json();
  createdProducts.push(product.id);
  const supplierResponse = await writeFromBrowser(page, '/api/suppliers', {
    name: `Distribuidor E2E ${randomUUID().slice(0, 8)}`,
    taxId: null,
    email: 'proveedor-e2e@example.invalid',
    phone: '000000000',
    address: 'Dirección ficticia',
    active: true,
  });
  expect(supplierResponse.status()).toBe(201);
  const supplier = await supplierResponse.json();
  createdSuppliers.push(supplier.id);
  return { product, supplier };
}
async function purchaseFixture(page: Page, product: { id: string }, supplier: { id: string }) {
  const body = {
    requestId: randomUUID(),
    supplierId: supplier.id,
    note: 'Documento ficticio E2E',
    lines: [{ productId: product.id, quantity: '3.125', unitCost: '0.10' }],
  };
  const response = await writeFromBrowser(page, '/api/purchases', body);
  expect(response.status()).toBe(201);
  const record = await response.json();
  createdPurchases.push(record.id);
  return record;
}
async function openPurchase(page: Page, record: { number: string }) {
  await page.goto(`/compras?q=${encodeURIComponent(record.number)}`);
  await page.getByRole('button', { name: `Abrir compra ${record.number}`, exact: true }).click();
}
test('inventario: administra producto, registra ajuste y consulta el movimiento persistente', async ({
  page,
}) => {
  await login(page);
  await page.goto('/inventario');
  await page.getByRole('button', { name: 'Nuevo producto', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const sku = `E2E-${randomUUID().slice(0, 8)}`;
  await dialog.getByLabel('Código SKU *', { exact: true }).fill(sku);
  await dialog
    .getByLabel('Nombre del producto *', { exact: true })
    .fill('Accesorio ficticio del navegador');
  await dialog.getByLabel('Precio de venta (S/) *', { exact: true }).fill('8.75');
  await dialog.getByLabel('Stock mínimo *', { exact: true }).fill('2.5');
  const pending = page.waitForResponse(
    (r) => r.url().endsWith('/api/products') && r.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Guardar ficha', exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(201);
  const product = await response.json();
  createdProducts.push(product.id);
  await expect(dialog).toHaveCount(0);
  await page.getByLabel('Buscar productos', { exact: true }).fill(sku);
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await page.getByRole('button', { name: `Ver producto ${product.sku}`, exact: true }).click();
  await dialog.getByRole('button', { name: 'Ajustar existencias', exact: true }).click();
  await dialog.getByLabel('Variación de unidades *', { exact: true }).fill('4.125');
  await dialog
    .getByLabel('Motivo del ajuste *', { exact: true })
    .fill('Saldo ficticio para el recorrido de prueba');
  await dialog.getByRole('button', { name: 'Registrar ajuste', exact: true }).click();
  await expect(
    dialog.getByText('Saldo ficticio para el recorrido de prueba', { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText('4.125 unidades', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: `Ver producto ${product.sku}`, exact: true }).click();
  await expect(
    dialog.getByText('Saldo ficticio para el recorrido de prueba', { exact: true }),
  ).toBeVisible();
});
test('compras: recepción crea proveedor y borrador, edita y recibe una sola vez', async ({
  page,
}) => {
  await login(page);
  const { product } = await inventoryFixtures(page);
  await logoutUI(page);
  await login(page, 'reception');
  await page.goto('/inventario?tab=suppliers');
  await page.getByRole('button', { name: 'Nuevo proveedor', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const name = `Proveedor navegador ${randomUUID().slice(0, 8)}`;
  await dialog.getByLabel('Nombre del proveedor *', { exact: true }).fill(name);
  await dialog.getByLabel('Teléfono del proveedor', { exact: true }).fill('000000000');
  const supplierSaved = page.waitForResponse(
    (r) => r.url().endsWith('/api/suppliers') && r.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Guardar ficha', exact: true }).click();
  const supplier = await (await supplierSaved).json();
  createdSuppliers.push(supplier.id);
  await expect(dialog).toHaveCount(0);
  await page.goto('/compras');
  await page.getByRole('button', { name: 'Nueva compra', exact: true }).click();
  await dialog.getByLabel('Buscar proveedor *', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: `Seleccionar proveedor ${name}`, exact: true }).click();
  await dialog.getByLabel('Buscar producto *', { exact: true }).fill(product.sku);
  await dialog
    .getByRole('button', { name: `Seleccionar producto ${product.name}`, exact: true })
    .click();
  await dialog.getByLabel(`Cantidad de ${product.sku} *`, { exact: true }).fill('3.125');
  await dialog.getByLabel(`Costo de ${product.sku} (S/) *`, { exact: true }).fill('0.10');
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/api/purchases') && r.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Guardar borrador', exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(201);
  let record = await response.json();
  createdPurchases.push(record.id);
  await expect(page.getByRole('dialog', { name: record.number, exact: true })).toBeVisible();
  expect((await (await page.request.get(`/api/products/${product.id}`)).json()).stock).toBe(
    '0.000',
  );
  await dialog.getByRole('button', { name: 'Editar borrador', exact: true }).click();
  await dialog.getByLabel(`Cantidad de ${product.sku} *`, { exact: true }).fill('4.125');
  await dialog.getByRole('button', { name: 'Guardar borrador', exact: true }).click();
  await expect(page.getByRole('dialog', { name: record.number, exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Recibir compra', exact: true }).click();
  await dialog.getByRole('button', { name: 'Confirmar recepción', exact: true }).click();
  await expect(dialog.getByText('Recibida', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Recibir compra', exact: true })).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: `Abrir compra ${record.number}`, exact: true }).click();
  await expect(dialog.getByText('Recibida', { exact: true })).toBeVisible();
  expect((await (await page.request.get(`/api/products/${product.id}`)).json()).stock).toBe(
    '4.125',
  );
});
test('compras: respuesta perdida después de recibir se reintenta sin duplicar stock', async ({
  page,
}) => {
  await login(page);
  const { product, supplier } = await inventoryFixtures(page);
  const record = await purchaseFixture(page, product, supplier);
  await openPurchase(page, record);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Recibir compra', exact: true }).click();
  const path = `**/api/purchases/${record.id}/receive`;
  await page.route(path, async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await route.abort();
  });
  await dialog.getByRole('button', { name: 'Confirmar recepción', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Tus cambios siguen en el formulario');
  await page.unroute(path);
  const pending = page.waitForResponse((r) =>
    r.url().endsWith(`/api/purchases/${record.id}/receive`),
  );
  await dialog.getByRole('button', { name: 'Confirmar recepción', exact: true }).click();
  const response = await pending;
  expect(response.headers()['idempotent-replay']).toBe('true');
  await expect(dialog.getByText('Recibida', { exact: true })).toBeVisible();
  expect((await (await page.request.get(`/api/products/${product.id}`)).json()).stock).toBe(
    '3.125',
  );
  expect(
    (await (await page.request.get(`/api/products/${product.id}/movements`)).json()).total,
  ).toBe(1);
});
test('compras: respuesta perdida al crear conserva solicitud y guarda un solo borrador', async ({
  page,
}) => {
  await login(page);
  const { product, supplier } = await inventoryFixtures(page);
  await page.goto('/compras');
  await page.getByRole('button', { name: 'Nueva compra', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Buscar proveedor *', { exact: true }).fill(supplier.name);
  await dialog
    .getByRole('button', { name: `Seleccionar proveedor ${supplier.name}`, exact: true })
    .click();
  await dialog.getByLabel('Buscar producto *', { exact: true }).fill(product.sku);
  await dialog
    .getByRole('button', { name: `Seleccionar producto ${product.name}`, exact: true })
    .click();
  let originalId = '';
  await page.route('**/api/purchases', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    originalId = (await response.json()).id;
    createdPurchases.push(originalId);
    await route.abort();
  });
  await dialog.getByRole('button', { name: 'Guardar borrador', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Tus cambios siguen en el formulario');
  await expect(dialog.getByLabel(`Cantidad de ${product.sku} *`, { exact: true })).toBeDisabled();
  await page.unroute('**/api/purchases');
  const pending = page.waitForResponse(
    (r) => r.url().endsWith('/api/purchases') && r.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Reintentar compra', exact: true }).click();
  const response = await pending;
  expect((await response.json()).id).toBe(originalId);
  expect(response.headers()['idempotent-replay']).toBe('true');
  await expect(dialog.getByText('Borrador', { exact: true })).toBeVisible();
});
test('compras móvil: conflicto de edición conserva borrador y permite cancelar sin stock', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const { product, supplier } = await inventoryFixtures(page);
  const record = await purchaseFixture(page, product, supplier);
  await openPurchase(page, record);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Editar borrador', exact: true }).click();
  await dialog.getByLabel('Nota de la compra', { exact: true }).fill('Mi borrador local de compra');
  const updated = await writeFromBrowser(
    page,
    `/api/purchases/${record.id}`,
    {
      supplierId: supplier.id,
      note: 'Modificado desde otra sesión',
      version: 1,
      lines: [{ productId: product.id, quantity: '5', unitCost: '0.10' }],
    },
    'PUT',
  );
  expect(updated.status()).toBe(200);
  await dialog.getByRole('button', { name: 'Guardar borrador', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Otra persona actualizó este registro');
  await expect(dialog.getByLabel('Nota de la compra', { exact: true })).toHaveValue(
    'Mi borrador local de compra',
  );
  await dialog.getByRole('button', { name: 'Recargar ficha actual', exact: true }).click();
  await expect(dialog.getByLabel('Nota de la compra', { exact: true })).toHaveValue(
    'Modificado desde otra sesión',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'Guardar borrador', exact: true }).click();
  await expect(page.getByRole('dialog', { name: record.number, exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancelar borrador', exact: true }).click();
  await expect(dialog.getByText('Cancelada', { exact: true })).toBeVisible();
  expect((await (await page.request.get(`/api/products/${product.id}`)).json()).stock).toBe(
    '0.000',
  );
});
test('inventario: recepción consulta sin editar catálogo y veterinario no accede a compras', async ({
  page,
}) => {
  await login(page, 'reception');
  await page.goto('/inventario');
  await expect(page.getByRole('button', { name: 'Nuevo producto', exact: true })).toHaveCount(0);
  await page
    .getByRole('button', { name: /^Ver producto / })
    .first()
    .click();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Ajustar existencias', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar', exact: true }).click();
  await logoutUI(page);
  await login(page, 'veterinarian');
  await page.goto('/compras');
  await expect(
    page.getByRole('heading', { name: 'Acceso restringido', exact: true }),
  ).toBeVisible();
  expect((await page.request.get('/api/purchases')).status()).toBe(403);
  expect((await page.request.get('/api/suppliers')).status()).toBe(403);
});
test('compras: fallo de lectura muestra error y permite reintentar', async ({ page }) => {
  await login(page);
  await page.route('**/api/purchases?*', (route) =>
    route.fulfill({ status: 503, json: { message: 'Compras temporalmente no disponibles' } }),
  );
  await page.goto('/compras');
  await expect(page.getByRole('alert')).toContainText('Compras temporalmente no disponibles');
  await page.unroute('**/api/purchases?*');
  await page.getByRole('button', { name: 'Intentar nuevamente', exact: true }).click();
  await expect(page.getByRole('columnheader', { name: 'Proveedor', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('compras: muestra centavos exactos también en importes grandes', async ({ page }) => {
  await login(page);
  const { product, supplier } = await inventoryFixtures(page);
  const response = await writeFromBrowser(page, '/api/purchases', {
    requestId: randomUUID(),
    supplierId: supplier.id,
    note: 'Prueba ficticia de precisión',
    lines: [{ productId: product.id, quantity: '999999999', unitCost: '99999.99' }],
  });
  expect(response.status()).toBe(201);
  const record = await response.json();
  createdPurchases.push(record.id);
  expect(record.total).toBe('99999989900000.01');
  await openPurchase(page, record);
  await expect(page.getByRole('dialog').getByText(/99,999,989,900,000\.01/)).toHaveCount(2);
});

async function salesProduct(page: Page, price = '15.50', balance = '3') {
  const r = await writeFromBrowser(page, '/api/products', {
    sku: `SALE-${randomUUID().slice(0, 8)}`,
    name: `Producto ventas ${randomUUID().slice(0, 8)}`,
    categoryId: null,
    salePrice: price,
    minimumStock: '1',
    active: true,
  });
  expect(r.status()).toBe(201);
  const p = await r.json();
  createdProducts.push(p.id);
  const adjustment = await writeFromBrowser(page, `/api/products/${p.id}/adjustments`, {
    requestId: randomUUID(),
    quantity: balance,
    reason: 'Saldo ficticio de la prueba de ventas',
  });
  expect(adjustment.status()).toBe(201);
  return p;
}
async function salesFixture(page: Page, product: { id: string }, quantity = '1') {
  const r = await writeFromBrowser(page, '/api/sales', {
    requestId: randomUUID(),
    clientId: null,
    note: 'Venta ficticia E2E',
    lines: [{ kind: 'product', itemId: product.id, quantity }],
  });
  expect(r.status()).toBe(201);
  const s = await r.json();
  createdSales.push(s.id);
  return s;
}
async function openSale(page: Page, s: { number: string }) {
  await page.goto(`/ventas?q=${encodeURIComponent(s.number)}`);
  await page.getByRole('button', { name: `Abrir venta ${s.number}`, exact: true }).click();
}
async function addSaleProduct(page: Page, p: { sku: string; name: string }) {
  const d = page.getByRole('dialog');
  await d.getByLabel('Buscar producto de venta', { exact: true }).fill(p.sku);
  await d.getByRole('button', { name: `Agregar producto ${p.name}`, exact: true }).click();
}
async function saveSale(page: Page) {
  const pending = page.waitForResponse(
    (r) => r.url().endsWith('/api/sales') && r.request().method() === 'POST',
  );
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Guardar venta', exact: true })
    .click();
  const r = await pending;
  expect(r.status()).toBe(201);
  const s = await r.json();
  createdSales.push(s.id);
  return s;
}
async function confirmSale(page: Page) {
  const pending = page.waitForResponse(
    (r) => /\/api\/sales\/[^/]+\/confirm$/.test(r.url()) && r.request().method() === 'POST',
  );
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirmar venta', exact: true })
    .click();
  return pending;
}
test('ventas: recepción prepara productos y servicios, asocia cliente y confirma cobros combinados', async ({
  page,
}) => {
  await login(page);
  const p = await salesProduct(page);
  const service = (
    await (await page.request.get('/api/sales/items?kind=service&q=Consulta%20general')).json()
  )[0];
  const hex = createHash('md5').update('client:1').digest('hex');
  const clientId = [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
  const client = await (await page.request.get(`/api/clients/${clientId}`)).json();
  await logoutUI(page);
  await login(page, 'reception');
  await page.goto('/ventas');
  await page.getByRole('button', { name: 'Nueva venta', exact: true }).click();
  const d = page.getByRole('dialog');
  await addSaleProduct(page, p);
  await d.getByRole('button', { name: 'Asociar cliente', exact: true }).click();
  await d.getByLabel('Buscar cliente de venta', { exact: true }).fill(client.name);
  await d.getByRole('button', { name: `Agregar cliente ${client.name}`, exact: true }).click();
  await d.getByLabel('Agregar a la venta', { exact: true }).selectOption('service');
  await d.getByLabel('Buscar servicio de venta', { exact: true }).fill(service.name);
  await d.getByRole('button', { name: `Agregar servicio ${service.name}`, exact: true }).click();
  const s = await saveSale(page);
  expect(s.clientId).toBe(client.id);
  expect(s.total).toBe('65.50');
  await expect(page.getByRole('dialog', { name: s.number, exact: true })).toBeVisible();
  await d.getByRole('button', { name: 'Editar venta', exact: true }).click();
  await d.getByLabel(`Cantidad de ${p.sku} *`, { exact: true }).fill('2');
  await d.getByRole('button', { name: 'Guardar venta', exact: true }).click();
  await expect(page.getByRole('dialog', { name: s.number, exact: true })).toBeVisible();
  await d.getByRole('button', { name: 'Registrar cobros y confirmar', exact: true }).click();
  await d.getByLabel('Medio de pago 1 *', { exact: true }).selectOption('cash');
  await d.getByLabel('Importe del pago 1 (S/) *', { exact: true }).fill('31.00');
  await d.getByRole('button', { name: 'Agregar otro pago', exact: true }).click();
  await d.getByLabel('Medio de pago 2 *', { exact: true }).selectOption('transfer');
  await d.getByLabel('Importe del pago 2 (S/) *', { exact: true }).fill('50.00');
  await d.getByLabel('Referencia del pago 2 *', { exact: true }).fill('TRANSFERENCIA-FICTICIA-01');
  const confirmed = await confirmSale(page);
  expect(confirmed.status()).toBe(200);
  await expect(d.getByText('Confirmada', { exact: true })).toBeVisible();
  await expect(d.getByText('Transferencia', { exact: true })).toBeVisible();
  expect((await (await page.request.get(`/api/products/${p.id}`)).json()).stock).toBe('1.000');
  await page.reload();
  await page.getByRole('button', { name: `Abrir venta ${s.number}`, exact: true }).click();
  await expect(d.getByText('TRANSFERENCIA-FICTICIA-01', { exact: false })).toBeVisible();
  await page.goto(`/clientes?q=${encodeURIComponent(client.name)}`);
  await page.getByRole('button', { name: `Ver ficha de ${client.name}`, exact: true }).click();
  await d.getByRole('link', { name: 'Ver ventas', exact: true }).click();
  await expect(page.getByText(`Ventas de ${client.name}`, { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: `Abrir venta ${s.number}`, exact: true }),
  ).toBeVisible();
});
test('ventas: stock insuficiente no registra cobros y permite corregir el borrador', async ({
  page,
}) => {
  await login(page);
  const p = await salesProduct(page, '15.50', '1'),
    s = await salesFixture(page, p, '2');
  await openSale(page, s);
  const d = page.getByRole('dialog');
  await d.getByRole('button', { name: 'Registrar cobros y confirmar', exact: true }).click();
  await d.getByLabel('Medio de pago 1 *', { exact: true }).selectOption('cash');
  const failed = await confirmSale(page);
  expect(failed.status()).toBe(409);
  await expect(d.getByRole('alert')).toContainText('Stock insuficiente');
  let saved = await (await page.request.get(`/api/sales/${s.id}`)).json();
  expect(saved.status).toBe('draft');
  expect(saved.payments).toHaveLength(0);
  await d.getByRole('button', { name: 'Volver', exact: true }).click();
  await d.getByRole('button', { name: 'Editar venta', exact: true }).click();
  await d.getByLabel(`Cantidad de ${p.sku} *`, { exact: true }).fill('1');
  await d.getByRole('button', { name: 'Guardar venta', exact: true }).click();
  await expect(page.getByRole('dialog', { name: s.number, exact: true })).toBeVisible();
  await d.getByRole('button', { name: 'Registrar cobros y confirmar', exact: true }).click();
  await d.getByLabel('Medio de pago 1 *', { exact: true }).selectOption('cash');
  expect((await confirmSale(page)).status()).toBe(200);
  await expect(d.getByText('Confirmada', { exact: true })).toBeVisible();
  expect((await (await page.request.get(`/api/products/${p.id}`)).json()).stock).toBe('0.000');
});
test('ventas móvil: cobros deben cuadrar y transferencia requiere referencia', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const p = await salesProduct(page),
    s = await salesFixture(page, p);
  await openSale(page, s);
  const d = page.getByRole('dialog');
  await d.getByRole('button', { name: 'Registrar cobros y confirmar', exact: true }).click();
  await d.getByLabel('Medio de pago 1 *', { exact: true }).selectOption('cash');
  await d.getByLabel('Importe del pago 1 (S/) *', { exact: true }).fill('15.49');
  expect((await confirmSale(page)).status()).toBe(400);
  await expect(d.getByRole('alert')).toContainText('La suma de los cobros');
  await d.getByLabel('Medio de pago 1 *', { exact: true }).selectOption('transfer');
  await expect(d.getByLabel('Referencia del pago 1 *', { exact: true })).toHaveAttribute(
    'required',
    '',
  );
  await d.getByLabel('Referencia del pago 1 *', { exact: true }).fill('OPERACION-FICTICIA');
  await d.getByLabel('Importe del pago 1 (S/) *', { exact: true }).fill('15.50');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await confirmSale(page)).status()).toBe(200);
  await expect(d.getByText('Confirmada', { exact: true })).toBeVisible();
});
test('ventas: respuesta perdida al confirmar no duplica cobros ni salidas', async ({ page }) => {
  await login(page);
  const p = await salesProduct(page),
    s = await salesFixture(page, p);
  await openSale(page, s);
  const d = page.getByRole('dialog');
  await d.getByRole('button', { name: 'Registrar cobros y confirmar', exact: true }).click();
  await d.getByLabel('Medio de pago 1 *', { exact: true }).selectOption('cash');
  const path = `**/api/sales/${s.id}/confirm`;
  await page.route(path, async (route) => {
    const r = await route.fetch();
    expect(r.status()).toBe(200);
    await route.abort();
  });
  await d.getByRole('button', { name: 'Confirmar venta', exact: true }).click();
  await expect(d.getByRole('alert')).toContainText('Tus cambios siguen en el formulario');
  await expect(d.getByLabel('Importe del pago 1 (S/) *', { exact: true })).toBeDisabled();
  await page.unroute(path);
  const pending = page.waitForResponse((r) => r.url().endsWith(`/api/sales/${s.id}/confirm`));
  await d.getByRole('button', { name: 'Reintentar confirmación', exact: true }).click();
  const r = await pending;
  expect(r.headers()['idempotent-replay']).toBe('true');
  await expect(d.getByText('Confirmada', { exact: true })).toBeVisible();
  const saved = await (await page.request.get(`/api/sales/${s.id}`)).json();
  expect(saved.payments).toHaveLength(1);
  expect(saved.version).toBe(2);
  expect((await (await page.request.get(`/api/products/${p.id}`)).json()).stock).toBe('2.000');
  const movements = await (await page.request.get(`/api/products/${p.id}/movements`)).json();
  expect(movements.items.filter((m: { kind: string }) => m.kind === 'sale')).toHaveLength(1);
});
test('ventas: respuesta perdida al crear conserva una sola venta', async ({ page }) => {
  await login(page);
  const p = await salesProduct(page);
  await page.goto('/ventas');
  await page.getByRole('button', { name: 'Nueva venta', exact: true }).click();
  await addSaleProduct(page, p);
  const d = page.getByRole('dialog');
  let id = '';
  await page.route('**/api/sales', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const r = await route.fetch();
    expect(r.status()).toBe(201);
    id = (await r.json()).id;
    createdSales.push(id);
    await route.abort();
  });
  await d.getByRole('button', { name: 'Guardar venta', exact: true }).click();
  await expect(d.getByRole('alert')).toContainText('Tus cambios siguen en el formulario');
  await expect(d.getByLabel(`Cantidad de ${p.sku} *`, { exact: true })).toBeDisabled();
  await page.unroute('**/api/sales');
  const pending = page.waitForResponse(
    (r) => r.url().endsWith('/api/sales') && r.request().method() === 'POST',
  );
  await d.getByRole('button', { name: 'Reintentar venta', exact: true }).click();
  const r = await pending;
  expect(r.headers()['idempotent-replay']).toBe('true');
  expect((await r.json()).id).toBe(id);
  await expect(d.getByText('Borrador', { exact: true })).toBeVisible();
  expect((await (await page.request.get(`/api/products/${p.id}`)).json()).stock).toBe('3.000');
});
test('ventas: conflicto conserva edición y cancelar no mueve stock', async ({ page }) => {
  await login(page);
  const p = await salesProduct(page),
    s = await salesFixture(page, p);
  await openSale(page, s);
  const d = page.getByRole('dialog');
  await d.getByRole('button', { name: 'Editar venta', exact: true }).click();
  await d.getByLabel('Nota de la venta', { exact: true }).fill('Borrador de venta sin perder');
  const r = await writeFromBrowser(
    page,
    `/api/sales/${s.id}`,
    {
      clientId: null,
      note: 'Actualizado en otra sesión',
      version: 1,
      lines: [{ kind: 'product', itemId: p.id, quantity: '2' }],
    },
    'PUT',
  );
  expect(r.status()).toBe(200);
  await d.getByRole('button', { name: 'Guardar venta', exact: true }).click();
  await expect(d.getByRole('alert')).toContainText('Otra persona actualizó este registro');
  await expect(d.getByLabel('Nota de la venta', { exact: true })).toHaveValue(
    'Borrador de venta sin perder',
  );
  await d.getByRole('button', { name: 'Recargar ficha actual', exact: true }).click();
  await expect(d.getByLabel('Nota de la venta', { exact: true })).toHaveValue(
    'Actualizado en otra sesión',
  );
  await d.getByRole('button', { name: 'Guardar venta', exact: true }).click();
  await expect(page.getByRole('dialog', { name: s.number, exact: true })).toBeVisible();
  await d.getByRole('button', { name: 'Cancelar venta', exact: true }).click();
  await expect(d.getByText('Cancelada', { exact: true })).toBeVisible();
  expect((await (await page.request.get(`/api/products/${p.id}`)).json()).stock).toBe('3.000');
});
test('ventas: veterinario no recibe datos de ventas ni búsquedas comerciales', async ({ page }) => {
  await login(page, 'veterinarian');
  await expect(page.getByRole('link', { name: 'Ventas', exact: true })).toHaveCount(0);
  await page.goto('/ventas');
  await expect(
    page.getByRole('heading', { name: 'Acceso restringido', exact: true }),
  ).toBeVisible();
  for (const path of [
    '/api/sales',
    '/api/sales/items?kind=product&q=NV',
    '/api/sales/clients?q=Demo',
  ])
    expect((await page.request.get(path)).status()).toBe(403);
});
test('ventas: lectura fallida informa y permite reintentar', async ({ page }) => {
  await login(page);
  await page.route('**/api/sales?*', (route) =>
    route.fulfill({ status: 503, json: { message: 'Ventas temporalmente no disponibles' } }),
  );
  await page.goto('/ventas');
  await expect(page.getByRole('alert')).toContainText('Ventas temporalmente no disponibles');
  await page.unroute('**/api/sales?*');
  await page.getByRole('button', { name: 'Intentar nuevamente', exact: true }).click();
  await expect(page.getByRole('columnheader', { name: 'Conceptos', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
test('ventas: total cero confirma sin cobros y descuenta el producto', async ({ page }) => {
  await login(page);
  const p = await salesProduct(page, '0.00'),
    s = await salesFixture(page, p);
  await openSale(page, s);
  const d = page.getByRole('dialog');
  await d.getByRole('button', { name: 'Registrar cobros y confirmar', exact: true }).click();
  await expect(
    d.getByText('El total es cero. La venta se confirmará sin cobros.', { exact: true }),
  ).toBeVisible();
  await expect(d.getByLabel('Medio de pago 1 *', { exact: true })).toHaveCount(0);
  expect((await confirmSale(page)).status()).toBe(200);
  await expect(d.getByText('Venta con total cero, sin cobros.', { exact: true })).toBeVisible();
  expect((await (await page.request.get(`/api/products/${p.id}`)).json()).stock).toBe('2.000');
});

test('reportes: período sin operaciones, gráfico interactivo y descarga CSV real', async ({
  page,
}) => {
  await login(page);
  await expect(
    page.getByRole('region', { name: 'Indicadores administrativos de hoy', exact: true }),
  ).toBeVisible();
  let releaseOptions: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseOptions = resolve;
  });
  await page.route('**/api/reports/options', async (route) => {
    await gate;
    await route.continue();
  });
  await page.getByRole('link', { name: 'Reportes', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Reportes operativos', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Reporte desde', { exact: true }).fill('2000-01-01');
  await page.getByLabel('Reporte hasta', { exact: true }).fill('2000-01-02');
  const optionsResponse = page.waitForResponse(
    (r) => r.url().endsWith('/api/reports/options') && r.status() === 200,
  );
  releaseOptions();
  await optionsResponse;
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(page.getByLabel('Reporte desde', { exact: true })).toHaveValue('2000-01-01');
  await expect(page.getByLabel('Reporte hasta', { exact: true })).toHaveValue('2000-01-02');
  const pending = page.waitForResponse(
    (r) => r.url().includes('/api/reports/operations?') && r.url().includes('from=2000-01-01'),
  );
  await page.getByRole('button', { name: 'Actualizar reporte', exact: true }).click();
  const r = await pending;
  expect(r.status()).toBe(200);
  expect((await r.json()).financial.salesTotal).toBe('0.00');
  await page.getByRole('button', { name: 'Ver día 2000-01-01', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('2000-01-01 · 0 ventas confirmadas');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar CSV', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('nexovet-reporte-2000-01-01-2000-01-02.csv');
  const text = await readFile((await download.path())!, 'utf8');
  expect(text).toContain('"Total confirmado PEN","0.00"');
  expect(text).toContain('"2000-01-01"');
  expect(text).not.toMatch(/password_hash|token_hash/);
});
test('administración: crea categoría y servicio, y los cambios llegan al catálogo operativo', async ({
  page,
}) => {
  test.setTimeout(60000);
  await login(page);
  await page.goto('/administracion?tab=categories');
  await page.getByRole('button', { name: 'Nueva categoría', exact: true }).click();
  const d = page.getByRole('dialog'),
    name = `Categoría E2E ${randomUUID().slice(0, 8)}`;
  await d.getByLabel('Nombre de la categoría *', { exact: true }).fill(name);
  const categorySaved = page.waitForResponse(
    (r) => r.url().endsWith('/api/admin/categories') && r.request().method() === 'POST',
  );
  await d.getByRole('button', { name: 'Guardar configuración', exact: true }).click();
  const category = await (await categorySaved).json();
  createdConfigCategories.push(category.id);
  await expect(d).toHaveCount(0);
  await page.getByRole('button', { name: `Editar categoría ${name}`, exact: true }).click();
  await d.getByLabel('Nombre de la categoría *', { exact: true }).fill(name + ' revisada');
  await d.getByRole('button', { name: 'Guardar configuración', exact: true }).click();
  await expect(d).toHaveCount(0);
  expect(
    (await (await page.request.get('/api/inventory/categories')).json()).find(
      (c: { id: string }) => c.id === category.id,
    ).name,
  ).toBe(name + ' revisada');
  await page.getByRole('button', { name: 'Servicios', exact: true }).click();
  await page.getByRole('button', { name: 'Nuevo servicio', exact: true }).click();
  const serviceName = `Consulta E2E ${randomUUID().slice(0, 8)}`;
  await d.getByLabel('Nombre del servicio *', { exact: true }).fill(serviceName);
  await d.getByLabel('Duración (minutos) *', { exact: true }).fill('45');
  await d.getByLabel('Precio del servicio (S/) *', { exact: true }).fill('29.90');
  const serviceSaved = page.waitForResponse(
    (r) => r.url().endsWith('/api/admin/services') && r.request().method() === 'POST',
  );
  await d.getByRole('button', { name: 'Guardar configuración', exact: true }).click();
  const service = await (await serviceSaved).json();
  createdConfigServices.push(service.id);
  await expect(d).toHaveCount(0);
  expect(
    (await (await page.request.get('/api/agenda/options')).json()).services.find(
      (s: { id: string }) => s.id === service.id,
    ).durationMinutes,
  ).toBe(45);
  await page.getByRole('button', { name: `Editar servicio ${serviceName}`, exact: true }).click();
  await d.getByLabel('Estado del servicio', { exact: true }).selectOption('false');
  await d.getByRole('button', { name: 'Guardar configuración', exact: true }).click();
  await expect(d).toHaveCount(0);
  await page.getByLabel('Estado de configuración', { exact: true }).selectOption('archived');
  await page.getByRole('button', { name: `Editar servicio ${serviceName}`, exact: true }).click();
  await d.getByLabel('Estado del servicio', { exact: true }).selectOption('true');
  await d.getByLabel('Precio del servicio (S/) *', { exact: true }).fill('39.90');
  await d.getByRole('button', { name: 'Guardar configuración', exact: true }).click();
  await expect(d).toHaveCount(0);
  const items = await (
    await page.request.get(`/api/sales/items?kind=service&q=${encodeURIComponent(serviceName)}`)
  ).json();
  expect(items.find((s: { id: string }) => s.id === service.id).price).toBe('39.90');
});
test('cuentas: crea acceso, cambia rol, revoca sesión y permite reactivar al integrante', async ({
  page,
  browser,
}) => {
  test.setTimeout(60000);
  await login(page);
  await page.goto('/administracion');
  await page.getByRole('button', { name: 'Nueva cuenta', exact: true }).click();
  const d = page.getByRole('dialog'),
    email = `equipo-e2e-${randomUUID()}@example.invalid`,
    secret = 'Contraseña ficticia de equipo 2026';
  await d
    .getByLabel('Nombre del integrante *', { exact: true })
    .fill(`Integrante E2E ${randomUUID().slice(0, 8)}`);
  await d.getByLabel('Correo de acceso *', { exact: true }).fill(email);
  await d.getByLabel('Contraseña inicial *', { exact: true }).fill(secret);
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/api/admin/users') && r.request().method() === 'POST',
  );
  await d.getByRole('button', { name: 'Guardar cuenta', exact: true }).click();
  const user = await (await saved).json();
  createdConfigUsers.push(user.id);
  await expect(d).toHaveCount(0);
  await page.getByLabel('Buscar integrantes', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' });
  try {
    const staff = await context.newPage();
    async function enter() {
      await staff.goto('/');
      await staff.getByLabel('Correo electrónico', { exact: true }).fill(email);
      await staff.getByLabel('Contraseña', { exact: true }).fill(secret);
      await staff.getByRole('button', { name: 'Ingresar', exact: true }).click();
      await expect(
        staff.getByRole('heading', { name: 'Todo listo para recibirlos.' }),
      ).toBeVisible();
    }
    await enter();
    await expect(staff.getByRole('link', { name: 'Reportes', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: `Editar cuenta ${email}`, exact: true }).click();
    await d.getByLabel('Rol del equipo *', { exact: true }).selectOption('veterinarian');
    await d.getByRole('button', { name: 'Guardar cuenta', exact: true }).click();
    await expect(d).toHaveCount(0);
    expect((await staff.request.get('/api/auth/session')).status()).toBe(401);
    await page.getByRole('button', { name: `Editar cuenta ${email}`, exact: true }).click();
    await d.getByLabel('Permitir ingreso', { exact: true }).uncheck();
    await d.getByRole('button', { name: 'Guardar cuenta', exact: true }).click();
    await expect(d).toHaveCount(0);
    expect(
      (await (await page.request.get(`/api/admin/users/${user.id}`)).json()).loginEnabled,
    ).toBe(false);
    await page.getByRole('button', { name: `Editar cuenta ${email}`, exact: true }).click();
    await d.getByLabel('Permitir ingreso', { exact: true }).check();
    await d.getByRole('button', { name: 'Guardar cuenta', exact: true }).click();
    await expect(d).toHaveCount(0);
    await enter();
    await expect(staff.getByRole('link', { name: 'Ventas', exact: true })).toHaveCount(0);
    expect((await staff.request.get('/api/sales')).status()).toBe(403);
  } finally {
    await context.close();
  }
});
test('administrador conserva su propio acceso y la API rechaza deshabilitarlo', async ({
  page,
}) => {
  await login(page);
  const session = await (await page.request.get('/api/auth/session')).json();
  await page.goto('/administracion');
  await page
    .getByRole('button', { name: `Editar cuenta ${session.user.email}`, exact: true })
    .click();
  const d = page.getByRole('dialog');
  await expect(d.getByLabel('Rol del equipo *', { exact: true })).toBeDisabled();
  await expect(d.getByLabel('Cuenta activa', { exact: true })).toBeDisabled();
  await expect(d.getByLabel('Permitir ingreso', { exact: true })).toBeDisabled();
  const user = await (await page.request.get(`/api/admin/users/${session.user.id}`)).json();
  const response = await writeFromBrowser(
    page,
    `/api/admin/users/${user.id}`,
    {
      name: user.name,
      role: 'reception',
      active: true,
      loginEnabled: true,
      password: null,
      version: user.version,
    },
    'PUT',
  );
  expect(response.status()).toBe(409);
  expect((await page.request.get('/api/auth/session')).status()).toBe(200);
});
test('configuración móvil: conflicto conserva el borrador del servicio y recarga explícitamente', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const body = {
    name: `Servicio conflicto ${randomUUID().slice(0, 8)}`,
    durationMinutes: 30,
    price: '11.11',
    active: true,
  };
  const response = await writeFromBrowser(page, '/api/admin/services', body);
  expect(response.status()).toBe(201);
  const service = await response.json();
  createdConfigServices.push(service.id);
  await page.goto(`/administracion?tab=services&q=${encodeURIComponent(service.name)}`);
  await page.getByRole('button', { name: `Editar servicio ${service.name}`, exact: true }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Precio del servicio (S/) *', { exact: true }).fill('22.22');
  expect(
    (
      await writeFromBrowser(
        page,
        `/api/admin/services/${service.id}`,
        { ...body, price: '33.33', version: 1 },
        'PUT',
      )
    ).status(),
  ).toBe(200);
  await d.getByRole('button', { name: 'Guardar configuración', exact: true }).click();
  await expect(d.getByRole('alert')).toContainText('Otra persona actualizó este registro');
  await expect(d.getByLabel('Precio del servicio (S/) *', { exact: true })).toHaveValue('22.22');
  await d.getByRole('button', { name: 'Recargar ficha actual', exact: true }).click();
  await expect(d.getByLabel('Precio del servicio (S/) *', { exact: true })).toHaveValue('33.33');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await d.getByRole('button', { name: 'Guardar configuración', exact: true }).click();
  await expect(d).toHaveCount(0);
});
test('negocio: conflicto conserva cambios y guardar actualiza el nombre en la navegación', async ({
  page,
}) => {
  await login(page);
  const original = await (await page.request.get('/api/admin/business')).json();
  const external = `NexoVet E2E externo ${randomUUID().slice(0, 8)}`,
    finalName = `NexoVet E2E ${randomUUID().slice(0, 8)}`;
  ownedBusinessNames.add(external);
  ownedBusinessNames.add(finalName);
  try {
    await page.goto('/administracion?tab=business');
    await page
      .getByLabel('Nombre del negocio *', { exact: true })
      .fill('Borrador local que debo conservar');
    expect(
      (
        await writeFromBrowser(
          page,
          '/api/admin/business',
          { name: external, address: original.address, version: original.version },
          'PUT',
        )
      ).status(),
    ).toBe(200);
    await page.getByRole('button', { name: 'Guardar negocio', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Otra persona actualizó este registro');
    await expect(page.getByLabel('Nombre del negocio *', { exact: true })).toHaveValue(
      'Borrador local que debo conservar',
    );
    await page.getByRole('button', { name: 'Recargar ficha actual', exact: true }).click();
    await expect(page.getByLabel('Nombre del negocio *', { exact: true })).toHaveValue(external);
    await page.getByLabel('Nombre del negocio *', { exact: true }).fill(finalName);
    await page.getByRole('button', { name: 'Guardar negocio', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Datos del negocio guardados');
    await expect(
      page
        .getByRole('complementary', { name: 'Navegación principal' })
        .getByText(finalName, { exact: true }),
    ).toBeVisible();
  } finally {
    const current = await (await page.request.get('/api/admin/business')).json();
    if (ownedBusinessNames.has(current.name))
      expect(
        (
          await writeFromBrowser(
            page,
            '/api/admin/business',
            { name: original.name, address: original.address, version: current.version },
            'PUT',
          )
        ).status(),
      ).toBe(200);
  }
});
test('auditoría: encuentra cambios de una categoría y filtra el historial del registro', async ({
  page,
}) => {
  await login(page);
  const name = `Auditoría E2E ${randomUUID().slice(0, 8)}`,
    response = await writeFromBrowser(page, '/api/admin/categories', { name });
  expect(response.status()).toBe(201);
  const category = await response.json();
  createdConfigCategories.push(category.id);
  expect(
    (
      await writeFromBrowser(
        page,
        `/api/admin/categories/${category.id}`,
        { name: name + ' revisada', version: 1 },
        'PUT',
      )
    ).status(),
  ).toBe(200);
  const options = await (await page.request.get('/api/reports/options')).json();
  const tomorrow = new Date(Date.parse(options.today + 'T12:00:00Z') + 86400000)
    .toISOString()
    .slice(0, 10);
  await page.goto(`/administracion?tab=audit&q=${category.id}&from=${options.from}&to=${tomorrow}`);
  await expect(
    page.getByRole('cell', { name: 'settings.category_updated', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'settings.category_created', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: `Ver historial del registro ${category.id}`, exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`entityId=${category.id}`));
  await expect(
    page.getByRole('button', { name: 'Quitar filtro de registro', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('password_hash', { exact: false })).toHaveCount(0);
});
test('reportes y auditoría: recepción y veterinarios no acceden por URL ni API', async ({
  page,
}) => {
  for (const role of ['reception', 'veterinarian']) {
    await login(page, role);
    await expect(
      page.getByRole('region', { name: 'Indicadores administrativos de hoy', exact: true }),
    ).toHaveCount(0);
    await page.goto('/reportes');
    await expect(
      page.getByRole('heading', { name: 'Acceso restringido', exact: true }),
    ).toBeVisible();
    expect((await page.request.get('/api/reports/operations')).status()).toBe(403);
    await page.goto('/administracion?tab=audit');
    await expect(
      page.getByRole('heading', { name: 'Acceso restringido', exact: true }),
    ).toBeVisible();
    expect((await page.request.get('/api/admin/audit')).status()).toBe(403);
    await logoutUI(page);
  }
});
test('reportes: fallo de lectura y de exportación se muestran y permiten reintentar', async ({
  page,
}) => {
  await login(page);
  await page.route('**/api/reports/operations?*', (route) =>
    route.fulfill({ status: 503, json: { message: 'Reportes temporalmente no disponibles' } }),
  );
  await page.goto('/reportes');
  await expect(page.getByRole('alert')).toContainText('Reportes temporalmente no disponibles');
  await expect(page.getByText('Ventas confirmadas', { exact: true })).toHaveCount(0);
  await page.unroute('**/api/reports/operations?*');
  await page.getByRole('button', { name: 'Intentar nuevamente', exact: true }).click();
  await expect(page.getByText('Ventas confirmadas', { exact: true })).toBeVisible();
  await page.getByLabel('Reporte desde', { exact: true }).fill('2020-01-01');
  await page.getByLabel('Reporte hasta', { exact: true }).fill('2026-01-01');
  await page.getByRole('button', { name: 'Actualizar reporte', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('máximo 366 días');
  await page.getByLabel('Reporte desde', { exact: true }).fill('2000-01-01');
  await page.getByLabel('Reporte hasta', { exact: true }).fill('2000-01-01');
  await page.getByRole('button', { name: 'Actualizar reporte', exact: true }).click();
  await expect(page.getByText('Ventas confirmadas', { exact: true })).toBeVisible();
  await page.route('**/api/reports/operations.csv?*', (route) =>
    route.fulfill({ status: 503, json: { message: 'Exportación no disponible' } }),
  );
  await page.getByRole('button', { name: 'Exportar CSV', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Exportación no disponible');
});
