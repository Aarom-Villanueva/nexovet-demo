import type { FastifyInstance } from 'fastify';
import type { ProductRecord, SupplierRecord, PurchaseRecord } from '@nexovet/shared';
import { searchPattern } from '../patients/validation.js';
import * as v from './validation.js';
import {
  type Dependencies,
  tx,
  parse,
  Problem,
  errors,
  version,
  audit,
  product,
  productColumns,
  productFrom,
  supplier,
  supplierColumns,
  purchase,
  purchaseColumns,
  purchaseFrom,
  activeRelations,
  movement,
  movementColumns,
  movementFrom,
  fingerprint,
  requestLock,
} from './repository.js';
export async function registerInventory(
  app: FastifyInstance,
  { pool, requireSession, requireWrite, permit }: Dependencies,
) {
  await app.register(async (scope) => {
    errors(scope);
    const read = [requireSession, permit(['admin', 'reception'])],
      write = [...read, requireWrite],
      adminWrite = [requireSession, permit(['admin']), requireWrite];
    const id = (r: { params: unknown }) => parse(v.guid, (r.params as { id: string }).id);
    scope.get(
      '/api/inventory/categories',
      { preHandler: read },
      async () =>
        (await pool.query('SELECT id,name FROM product_categories ORDER BY name,id')).rows,
    );
    scope.get(
      '/api/inventory/stats',
      { preHandler: read },
      async () =>
        (
          await pool.query(
            'SELECT count(*)::int AS active,count(*) FILTER (WHERE s.quantity<p.minimum_stock)::int AS low,count(*) FILTER (WHERE s.quantity=0)::int AS empty FROM products p JOIN product_stock s ON s.product_id=p.id WHERE p.active',
          )
        ).rows[0],
    );
    scope.get('/api/products', { preHandler: read }, async (req) => {
      const q = parse(v.productQuery, req.query);
      return tx(
        pool,
        async (c) => {
          const where =
            "($1='all' OR p.active=($1='active')) AND (p.name ILIKE $2 OR p.sku ILIKE $2) AND ($3::uuid IS NULL OR p.category_id=$3) AND ($4='all' OR ($4='low' AND s.quantity<p.minimum_stock) OR ($4='empty' AND s.quantity=0))";
          const args = [q.status, searchPattern(q.q), q.categoryId ?? null, q.stock];
          const total = (
            await c.query<{ total: number }>(
              `SELECT count(*)::int AS total ${productFrom} WHERE ${where}`,
              args,
            )
          ).rows[0]!.total;
          const items = (
            await c.query<ProductRecord>(
              `SELECT ${productColumns} ${productFrom} WHERE ${where} ORDER BY p.sku,p.id LIMIT $5 OFFSET $6`,
              [...args, q.pageSize, (q.page - 1) * q.pageSize],
            )
          ).rows;
          return { items, total, page: q.page, pageSize: q.pageSize };
        },
        true,
      );
    });
    scope.get('/api/products/:id', { preHandler: read }, (req) =>
      tx(pool, (c) => product(c, id(req)), true),
    );
    scope.post('/api/products', { preHandler: adminWrite }, async (req, reply) => {
      const b = parse(v.productSchema, req.body);
      const r = await tx(pool, async (c) => {
        const saved = (
          await c.query<{ id: string }>(
            'INSERT INTO products(sku,name,category_id,sale_price,minimum_stock,active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
            [b.sku, b.name, b.categoryId, b.salePrice, b.minimumStock, b.active],
          )
        ).rows[0]!;
        await audit(c, req, 'product.created', 'product', saved.id, { version: 1 });
        return product(c, saved.id);
      });
      return reply.code(201).send(r);
    });
    scope.put('/api/products/:id', { preHandler: adminWrite }, async (req) => {
      const b = parse(v.productEditSchema, req.body);
      return tx(pool, async (c) => {
        const old = await product(c, id(req), true);
        version(b.version, old.version);
        await c.query(
          'UPDATE products SET sku=$2,name=$3,category_id=$4,sale_price=$5,minimum_stock=$6,active=$7,version=version+1,updated_at=now() WHERE id=$1',
          [old.id, b.sku, b.name, b.categoryId, b.salePrice, b.minimumStock, b.active],
        );
        await audit(c, req, 'product.updated', 'product', old.id, {
          version: old.version + 1,
          active: b.active,
        });
        return product(c, old.id);
      });
    });
    scope.get('/api/products/:id/movements', { preHandler: read }, async (req) => {
      const productId = id(req),
        q = parse(v.movementQuery, req.query);
      return tx(
        pool,
        async (c) => {
          await product(c, productId);
          const total = (
            await c.query<{ total: number }>(
              'SELECT count(*)::int AS total FROM stock_movements WHERE product_id=$1',
              [productId],
            )
          ).rows[0]!.total;
          const items = (
            await c.query(
              `SELECT ${movementColumns} ${movementFrom} WHERE m.product_id=$1 ORDER BY m.created_at DESC,m.id DESC LIMIT $2 OFFSET $3`,
              [productId, q.pageSize, (q.page - 1) * q.pageSize],
            )
          ).rows;
          return { items, total, page: q.page, pageSize: q.pageSize };
        },
        true,
      );
    });
    scope.post('/api/products/:id/adjustments', { preHandler: adminWrite }, async (req, reply) => {
      const productId = id(req),
        b = parse(v.adjustmentSchema, req.body),
        hash = fingerprint([productId, b.quantity, b.reason]);
      const result = await tx(pool, async (c) => {
        await requestLock(c, b.requestId);
        const old = (
          await c.query<{ id: string; recorded_by: string; request_fingerprint: string }>(
            'SELECT id,recorded_by,request_fingerprint FROM stock_movements WHERE request_id=$1',
            [b.requestId],
          )
        ).rows[0];
        if (old) {
          if (old.recorded_by !== req.identity!.user.id || old.request_fingerprint !== hash)
            throw new Problem(
              409,
              'Este identificador ya se utilizó para otro ajuste.',
              'REQUEST_CONFLICT',
            );
          return { record: await movement(c, old.id), replay: true };
        }
        const p = await product(c, productId, true);
        if (!p.active) throw new Problem(409, 'Reactiva el producto antes de ajustar su saldo.');
        const saved = (
          await c.query<{ id: string }>(
            "INSERT INTO stock_movements(product_id,quantity,kind,reason,recorded_by,request_id,request_fingerprint) VALUES ($1,$2,'adjustment',$3,$4,$5,$6) RETURNING id",
            [productId, b.quantity, b.reason, req.identity!.user.id, b.requestId, hash],
          )
        ).rows[0]!;
        await audit(c, req, 'stock.adjusted', 'product', productId, {
          movementId: saved.id,
          quantity: b.quantity,
        });
        return { record: await movement(c, saved.id), replay: false };
      });
      if (result.replay) reply.header('Idempotent-Replay', 'true');
      return reply.code(201).send(result.record);
    });
    scope.get('/api/suppliers', { preHandler: read }, async (req) => {
      const q = parse(v.supplierQuery, req.query);
      return tx(
        pool,
        async (c) => {
          const where =
            "($1='all' OR active=($1='active')) AND (name ILIKE $2 OR tax_id ILIKE $2 OR phone ILIKE $2 OR email ILIKE $2)";
          const args = [q.status, searchPattern(q.q)];
          const total = (
            await c.query<{ total: number }>(
              `SELECT count(*)::int AS total FROM suppliers WHERE ${where}`,
              args,
            )
          ).rows[0]!.total;
          const items = (
            await c.query<SupplierRecord>(
              `SELECT ${supplierColumns} FROM suppliers WHERE ${where} ORDER BY lower(name),id LIMIT $3 OFFSET $4`,
              [...args, q.pageSize, (q.page - 1) * q.pageSize],
            )
          ).rows;
          return { items, total, page: q.page, pageSize: q.pageSize };
        },
        true,
      );
    });
    scope.get('/api/suppliers/:id', { preHandler: read }, (req) =>
      tx(pool, (c) => supplier(c, id(req)), true),
    );
    scope.post('/api/suppliers', { preHandler: write }, async (req, reply) => {
      const b = parse(v.supplierSchema, req.body);
      const r = await tx(pool, async (c) => {
        const saved = (
          await c.query<{ id: string }>(
            'INSERT INTO suppliers(name,tax_id,email,phone,address,active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
            [b.name, b.taxId, b.email, b.phone, b.address, b.active],
          )
        ).rows[0]!;
        await audit(c, req, 'supplier.created', 'supplier', saved.id, { version: 1 });
        return supplier(c, saved.id);
      });
      return reply.code(201).send(r);
    });
    scope.put('/api/suppliers/:id', { preHandler: write }, async (req) => {
      const b = parse(v.supplierEditSchema, req.body);
      return tx(pool, async (c) => {
        const old = await supplier(c, id(req), true);
        version(b.version, old.version);
        await c.query(
          'UPDATE suppliers SET name=$2,tax_id=$3,email=$4,phone=$5,address=$6,active=$7,version=version+1,updated_at=now() WHERE id=$1',
          [old.id, b.name, b.taxId, b.email, b.phone, b.address, b.active],
        );
        await audit(c, req, 'supplier.updated', 'supplier', old.id, {
          version: old.version + 1,
          active: b.active,
        });
        return supplier(c, old.id);
      });
    });
    scope.get('/api/purchases', { preHandler: read }, async (req) => {
      const q = parse(v.purchaseQuery, req.query);
      return tx(
        pool,
        async (c) => {
          const where =
            "($1='all' OR o.status=$1) AND (o.number ILIKE $2 OR coalesce(o.supplier_snapshot,s.name) ILIKE $2)";
          const args = [q.status, searchPattern(q.q)];
          const total = (
            await c.query<{ total: number }>(
              `SELECT count(*)::int AS total ${purchaseFrom} WHERE ${where}`,
              args,
            )
          ).rows[0]!.total;
          const items = (
            await c.query<PurchaseRecord>(
              `SELECT ${purchaseColumns} ${purchaseFrom} WHERE ${where} ORDER BY o.ordered_at DESC,o.id DESC LIMIT $3 OFFSET $4`,
              [...args, q.pageSize, (q.page - 1) * q.pageSize],
            )
          ).rows;
          return { items, total, page: q.page, pageSize: q.pageSize };
        },
        true,
      );
    });
    scope.get('/api/purchases/:id', { preHandler: read }, (req) =>
      tx(pool, (c) => purchase(c, id(req)), true),
    );
    scope.post('/api/purchases', { preHandler: write }, async (req, reply) => {
      const { requestId, ...b } = parse(v.purchaseCreateSchema, req.body),
        hash = fingerprint(b);
      const result = await tx(pool, async (c) => {
        await requestLock(c, requestId);
        const old = (
          await c.query<{ id: string; created_by: string; request_fingerprint: string }>(
            'SELECT id,created_by,request_fingerprint FROM purchase_orders WHERE request_id=$1',
            [requestId],
          )
        ).rows[0];
        if (old) {
          if (old.created_by !== req.identity!.user.id || old.request_fingerprint !== hash)
            throw new Problem(
              409,
              'Este identificador ya se utilizó para otra compra.',
              'REQUEST_CONFLICT',
            );
          return { record: await purchase(c, old.id), replay: true };
        }
        await activeRelations(
          c,
          b.supplierId,
          b.lines.map((l) => l.productId),
        );
        const saved = (
          await c.query<{ id: string }>(
            "INSERT INTO purchase_orders(number,supplier_id,created_by,note,request_id,request_fingerprint) VALUES ('OC-'||lpad(nextval('purchase_number_seq')::text,8,'0'),$1,$2,$3,$4,$5) RETURNING id",
            [b.supplierId, req.identity!.user.id, b.note, requestId, hash],
          )
        ).rows[0]!;
        for (const l of b.lines)
          await c.query(
            'INSERT INTO purchase_order_lines(purchase_order_id,product_id,quantity,unit_cost) VALUES ($1,$2,$3,$4)',
            [saved.id, l.productId, l.quantity, l.unitCost],
          );
        await audit(c, req, 'purchase.created', 'purchase', saved.id, {
          version: 1,
          lineCount: b.lines.length,
        });
        return { record: await purchase(c, saved.id), replay: false };
      });
      if (result.replay) reply.header('Idempotent-Replay', 'true');
      return reply.code(201).send(result.record);
    });
    scope.put('/api/purchases/:id', { preHandler: write }, async (req) => {
      const b = parse(v.purchaseEditSchema, req.body);
      return tx(pool, async (c) => {
        const old = await purchase(c, id(req), true);
        version(b.version, old.version);
        if (old.status !== 'draft')
          throw new Problem(409, 'Solo se modifican compras en borrador.');
        await activeRelations(
          c,
          b.supplierId,
          b.lines.map((l) => l.productId),
        );
        await c.query(
          'UPDATE purchase_orders SET supplier_id=$2,note=$3,version=version+1,updated_at=now() WHERE id=$1',
          [old.id, b.supplierId, b.note],
        );
        await c.query('DELETE FROM purchase_order_lines WHERE purchase_order_id=$1', [old.id]);
        for (const l of b.lines)
          await c.query(
            'INSERT INTO purchase_order_lines(purchase_order_id,product_id,quantity,unit_cost) VALUES ($1,$2,$3,$4)',
            [old.id, l.productId, l.quantity, l.unitCost],
          );
        await audit(c, req, 'purchase.updated', 'purchase', old.id, {
          version: old.version + 1,
          lineCount: b.lines.length,
        });
        return purchase(c, old.id);
      });
    });
    scope.post('/api/purchases/:id/cancel', { preHandler: write }, async (req) => {
      const b = parse(v.stateSchema, req.body);
      return tx(pool, async (c) => {
        const old = await purchase(c, id(req), true);
        version(b.version, old.version);
        if (old.status !== 'draft')
          throw new Problem(
            409,
            'Solo se cancelan borradores. Una compra recibida conserva sus movimientos.',
          );
        await c.query(
          "UPDATE purchase_orders SET status='cancelled',version=version+1,updated_at=now() WHERE id=$1",
          [old.id],
        );
        await audit(c, req, 'purchase.cancelled', 'purchase', old.id, { version: old.version + 1 });
        return purchase(c, old.id);
      });
    });
    scope.post('/api/purchases/:id/receive', { preHandler: write }, async (req, reply) => {
      const b = parse(v.stateSchema, req.body);
      const result = await tx(pool, async (c) => {
        const old = await purchase(c, id(req), true);
        if (old.status === 'received' && b.version === old.version - 1)
          return { record: old, replay: true };
        version(b.version, old.version);
        if (old.status !== 'draft') throw new Problem(409, 'Solo se reciben compras en borrador.');
        if (!old.lines.length)
          throw new Problem(409, 'Agrega al menos un producto antes de recibir.');
        await activeRelations(
          c,
          old.supplierId,
          old.lines.map((l) => l.productId),
        );
        const fresh = await purchase(c, old.id);
        for (const l of fresh.lines) {
          await c.query(
            'UPDATE purchase_order_lines SET product_sku=$2,product_name=$3 WHERE id=$1',
            [l.id, l.sku, l.productName],
          );
          await c.query(
            "INSERT INTO stock_movements(product_id,quantity,kind,purchase_line_id,reason,recorded_by) VALUES ($1,$2,'purchase',$3,$4,$5)",
            [l.productId, l.quantity, l.id, `Recepción ${old.number}`, req.identity!.user.id],
          );
        }
        await c.query(
          "UPDATE purchase_orders SET status='received',received_at=now(),received_by=$2,supplier_snapshot=$3,version=version+1,updated_at=now() WHERE id=$1",
          [old.id, req.identity!.user.id, fresh.supplierName],
        );
        await audit(c, req, 'purchase.received', 'purchase', old.id, {
          version: old.version + 1,
          lineCount: old.lines.length,
          total: old.total,
        });
        return { record: await purchase(c, old.id), replay: false };
      });
      if (result.replay) reply.header('Idempotent-Replay', 'true');
      return result.record;
    });
  });
}
