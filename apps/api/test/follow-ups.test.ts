import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Role, FollowupInput, FollowupRecord, ContactInput } from '@nexovet/shared';
import { buildApp } from '../src/app.js';
import { parseConfig } from '../src/config.js';
import { createPool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrations.js';
import { seed } from '../src/db/seeds.js';
import { hashPassword } from '../src/auth/crypto.js';
import { getDemoOverview } from '../src/demo.js';
const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/nexovet_test')
  throw new Error('Seguimientos requiere nexovet_test');
const pool = createPool(url),
  origin = 'http://127.0.0.1:5173';
const config = parseConfig({ DATABASE_URL: url, NODE_ENV: 'test', APP_ORIGIN: origin });
const app = buildApp({
  ready: async () => {},
  overview: (role, id) => getDemoOverview(pool, role, id),
  auth: { pool, config, sendMail: async () => {} },
});
type Person = { id: string; headers: Record<string, string> };
let admin: Person, reception: Person, vet: Person, other: Person;
const users: string[] = [],
  owners: string[] = [],
  pets: string[] = [],
  tasks: string[] = [];
const contacts = new Set<string>();
const prefix = `Seguimiento ${randomUUID().slice(0, 8)}`;
let now: { today: string; time: string };
before(async () => {
  await migrate(pool);
  await seed(pool, { NODE_ENV: 'test', DATABASE_URL: url });
  await pool.query('DELETE FROM auth_rate_limits');
  const password = 'Seguimientos ficticios 2026',
    hash = await hashPassword(password);
  async function person(role: Role) {
    const id = randomUUID(),
      email = `follow-${id}@example.invalid`;
    await pool.query(
      'INSERT INTO users(id,name,email,role,password_hash,login_enabled) VALUES ($1,$2,$3,$4,$5,true)',
      [id, `${prefix} ${role}`, email, role, hash],
    );
    users.push(id);
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin },
      payload: { email, password },
    });
    assert.equal(response.statusCode, 200);
    return {
      id,
      headers: {
        origin,
        cookie: `nexovet_session=${response.cookies[0]!.value}`,
        'x-csrf-token': response.json().csrfToken,
      },
    };
  }
  admin = await person('admin');
  reception = await person('reception');
  vet = await person('veterinarian');
  other = await person('veterinarian');
  now = (await app.inject({ url: '/api/follow-ups/options', headers: admin.headers })).json();
});
after(async () => {
  await app.close();
  await pool.query('DELETE FROM contact_events WHERE id=ANY($1::uuid[])', [[...contacts]]);
  await pool.query('DELETE FROM follow_up_tasks WHERE id=ANY($1::uuid[])', [tasks]);
  await pool.query('DELETE FROM pets WHERE id=ANY($1::uuid[])', [pets]);
  await pool.query('DELETE FROM clients WHERE id=ANY($1::uuid[])', [owners]);
  await pool.query('UPDATE users SET active=false,login_enabled=false WHERE id=ANY($1::uuid[])', [
    users,
  ]);
  await pool.end();
});
async function target() {
  const clientId = randomUUID(),
    petId = randomUUID();
  await pool.query('INSERT INTO clients(id,name,email,phone) VALUES ($1,$2,$3,$4)', [
    clientId,
    `${prefix} familia ${owners.length}`,
    'privado-follow@example.invalid',
    '000000000',
  ]);
  owners.push(clientId);
  await pool.query("INSERT INTO pets(id,client_id,name,species) VALUES ($1,$2,$3,'cat')", [
    petId,
    clientId,
    `${prefix} paciente ${pets.length}`,
  ]);
  pets.push(petId);
  return { clientId, petId };
}
function post(path: string, payload: unknown, actor = reception) {
  return app.inject({ method: 'POST', url: path, headers: actor.headers, payload });
}
function input(
  target: { clientId: string; petId: string | null },
  assignedTo: string | null = null,
): FollowupInput {
  return {
    ...target,
    assignedTo,
    title: `${prefix} tarea ${randomUUID().slice(0, 6)}`,
    description: 'Indicaciones operativas ficticias',
    date: '2040-05-01',
    time: '10:30',
  };
}
async function create(body: FollowupInput, actor = reception) {
  const response = await post('/api/follow-ups', body, actor);
  assert.equal(response.statusCode, 201, response.body);
  const saved = response.json<FollowupRecord>();
  tasks.push(saved.id);
  return saved;
}
const contactInput = (task: FollowupRecord | null, clientId: string): ContactInput => ({
  requestId: randomUUID(),
  clientId,
  taskId: task?.id ?? null,
  taskVersion: task?.version ?? null,
  channel: 'phone',
  outcome: 'contacted',
  note: 'Comunicación ficticia de prueba',
  date: now.today,
  time: now.time,
  completeTask: false,
});
async function contact(body: ContactInput, actor = reception) {
  const response = await post('/api/contact-events', body, actor);
  if (response.statusCode === 201) contacts.add(response.json().id);
  return response;
}
test('crear y editar conserva vínculo, zona Lima y versiones', async () => {
  const link = await target(),
    body = input(link, reception.id);
  const saved = await create(body);
  assert.equal(new Date(saved.dueAt).toISOString(), '2040-05-01T15:30:00.000Z');
  assert.equal(saved.version, 1);
  assert.equal(saved.petId, link.petId);
  assert.equal(saved.assignedTo, reception.id);
  assert.equal(saved.createdByName, `${prefix} reception`);
  const { clientId: _, petId: __, ...edit } = body;
  const response = await app.inject({
    method: 'PUT',
    url: `/api/follow-ups/${saved.id}`,
    headers: admin.headers,
    payload: { ...edit, title: 'Tarea corregida', time: '11:45', version: 1 },
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().version, 2);
  assert.equal(response.json().time, '11:45');
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: `/api/follow-ups/${saved.id}`,
        headers: admin.headers,
        payload: { ...edit, clientId: randomUUID(), version: 2 },
      })
    ).statusCode,
    400,
  );
});
test('cliente/mascota activos y relación correcta; no se asigna a cuentas deshabilitadas', async () => {
  const a = await target(),
    b = await target();
  assert.equal(
    (await post('/api/follow-ups', input({ clientId: a.clientId, petId: b.petId }))).statusCode,
    400,
  );
  await pool.query('UPDATE clients SET active=false WHERE id=$1', [a.clientId]);
  assert.equal((await post('/api/follow-ups', input(a))).statusCode, 409);
  await pool.query('UPDATE clients SET active=true WHERE id=$1', [a.clientId]);
  await pool.query('UPDATE pets SET active=false WHERE id=$1', [a.petId]);
  assert.equal((await post('/api/follow-ups', input(a))).statusCode, 409);
  await pool.query('UPDATE users SET login_enabled=false WHERE id=$1', [other.id]);
  try {
    assert.equal((await post('/api/follow-ups', input(b, other.id))).statusCode, 409);
  } finally {
    await pool.query('UPDATE users SET login_enabled=true WHERE id=$1', [other.id]);
  }
  assert.equal(
    (await post('/api/follow-ups', input({ clientId: randomUUID(), petId: null }))).statusCode,
    404,
  );
});
test('listas buscan literalmente, filtran fechas y paginan con orden estable', async () => {
  const link = await target();
  for (let i = 0; i < 4; i++)
    await create({
      ...input(link, reception.id),
      title: `Filtro %_ ${prefix} ${i}`,
      date: i === 0 ? '2000-01-01' : '2040-05-01',
    });
  const query = `/api/follow-ups?q=${encodeURIComponent(`Filtro %_ ${prefix}`)}&pageSize=2`;
  const first = (await app.inject({ url: query, headers: admin.headers })).json(),
    second = (await app.inject({ url: `${query}&page=2`, headers: admin.headers })).json();
  assert.equal(first.total, 4);
  assert.equal(first.items.length, 2);
  assert.notDeepEqual(
    first.items.map((x: FollowupRecord) => x.id),
    second.items.map((x: FollowupRecord) => x.id),
  );
  assert.equal(first.items[0].overdue, true);
  assert.equal(
    (await app.inject({ url: `${query}&period=overdue`, headers: admin.headers })).json().total,
    1,
  );
  assert.equal(
    (
      await app.inject({
        url: `${query}&assignee=${reception.id.toUpperCase()}`,
        headers: admin.headers,
      })
    ).json().total,
    4,
  );
  assert.equal(
    (
      await app.inject({
        url: `/api/follow-ups?q=${encodeURIComponent("' OR 1=1 --")}`,
        headers: admin.headers,
      })
    ).json().total,
    0,
  );
});
test('veterinario solo gestiona asignados propios; resumen, indicadores y búsquedas no filtran tareas ajenas', async () => {
  const link = await target();
  const own = await create(input(link, vet.id), vet);
  const hidden = await create({ ...input(link, other.id), title: `Privado ${randomUUID()}` });
  for (const path of [`/api/follow-ups/${hidden.id}`])
    assert.equal((await app.inject({ url: path, headers: vet.headers })).statusCode, 404);
  const list = await app.inject({ url: '/api/follow-ups?status=all', headers: vet.headers });
  assert.ok(list.json().items.every((item: FollowupRecord) => item.assignedTo === vet.id));
  assert.doesNotMatch(list.body, /privado-follow|"email"|"phone"|"address"/);
  const summary = await app.inject({ url: '/api/overview', headers: vet.headers });
  assert.ok(summary.json().tasks.every((item: { id: string }) => item.id === own.id));
  assert.equal(summary.json().totals.pendingTasks, 1);
  assert.doesNotMatch(summary.body, new RegExp(hidden.title));
  const stats = (await app.inject({ url: '/api/follow-ups/stats', headers: vet.headers })).json();
  assert.equal(stats.pending, 1);
  const options = (
    await app.inject({ url: '/api/follow-ups/options', headers: vet.headers })
  ).json();
  assert.equal(options.team.length, 1);
  assert.equal(options.team[0].id, vet.id);
  assert.equal((await post('/api/follow-ups', input(link, other.id), vet)).statusCode, 403);
  assert.equal(
    (await post('/api/follow-ups', input({ clientId: link.clientId, petId: null }, vet.id), vet))
      .statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        url: `/api/follow-ups/targets?kind=client&q=${encodeURIComponent(prefix)}`,
        headers: vet.headers,
      })
    ).statusCode,
    403,
  );
  const search = await app.inject({
    url: '/api/follow-ups/targets?kind=pet&q=privado-follow',
    headers: vet.headers,
  });
  assert.deepEqual(search.json(), []);
});
test('veterinario no edita, completa ni cancela tareas de otro integrante', async () => {
  const link = await target(),
    body = input(link, reception.id),
    record = await create(body);
  const { clientId: _, petId: __, ...editable } = body;
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: `/api/follow-ups/${record.id}`,
        headers: vet.headers,
        payload: { ...editable, assignedTo: vet.id, version: 1 },
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (await post(`/api/follow-ups/${record.id}/status`, { version: 1, status: 'completed' }, vet))
      .statusCode,
    404,
  );
  const own = await create(input(link, vet.id), vet);
  assert.equal(
    (
      await post(
        `/api/follow-ups/${own.id}/status`,
        { version: own.version, status: 'completed' },
        vet,
      )
    ).statusCode,
    200,
  );
});
test('dos cambios concurrentes no sobrescriben: los estados finales conservan la fecha de cierre', async () => {
  const record = await create(input(await target()));
  const replies = await Promise.all([
    post(`/api/follow-ups/${record.id}/status`, { version: 1, status: 'completed' }),
    post(`/api/follow-ups/${record.id}/status`, { version: 1, status: 'cancelled' }),
  ]);
  assert.deepEqual(replies.map((r) => r.statusCode).sort(), [200, 409]);
  assert.equal(replies.find((r) => r.statusCode === 409)!.json().code, 'VERSION_CONFLICT');
  const final = replies.find((r) => r.statusCode === 200)!.json<FollowupRecord>();
  assert.equal(final.version, 2);
  assert.equal(!!final.completedAt, final.status === 'completed');
  assert.equal(
    (await post(`/api/follow-ups/${record.id}/status`, { version: 2, status: 'completed' }))
      .statusCode,
    409,
  );
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: `/api/follow-ups/${record.id}`,
        headers: reception.headers,
        payload: {
          assignedTo: null,
          title: 'No se cambia',
          description: '',
          date: '2040-05-02',
          time: '10:00',
          version: 2,
        },
      })
    ).statusCode,
    409,
  );
});
test('validaciones y CSRF rechazan peticiones sin efectos laterales', async () => {
  const body = input(await target());
  assert.equal(
    (await app.inject({ method: 'POST', url: '/api/follow-ups', payload: body })).statusCode,
    401,
  );
  for (const headers of [{ origin: 'https://ajeno.invalid' }, { 'x-csrf-token': 'incorrecto' }])
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/follow-ups',
          headers: { ...reception.headers, ...headers },
          payload: body,
        })
      ).statusCode,
      403,
    );
  for (const change of [
    { title: ' ' },
    { date: '2040-02-30' },
    { time: '25:00' },
    { description: 'x'.repeat(1001) },
    { createdBy: admin.id },
  ])
    assert.equal((await post('/api/follow-ups', { ...body, ...change })).statusCode, 400);
  for (const query of ['page=0', 'pageSize=51', 'period=ayer', 'assignee=incorrecto'])
    assert.equal(
      (await app.inject({ url: `/api/follow-ups?${query}`, headers: reception.headers }))
        .statusCode,
      400,
    );
});
test('contacto vinculado guarda actor y resultado; completar es una decisión explícita', async () => {
  const record = await create(input(await target()));
  const first = await contact({ ...contactInput(record, record.clientId), outcome: 'no_answer' });
  assert.equal(first.statusCode, 201, first.body);
  assert.equal(first.json().recordedBy, reception.id);
  assert.equal(
    (await app.inject({ url: `/api/follow-ups/${record.id}`, headers: reception.headers })).json()
      .status,
    'pending',
  );
  const done = await contact({ ...contactInput(record, record.clientId), completeTask: true });
  assert.equal(done.statusCode, 201, done.body);
  const task = (
    await app.inject({ url: `/api/follow-ups/${record.id}`, headers: reception.headers })
  ).json<FollowupRecord>();
  assert.equal(task.status, 'completed');
  assert.equal(task.contactCount, 2);
  assert.ok(task.completedAt);
  const log = await app.inject({
    url: `/api/contact-events?taskId=${record.id}&pageSize=1`,
    headers: admin.headers,
  });
  assert.equal(log.json().total, 2);
  assert.equal(log.json().items.length, 1);
  assert.doesNotMatch(log.body, /request_fingerprint|request_id|"phone"\s*:|privado-follow/);
});
test('contactos requieren vínculo correcto, fecha real y resultado válido para completar', async () => {
  const record = await create(input(await target())),
    otherTarget = await target();
  for (const change of [
    { clientId: otherTarget.clientId },
    { date: '2040-05-01' },
    { date: '2026-02-30' },
    { outcome: 'no_answer', completeTask: true },
    { taskVersion: null },
    { note: 'x'.repeat(2001) },
    { recordedBy: admin.id },
  ]) {
    const response = await contact({
      ...contactInput(record, record.clientId),
      ...change,
    } as ContactInput);
    assert.equal(response.statusCode, 400, response.body);
  }
  assert.equal(
    (await contact({ ...contactInput(null, record.clientId), completeTask: true })).statusCode,
    400,
  );
  assert.equal(
    (await app.inject({ url: `/api/follow-ups/${record.id}`, headers: admin.headers })).json()
      .status,
    'pending',
  );
});
test('reintentos concurrentes con UUID equivalente registran un contacto y un solo cierre', async () => {
  const record = await create(input(await target()));
  const body = { ...contactInput(record, record.clientId), completeTask: true };
  const replies = await Promise.all([
    contact(body),
    contact({
      ...body,
      requestId: body.requestId.toUpperCase(),
      clientId: body.clientId.toUpperCase(),
      taskId: body.taskId!.toUpperCase(),
    }),
  ]);
  assert.deepEqual(
    replies.map((r) => r.statusCode),
    [201, 201],
  );
  assert.equal(replies[0].json().id, replies[1].json().id);
  assert.ok(replies.some((r) => r.headers['idempotent-replay'] === 'true'));
  assert.equal(
    (await pool.query('SELECT count(*) FROM contact_events WHERE request_id=$1', [body.requestId]))
      .rows[0].count,
    '1',
  );
  assert.equal(
    (await app.inject({ url: `/api/follow-ups/${record.id}`, headers: admin.headers })).json()
      .version,
    2,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*) FROM audit_logs WHERE action='contact.recorded' AND entity_id=$1",
        [replies[0].json().id],
      )
    ).rows[0].count,
    '1',
  );
  assert.equal((await contact({ ...body, note: 'Otra solicitud distinta' })).statusCode, 409);
  assert.equal((await contact(body, admin)).statusCode, 409);
});
test('un veterinario no consulta ni registra contactos; no hay endpoints de edición o borrado', async () => {
  const link = await target(),
    result = await contact(contactInput(null, link.clientId));
  assert.equal(result.statusCode, 201);
  assert.equal(
    (await app.inject({ url: '/api/contact-events', headers: vet.headers })).statusCode,
    403,
  );
  assert.equal((await contact(contactInput(null, link.clientId), vet)).statusCode, 403);
  for (const method of ['PUT', 'DELETE'] as const)
    assert.equal(
      (
        await app.inject({
          method,
          url: `/api/contact-events/${result.json().id}`,
          headers: admin.headers,
          payload: method === 'PUT' ? { note: 'No cambia' } : undefined,
        })
      ).statusCode,
      404,
    );
  await assert.rejects(
    pool.query("UPDATE contact_events SET note='No se permite' WHERE id=$1", [result.json().id]),
    (error: unknown) => (error as { code: string }).code === '23514',
  );
});
test('una versión antigua no registra contacto ni cierra un seguimiento nuevo', async () => {
  const link = await target(),
    body = input(link),
    task = await create(body);
  const { clientId: _, petId: __, ...edit } = body;
  await app.inject({
    method: 'PUT',
    url: `/api/follow-ups/${task.id}`,
    headers: admin.headers,
    payload: { ...edit, title: 'Cambio antes del contacto', version: 1 },
  });
  const stale = await contact({ ...contactInput(task, task.clientId), completeTask: true });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().code, 'VERSION_CONFLICT');
  assert.equal(
    (await pool.query('SELECT count(*) FROM contact_events WHERE task_id=$1', [task.id])).rows[0]
      .count,
    '0',
  );
  assert.equal(
    (await app.inject({ url: `/api/follow-ups/${task.id}`, headers: admin.headers })).json().status,
    'pending',
  );
});
test('fallo de auditoría revierte contacto y cierre; la misma solicitud puede reintentarse', async () => {
  const record = await create(input(await target()));
  const body = { ...contactInput(record, record.clientId), completeTask: true };
  await pool.query(
    `ALTER TABLE audit_logs ADD CONSTRAINT followup_test_audit_failure CHECK (actor_id <> '${reception.id}'::uuid) NOT VALID`,
  );
  try {
    const failed = await contact(body);
    assert.equal(failed.statusCode, 500);
    assert.equal(
      (
        await pool.query('SELECT count(*) FROM contact_events WHERE request_id=$1', [
          body.requestId,
        ])
      ).rows[0].count,
      '0',
    );
    const task = (
      await app.inject({ url: `/api/follow-ups/${record.id}`, headers: admin.headers })
    ).json();
    assert.equal(task.status, 'pending');
    assert.equal(task.version, 1);
  } finally {
    await pool.query('ALTER TABLE audit_logs DROP CONSTRAINT followup_test_audit_failure');
  }
  const saved = await contact(body);
  assert.equal(saved.statusCode, 201);
  const audit = (
    await pool.query(
      "SELECT metadata FROM audit_logs WHERE action='contact.recorded' AND entity_id=$1",
      [saved.json().id],
    )
  ).rows[0];
  assert.doesNotMatch(JSON.stringify(audit), /Comunicación ficticia|privado-follow|000000000/);
});
