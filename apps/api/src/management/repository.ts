import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
import type {
  BusinessSettings,
  ServiceRecord,
  CategoryRecord,
  UserAccount,
  AuditRecord,
} from '@nexovet/shared';
import { Problem, iso } from '../inventory/repository.js';
export function errors(app: FastifyInstance) {
  app.setErrorHandler((e, req, reply) => {
    if (e instanceof Problem)
      return reply.code(e.status).send({ message: e.message, code: e.code });
    if (e && typeof e === 'object' && 'issues' in e && Array.isArray(e.issues)) {
      const fields: Record<string, string> = {};
      for (const i of e.issues as { path: (string | number)[]; message: string }[])
        fields[String(i.path[0] ?? 'form')] = i.message;
      return reply.code(400).send({
        message:
          req.method === 'GET'
            ? (Object.values(fields)[0] ?? 'Revisa los filtros indicados.')
            : 'Revisa los campos indicados.',
        fields,
      });
    }
    const code = (e as { code?: string }).code;
    if (code === '23505')
      return reply.code(409).send({
        message: 'Ya existe ese nombre o correo. Revisa los registros.',
        code: 'DUPLICATE_RECORD',
      });
    if (code === '23503')
      return reply
        .code(409)
        .send({ message: 'El registro está relacionado con otras operaciones. Recarga la ficha.' });
    if (code === '40P01')
      return reply.code(409).send({
        message: 'Hubo un cambio de acceso simultáneo. Recarga e intenta nuevamente.',
        code: 'ACCESS_CONFLICT',
      });
    app.log.error({ code }, 'No se pudo procesar administración');
    const s = (e as { statusCode?: number }).statusCode;
    return reply
      .code(s && s >= 400 && s < 500 ? s : 500)
      .send({ message: 'No se pudo completar la operación. Intenta nuevamente.' });
  });
}
export async function actor(c: PoolClient, r: FastifyRequest) {
  if (
    !(
      await c.query(
        "SELECT u.id FROM users u JOIN user_sessions s ON s.user_id=u.id WHERE u.id=$1 AND u.role='admin' AND u.active AND u.login_enabled AND s.id=$2 AND s.revoked_at IS NULL AND s.expires_at>now() FOR SHARE OF u,s",
        [r.identity!.user.id, r.identity!.sessionId],
      )
    ).rowCount
  )
    throw new Problem(403, 'Tu acceso administrativo cambió. Ingresa nuevamente.');
}
export const businessColumns = `name,address,currency,timezone,is_demo AS demo,version,${iso('updated_at')} AS "updatedAt"`;
export async function business(c: PoolClient, lock = false) {
  const r = (
    await c.query<BusinessSettings>(
      `SELECT ${businessColumns} FROM business_settings ${lock ? 'FOR UPDATE' : ''}`,
    )
  ).rows[0];
  if (!r) throw new Problem(404, 'El negocio aún no está configurado.');
  return r;
}
export const serviceColumns = `id,name,duration_minutes AS "durationMinutes",price::text,active,version,${iso('updated_at')} AS "updatedAt"`;
export const categoryColumns = `id,name,version,${iso('updated_at')} AS "updatedAt"`;
export const userColumns = `id,name,email,role,active,login_enabled AS "loginEnabled",(password_hash IS NOT NULL) AS "hasPassword",version,${iso('updated_at')} AS "updatedAt"`;
export async function service(c: PoolClient, id: string, lock = false) {
  const r = (
    await c.query<ServiceRecord>(
      `SELECT ${serviceColumns} FROM services WHERE id=$1 ${lock ? 'FOR UPDATE' : ''}`,
      [id],
    )
  ).rows[0];
  if (!r) throw new Problem(404, 'No encontramos ese servicio.');
  return r;
}
export async function category(c: PoolClient, id: string, lock = false) {
  const r = (
    await c.query<CategoryRecord>(
      `SELECT ${categoryColumns} FROM product_categories WHERE id=$1 ${lock ? 'FOR UPDATE' : ''}`,
      [id],
    )
  ).rows[0];
  if (!r) throw new Problem(404, 'No encontramos esa categoría.');
  return r;
}
export async function user(c: PoolClient, id: string, lock = false) {
  const r = (
    await c.query<UserAccount>(
      `SELECT ${userColumns} FROM users WHERE id=$1 ${lock ? 'FOR UPDATE' : ''}`,
      [id],
    )
  ).rows[0];
  if (!r) throw new Problem(404, 'No encontramos esa cuenta.');
  return r;
}
export function auditSummary(meta: unknown): AuditRecord['summary'] {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {};
  const m = meta as Record<string, unknown>,
    out: AuditRecord['summary'] = {};
  for (const key of ['version', 'lineCount', 'paymentCount', 'sessionsRevoked']) {
    const v = m[key];
    if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) out[key] = v;
  }
  for (const key of ['active', 'loginEnabled', 'passwordChanged'])
    if (typeof m[key] === 'boolean') out[key] = m[key];
  for (const key of ['total', 'quantity'])
    if (typeof m[key] === 'string' && /^-?\d{1,18}(\.\d{1,3})?$/.test(m[key])) out[key] = m[key];
  const statuses = new Set([
    'draft',
    'received',
    'confirmed',
    'cancelled',
    'scheduled',
    'arrived',
    'in_progress',
    'completed',
    'no_show',
    'pending',
  ]);
  for (const key of ['status', 'previousStatus'])
    if (typeof m[key] === 'string' && statuses.has(m[key])) out[key] = m[key];
  if (typeof m.role === 'string' && ['admin', 'reception', 'veterinarian'].includes(m.role))
    out.role = m.role;
  if (Array.isArray(m.fields)) {
    const allowed = new Set([
      'name',
      'address',
      'role',
      'active',
      'loginEnabled',
      'durationMinutes',
      'price',
      'assignedTo',
      'title',
      'description',
      'dueAt',
      'date',
      'time',
      'status',
    ]);
    out.fields = m.fields.filter((v): v is string => typeof v === 'string' && allowed.has(v));
  }
  return out;
}
