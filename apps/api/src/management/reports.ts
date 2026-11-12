import type { Pool, PoolClient } from 'pg';
import type { OperationsReport } from '@nexovet/shared';
import { tx, iso } from '../inventory/repository.js';
import { bounds } from './validation.js';
export async function report(pool: Pool, from: string, to: string): Promise<OperationsReport> {
  return tx(
    pool,
    async (c) => {
      const args = bounds(from, to);
      const header = (
        await c.query<{ businessName: string; generatedAt: string }>(
          `SELECT name AS "businessName",${iso('now()')} AS "generatedAt" FROM business_settings`,
        )
      ).rows[0]!;
      const financial = (
        await c.query<OperationsReport['financial']>(
          `SELECT
 (SELECT count(*)::int FROM sales WHERE status='confirmed' AND confirmed_at>=$1 AND confirmed_at<$2) AS "confirmedSales",
 (SELECT coalesce(sum(l.line_total),0)::numeric(30,2)::text FROM sale_lines l JOIN sales s ON s.id=l.sale_id WHERE s.status='confirmed' AND s.confirmed_at>=$1 AND s.confirmed_at<$2) AS "salesTotal",
 (SELECT count(*)::int FROM payments p JOIN sales s ON s.id=p.sale_id WHERE s.status='confirmed' AND p.paid_at>=$1 AND p.paid_at<$2) AS "paymentCount",
 (SELECT coalesce(sum(p.amount),0)::numeric(30,2)::text FROM payments p JOIN sales s ON s.id=p.sale_id WHERE s.status='confirmed' AND p.paid_at>=$1 AND p.paid_at<$2) AS "paymentsTotal",
 (SELECT count(*)::int FROM purchase_orders WHERE status='received' AND received_at>=$1 AND received_at<$2) AS "receivedPurchases",
 (SELECT coalesce(sum(l.line_total),0)::numeric(30,2)::text FROM purchase_order_lines l JOIN purchase_orders o ON o.id=l.purchase_order_id WHERE o.status='received' AND o.received_at>=$1 AND o.received_at<$2) AS "purchasesTotal"`,
          args,
        )
      ).rows[0]!;
      const activity = (
        await c.query<OperationsReport['activity']>(
          `SELECT
 (SELECT count(*)::int FROM appointments WHERE starts_at>=$1 AND starts_at<$2) AS appointments,
 (SELECT count(*)::int FROM encounters WHERE closed_at>=$1 AND closed_at<$2) AS "closedEncounters",
 (SELECT count(*)::int FROM clients WHERE created_at>=$1 AND created_at<$2) AS "newClients",
 (SELECT count(*)::int FROM pets WHERE created_at>=$1 AND created_at<$2) AS "newPets"`,
          args,
        )
      ).rows[0]!;
      const followups = (
        await c.query<OperationsReport['followups']>(
          `SELECT count(*) FILTER(WHERE status='pending')::int AS pending,count(*) FILTER(WHERE status='completed')::int AS completed,count(*) FILTER(WHERE status='cancelled')::int AS cancelled,count(*) FILTER(WHERE status='pending' AND due_at<now())::int AS overdue FROM follow_up_tasks WHERE due_at>=$1 AND due_at<$2`,
          args,
        )
      ).rows[0]!;
      const inventory = await currentInventory(c);
      const dailySales = (
        await c.query<OperationsReport['dailySales'][number]>(
          `WITH daily AS (SELECT (s.confirmed_at AT TIME ZONE 'America/Lima')::date AS day,count(DISTINCT s.id)::int AS count,sum(l.line_total) AS total FROM sales s JOIN sale_lines l ON l.sale_id=s.id WHERE s.status='confirmed' AND s.confirmed_at>=$1 AND s.confirmed_at<$2 GROUP BY 1) SELECT to_char(d.day,'YYYY-MM-DD') AS date,coalesce(v.count,0)::int AS count,coalesce(v.total,0)::numeric(30,2)::text AS total FROM generate_series(($1::timestamptz AT TIME ZONE 'America/Lima')::date,($2::timestamptz AT TIME ZONE 'America/Lima')::date-1,interval '1 day') d(day) LEFT JOIN daily v ON v.day=d.day::date ORDER BY d.day`,
          args,
        )
      ).rows;
      const paymentsByMethod = (
        await c.query<OperationsReport['paymentsByMethod'][number]>(
          `SELECT m.method,count(p.id)::int AS count,coalesce(sum(p.amount),0)::numeric(30,2)::text AS total FROM (VALUES('cash'),('card'),('transfer')) m(method) LEFT JOIN (payments p JOIN sales s ON s.id=p.sale_id AND s.status='confirmed') ON p.method=m.method AND p.paid_at>=$1 AND p.paid_at<$2 GROUP BY m.method ORDER BY m.method`,
          args,
        )
      ).rows;
      const appointmentsByStatus = (
        await c.query<OperationsReport['appointmentsByStatus'][number]>(
          `SELECT status,count(*)::int AS count FROM appointments WHERE starts_at>=$1 AND starts_at<$2 GROUP BY status ORDER BY status`,
          args,
        )
      ).rows;
      const topItems = (
        await c.query<OperationsReport['topItems'][number]>(
          `SELECT CASE WHEN l.product_id IS NOT NULL THEN 'product' ELSE 'service' END AS kind,coalesce(l.product_id,l.service_id) AS "itemId",(array_agg(l.description ORDER BY s.confirmed_at DESC,l.id))[1] AS name,sum(l.quantity)::numeric(30,3)::text AS quantity,sum(l.line_total)::numeric(30,2)::text AS total FROM sale_lines l JOIN sales s ON s.id=l.sale_id WHERE s.status='confirmed' AND s.confirmed_at>=$1 AND s.confirmed_at<$2 GROUP BY l.product_id,l.service_id ORDER BY sum(l.line_total) DESC,coalesce(l.product_id,l.service_id) LIMIT 10`,
          args,
        )
      ).rows;
      return {
        from,
        to,
        ...header,
        financial,
        activity,
        followups,
        inventory,
        dailySales,
        paymentsByMethod,
        appointmentsByStatus,
        topItems,
      };
    },
    true,
  );
}
export async function currentInventory(c: PoolClient) {
  return (
    await c.query<OperationsReport['inventory']>(
      'SELECT count(*)::int AS active,count(*) FILTER(WHERE s.quantity<p.minimum_stock)::int AS low,count(*) FILTER(WHERE s.quantity=0)::int AS empty FROM products p JOIN product_stock s ON s.product_id=p.id WHERE p.active',
    )
  ).rows[0]!;
}
export function csvCell(value: unknown) {
  let s = String(value ?? '').replace(/\u0000/g, '');
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export function reportCsv(r: OperationsReport) {
  const rows: unknown[][] = [
    ['Sección', 'Indicador / fecha', 'Valor', 'Cantidad'],
    ['Período', 'Desde', r.from],
    ['Período', 'Hasta inclusive', r.to],
    ['Contexto', 'Negocio', r.businessName],
    ['Contexto', 'Generado UTC', r.generatedAt],
    ['Ventas', 'Total confirmado PEN', r.financial.salesTotal, r.financial.confirmedSales],
    ['Cobros', 'Total registrado PEN', r.financial.paymentsTotal, r.financial.paymentCount],
    ['Compras', 'Total recibido PEN', r.financial.purchasesTotal, r.financial.receivedPurchases],
    ['Actividad', 'Citas por inicio', r.activity.appointments],
    ['Actividad', 'Atenciones cerradas', r.activity.closedEncounters],
    ['Actividad', 'Clientes registrados', r.activity.newClients],
    ['Actividad', 'Mascotas registradas', r.activity.newPets],
    ['Seguimiento por vencimiento', 'Pendientes', r.followups.pending],
    ['Seguimiento por vencimiento', 'Completados', r.followups.completed],
    ['Seguimiento por vencimiento', 'Cancelados', r.followups.cancelled],
    ['Seguimiento por vencimiento', 'Pendientes vencidos ahora', r.followups.overdue],
    ['Inventario actual', 'Productos activos', r.inventory.active],
    ['Inventario actual', 'Stock bajo', r.inventory.low],
    ['Inventario actual', 'Sin existencias', r.inventory.empty],
  ];
  for (const d of r.dailySales) rows.push(['Venta diaria', d.date, d.total, d.count]);
  for (const p of r.paymentsByMethod) rows.push(['Cobros por medio', p.method, p.total, p.count]);
  for (const a of r.appointmentsByStatus) rows.push(['Citas por estado', a.status, a.count]);
  for (const p of r.topItems) rows.push([`Concepto ${p.kind}`, p.name, p.total, p.quantity]);
  return '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
