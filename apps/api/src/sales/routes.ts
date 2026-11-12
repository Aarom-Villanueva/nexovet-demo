import type { FastifyInstance } from 'fastify';
import type { SaleRecord, SaleItemChoice, SaleClientChoice } from '@nexovet/shared';
import { searchPattern } from '../patients/validation.js';
import {
  type Dependencies,
  tx,
  parse,
  Problem,
  version,
  audit,
  fingerprint,
} from '../inventory/repository.js';
import {
  sale,
  saleColumns,
  saleFrom,
  errors,
  activeClient,
  activeItems,
  writeLines,
  requestLock,
} from './repository.js';
import * as v from './validation.js';
export async function registerSales(
  app: FastifyInstance,
  { pool, requireSession, requireWrite, permit }: Dependencies,
) {
  await app.register(async (scope) => {
    errors(scope);
    const read = [requireSession, permit(['admin', 'reception'])],
      write = [...read, requireWrite];
    const id = (r: { params: unknown }) => parse(v.guid, (r.params as { id: string }).id);
    scope.get('/api/sales/items', { preHandler: read }, async (req) => {
      const q = parse(v.itemQuery, req.query),
        pattern = searchPattern(q.q);
      return q.kind === 'product'
        ? (
            await pool.query<SaleItemChoice>(
              `SELECT p.id,'product'::text AS kind,p.name,p.sku,p.sale_price::text AS price,s.quantity::text AS stock FROM products p JOIN product_stock s ON s.product_id=p.id WHERE p.active AND (p.name ILIKE $1 OR p.sku ILIKE $1) ORDER BY p.sku,p.id LIMIT 20`,
              [pattern],
            )
          ).rows
        : (
            await pool.query<SaleItemChoice>(
              `SELECT id,'service'::text AS kind,name,NULL::text AS sku,price::text,NULL::text AS stock FROM services WHERE active AND name ILIKE $1 ORDER BY name,id LIMIT 20`,
              [pattern],
            )
          ).rows;
    });
    scope.get('/api/sales/clients', { preHandler: read }, async (req) => {
      const q = parse(v.clientQuery, req.query);
      return (
        await pool.query<SaleClientChoice>(
          'SELECT id,name,document_number AS "documentNumber" FROM clients WHERE active AND (name ILIKE $1 OR document_number ILIKE $1 OR phone ILIKE $1 OR email ILIKE $1) ORDER BY lower(name),id LIMIT 20',
          [searchPattern(q.q)],
        )
      ).rows;
    });
    scope.get('/api/sales', { preHandler: read }, async (req) => {
      const q = parse(v.querySchema, req.query);
      return tx(
        pool,
        async (c) => {
          const where =
            "($1='all' OR s.status=$1) AND (s.number ILIKE $2 OR coalesce(s.client_name,c.name) ILIKE $2) AND ($3::uuid IS NULL OR s.client_id=$3)";
          const args = [q.status, searchPattern(q.q), q.clientId ?? null];
          const total = (
            await c.query<{ total: number }>(
              `SELECT count(*)::int AS total ${saleFrom} WHERE ${where}`,
              args,
            )
          ).rows[0]!.total;
          const items = (
            await c.query<SaleRecord>(
              `SELECT ${saleColumns} ${saleFrom} WHERE ${where} ORDER BY s.created_at DESC,s.id DESC LIMIT $4 OFFSET $5`,
              [...args, q.pageSize, (q.page - 1) * q.pageSize],
            )
          ).rows;
          return { items, total, page: q.page, pageSize: q.pageSize };
        },
        true,
      );
    });
    scope.get('/api/sales/:id', { preHandler: read }, (req) =>
      tx(pool, (c) => sale(c, id(req)), true),
    );
    scope.post('/api/sales', { preHandler: write }, async (req, reply) => {
      const { requestId, ...b } = parse(v.createSchema, req.body),
        hash = fingerprint(b);
      const result = await tx(pool, async (c) => {
        await requestLock(c, `create:${requestId}`);
        const old = (
          await c.query<{ id: string; created_by: string; request_fingerprint: string }>(
            'SELECT id,created_by,request_fingerprint FROM sales WHERE request_id=$1',
            [requestId],
          )
        ).rows[0];
        if (old) {
          if (old.created_by !== req.identity!.user.id || old.request_fingerprint !== hash)
            throw new Problem(
              409,
              'Ese identificador corresponde a otra solicitud.',
              'REQUEST_CONFLICT',
            );
          return { record: await sale(c, old.id), replay: true };
        }
        await activeClient(c, b.clientId);
        const items = await activeItems(c, b.lines);
        const row = (
          await c.query<{ id: string }>(
            "INSERT INTO sales(number,client_id,note,created_by,request_id,request_fingerprint) VALUES ('V-'||lpad(nextval('sale_number_seq')::text,10,'0'),$1,$2,$3,$4,$5) RETURNING id",
            [b.clientId, b.note, req.identity!.user.id, requestId, hash],
          )
        ).rows[0]!;
        await writeLines(c, row.id, b.lines, items);
        await audit(c, req, 'sale.created', 'sale', row.id, {
          version: 1,
          lineCount: b.lines.length,
        });
        return { record: await sale(c, row.id), replay: false };
      });
      if (result.replay) reply.header('Idempotent-Replay', 'true');
      return reply
        .header('Location', `/api/sales/${result.record.id}`)
        .code(201)
        .send(result.record);
    });
    scope.put('/api/sales/:id', { preHandler: write }, async (req) => {
      const b = parse(v.editSchema, req.body);
      return tx(pool, async (c) => {
        const old = await sale(c, id(req), true);
        version(b.version, old.version);
        if (old.status !== 'draft') throw new Problem(409, 'Solo se editan ventas en borrador.');
        await activeClient(c, b.clientId);
        const items = await activeItems(c, b.lines);
        await c.query(
          'UPDATE sales SET client_id=$2,note=$3,version=version+1,updated_at=now() WHERE id=$1',
          [old.id, b.clientId, b.note],
        );
        await c.query('DELETE FROM sale_lines WHERE sale_id=$1', [old.id]);
        await writeLines(c, old.id, b.lines, items);
        await audit(c, req, 'sale.updated', 'sale', old.id, {
          version: old.version + 1,
          lineCount: b.lines.length,
        });
        return sale(c, old.id);
      });
    });
    scope.post('/api/sales/:id/cancel', { preHandler: write }, async (req) => {
      const b = parse(v.stateSchema, req.body);
      return tx(pool, async (c) => {
        const old = await sale(c, id(req), true);
        version(b.version, old.version);
        if (old.status !== 'draft')
          throw new Problem(
            409,
            'Solo se cancelan borradores. Una venta confirmada conserva sus cobros y salidas.',
          );
        await c.query(
          "UPDATE sales SET status='cancelled',version=version+1,updated_at=now() WHERE id=$1",
          [old.id],
        );
        await audit(c, req, 'sale.cancelled', 'sale', old.id, { version: old.version + 1 });
        return sale(c, old.id);
      });
    });
    scope.post('/api/sales/:id/confirm', { preHandler: write }, async (req, reply) => {
      const saleId = id(req),
        { requestId, ...b } = parse(v.confirmSchema, req.body),
        hash = fingerprint([saleId, b]);
      const result = await tx(pool, async (c) => {
        await requestLock(c, `confirm:${requestId}`);
        const previous = (
          await c.query<{ id: string; confirmed_by: string; confirm_fingerprint: string }>(
            'SELECT id,confirmed_by,confirm_fingerprint FROM sales WHERE confirm_request_id=$1',
            [requestId],
          )
        ).rows[0];
        if (previous) {
          if (
            previous.id !== saleId ||
            previous.confirmed_by !== req.identity!.user.id ||
            previous.confirm_fingerprint !== hash
          )
            throw new Problem(
              409,
              'Ese identificador ya se usó con otros datos de confirmación.',
              'REQUEST_CONFLICT',
            );
          return { record: await sale(c, saleId), replay: true };
        }
        const old = await sale(c, saleId, true);
        version(b.version, old.version);
        if (old.status !== 'draft')
          throw new Problem(
            409,
            'Esta venta ya finalizó. Revisa sus cobros y movimientos antes de registrar otra.',
          );
        if (!old.lines.length) throw new Problem(409, 'Agrega al menos un producto o servicio.');
        const clientName = await activeClient(c, old.clientId);
        await activeItems(c, old.lines);
        const total = v.scaled(old.total, 2),
          paid = b.payments.reduce((sum, p) => sum + v.scaled(p.amount, 2), 0n);
        if (total !== paid)
          throw new Problem(
            400,
            'La suma de los cobros debe ser igual al total de la venta. Registra el importe aplicado, sin vuelto.',
            'PAYMENT_MISMATCH',
          );
        for (const l of old.lines) {
          if (l.kind !== 'product') continue;
          const balance = (
            await c.query<{ valid: boolean }>(
              'SELECT coalesce(sum(quantity),0)>=$2::numeric AS valid FROM stock_movements WHERE product_id=$1',
              [l.itemId, l.quantity],
            )
          ).rows[0]!;
          if (!balance.valid)
            throw new Problem(
              409,
              `Stock insuficiente para ${l.sku ?? l.description}. Revisa existencias y cantidad.`,
              'STOCK_CONFLICT',
            );
          await c.query(
            "INSERT INTO stock_movements(product_id,quantity,kind,sale_line_id,reason,recorded_by) VALUES ($1,-$2::numeric,'sale',$3,$4,$5)",
            [l.itemId, l.quantity, l.id, `Venta ${old.number}`, req.identity!.user.id],
          );
        }
        for (const p of b.payments)
          await c.query(
            'INSERT INTO payments(sale_id,method,amount,reference,recorded_by) VALUES ($1,$2,$3,$4,$5)',
            [old.id, p.method, p.amount, p.reference, req.identity!.user.id],
          );
        await c.query(
          "UPDATE sales SET status='confirmed',confirmed_at=now(),confirmed_by=$2,client_name=$3,confirm_request_id=$4,confirm_fingerprint=$5,version=version+1,updated_at=now() WHERE id=$1",
          [old.id, req.identity!.user.id, clientName, requestId, hash],
        );
        await audit(c, req, 'sale.confirmed', 'sale', old.id, {
          version: old.version + 1,
          total: old.total,
          paymentCount: b.payments.length,
          lineCount: old.lines.length,
        });
        return { record: await sale(c, old.id), replay: false };
      });
      if (result.replay) reply.header('Idempotent-Replay', 'true');
      return result.record;
    });
  });
}
