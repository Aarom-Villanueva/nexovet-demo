import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import type { z } from 'zod';
import type { AppointmentRecord, EncounterRecord, Role } from '@nexovet/shared';

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | void>;
export interface AgendaDependencies {
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
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw result.error;
  return result.data;
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
    if (code === '23P01')
      return reply.code(409).send({
        message:
          'Ese horario se cruza con otra cita del profesional o de la mascota. Elige otro horario.',
        code: 'SLOT_CONFLICT',
      });
    if (code === '23505')
      return reply.code(409).send({
        message: 'La cita ya tiene una atención. Recarga la ficha.',
        code: 'ALREADY_STARTED',
      });
    if ((code === '23514' && !(error as { constraint?: string }).constraint) || code === '23503')
      return reply.code(409).send({
        message:
          'No se pudo completar el cambio con el estado actual de la cita. Recarga la ficha.',
      });
    scope.log.error({ code }, 'No se pudo procesar la agenda');
    const status = (error as { statusCode?: number }).statusCode;
    return reply
      .code(status && status >= 400 && status < 500 ? status : 500)
      .send({ message: 'No se pudo completar la operación. Intenta nuevamente.' });
  });
}
export const appointmentFrom = `FROM appointments a JOIN pets p ON p.id=a.pet_id JOIN clients c ON c.id=p.client_id JOIN users u ON u.id=a.professional_id JOIN services s ON s.id=a.service_id LEFT JOIN encounters e ON e.appointment_id=a.id`;
export const appointmentColumns = `a.id,a.pet_id AS "petId",a.professional_id AS "professionalId",a.service_id AS "serviceId",p.name AS "petName",p.species,c.name AS "ownerName",u.name AS "professionalName",s.name AS "serviceName",a.starts_at::text AS "startsAt",a.ends_at::text AS "endsAt",to_char(a.starts_at AT TIME ZONE 'America/Lima','YYYY-MM-DD') AS date,to_char(a.starts_at AT TIME ZONE 'America/Lima','HH24:MI') AS "startTime",to_char(a.ends_at AT TIME ZONE 'America/Lima','HH24:MI') AS "endTime",(extract(epoch FROM a.ends_at-a.starts_at)/60)::int AS "durationMinutes",a.reason,a.status,a.version,e.id AS "encounterId",e.closed_at::text AS "encounterClosedAt"`;
export async function appointment(client: PoolClient, id: string) {
  const row = (
    await client.query<AppointmentRecord>(
      `SELECT ${appointmentColumns} ${appointmentFrom} WHERE a.id=$1`,
      [id],
    )
  ).rows[0];
  if (!row) throw new Problem(404, 'No encontramos esa cita.');
  return row;
}
export async function lockAppointment(client: PoolClient, id: string) {
  if (!(await client.query('SELECT id FROM appointments WHERE id=$1 FOR UPDATE', [id])).rowCount)
    throw new Problem(404, 'No encontramos esa cita.');
  return appointment(client, id);
}
export function version(expected: number, actual: number) {
  if (expected !== actual)
    throw new Problem(
      409,
      'Otra persona actualizó este registro. Carga la versión actual antes de guardar.',
      'VERSION_CONFLICT',
    );
}
export async function checkPatient(client: PoolClient, id: string) {
  const pet = (
    await client.query<{ client_id: string }>('SELECT client_id FROM pets WHERE id=$1', [id])
  ).rows[0];
  if (!pet) throw new Problem(404, 'No encontramos la mascota seleccionada.');
  // Orden coherente con altas de pacientes: responsable antes de mascota.
  const owner = (
    await client.query<{ active: boolean }>('SELECT active FROM clients WHERE id=$1 FOR SHARE', [
      pet.client_id,
    ])
  ).rows[0];
  const patient = (
    await client.query<{ active: boolean; client_id: string }>(
      'SELECT active,client_id FROM pets WHERE id=$1 FOR SHARE',
      [id],
    )
  ).rows[0];
  if (!owner?.active || !patient?.active || patient.client_id !== pet.client_id)
    throw new Problem(
      409,
      'Reactiva la ficha del responsable y de la mascota antes de programar o iniciar la atención.',
    );
}
export async function checkProfessional(client: PoolClient, id: string) {
  if (
    !(
      await client.query(
        "SELECT id FROM users WHERE id=$1 AND active AND login_enabled AND role='veterinarian' FOR SHARE",
        [id],
      )
    ).rowCount
  )
    throw new Problem(409, 'Selecciona un veterinario activo con acceso habilitado.');
}
export async function checkService(client: PoolClient, id: string) {
  if (
    !(await client.query('SELECT id FROM services WHERE id=$1 AND active FOR SHARE', [id])).rowCount
  )
    throw new Problem(409, 'Selecciona un servicio activo.');
}
export async function futureSlot(client: PoolClient, start: string) {
  if (
    !(await client.query("SELECT $1::timestamptz>=now()-interval '5 minutes' AS valid", [start]))
      .rows[0].valid
  )
    throw new Problem(400, 'No se puede programar un horario pasado. Revisa fecha y hora.');
}
export async function audit(
  client: PoolClient,
  request: FastifyRequest,
  action: string,
  type: 'appointment' | 'encounter',
  id: string,
  metadata: Record<string, unknown>,
) {
  await client.query(
    'INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,$3,$4,$5)',
    [request.identity!.user.id, action, type, id, metadata],
  );
}
export const encounterFrom = `FROM encounters e JOIN appointments a ON a.id=e.appointment_id JOIN pets p ON p.id=a.pet_id JOIN clients c ON c.id=p.client_id JOIN users u ON u.id=e.veterinarian_id JOIN services s ON s.id=a.service_id`;
export const encounterColumns = `e.id,e.appointment_id AS "appointmentId",a.pet_id AS "petId",p.name AS "petName",c.name AS "ownerName",e.veterinarian_id AS "veterinarianId",u.name AS "veterinarianName",s.name AS "serviceName",a.starts_at::text AS "startsAt",e.weight_kg::float8 AS "weightKg",e.temperature_c::float8 AS "temperatureC",e.findings,e.diagnosis,e.treatment,e.closed_at::text AS "closedAt",e.created_at::text AS "createdAt",e.updated_at::text AS "updatedAt",e.version`;
export async function encounter(client: PoolClient, id: string) {
  const row = (
    await client.query<EncounterRecord>(
      `SELECT ${encounterColumns} ${encounterFrom} WHERE e.id=$1`,
      [id],
    )
  ).rows[0];
  if (!row) throw new Problem(404, 'No encontramos esa atención.');
  return row;
}
export async function editableEncounter(
  client: PoolClient,
  id: string,
  actor: string,
  expected: number,
) {
  const entry = (
    await client.query<{ appointment_id: string }>(
      'SELECT appointment_id FROM encounters WHERE id=$1',
      [id],
    )
  ).rows[0];
  if (!entry) throw new Problem(404, 'No encontramos esa atención.');
  const appt = await lockAppointment(client, entry.appointment_id);
  const record = await encounter(client, id);
  if (record.veterinarianId !== actor || appt.professionalId !== actor)
    throw new Problem(403, 'Solo el veterinario asignado puede registrar esta atención.');
  if (record.closedAt || appt.status !== 'in_progress')
    throw new Problem(409, 'La atención está cerrada y conserva su contenido.', 'ENCOUNTER_CLOSED');
  version(expected, record.version);
  return { record, appt };
}
