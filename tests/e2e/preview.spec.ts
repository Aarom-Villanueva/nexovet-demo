import { test, expect } from '@playwright/test';

test('recorre la vista previa con datos de PostgreSQL', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Todo listo para recibirlos.' })).toBeVisible();
  await expect(page.getByText('320', { exact: true })).toBeVisible();
  await expect(page.getByText('400', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Revisar agenda' }).click();
  await expect(page).toHaveURL(/\/agenda$/);
  await expect(page.getByRole('heading', { name: 'Agenda de hoy' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Consulta general' }).first()).toBeVisible();
  await page.getByRole('link', { name: 'Clientes y mascotas' }).click();
  await expect(page.getByRole('heading', { name: 'Clientes', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mascotas', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Inventario', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'NV-0001', exact: true })).toBeVisible();
  await expect(page.getByText('Stock bajo', { exact: true }).first()).toBeVisible();
  await page.getByRole('link', { name: 'Compras', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Compras, en preparación' })).toBeVisible();
});
test('muestra el error de conexión y permite reintentar sin inventar métricas', async ({
  page,
}) => {
  await page.route('**/api/demo/overview', (route) =>
    route.fulfill({ status: 503, json: { message: 'No disponible' } }),
  );
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'No pudimos cargar la vista previa' }),
  ).toBeVisible();
  await expect(page.getByText('320', { exact: true })).toHaveCount(0);
  await page.unroute('**/api/demo/overview');
  await page.getByRole('button', { name: 'Intentar nuevamente' }).click();
  await expect(page.getByRole('heading', { name: 'Todo listo para recibirlos.' })).toBeVisible();
});
test('navegación móvil y tablas no desbordan el documento', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Todo listo para recibirlos.' })).toBeVisible();
  await page.getByRole('button', { name: 'Abrir menú' }).click();
  await page.getByRole('link', { name: 'Clientes y mascotas' }).click();
  await expect(page.getByRole('heading', { name: 'Clientes', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Abrir menú' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
});
