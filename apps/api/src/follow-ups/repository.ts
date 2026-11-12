import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import type { z } from 'zod';
import type { Role, FollowupRecord, ContactRecord } from '@nexovet/shared';
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
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw parsed.error;
  return parsed.data;
}
export async function tx<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
  readOnly = false,
) {
  const client = await pool.connect();
  try {
    await client.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
export function errors(scope: FastifyInstance) {
  scope.setErrorHandler((error, _request, reply) => {
    if (error instanceof Problem)
      return reply.code(error.status).send({ message: error.message, code: error.code });
    if (error && typeof error === 'object' && 'issues' in error && Array.isArray(error.issues)) {
      const fields: Record<string, string> = {};
      for (const issue of error.issues as Array<{ path: Array<string | number>; message: string }>)
        fields[String(issue.path[0] ?? 'form')] = issue.message;
      return reply.code(400).send({ message: 'Revisa los campos indicados.', fields });
    }
    const code = (error as { code?: string }).code;
    if (code === '23503')
      return reply.code(409).send({
        message:
          'La relación entre cliente, mascota y seguimiento ya no es válida. Recarga la ficha.',
      });
    if (code === '23505')
      return reply.code(409).send({
        message: 'La solicitud ya fue utilizada. Recarga la ficha.',
        code: 'REQUEST_CONFLICT',
      });
    scope.log.error({ code }, 'No se pudo procesar un seguimiento');
    const status = (error as { statusCode?: number }).statusCode;
    return reply
      .code(status && status >= 400 && status < 500 ? status : 500)
      .send({ message: 'No se pudo completar la operación. Intenta nuevamente.' });
  });
}
export function checkVersion(expected: number, actual: number) {
  if (expected !== actual)
    throw new Problem(
      409,
      'Otra persona actualizó este seguimiento. Carga la versión actual antes de guardar.',
      'VERSION_CONFLICT',
    );
}
const iso = (field: string) =>
  `to_char(${field} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
export const taskFrom =
  'FROM follow_up_tasks t JOIN clients c ON c.id=t.client_id LEFT JOIN pets p ON p.id=t.pet_id LEFT JOIN users u ON u.id=t.assigned_to LEFT JOIN users a ON a.id=t.created_by';
export const taskColumns = `t.id,t.client_id AS "clientId",c.name AS "clientName",t.pet_id AS "petId",p.name AS "petName",t.assigned_to AS "assignedTo",u.name AS "assigneeName",t.title,t.description,${iso('t.due_at')} AS "dueAt",to_char(t.due_at AT TIME ZONE 'America/Lima','YYYY-MM-DD') AS date,to_char(t.due_at AT TIME ZONE 'America/Lima','HH24:MI') AS time,t.status,${iso('t.completed_at')} AS "completedAt",t.version,${iso('t.created_at')} AS "createdAt",${iso('t.updated_at')} AS "updatedAt",a.name AS "createdByName",(SELECT count(*)::int FROM contact_events ce WHERE ce.task_id=t.id) AS "contactCount",(t.status='pending' AND t.due_at<now()) AS overdue`;
export async function getTask(
  client: PoolClient,
  id: string,
  request: FastifyRequest,
  lock = false,
) {
  const role = request.identity!.user.role,
    actor = request.identity!.user.id;
  if (
    lock &&
    !(
      await client.query(
        "SELECT id FROM follow_up_tasks WHERE id=$1 AND ($2<>'veterinarian' OR assigned_to=$3) FOR UPDATE",
        [id, role, actor],
      )
    ).rowCount
  )
    throw new Problem(404, 'No encontramos ese seguimiento en tus registros.');
  const record = (
    await client.query<FollowupRecord>(
      `SELECT ${taskColumns} ${taskFrom} WHERE t.id=$1 AND ($2<>'veterinarian' OR t.assigned_to=$3)`,
      [id, role, actor],
    )
  ).rows[0];
  if (!record) throw new Problem(404, 'No encontramos ese seguimiento en tus registros.');
  return record;
}
export async function target(client: PoolClient, clientId: string, petId: string | null) {
  const owner = (
    await client.query<{ active: boolean }>('SELECT active FROM clients WHERE id=$1 FOR SHARE', [
      clientId,
    ])
  ).rows[0];
  if (!owner) throw new Problem(404, 'No encontramos al cliente seleccionado.');
  if (!owner.active)
    throw new Problem(409, 'Reactiva al cliente antes de programar un seguimiento.');
  if (petId) {
    const pet = (
      await client.query<{ active: boolean; client_id: string }>(
        'SELECT active,client_id FROM pets WHERE id=$1 FOR SHARE',
        [petId],
      )
    ).rows[0];
    if (!pet || pet.client_id !== clientId)
      throw new Problem(400, 'La mascota no pertenece al cliente seleccionado.');
    if (!pet.active)
      throw new Problem(409, 'Reactiva la mascota antes de programar un seguimiento.');
  }
}
export async function assignee(client: PoolClient, id: string | null, request: FastifyRequest) {
  if (request.identity!.user.role === 'veterinarian' && id !== request.identity!.user.id)
    throw new Problem(403, 'Solo puedes crear o editar seguimientos asignados a tu cuenta.');
  if (
    id &&
    !(
      await client.query(
        'SELECT id FROM users WHERE id=$1 AND active AND login_enabled FOR SHARE',
        [id],
      )
    ).rowCount
  )
    throw new Problem(409, 'Selecciona una persona activa con acceso habilitado.');
}
export async function audit(
  client: PoolClient,
  request: FastifyRequest,
  action: string,
  type: 'follow_up' | 'contact',
  id: string,
  metadata: Record<string, unknown>,
) {
  await client.query(
    'INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,$3,$4,$5)',
    [request.identity!.user.id, action, type, id, metadata],
  );
}
export const contactFrom =
  'FROM contact_events e JOIN clients c ON c.id=e.client_id LEFT JOIN follow_up_tasks t ON t.id=e.task_id LEFT JOIN users u ON u.id=e.recorded_by';
export const contactColumns = `e.id,e.client_id AS "clientId",c.name AS "clientName",e.task_id AS "taskId",t.title AS "taskTitle",e.recorded_by AS "recordedBy",u.name AS "recorderName",e.channel,e.outcome,e.note,${iso('e.occurred_at')} AS "occurredAt",${iso('e.created_at')} AS "createdAt"`;
export async function getContact(client: PoolClient, id: string) {
  return (
    await client.query<ContactRecord>(`SELECT ${contactColumns} ${contactFrom} WHERE e.id=$1`, [id])
  ).rows[0]!;
}
