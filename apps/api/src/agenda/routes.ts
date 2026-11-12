import type { FastifyInstance } from 'fastify';
import { idSchema, searchPattern, todayInLima } from '../patients/validation.js';
import {
  appointmentSchema,
  rescheduleSchema,
  stateSchema,
  actionSchema,
  availabilitySchema,
  agendaQuerySchema,
  encounterSchema,
  historySchema,
  slotTimes,
} from './validation.js';
import {
  errors,
  tx,
  parse,
  Problem,
  appointment,
  lockAppointment,
  version,
  checkPatient,
  checkProfessional,
  checkService,
  futureSlot,
  audit,
  appointmentColumns,
  appointmentFrom,
  encounter,
  editableEncounter,
  encounterColumns,
  encounterFrom,
  type AgendaDependencies,
} from './repository.js';
import type { AppointmentRecord, AppointmentStatus, EncounterRecord } from '@nexovet/shared';
import { z } from 'zod';

export async function registerAgenda(
  app: FastifyInstance,
  { pool, requireSession, requireWrite, permit }: AgendaDependencies,
) {
  await app.register(async (scope) => {
    errors(scope);
    const operational = [requireSession, permit(['admin', 'reception']), requireWrite];
    const clinicalRead = [requireSession, permit(['admin', 'veterinarian'])];
    const clinicalWrite = [requireSession, permit(['veterinarian']), requireWrite];
    scope.get('/api/agenda/patients', { preHandler: requireSession }, async (request) => {
      const query = parse(
        z.object({ q: z.string().trim().min(2).max(100) }).strict(),
        request.query,
      );
      return (
        await pool.query(
          `SELECT p.id,p.name,p.species,c.name AS "ownerName" FROM pets p JOIN clients c ON c.id=p.client_id WHERE p.active AND c.active AND (p.name ILIKE $1 OR c.name ILIKE $1 OR p.microchip ILIKE $1) ORDER BY lower(p.name),p.id LIMIT 20`,
          [searchPattern(query.q)],
        )
      ).rows;
    });
    scope.get('/api/agenda/options', { preHandler: requireSession }, async () =>
      tx(
        pool,
        async (client) => ({
          professionals: (
            await client.query(
              "SELECT id,name FROM users WHERE role='veterinarian' AND active AND login_enabled ORDER BY name,id",
            )
          ).rows,
          services: (
            await client.query(
              'SELECT id,name,duration_minutes AS "durationMinutes" FROM services WHERE active ORDER BY name,id',
            )
          ).rows,
          today: todayInLima(),
          timezone: 'America/Lima',
        }),
        true,
      ),
    );
    scope.get('/api/appointments', { preHandler: requireSession }, async (request) => {
      const q = parse(agendaQuerySchema, request.query);
      return tx(
        pool,
        async (client) => {
          const where = `a.starts_at<($2::date+1)::timestamp AT TIME ZONE 'America/Lima' AND a.ends_at>($1::date)::timestamp AT TIME ZONE 'America/Lima' AND ($3::uuid IS NULL OR a.professional_id=$3) AND ($4='all' OR a.status=$4) AND (p.name ILIKE $5 OR c.name ILIKE $5)`;
          const args = [q.from, q.to, q.professionalId ?? null, q.status, searchPattern(q.q)];
          const total = (
            await client.query<{ total: number }>(
              `SELECT count(*)::int AS total ${appointmentFrom} WHERE ${where}`,
              args,
            )
          ).rows[0]!.total;
          const items = (
            await client.query<AppointmentRecord>(
              `SELECT ${appointmentColumns} ${appointmentFrom} WHERE ${where} ORDER BY a.starts_at,a.id LIMIT $6 OFFSET $7`,
              [...args, q.pageSize, (q.page - 1) * q.pageSize],
            )
          ).rows;
          return { items, total, page: q.page, pageSize: q.pageSize };
        },
        true,
      );
    });
    scope.get('/api/appointments/availability', { preHandler: requireSession }, async (request) => {
      const input = parse(availabilitySchema, request.query);
      const { start, end } = slotTimes(input);
      const conflicts = (
        await pool.query<{ kind: 'professional' | 'pet'; startsAt: string; endsAt: string }>(
          `SELECT 'professional' AS kind,starts_at::text AS "startsAt",ends_at::text AS "endsAt" FROM appointments WHERE professional_id=$1 AND status IN ('scheduled','confirmed','arrived','in_progress') AND tstzrange(starts_at,ends_at,'[)')&&tstzrange($3::timestamptz,$4::timestamptz,'[)') AND ($5::uuid IS NULL OR id<>$5)
      UNION ALL SELECT 'pet' AS kind,starts_at::text,ends_at::text FROM appointments WHERE pet_id=$2 AND status IN ('scheduled','confirmed','arrived','in_progress') AND tstzrange(starts_at,ends_at,'[)')&&tstzrange($3::timestamptz,$4::timestamptz,'[)') AND ($5::uuid IS NULL OR id<>$5)`,
          [input.professionalId, input.petId, start, end, input.excludeId ?? null],
        )
      ).rows;
      return { available: conflicts.length === 0, conflicts };
    });
    scope.get('/api/appointments/:id', { preHandler: requireSession }, async (request) =>
      tx(
        pool,
        (client) => appointment(client, parse(idSchema, (request.params as { id: string }).id)),
        true,
      ),
    );
    scope.post('/api/appointments', { preHandler: operational }, async (request, reply) => {
      const input = parse(appointmentSchema, request.body);
      const { start, end } = slotTimes(input);
      const saved = await tx(pool, async (client) => {
        await futureSlot(client, start);
        await checkPatient(client, input.petId);
        await checkProfessional(client, input.professionalId);
        await checkService(client, input.serviceId);
        const result = await client.query<{ id: string }>(
          `INSERT INTO appointments(pet_id,professional_id,service_id,starts_at,ends_at,reason,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [
            input.petId,
            input.professionalId,
            input.serviceId,
            start,
            end,
            input.reason,
            request.identity!.user.id,
          ],
        );
        const id = result.rows[0]!.id;
        await audit(client, request, 'appointment.created', 'appointment', id, {
          version: 1,
          status: 'scheduled',
        });
        return appointment(client, id);
      });
      return reply.header('Location', `/api/appointments/${saved.id}`).code(201).send(saved);
    });
    scope.put('/api/appointments/:id', { preHandler: operational }, async (request) => {
      const id = parse(idSchema, (request.params as { id: string }).id);
      const input = parse(rescheduleSchema, request.body);
      const { start, end } = slotTimes(input);
      return tx(pool, async (client) => {
        const old = await lockAppointment(client, id);
        version(input.version, old.version);
        if (!['scheduled', 'confirmed'].includes(old.status) || old.encounterId)
          throw new Problem(
            409,
            'Solo se reprograman citas programadas o confirmadas, antes de la llegada.',
          );
        await futureSlot(client, start);
        await checkPatient(client, old.petId);
        await checkProfessional(client, input.professionalId);
        await checkService(client, input.serviceId);
        await client.query(
          `UPDATE appointments SET professional_id=$2,service_id=$3,starts_at=$4,ends_at=$5,reason=$6,status='scheduled',version=version+1,updated_at=now() WHERE id=$1`,
          [id, input.professionalId, input.serviceId, start, end, input.reason],
        );
        await audit(client, request, 'appointment.rescheduled', 'appointment', id, {
          version: old.version + 1,
          previousStatus: old.status,
          status: 'scheduled',
        });
        return appointment(client, id);
      });
    });
    const transitions: Partial<Record<AppointmentStatus, readonly AppointmentStatus[]>> = {
      scheduled: ['confirmed', 'arrived', 'cancelled', 'no_show'],
      confirmed: ['arrived', 'cancelled', 'no_show'],
      arrived: ['cancelled'],
    };
    scope.post('/api/appointments/:id/status', { preHandler: operational }, async (request) => {
      const id = parse(idSchema, (request.params as { id: string }).id);
      const input = parse(stateSchema, request.body);
      return tx(pool, async (client) => {
        const old = await lockAppointment(client, id);
        version(input.version, old.version);
        if (old.encounterId || !transitions[old.status]?.includes(input.status))
          throw new Problem(409, 'Ese cambio no corresponde al estado actual de la cita.');
        if (
          input.status === 'no_show' &&
          !(await client.query('SELECT now()>=$1::timestamptz AS valid', [old.startsAt])).rows[0]
            .valid
        )
          throw new Problem(
            409,
            'La hora de la cita todavía no llegó. No se puede marcar inasistencia.',
          );
        await client.query(
          'UPDATE appointments SET status=$2,version=version+1,updated_at=now() WHERE id=$1',
          [id, input.status],
        );
        await audit(client, request, 'appointment.status_changed', 'appointment', id, {
          previousStatus: old.status,
          status: input.status,
          version: old.version + 1,
        });
        return appointment(client, id);
      });
    });
    scope.post(
      '/api/appointments/:id/start',
      { preHandler: clinicalWrite },
      async (request, reply) => {
        const id = parse(idSchema, (request.params as { id: string }).id);
        const input = parse(actionSchema, request.body);
        const saved = await tx(pool, async (client) => {
          const old = await lockAppointment(client, id);
          if (old.professionalId !== request.identity!.user.id)
            throw new Problem(403, 'Solo el veterinario asignado puede iniciar esta atención.');
          version(input.version, old.version);
          if (old.status !== 'arrived' || old.encounterId)
            throw new Problem(
              409,
              'Registra primero la llegada del paciente. La atención solo se inicia una vez.',
            );
          if (
            !(
              await client.query("SELECT $1::timestamptz<=now()+interval '30 minutes' AS valid", [
                old.startsAt,
              ])
            ).rows[0].valid
          )
            throw new Problem(
              409,
              'La atención puede iniciarse hasta 30 minutos antes del horario reservado.',
            );
          await checkPatient(client, old.petId);
          await checkProfessional(client, old.professionalId);
          await client.query(
            "UPDATE appointments SET status='in_progress',version=version+1,updated_at=now() WHERE id=$1",
            [id],
          );
          const result = await client.query<{ id: string }>(
            'INSERT INTO encounters(appointment_id,veterinarian_id) VALUES ($1,$2) RETURNING id',
            [id, request.identity!.user.id],
          );
          const encounterId = result.rows[0]!.id;
          await audit(client, request, 'appointment.started', 'appointment', id, {
            version: old.version + 1,
            status: 'in_progress',
          });
          await audit(client, request, 'encounter.created', 'encounter', encounterId, {
            version: 1,
            appointmentId: id,
          });
          return encounter(client, encounterId);
        });
        return reply.header('Location', `/api/encounters/${saved.id}`).code(201).send(saved);
      },
    );
    scope.get('/api/encounters/:id', { preHandler: clinicalRead }, async (request) =>
      tx(
        pool,
        (client) => encounter(client, parse(idSchema, (request.params as { id: string }).id)),
        true,
      ),
    );
    scope.put(
      '/api/encounters/:id',
      { preHandler: clinicalWrite, bodyLimit: 65536 },
      async (request) => {
        const id = parse(idSchema, (request.params as { id: string }).id);
        const input = parse(encounterSchema, request.body);
        return tx(pool, async (client) => {
          await editableEncounter(client, id, request.identity!.user.id, input.version);
          await client.query(
            'UPDATE encounters SET weight_kg=$2,temperature_c=$3,findings=$4,diagnosis=$5,treatment=$6,version=version+1,updated_at=now() WHERE id=$1',
            [
              id,
              input.weightKg,
              input.temperatureC,
              input.findings,
              input.diagnosis,
              input.treatment,
            ],
          );
          await audit(client, request, 'encounter.updated', 'encounter', id, {
            version: input.version + 1,
            fields: ['weightKg', 'temperatureC', 'findings', 'diagnosis', 'treatment'],
          });
          return encounter(client, id);
        });
      },
    );
    scope.post('/api/encounters/:id/close', { preHandler: clinicalWrite }, async (request) => {
      const id = parse(idSchema, (request.params as { id: string }).id);
      const input = parse(actionSchema, request.body);
      return tx(pool, async (client) => {
        const { record, appt } = await editableEncounter(
          client,
          id,
          request.identity!.user.id,
          input.version,
        );
        if (!record.findings.trim() || !record.diagnosis.trim() || !record.treatment.trim())
          throw new Problem(
            400,
            'Completa hallazgos, evaluación/diagnóstico y plan antes de cerrar la atención.',
          );
        await client.query(
          'UPDATE encounters SET closed_at=now(),version=version+1,updated_at=now() WHERE id=$1',
          [id],
        );
        await client.query(
          "UPDATE appointments SET status='completed',version=version+1,updated_at=now() WHERE id=$1",
          [appt.id],
        );
        await audit(client, request, 'encounter.closed', 'encounter', id, {
          version: record.version + 1,
          appointmentId: appt.id,
        });
        await audit(client, request, 'appointment.completed', 'appointment', appt.id, {
          version: appt.version + 1,
          status: 'completed',
        });
        return encounter(client, id);
      });
    });
    scope.get('/api/pets/:id/history', { preHandler: clinicalRead }, async (request) => {
      const id = parse(idSchema, (request.params as { id: string }).id);
      const q = parse(historySchema, request.query);
      return tx(
        pool,
        async (client) => {
          if (!(await client.query('SELECT id FROM pets WHERE id=$1', [id])).rowCount)
            throw new Problem(404, 'No encontramos esa mascota.');
          const total = (
            await client.query<{ total: number }>(
              `SELECT count(*)::int AS total ${encounterFrom} WHERE a.pet_id=$1`,
              [id],
            )
          ).rows[0]!.total;
          const items = (
            await client.query<EncounterRecord>(
              `SELECT ${encounterColumns} ${encounterFrom} WHERE a.pet_id=$1 ORDER BY a.starts_at DESC,e.id DESC LIMIT $2 OFFSET $3`,
              [id, q.pageSize, (q.page - 1) * q.pageSize],
            )
          ).rows;
          return { items, total, page: q.page, pageSize: q.pageSize };
        },
        true,
      );
    });
  });
}
