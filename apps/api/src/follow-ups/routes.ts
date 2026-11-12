import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import type { FollowupRecord, FollowupStats } from '@nexovet/shared';
import { idSchema, searchPattern, todayInLima } from '../patients/validation.js';
import {
  taskSchema,
  taskEditSchema,
  taskStateSchema,
  taskQuerySchema,
  targetSchema,
  contactSchema,
  contactQuerySchema,
  localInstant,
} from './validation.js';
import {
  tx,
  parse,
  Problem,
  errors,
  checkVersion,
  getTask,
  target,
  assignee,
  audit,
  taskColumns,
  taskFrom,
  contactColumns,
  contactFrom,
  getContact,
  type Dependencies,
} from './repository.js';

export async function registerFollowups(
  app: FastifyInstance,
  { pool, requireSession, requireWrite, permit }: Dependencies,
) {
  await app.register(async (scope) => {
    errors(scope);
    const write = [requireSession, requireWrite],
      contactsRead = [requireSession, permit(['admin', 'reception'])],
      contactsWrite = [...contactsRead, requireWrite];
    scope.get('/api/follow-ups/options', { preHandler: requireSession }, async (request) => {
      const user = request.identity!.user;
      const team = (
        await pool.query(
          "SELECT id,name,role FROM users WHERE active AND login_enabled AND ($1<>'veterinarian' OR id=$2) ORDER BY name,id",
          [user.role, user.id],
        )
      ).rows;
      return {
        team,
        today: todayInLima(),
        time: new Intl.DateTimeFormat('en-GB', {
          timeZone: 'America/Lima',
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        }).format(new Date()),
        canCoordinate: user.role !== 'veterinarian',
      };
    });
    scope.get('/api/follow-ups/targets', { preHandler: requireSession }, async (request) => {
      const q = parse(targetSchema, request.query);
      if (q.kind === 'client' && request.identity!.user.role === 'veterinarian')
        throw new Problem(403, 'Selecciona una mascota para crear tu seguimiento.');
      return q.kind === 'client'
        ? (
            await pool.query(
              `SELECT id AS "clientId",name AS "clientName",NULL::uuid AS "petId",NULL::text AS "petName" FROM clients WHERE active AND (name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1 OR document_number ILIKE $1) ORDER BY lower(name),id LIMIT 20`,
              [searchPattern(q.q)],
            )
          ).rows
        : (
            await pool.query(
              `SELECT c.id AS "clientId",c.name AS "clientName",p.id AS "petId",p.name AS "petName" FROM pets p JOIN clients c ON c.id=p.client_id WHERE p.active AND c.active AND (p.name ILIKE $1 OR c.name ILIKE $1 OR p.microchip ILIKE $1) ORDER BY lower(p.name),p.id LIMIT 20`,
              [searchPattern(q.q)],
            )
          ).rows;
    });
    scope.get(
      '/api/follow-ups/stats',
      { preHandler: requireSession },
      async (request) =>
        (
          await pool.query<FollowupStats>(
            `SELECT count(*) FILTER (WHERE status='pending')::int AS pending,count(*) FILTER (WHERE status='pending' AND due_at<now())::int AS overdue,count(*) FILTER (WHERE status='pending' AND (due_at AT TIME ZONE 'America/Lima')::date=(now() AT TIME ZONE 'America/Lima')::date)::int AS today,count(*) FILTER (WHERE status='completed')::int AS completed FROM follow_up_tasks WHERE ($1<>'veterinarian' OR assigned_to=$2)`,
            [request.identity!.user.role, request.identity!.user.id],
          )
        ).rows[0],
    );
    scope.get('/api/follow-ups', { preHandler: requireSession }, async (request) => {
      const q = parse(taskQuerySchema, request.query),
        user = request.identity!.user;
      return tx(
        pool,
        async (client) => {
          const where = `($1<>'veterinarian' OR t.assigned_to=$2) AND ($3='all' OR t.status=$3) AND (t.title ILIKE $4 OR c.name ILIKE $4 OR p.name ILIKE $4) AND ($5::uuid IS NULL OR t.client_id=$5) AND ($6::uuid IS NULL OR t.pet_id=$6) AND ($7='all' OR ($7='mine' AND t.assigned_to=$2) OR ($7='unassigned' AND t.assigned_to IS NULL) OR t.assigned_to::text=$7) AND ($8='all' OR ($8='overdue' AND t.status='pending' AND t.due_at<now()) OR ($8='today' AND (t.due_at AT TIME ZONE 'America/Lima')::date=(now() AT TIME ZONE 'America/Lima')::date) OR ($8='next7' AND t.due_at>=now() AND t.due_at<now()+interval '7 days'))`;
          const args = [
            user.role,
            user.id,
            q.status,
            searchPattern(q.q),
            q.clientId ?? null,
            q.petId ?? null,
            q.assignee,
            q.period,
          ];
          const total = (
            await client.query<{ total: number }>(
              `SELECT count(*)::int AS total ${taskFrom} WHERE ${where}`,
              args,
            )
          ).rows[0]!.total;
          const items = (
            await client.query<FollowupRecord>(
              `SELECT ${taskColumns} ${taskFrom} WHERE ${where} ORDER BY t.due_at,t.id LIMIT $9 OFFSET $10`,
              [...args, q.pageSize, (q.page - 1) * q.pageSize],
            )
          ).rows;
          return { items, total, page: q.page, pageSize: q.pageSize };
        },
        true,
      );
    });
    scope.get('/api/follow-ups/:id', { preHandler: requireSession }, async (request) =>
      tx(
        pool,
        (client) =>
          getTask(client, parse(idSchema, (request.params as { id: string }).id), request),
        true,
      ),
    );
    scope.post('/api/follow-ups', { preHandler: write }, async (request, reply) => {
      const input = parse(taskSchema, request.body);
      if (request.identity!.user.role === 'veterinarian' && !input.petId)
        throw new Problem(400, 'Selecciona una mascota para tu seguimiento.');
      const saved = await tx(pool, async (client) => {
        await target(client, input.clientId, input.petId);
        await assignee(client, input.assignedTo, request);
        const result = await client.query<{ id: string }>(
          'INSERT INTO follow_up_tasks(client_id,pet_id,assigned_to,title,description,due_at,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
          [
            input.clientId,
            input.petId,
            input.assignedTo,
            input.title,
            input.description,
            localInstant(input.date, input.time),
            request.identity!.user.id,
          ],
        );
        const id = result.rows[0]!.id;
        await audit(client, request, 'follow_up.created', 'follow_up', id, {
          version: 1,
          status: 'pending',
        });
        return getTask(client, id, request);
      });
      return reply.header('Location', `/api/follow-ups/${saved.id}`).code(201).send(saved);
    });
    scope.put('/api/follow-ups/:id', { preHandler: write }, async (request) => {
      const id = parse(idSchema, (request.params as { id: string }).id),
        input = parse(taskEditSchema, request.body);
      return tx(pool, async (client) => {
        const old = await getTask(client, id, request, true);
        checkVersion(input.version, old.version);
        if (old.status !== 'pending')
          throw new Problem(
            409,
            'Solo se editan seguimientos pendientes. Puedes crear otro para una nueva gestión.',
          );
        await target(client, old.clientId, old.petId);
        await assignee(client, input.assignedTo, request);
        await client.query(
          'UPDATE follow_up_tasks SET assigned_to=$2,title=$3,description=$4,due_at=$5,version=version+1,updated_at=now() WHERE id=$1',
          [
            id,
            input.assignedTo,
            input.title,
            input.description,
            localInstant(input.date, input.time),
          ],
        );
        await audit(client, request, 'follow_up.updated', 'follow_up', id, {
          version: old.version + 1,
          fields: ['assignedTo', 'title', 'description', 'dueAt'],
        });
        return getTask(client, id, request);
      });
    });
    scope.post('/api/follow-ups/:id/status', { preHandler: write }, async (request) => {
      const id = parse(idSchema, (request.params as { id: string }).id),
        input = parse(taskStateSchema, request.body);
      return tx(pool, async (client) => {
        const old = await getTask(client, id, request, true);
        checkVersion(input.version, old.version);
        if (old.status !== 'pending')
          throw new Problem(
            409,
            'Este seguimiento ya terminó. Crea otro si necesitas una nueva gestión.',
          );
        await client.query(
          "UPDATE follow_up_tasks SET status=$2,completed_at=CASE WHEN $2='completed' THEN now() END,version=version+1,updated_at=now() WHERE id=$1",
          [id, input.status],
        );
        await audit(client, request, 'follow_up.status_changed', 'follow_up', id, {
          version: old.version + 1,
          previousStatus: old.status,
          status: input.status,
        });
        return getTask(client, id, request);
      });
    });
    scope.get('/api/contact-events', { preHandler: contactsRead }, async (request) => {
      const q = parse(contactQuerySchema, request.query);
      return tx(
        pool,
        async (client) => {
          const where =
            '($1::uuid IS NULL OR e.client_id=$1) AND ($2::uuid IS NULL OR e.task_id=$2) AND (c.name ILIKE $3 OR t.title ILIKE $3)';
          const args = [q.clientId ?? null, q.taskId ?? null, searchPattern(q.q)];
          const total = (
            await client.query<{ total: number }>(
              `SELECT count(*)::int AS total ${contactFrom} WHERE ${where}`,
              args,
            )
          ).rows[0]!.total;
          const items = (
            await client.query(
              `SELECT ${contactColumns} ${contactFrom} WHERE ${where} ORDER BY e.occurred_at DESC,e.id DESC LIMIT $4 OFFSET $5`,
              [...args, q.pageSize, (q.page - 1) * q.pageSize],
            )
          ).rows;
          return { items, total, page: q.page, pageSize: q.pageSize };
        },
        true,
      );
    });
    scope.post('/api/contact-events', { preHandler: contactsWrite }, async (request, reply) => {
      const input = parse(contactSchema, request.body);
      const { requestId, ...payload } = input;
      const fingerprint = createHash('sha256')
        .update(
          JSON.stringify(
            Object.keys(payload)
              .sort()
              .map((key) => [key, payload[key as keyof typeof payload]]),
          ),
        )
        .digest('hex');
      const result = await tx(pool, async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          `nexovet:contact:${requestId}`,
        ]);
        const existing = (
          await client.query<{ id: string; recorded_by: string; request_fingerprint: string }>(
            'SELECT id,recorded_by,request_fingerprint FROM contact_events WHERE request_id=$1',
            [requestId],
          )
        ).rows[0];
        if (existing) {
          if (
            existing.recorded_by !== request.identity!.user.id ||
            existing.request_fingerprint !== fingerprint
          )
            throw new Problem(
              409,
              'Este identificador ya se usó para otra solicitud. Abre un registro nuevo.',
              'REQUEST_CONFLICT',
            );
          return { record: await getContact(client, existing.id), replayed: true };
        }
        const task = input.taskId ? await getTask(client, input.taskId, request, true) : null;
        if (task) {
          checkVersion(input.taskVersion!, task.version);
          if (task.clientId !== input.clientId)
            throw new Problem(
              400,
              'El contacto y el seguimiento deben pertenecer al mismo cliente.',
            );
        }
        if (
          !(await client.query('SELECT id FROM clients WHERE id=$1 FOR SHARE', [input.clientId]))
            .rowCount
        )
          throw new Problem(404, 'No encontramos ese cliente.');
        const occurredAt = localInstant(input.date, input.time);
        if (
          !(
            await client.query("SELECT $1::timestamptz<=now()+interval '5 minutes' AS valid", [
              occurredAt,
            ])
          ).rows[0].valid
        )
          throw new Problem(400, 'Registra un contacto ya realizado, no una comunicación futura.');
        if (input.completeTask && task?.status !== 'pending')
          throw new Problem(409, 'El seguimiento ya terminó. Recarga su estado.');
        const saved = (
          await client.query<{ id: string }>(
            'INSERT INTO contact_events(client_id,task_id,recorded_by,channel,outcome,note,occurred_at,request_id,request_fingerprint) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
            [
              input.clientId,
              input.taskId,
              request.identity!.user.id,
              input.channel,
              input.outcome,
              input.note,
              occurredAt,
              requestId,
              fingerprint,
            ],
          )
        ).rows[0]!;
        if (input.completeTask && task) {
          await client.query(
            "UPDATE follow_up_tasks SET status='completed',completed_at=now(),version=version+1,updated_at=now() WHERE id=$1",
            [task.id],
          );
          await audit(client, request, 'follow_up.completed_with_contact', 'follow_up', task.id, {
            version: task.version + 1,
            status: 'completed',
            contactId: saved.id,
          });
        }
        await audit(client, request, 'contact.recorded', 'contact', saved.id, {
          taskId: input.taskId,
          channel: input.channel,
          outcome: input.outcome,
        });
        return { record: await getContact(client, saved.id), replayed: false };
      });
      if (result.replayed) reply.header('Idempotent-Replay', 'true');
      return reply
        .header('Location', `/api/contact-events?clientId=${input.clientId}`)
        .code(201)
        .send(result.record);
    });
  });
}
