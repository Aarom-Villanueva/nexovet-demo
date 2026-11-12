import type { FastifyInstance } from 'fastify';
import type { UserAccount, ServiceRecord, CategoryRecord, AuditRecord } from '@nexovet/shared';
import {
  type Dependencies,
  tx,
  parse,
  Problem,
  version,
  audit,
  iso,
} from '../inventory/repository.js';
import { searchPattern } from '../patients/validation.js';
import { hashPassword } from '../auth/crypto.js';
import {
  actor,
  business,
  user,
  service,
  category,
  userColumns,
  serviceColumns,
  categoryColumns,
  errors,
  auditSummary,
} from './repository.js';
import { report, reportCsv } from './reports.js';
import * as v from './validation.js';
export async function registerManagement(
  app: FastifyInstance,
  { pool, requireSession, requireWrite, permit }: Dependencies,
) {
  await app.register(async (scope) => {
    errors(scope);
    const read = [requireSession, permit(['admin'])],
      write = [...read, requireWrite],
      id = (r: { params: unknown }) => parse(v.guid, (r.params as { id: string }).id);
    scope.get('/api/reports/options', { preHandler: read }, async () => ({
      ...v.defaults(),
      timezone: 'America/Lima',
      maxDays: 366,
    }));
    const period = (q: unknown) => {
      const d = v.defaults();
      return parse(v.periodSchema, { from: d.from, to: d.to, ...(q as object) });
    };
    scope.get('/api/reports/operations', { preHandler: read }, async (req) => {
      const q = period(req.query);
      return report(pool, q.from, q.to);
    });
    scope.get('/api/reports/operations.csv', { preHandler: read }, async (req, reply) => {
      const q = period(req.query),
        r = await report(pool, q.from, q.to);
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header(
          'Content-Disposition',
          `attachment; filename="nexovet-reporte-${q.from}-${q.to}.csv"`,
        )
        .send(reportCsv(r));
    });
    scope.get('/api/admin/business', { preHandler: read }, () =>
      tx(pool, (c) => business(c), true),
    );
    scope.put('/api/admin/business', { preHandler: write }, async (req) => {
      const b = parse(v.businessSchema, req.body);
      return tx(pool, async (c) => {
        await actor(c, req);
        const old = await business(c, true);
        version(b.version, old.version);
        await c.query(
          'UPDATE business_settings SET name=$1,address=$2,version=version+1,updated_at=now()',
          [b.name, b.address],
        );
        await audit(c, req, 'settings.business_updated', 'settings', null, {
          version: old.version + 1,
          fields: ['name', 'address'],
        });
        return business(c);
      });
    });
    scope.get('/api/admin/services', { preHandler: read }, async (req) => {
      const q = parse(v.listSchema, req.query);
      return tx(
        pool,
        async (c) => {
          const args = [q.status, searchPattern(q.q)],
            where = "($1='all' OR active=($1='active')) AND name ILIKE $2";
          const total = (
            await c.query<{ total: number }>(
              `SELECT count(*)::int AS total FROM services WHERE ${where}`,
              args,
            )
          ).rows[0]!.total;
          const items = (
            await c.query<ServiceRecord>(
              `SELECT ${serviceColumns} FROM services WHERE ${where} ORDER BY lower(name),id LIMIT $3 OFFSET $4`,
              [...args, q.pageSize, (q.page - 1) * q.pageSize],
            )
          ).rows;
          return { items, total, page: q.page, pageSize: q.pageSize };
        },
        true,
      );
    });
    scope.get('/api/admin/services/:id', { preHandler: read }, (req) =>
      tx(pool, (c) => service(c, id(req)), true),
    );
    scope.post('/api/admin/services', { preHandler: write }, async (req, reply) => {
      const b = parse(v.serviceSchema, req.body);
      const r = await tx(pool, async (c) => {
        await actor(c, req);
        const row = (
          await c.query<{ id: string }>(
            'INSERT INTO services(name,duration_minutes,price,active) VALUES($1,$2,$3,$4) RETURNING id',
            [b.name, b.durationMinutes, b.price, b.active],
          )
        ).rows[0]!;
        await audit(c, req, 'settings.service_created', 'service', row.id, {
          version: 1,
          active: b.active,
        });
        return service(c, row.id);
      });
      return reply.code(201).send(r);
    });
    scope.put('/api/admin/services/:id', { preHandler: write }, async (req) => {
      const b = parse(v.serviceEdit, req.body);
      return tx(pool, async (c) => {
        await actor(c, req);
        const old = await service(c, id(req), true);
        version(b.version, old.version);
        await c.query(
          'UPDATE services SET name=$2,duration_minutes=$3,price=$4,active=$5,version=version+1,updated_at=now() WHERE id=$1',
          [old.id, b.name, b.durationMinutes, b.price, b.active],
        );
        await audit(c, req, 'settings.service_updated', 'service', old.id, {
          version: old.version + 1,
          active: b.active,
          fields: ['name', 'durationMinutes', 'price', 'active'],
        });
        return service(c, old.id);
      });
    });
    scope.get('/api/admin/categories', { preHandler: read }, async (req) => {
      const q = parse(v.categoryQuery, req.query);
      return tx(
        pool,
        async (c) => {
          const args = [searchPattern(q.q)],
            total = (
              await c.query<{ total: number }>(
                'SELECT count(*)::int AS total FROM product_categories WHERE name ILIKE $1',
                args,
              )
            ).rows[0]!.total;
          const items = (
            await c.query<CategoryRecord>(
              `SELECT ${categoryColumns} FROM product_categories WHERE name ILIKE $1 ORDER BY lower(name),id LIMIT $2 OFFSET $3`,
              [...args, q.pageSize, (q.page - 1) * q.pageSize],
            )
          ).rows;
          return { items, total, page: q.page, pageSize: q.pageSize };
        },
        true,
      );
    });
    scope.get('/api/admin/categories/:id', { preHandler: read }, (req) =>
      tx(pool, (c) => category(c, id(req)), true),
    );
    scope.post('/api/admin/categories', { preHandler: write }, async (req, reply) => {
      const b = parse(v.categorySchema, req.body),
        r = await tx(pool, async (c) => {
          await actor(c, req);
          const row = (
            await c.query<{ id: string }>(
              'INSERT INTO product_categories(name) VALUES($1) RETURNING id',
              [b.name],
            )
          ).rows[0]!;
          await audit(c, req, 'settings.category_created', 'category', row.id, { version: 1 });
          return category(c, row.id);
        });
      return reply.code(201).send(r);
    });
    scope.put('/api/admin/categories/:id', { preHandler: write }, async (req) => {
      const b = parse(v.categoryEdit, req.body);
      return tx(pool, async (c) => {
        await actor(c, req);
        const old = await category(c, id(req), true);
        version(b.version, old.version);
        await c.query(
          'UPDATE product_categories SET name=$2,version=version+1,updated_at=now() WHERE id=$1',
          [old.id, b.name],
        );
        await audit(c, req, 'settings.category_updated', 'category', old.id, {
          version: old.version + 1,
          fields: ['name'],
        });
        return category(c, old.id);
      });
    });
    scope.get('/api/admin/users', { preHandler: read }, async (req) => {
      const q = parse(v.listSchema, req.query);
      return tx(
        pool,
        async (c) => {
          const args = [q.status, searchPattern(q.q)],
            where = "($1='all' OR active=($1='active')) AND (name ILIKE $2 OR email ILIKE $2)";
          const total = (
            await c.query<{ total: number }>(
              `SELECT count(*)::int AS total FROM users WHERE ${where}`,
              args,
            )
          ).rows[0]!.total;
          const items = (
            await c.query<UserAccount>(
              `SELECT ${userColumns} FROM users WHERE ${where} ORDER BY lower(name),id LIMIT $3 OFFSET $4`,
              [...args, q.pageSize, (q.page - 1) * q.pageSize],
            )
          ).rows;
          return { items, total, page: q.page, pageSize: q.pageSize };
        },
        true,
      );
    });
    scope.get('/api/admin/users/:id', { preHandler: read }, (req) =>
      tx(pool, (c) => user(c, id(req)), true),
    );
    scope.post('/api/admin/users', { preHandler: write }, async (req, reply) => {
      const b = parse(v.userCreate, req.body),
        hash = await hashPassword(b.password);
      const r = await tx(pool, async (c) => {
        await c.query("SELECT pg_advisory_xact_lock(hashtext('nexovet:admin-users'))");
        await actor(c, req);
        const row = (
          await c.query<{ id: string }>(
            'INSERT INTO users(name,email,role,password_hash,active,login_enabled) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
            [b.name, b.email, b.role, hash, b.active, b.loginEnabled],
          )
        ).rows[0]!;
        await audit(c, req, 'settings.user_created', 'user', row.id, {
          version: 1,
          role: b.role,
          active: b.active,
          loginEnabled: b.loginEnabled,
        });
        return user(c, row.id);
      });
      return reply.code(201).send(r);
    });
    scope.put('/api/admin/users/:id', { preHandler: write }, async (req) => {
      const b = parse(v.userEdit, req.body),
        hash = b.password === null ? null : await hashPassword(b.password);
      return tx(pool, async (c) => {
        await c.query("SELECT pg_advisory_xact_lock(hashtext('nexovet:admin-users'))");
        await actor(c, req);
        const old = await user(c, id(req), true);
        version(b.version, old.version);
        if (
          old.id === req.identity!.user.id &&
          (!b.active || !b.loginEnabled || b.role !== 'admin')
        )
          throw new Problem(
            409,
            'No puedes quitar tu propio acceso administrativo. Usa otra cuenta administradora.',
            'SELF_ACCESS_PROTECTED',
          );
        if (
          old.role === 'admin' &&
          old.active &&
          old.loginEnabled &&
          (!b.active || !b.loginEnabled || b.role !== 'admin') &&
          (
            await c.query<{ n: number }>(
              "SELECT count(*)::int AS n FROM users WHERE role='admin' AND active AND login_enabled",
            )
          ).rows[0]!.n <= 1
        )
          throw new Problem(
            409,
            'Debe quedar al menos una cuenta administradora con acceso.',
            'LAST_ADMIN',
          );
        if (b.loginEnabled && !old.hasPassword && !hash)
          throw new Problem(409, 'Establece una contraseña para habilitar esta cuenta.');
        const changed =
          old.role !== b.role ||
          old.active !== b.active ||
          old.loginEnabled !== b.loginEnabled ||
          hash !== null;
        await c.query(
          'UPDATE users SET name=$2,role=$3,active=$4,login_enabled=$5,password_hash=coalesce($6,password_hash),version=version+1,updated_at=now() WHERE id=$1',
          [old.id, b.name, b.role, b.active, b.loginEnabled, hash],
        );
        let sessionsRevoked = 0;
        if (changed) {
          sessionsRevoked =
            (
              await c.query(
                'UPDATE user_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',
                [old.id],
              )
            ).rowCount ?? 0;
          await c.query(
            'UPDATE password_reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL',
            [old.id],
          );
        }
        await audit(c, req, 'settings.user_updated', 'user', old.id, {
          version: old.version + 1,
          role: b.role,
          active: b.active,
          loginEnabled: b.loginEnabled,
          passwordChanged: hash !== null,
          sessionsRevoked,
        });
        return user(c, old.id);
      });
    });
    scope.get('/api/admin/audit/options', { preHandler: read }, async () => ({
      ...v.defaults(),
      actions: (
        await pool.query('SELECT DISTINCT action FROM audit_logs ORDER BY action LIMIT 200')
      ).rows.map((r) => r.action),
      entityTypes: (
        await pool.query(
          'SELECT DISTINCT entity_type FROM audit_logs ORDER BY entity_type LIMIT 200',
        )
      ).rows.map((r) => r.entity_type),
    }));
    scope.get('/api/admin/audit', { preHandler: read }, async (req) => {
      const d = v.defaults(),
        q = parse(v.auditSchema, { from: d.from, to: d.to, ...(req.query as object) });
      return tx(
        pool,
        async (c) => {
          const where =
            "a.created_at>=$1 AND a.created_at<$2 AND ($3='' OR a.action=$3) AND ($4='' OR a.entity_type=$4) AND ($5::uuid IS NULL OR a.actor_id=$5) AND ($6::uuid IS NULL OR a.entity_id=$6) AND (a.action ILIKE $7 OR a.entity_type ILIKE $7 OR a.entity_id::text ILIKE $7 OR u.name ILIKE $7)";
          const args = [
            ...v.bounds(q.from, q.to),
            q.action,
            q.entityType,
            q.actorId ?? null,
            q.entityId ?? null,
            searchPattern(q.q),
          ];
          const from = 'FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id';
          const total = (
            await c.query<{ total: number }>(
              `SELECT count(*)::int AS total ${from} WHERE ${where}`,
              args,
            )
          ).rows[0]!.total;
          const rows = (
            await c.query<Omit<AuditRecord, 'summary'> & { metadata: unknown }>(
              `SELECT a.id::text,a.actor_id AS "actorId",u.name AS "actorName",a.action,a.entity_type AS "entityType",a.entity_id AS "entityId",${iso('a.created_at')} AS "createdAt",a.metadata ${from} WHERE ${where} ORDER BY a.created_at DESC,a.id DESC LIMIT $8 OFFSET $9`,
              [...args, q.pageSize, (q.page - 1) * q.pageSize],
            )
          ).rows;
          return {
            items: rows.map(({ metadata, ...r }) => ({ ...r, summary: auditSummary(metadata) })),
            total,
            page: q.page,
            pageSize: q.pageSize,
          };
        },
        true,
      );
    });
  });
}
