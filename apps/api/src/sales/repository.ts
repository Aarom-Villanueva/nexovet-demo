import type { PoolClient } from 'pg';
import type { FastifyInstance } from 'fastify';
import type { SaleDetail, SaleRecord, SaleLineInput } from '@nexovet/shared';
import { Problem, iso } from '../inventory/repository.js';
import { scaled } from './validation.js';
export function errors(app: FastifyInstance) {
  app.setErrorHandler((e, _req, reply) => {
    if (e instanceof Problem)
      return reply.code(e.status).send({ message: e.message, code: e.code });
    if (e && typeof e === 'object' && 'issues' in e && Array.isArray(e.issues)) {
      const fields: Record<string, string> = {};
      for (const i of e.issues as { path: (string | number)[]; message: string }[])
        fields[String(i.path[0] ?? 'form')] = i.message;
      return reply.code(400).send({ message: 'Revisa los campos indicados.', fields });
    }
    const code = (e as { code?: string }).code;
    if (code === '23505')
      return reply.code(409).send({
        message: 'La solicitud o el documento ya existe. Revisa la venta.',
        code: 'REQUEST_CONFLICT',
      });
    if (code === '23514' && !(e as { constraint?: string }).constraint)
      return reply.code(409).send({
        message: 'No se pudo confirmar: revisa el saldo y el estado de la venta.',
        code: 'STOCK_CONFLICT',
      });
    if (code === '23503')
      return reply.code(409).send({
        message: 'El cliente, producto o servicio ya no está disponible. Recarga la venta.',
      });
    app.log.error({ code }, 'No se pudo procesar una venta');
    const status = (e as { statusCode?: number }).statusCode;
    return reply
      .code(status && status >= 400 && status < 500 ? status : 500)
      .send({ message: 'No se pudo completar la operación. Intenta nuevamente.' });
  });
}
export const saleFrom =
  'FROM sales s LEFT JOIN clients c ON c.id=s.client_id JOIN users u ON u.id=s.created_by LEFT JOIN users v ON v.id=s.confirmed_by';
export const saleColumns = `s.id,s.number,s.client_id AS "clientId",coalesce(s.client_name,c.name) AS "clientName",s.status,s.note,s.version,${iso('s.created_at')} AS "createdAt",${iso('s.updated_at')} AS "updatedAt",${iso('s.confirmed_at')} AS "confirmedAt",u.name AS "createdByName",v.name AS "confirmedByName",(SELECT coalesce(sum(line_total),0)::numeric(18,2)::text FROM sale_lines WHERE sale_id=s.id) AS total,(SELECT coalesce(sum(amount),0)::numeric(18,2)::text FROM payments WHERE sale_id=s.id) AS paid,(SELECT count(*)::int FROM sale_lines WHERE sale_id=s.id) AS "lineCount"`;
export async function sale(c: PoolClient, id: string, lock = false): Promise<SaleDetail> {
  if (lock) await c.query('SELECT id FROM sales WHERE id=$1 FOR UPDATE', [id]);
  const r = (await c.query<SaleRecord>(`SELECT ${saleColumns} ${saleFrom} WHERE s.id=$1`, [id]))
    .rows[0];
  if (!r) throw new Problem(404, 'No encontramos esa venta.');
  const lines = (
    await c.query<SaleDetail['lines'][number]>(
      `SELECT l.id,CASE WHEN l.product_id IS NOT NULL THEN 'product' ELSE 'service' END AS kind,coalesce(l.product_id,l.service_id) AS "itemId",l.description,coalesce(l.sku_snapshot,p.sku) AS sku,l.quantity::text,l.unit_price::text AS "unitPrice",l.line_total::text AS "lineTotal",coalesce(p.active,v.active) AS active FROM sale_lines l LEFT JOIN products p ON p.id=l.product_id LEFT JOIN services v ON v.id=l.service_id WHERE l.sale_id=$1 ORDER BY l.id`,
      [id],
    )
  ).rows;
  const payments = (
    await c.query<SaleDetail['payments'][number]>(
      `SELECT p.id,p.method,p.amount::text,p.reference,u.name AS "recordedByName",${iso('p.paid_at')} AS "paidAt" FROM payments p JOIN users u ON u.id=p.recorded_by WHERE p.sale_id=$1 ORDER BY p.paid_at,p.id`,
      [id],
    )
  ).rows;
  return { ...r, lines, payments };
}
export async function activeClient(c: PoolClient, id: string | null) {
  if (!id) return null;
  const row = (
    await c.query<{ name: string }>('SELECT name FROM clients WHERE id=$1 AND active FOR SHARE', [
      id,
    ])
  ).rows[0];
  if (!row)
    throw new Problem(
      409,
      'Selecciona un cliente activo o registra la venta sin cliente asociado.',
    );
  return row.name;
}
export interface Item {
  id: string;
  name: string;
  sku: string | null;
  price: string;
}
export async function activeItems(c: PoolClient, lines: SaleLineInput[]) {
  const products = lines
      .filter((l) => l.kind === 'product')
      .map((l) => l.itemId)
      .sort(),
    services = lines
      .filter((l) => l.kind === 'service')
      .map((l) => l.itemId)
      .sort();
  const ps = (
    await c.query<Item>(
      'SELECT id,name,sku,sale_price::text AS price FROM products WHERE active AND id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',
      [products],
    )
  ).rows;
  const ss = (
    await c.query<Item>(
      'SELECT id,name,NULL::text AS sku,price::text FROM services WHERE active AND id=ANY($1::uuid[]) ORDER BY id FOR SHARE',
      [services],
    )
  ).rows;
  if (ps.length !== products.length || ss.length !== services.length)
    throw new Problem(
      409,
      'Todos los productos y servicios deben estar activos. Revisa las líneas.',
    );
  return new Map([
    ...ps.map((p) => [`product:${p.id}`, p] as const),
    ...ss.map((s) => [`service:${s.id}`, s] as const),
  ]);
}
export async function writeLines(
  c: PoolClient,
  id: string,
  lines: SaleLineInput[],
  items: Map<string, Item>,
) {
  let total = 0n;
  for (const l of lines) {
    const item = items.get(`${l.kind}:${l.itemId}`)!;
    total += (scaled(l.quantity, 3) * scaled(item.price, 2) + 500n) / 1000n;
  }
  if (total > 999999999999n)
    throw new Problem(400, 'El total supera el máximo de S/ 9,999,999,999.99 por venta.');
  for (const l of lines) {
    const item = items.get(`${l.kind}:${l.itemId}`)!;
    await c.query(
      'INSERT INTO sale_lines(sale_id,product_id,service_id,description,sku_snapshot,quantity,unit_price) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [
        id,
        l.kind === 'product' ? l.itemId : null,
        l.kind === 'service' ? l.itemId : null,
        item.name,
        item.sku,
        l.quantity,
        item.price,
      ],
    );
  }
}
export async function requestLock(c: PoolClient, key: string) {
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`nexovet:sales:${key}`]);
}
