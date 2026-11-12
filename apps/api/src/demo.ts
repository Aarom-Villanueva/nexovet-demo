import type { DemoOverview, Role } from '@nexovet/shared';
import type { Pool } from 'pg';

// Los datos se filtran aquí, antes de salir de la API; no basta con ocultar el menú.
export async function getDemoOverview(
  pool: Pool,
  role: Role = 'admin',
): Promise<DemoOverview | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const business = await client.query<{ name: string; today: string; is_demo: boolean }>(
      "SELECT name,is_demo, to_char(now() AT TIME ZONE timezone, 'YYYY-MM-DD') AS today FROM business_settings",
    );
    if (!business.rows[0]) {
      await client.query('COMMIT');
      return null;
    }
    const { name, today } = business.rows[0];
    const totals = await client.query<DemoOverview['totals']>(
      `SELECT
      (SELECT count(*)::int FROM clients) AS clients,
      (SELECT count(*)::int FROM pets) AS pets,
      (SELECT count(*)::int FROM products) AS products,
      (SELECT count(*)::int FROM appointments WHERE (starts_at AT TIME ZONE 'America/Lima')::date=$1::date) AS "appointmentsToday",
      (SELECT count(*)::int FROM follow_up_tasks WHERE status='pending') AS "pendingTasks"`,
      [today],
    );
    const appointments = await client.query<DemoOverview['appointments'][number]>(
      `SELECT a.id,p.name AS pet,c.name AS owner,s.name AS service,u.name AS professional,a.starts_at::text AS "startsAt",a.status
      FROM appointments a JOIN pets p ON p.id=a.pet_id JOIN clients c ON c.id=p.client_id JOIN services s ON s.id=a.service_id JOIN users u ON u.id=a.professional_id
      WHERE (a.starts_at AT TIME ZONE 'America/Lima')::date=$1::date ORDER BY a.starts_at,p.name LIMIT 8`,
      [today],
    );
    const clients =
      role === 'veterinarian'
        ? { rows: [] }
        : await client.query<DemoOverview['clients'][number]>(
            'SELECT c.id,c.name,c.email,count(p.id)::int AS pets FROM clients c LEFT JOIN pets p ON p.client_id=c.id GROUP BY c.id ORDER BY c.name LIMIT 12',
          );
    const pets = await client.query<DemoOverview['pets'][number]>(
      'SELECT p.id,p.name,p.species,c.name AS owner FROM pets p JOIN clients c ON c.id=p.client_id ORDER BY p.name,p.id LIMIT 12',
    );
    const products =
      role === 'veterinarian'
        ? { rows: [] }
        : await client.query<DemoOverview['products'][number]>(
            'SELECT p.id,p.sku,p.name,p.sale_price::text AS price,s.quantity::text AS stock,p.minimum_stock::text AS "minimumStock" FROM products p JOIN product_stock s ON s.product_id=p.id ORDER BY p.sku LIMIT 12',
          );
    const tasks = await client.query<DemoOverview['tasks'][number]>(
      'SELECT t.id,t.title,c.name AS client,t.due_at::text AS "dueAt",t.status FROM follow_up_tasks t JOIN clients c ON c.id=t.client_id ORDER BY t.due_at,t.id LIMIT 12',
    );
    await client.query('COMMIT');
    return {
      demo: business.rows[0].is_demo,
      businessName: name,
      today,
      totals: {
        ...totals.rows[0]!,
        products: role === 'veterinarian' ? null : totals.rows[0]!.products,
      },
      appointments: appointments.rows,
      clients: clients.rows,
      pets: pets.rows,
      products: products.rows,
      tasks: tasks.rows,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
