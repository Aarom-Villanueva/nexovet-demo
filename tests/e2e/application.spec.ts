import { test, expect, type Page } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { assertDevelopmentDatabase, parseConfig } from '../../apps/api/src/config';

const root = fileURLToPath(new URL('../../', import.meta.url));
assertDevelopmentDatabase(process.env);
const databaseUrl = parseConfig(process.env).DATABASE_URL;
const database = new URL(databaseUrl).pathname.slice(1);
const credentials: { accounts: Array<{ email: string; role: string; password: string }> } =
  JSON.parse(await readFile(`${root}/.local/demo-credentials-${database}.json`, 'utf8'));
test.beforeAll(async () => {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    if (!(await pool.query('SELECT 1 FROM business_settings WHERE is_demo')).rowCount)
      throw new Error('E2E requiere una veterinaria ficticia');
    // Aísla la repetición de la suite; no modifica límites de cuentas reales.
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
    await page.getByLabel('Correo electrónico', { exact: true }).fill(email);
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
