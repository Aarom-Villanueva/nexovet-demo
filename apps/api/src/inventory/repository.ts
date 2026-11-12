import type { Pool, PoolClient } from 'pg';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { z } from 'zod';
import { createHash } from 'node:crypto';
import type {
  ProductRecord,
  SupplierRecord,
  PurchaseDetail,
  PurchaseRecord,
  StockMovement,
  Role,
} from '@nexovet/shared';
export type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | void>;
export interface Dependencies {
  pool: Pool;
  requireSession: Guard;
  requireWrite: Guard;
  permit: (roles: readonly Role[]) => Guard;
}
export class Problem extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}
export const parse = <T>(schema: z.ZodType<T>, value: unknown): T => schema.parse(value);
export async function tx<T>(pool: Pool, work: (c: PoolClient) => Promise<T>, readOnly = false) {
  const c = await pool.connect();
  try {
    await c.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
    const r = await work(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
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
        message: 'Ya existe ese código, RUC o identificador de solicitud. Revisa el registro.',
        code: 'DUPLICATE_RECORD',
      });
    if (code === '23514' && !(e as { constraint?: string }).constraint)
      return reply.code(409).send({
        message:
          'No se pudo aplicar el movimiento: revisa el saldo disponible y el estado del documento.',
        code: 'STOCK_CONFLICT',
      });
    if (code === '23503')
      return reply.code(409).send({
        message: 'El producto, categoría o proveedor ya no está disponible. Recarga la ficha.',
      });
    app.log.error({ code }, 'No se pudo procesar el inventario');
    const s = (e as { statusCode?: number }).statusCode;
    return reply
      .code(s && s >= 400 && s < 500 ? s : 500)
      .send({ message: 'No se pudo completar la operación. Intenta nuevamente.' });
  });
}
export function version(expected: number, actual: number) {
  if (expected !== actual)
    throw new Problem(
      409,
      'Otra persona actualizó este registro. Carga la versión actual antes de guardar.',
      'VERSION_CONFLICT',
    );
}
export async function audit(
  c: PoolClient,
  r: FastifyRequest,
  action: string,
  type: string,
  id: string,
  metadata: Record<string, unknown> = {},
) {
  await c.query(
    'INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,$3,$4,$5)',
    [r.identity!.user.id, action, type, id, metadata],
  );
}
export const iso = (f: string) =>
  `to_char(${f} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
export const productFrom =
  'FROM products p LEFT JOIN product_categories c ON c.id=p.category_id JOIN product_stock s ON s.product_id=p.id';
export const productColumns = `p.id,p.sku,p.name,p.category_id AS "categoryId",c.name AS "categoryName",p.sale_price::text AS "salePrice",p.minimum_stock::text AS "minimumStock",p.active,p.version,${iso('p.updated_at')} AS "updatedAt",s.quantity::text AS stock,(s.quantity<p.minimum_stock) AS "lowStock"`;
export async function product(c: PoolClient, id: string, lock = false) {
  if (lock) await c.query('SELECT id FROM products WHERE id=$1 FOR UPDATE', [id]);
  const r = (
    await c.query<ProductRecord>(`SELECT ${productColumns} ${productFrom} WHERE p.id=$1`, [id])
  ).rows[0];
  if (!r) throw new Problem(404, 'No encontramos ese producto.');
  return r;
}
export const supplierColumns = `id,name,tax_id AS "taxId",email,phone,address,active,version,${iso('updated_at')} AS "updatedAt"`;
export async function supplier(c: PoolClient, id: string, lock = false) {
  const r = (
    await c.query<SupplierRecord>(
      `SELECT ${supplierColumns} FROM suppliers WHERE id=$1 ${lock ? 'FOR UPDATE' : ''}`,
      [id],
    )
  ).rows[0];
  if (!r) throw new Problem(404, 'No encontramos ese proveedor.');
  return r;
}
export const purchaseFrom =
  'FROM purchase_orders o JOIN suppliers s ON s.id=o.supplier_id JOIN users u ON u.id=o.created_by LEFT JOIN users r ON r.id=o.received_by';
export const purchaseColumns = `o.id,o.number,o.supplier_id AS "supplierId",coalesce(o.supplier_snapshot,s.name) AS "supplierName",o.status,o.note,o.version,${iso('o.ordered_at')} AS "orderedAt",${iso('o.updated_at')} AS "updatedAt",${iso('o.received_at')} AS "receivedAt",u.name AS "createdByName",r.name AS "receivedByName",(SELECT coalesce(sum(line_total),0)::numeric(18,2)::text FROM purchase_order_lines WHERE purchase_order_id=o.id) AS total,(SELECT count(*)::int FROM purchase_order_lines WHERE purchase_order_id=o.id) AS "lineCount"`;
export async function purchase(c: PoolClient, id: string, lock = false): Promise<PurchaseDetail> {
  if (lock) await c.query('SELECT id FROM purchase_orders WHERE id=$1 FOR UPDATE', [id]);
  const r = (
    await c.query<PurchaseRecord>(`SELECT ${purchaseColumns} ${purchaseFrom} WHERE o.id=$1`, [id])
  ).rows[0];
  if (!r) throw new Problem(404, 'No encontramos esa compra.');
  const lines = (
    await c.query<PurchaseDetail['lines'][number]>(
      'SELECT l.id,l.product_id AS "productId",coalesce(l.product_sku,p.sku) AS sku,coalesce(l.product_name,p.name) AS "productName",p.active AS "productActive",l.quantity::text,l.unit_cost::text AS "unitCost",l.line_total::text AS "lineTotal" FROM purchase_order_lines l JOIN products p ON p.id=l.product_id WHERE l.purchase_order_id=$1 ORDER BY p.id',
      [id],
    )
  ).rows;
  return { ...r, lines };
}
export async function activeRelations(c: PoolClient, supplierId: string, productIds: string[]) {
  // Todas las operaciones con varios productos usan el mismo orden de bloqueo.
  if (
    !(await c.query('SELECT id FROM suppliers WHERE id=$1 AND active FOR SHARE', [supplierId]))
      .rowCount
  )
    throw new Problem(409, 'Selecciona un proveedor activo.');
  const ids = [...productIds].sort();
  const r = await c.query(
    'SELECT id FROM products WHERE id=ANY($1::uuid[]) AND active ORDER BY id FOR UPDATE',
    [ids],
  );
  if (r.rowCount !== ids.length)
    throw new Problem(409, 'Todos los productos deben estar activos. Revisa las líneas.');
}
export const movementFrom =
  'FROM stock_movements m JOIN users u ON u.id=m.recorded_by LEFT JOIN purchase_order_lines l ON l.id=m.purchase_line_id LEFT JOIN purchase_orders o ON o.id=l.purchase_order_id';
export const movementColumns = `m.id,m.product_id AS "productId",m.quantity::text,m.kind,m.reason,u.name AS "recordedByName",${iso('m.created_at')} AS "createdAt",o.id AS "purchaseId",o.number AS "purchaseNumber"`;
export async function movement(c: PoolClient, id: string) {
  return (
    await c.query<StockMovement>(`SELECT ${movementColumns} ${movementFrom} WHERE m.id=$1`, [id])
  ).rows[0]!;
}
export const fingerprint = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
export async function requestLock(c: PoolClient, key: string) {
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    `nexovet:inventory:${key}`,
  ]);
}
