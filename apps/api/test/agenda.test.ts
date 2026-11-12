import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AppointmentInput, AppointmentRecord, EncounterRecord, Role } from '@nexovet/shared';
import { buildApp } from '../src/app.js';
import { parseConfig } from '../src/config.js';
import { createPool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrations.js';
import { seed } from '../src/db/seeds.js';
import { hashPassword } from '../src/auth/crypto.js';

const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/nexovet_test')
  throw new Error('Agenda requiere nexovet_test');
const pool = createPool(url);
const origin = 'http://127.0.0.1:5173';
const config = parseConfig({ DATABASE_URL: url, NODE_ENV: 'test', APP_ORIGIN: origin });
const app = buildApp({
  ready: async () => {},
  overview: async () => null,
  auth: { pool, config, sendMail: async () => {} },
});
type Person = { id: string; headers: Record<string, string> };
let admin: Person, reception: Person, vet: Person, other: Person, hash: string;
const users: string[] = [],
  pets: string[] = [],
  owners: string[] = [],
  appointments: string[] = [];
const serviceId = randomUUID();
const prefix = `Agenda ${randomUUID().slice(0, 8)}`;
const password = 'Acceso ficticio para agenda 2026';
async function person(role: Role) {
  const id = randomUUID();
  const email = `agenda-${id}@example.invalid`;
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
  assert.equal(response.statusCode, 200, response.body);
  return {
    id,
    headers: {
      origin,
      cookie: `nexovet_session=${response.cookies[0]!.value}`,
      'x-csrf-token': response.json().csrfToken,
    },
  };
}
async function patient() {
  const owner = randomUUID(),
    pet = randomUUID();
  await pool.query('INSERT INTO clients(id,name,email) VALUES ($1,$2,$3)', [
    owner,
    `${prefix} responsable`,
    'contacto-privado@example.invalid',
  ]);
  owners.push(owner);
  await pool.query("INSERT INTO pets(id,client_id,name,species) VALUES ($1,$2,$3,'dog')", [
    pet,
    owner,
    `${prefix} paciente ${pets.length}`,
  ]);
  pets.push(pet);
  return { id: pet, owner };
}
before(async () => {
  await migrate(pool);
  await seed(pool, { NODE_ENV: 'test', DATABASE_URL: url });
  await pool.query('DELETE FROM auth_rate_limits');
  hash = await hashPassword(password);
  admin = await person('admin');
  reception = await person('reception');
  vet = await person('veterinarian');
  other = await person('veterinarian');
  await pool.query('INSERT INTO services(id,name,duration_minutes,price) VALUES ($1,$2,30,0)', [
    serviceId,
    `${prefix} servicio`,
  ]);
});
after(async () => {
  await app.close();
  await pool.query('DELETE FROM encounters WHERE appointment_id=ANY($1::uuid[])', [appointments]);
  await pool.query('DELETE FROM appointments WHERE id=ANY($1::uuid[])', [appointments]);
  await pool.query('DELETE FROM pets WHERE id=ANY($1::uuid[])', [pets]);
  await pool.query('DELETE FROM clients WHERE id=ANY($1::uuid[])', [owners]);
  await pool.query('DELETE FROM services WHERE id=$1', [serviceId]);
  await pool.query('UPDATE users SET active=false,login_enabled=false WHERE id=ANY($1::uuid[])', [
    users,
  ]);
  await pool.end();
});
function post(path: string, payload: unknown, actor: Person = admin) {
  return app.inject({ method: 'POST', url: path, headers: actor.headers, payload });
}
function future(
  petId: string,
  professionalId = vet.id,
  day = '2040-03-01',
  startTime = '10:00',
  durationMinutes = 30,
): AppointmentInput {
  return {
    petId,
    professionalId,
    serviceId,
    date: day,
    startTime,
    durationMinutes,
    reason: 'Motivo ficticio de prueba',
  };
}
async function book(input: AppointmentInput, actor = admin) {
  const response = await post('/api/appointments', input, actor);
  assert.equal(response.statusCode, 201, response.body);
  const record = response.json<AppointmentRecord>();
  appointments.push(record.id);
  return record;
}
async function state(record: AppointmentRecord, status: string, actor = reception) {
  const response = await post(
    `/api/appointments/${record.id}/status`,
    { version: record.version, status },
    actor,
  );
  assert.equal(response.statusCode, 200, response.body);
  return response.json<AppointmentRecord>();
}
function reschedule(record: AppointmentRecord, input: AppointmentInput) {
  const { petId: _, ...body } = input;
  return app.inject({
    method: 'PUT',
    url: `/api/appointments/${record.id}`,
    headers: admin.headers,
    payload: { ...body, version: record.version },
  });
}
const notes = {
  weightKg: 8.125,
  temperatureC: 38.2,
  findings: 'Hallazgos ficticios de demostración.',
  diagnosis: 'Evaluación ficticia, sin recomendación clínica.',
  treatment: 'Plan de prueba, no usar como indicación médica.',
};
async function activeCare() {
  const doctor = await person('veterinarian');
  const pet = await patient();
  const instant = new Date(Math.ceil(Date.now() / 60000) * 60000 + 10 * 60000);
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
  const startTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Lima',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);
  let record = await book(future(pet.id, doctor.id, date, startTime));
  record = await state(record, 'arrived');
  const started = await post(
    `/api/appointments/${record.id}/start`,
    { version: record.version },
    doctor,
  );
  assert.equal(started.statusCode, 201, started.body);
  return { doctor, pet, appointment: record, encounter: started.json<EncounterRecord>() };
}
async function saveCare(record: EncounterRecord, doctor: Person, fields = notes) {
  const response = await app.inject({
    method: 'PUT',
    url: `/api/encounters/${record.id}`,
    headers: doctor.headers,
    payload: { ...fields, version: record.version },
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json<EncounterRecord>();
}
test('catálogos no exponen precios ni correos; las listas exigen sesión', async () => {
  const options = await app.inject({ url: '/api/agenda/options', headers: reception.headers });
  assert.equal(options.statusCode, 200);
  assert.equal(options.json().timezone, 'America/Lima');
  assert.ok(options.json().professionals.some((p: { id: string }) => p.id === vet.id));
  assert.doesNotMatch(options.body, /"price"|"email"|password/);
  for (const path of [
    '/api/agenda/options',
    '/api/appointments?from=2040-03-01&to=2040-03-01',
    '/api/agenda/patients?q=Ag',
  ])
    assert.equal((await app.inject(path)).statusCode, 401);
});
test('programa en hora Lima y filtra por periodo, profesional y paciente sin contactos', async () => {
  const pet = await patient();
  const record = await book(future(pet.id, vet.id, '2040-03-02', '23:45', 30), reception);
  assert.equal(new Date(record.startsAt).toISOString(), '2040-03-03T04:45:00.000Z');
  assert.equal(record.date, '2040-03-02');
  assert.equal(record.endTime, '00:15');
  assert.equal(record.version, 1);
  for (const day of ['2040-03-02', '2040-03-03']) {
    const response = await app.inject({
      url: `/api/appointments?from=${day}&to=${day}&professionalId=${vet.id}&q=${encodeURIComponent(prefix)}&pageSize=1`,
      headers: vet.headers,
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().total, 1);
    assert.equal(response.json().items[0].id, record.id);
    assert.doesNotMatch(response.body, /contacto-privado|"phone"|"email"|"price"/);
  }
  assert.equal(
    (
      await app.inject({
        url: '/api/appointments?from=2040-03-02&to=2040-03-02&page=2&pageSize=1',
        headers: admin.headers,
      })
    ).json().items.length,
    0,
  );
});
test('la selección excluye mascotas o responsables archivados y las altas vuelven a validarlos', async () => {
  const pet = await patient();
  await pool.query('UPDATE clients SET active=false WHERE id=$1', [pet.owner]);
  const query = await app.inject({
    url: `/api/agenda/patients?q=${encodeURIComponent(prefix)}`,
    headers: reception.headers,
  });
  assert.ok(!query.json().some((item: { id: string }) => item.id === pet.id));
  assert.equal(
    (await post('/api/appointments', future(pet.id, vet.id, '2040-03-03'))).statusCode,
    409,
  );
  await pool.query('UPDATE clients SET active=true WHERE id=$1', [pet.owner]);
  await pool.query('UPDATE pets SET active=false WHERE id=$1', [pet.id]);
  assert.equal(
    (await post('/api/appointments', future(pet.id, vet.id, '2040-03-03'))).statusCode,
    409,
  );
  assert.equal((await post('/api/appointments', future(randomUUID()))).statusCode, 404);
});
test('rechaza profesional no veterinario, servicio inactivo y valores de fecha/hora inválidos', async () => {
  const pet = await patient();
  assert.equal((await post('/api/appointments', future(pet.id, reception.id))).statusCode, 409);
  await pool.query('UPDATE services SET active=false WHERE id=$1', [serviceId]);
  assert.equal((await post('/api/appointments', future(pet.id))).statusCode, 409);
  await pool.query('UPDATE services SET active=true WHERE id=$1', [serviceId]);
  for (const bad of [
    { date: '2040-02-30' },
    { startTime: '25:00' },
    { durationMinutes: 4 },
    { durationMinutes: 481 },
    { durationMinutes: 5.5 },
    { date: '2000-01-01' },
  ])
    assert.equal(
      (await post('/api/appointments', { ...future(pet.id), ...bad })).statusCode,
      400,
      JSON.stringify(bad),
    );
  for (const query of [
    'from=2040-03-02&to=2040-03-01',
    'from=2040-01-01&to=2040-03-01',
    'from=2040-03-01&to=2040-03-01&pageSize=51',
  ])
    assert.equal(
      (await app.inject({ url: `/api/appointments?${query}`, headers: admin.headers })).statusCode,
      400,
    );
});
test('disponibilidad y restricciones detectan cruces de profesional y paciente; permiten citas contiguas', async () => {
  const a = await patient(),
    b = await patient();
  const first = await book(future(a.id, vet.id, '2040-03-04', '10:00'));
  const url = `/api/appointments/availability?date=2040-03-04&startTime=10:15&durationMinutes=30&professionalId=${vet.id}&petId=${a.id}`;
  const availability = (await app.inject({ url, headers: admin.headers })).json();
  assert.equal(availability.available, false);
  assert.deepEqual(availability.conflicts.map((c: { kind: string }) => c.kind).sort(), [
    'pet',
    'professional',
  ]);
  assert.equal(
    (await post('/api/appointments', future(b.id, vet.id, '2040-03-04', '10:15'))).statusCode,
    409,
  );
  assert.equal(
    (await post('/api/appointments', future(a.id, other.id, '2040-03-04', '10:15'))).statusCode,
    409,
  );
  await book(future(a.id, vet.id, '2040-03-04', '10:30'));
  const excluded = (
    await app.inject({ url: `${url}&excludeId=${first.id}`, headers: admin.headers })
  ).json();
  assert.equal(excluded.available, false); // Sigue cruzando la segunda cita contigua.
});
test('dos reservas concurrentes del mismo horario producen una sola cita', async () => {
  const a = await patient(),
    b = await patient();
  const results = await Promise.all([
    post('/api/appointments', future(a.id, vet.id, '2040-03-05', '10:00')),
    post('/api/appointments', future(b.id, vet.id, '2040-03-05', '10:00'), reception),
  ]);
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [201, 409]);
  appointments.push(results.find((r) => r.statusCode === 201)!.json().id);
  assert.equal(results.find((r) => r.statusCode === 409)!.json().code, 'SLOT_CONFLICT');
  assert.doesNotMatch(results.find((r) => r.statusCode === 409)!.body, /23P01|INSERT|constraint/);
});
test('reprogramar reconfirma, conserva paciente y libera el horario anterior', async () => {
  const pet = await patient();
  let record = await book(future(pet.id, vet.id, '2040-03-06', '10:00'));
  record = await state(record, 'confirmed');
  const updated = await reschedule(record, future(pet.id, other.id, '2040-03-06', '11:00'));
  assert.equal(updated.statusCode, 200, updated.body);
  assert.equal(updated.json().status, 'scheduled');
  assert.equal(updated.json().petId, pet.id);
  assert.equal(updated.json().version, 3);
  await book(future((await patient()).id, vet.id, '2040-03-06', '10:00'));
  const stale = await reschedule(record, future(pet.id, vet.id, '2040-03-06', '12:00'));
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().code, 'VERSION_CONFLICT');
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: `/api/appointments/${record.id}`,
        headers: admin.headers,
        payload: { ...future(pet.id), version: 3 },
      })
    ).statusCode,
    400,
  );
});
test('cancelar libera cupo; no se puede marcar inasistencia futura ni resucitar una cita cancelada', async () => {
  const pet = await patient();
  const record = await book(future(pet.id, vet.id, '2040-03-07'));
  assert.equal(
    (
      await post(`/api/appointments/${record.id}/status`, {
        version: record.version,
        status: 'no_show',
      })
    ).statusCode,
    409,
  );
  const cancelled = await state(record, 'cancelled');
  await book(future(pet.id, vet.id, '2040-03-07'));
  assert.equal(
    (
      await post(`/api/appointments/${record.id}/status`, {
        version: cancelled.version,
        status: 'arrived',
      })
    ).statusCode,
    409,
  );
  const past = await book(future((await patient()).id, other.id, '2040-03-07'));
  await pool.query(
    "UPDATE appointments SET starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' WHERE id=$1",
    [past.id],
  );
  const noShow = await state(past, 'no_show');
  assert.equal(noShow.status, 'no_show');
});
test('permisos y CSRF se aplican a citas y atenciones en API', async () => {
  const pet = await patient();
  const input = future(pet.id, vet.id, '2040-03-08');
  assert.equal((await post('/api/appointments', input, vet)).statusCode, 403);
  for (const change of [{ origin: 'https://ajeno.invalid' }, { 'x-csrf-token': 'incorrecto' }])
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/appointments',
          headers: { ...admin.headers, ...change },
          payload: input,
        })
      ).statusCode,
      403,
    );
  const record = await book(input);
  assert.equal(
    (await post(`/api/appointments/${record.id}/start`, { version: 1 }, reception)).statusCode,
    403,
  );
  assert.equal(
    (await post(`/api/appointments/${record.id}/start`, { version: 1 }, admin)).statusCode,
    403,
  );
  assert.equal(
    (await post(`/api/appointments/${record.id}/start`, { version: 1 }, other)).statusCode,
    403,
  );
  assert.equal(
    (await post(`/api/appointments/${record.id}/start`, { version: 1 }, vet)).statusCode,
    409,
  );
  const arrived = await state(record, 'arrived');
  assert.equal(
    (await post(`/api/appointments/${record.id}/start`, { version: arrived.version }, vet))
      .statusCode,
    409,
  ); // Demasiado adelantada.
});
test('recepción no recibe texto clínico; solo el médico asignado escribe, sin imponer identidad desde el cliente', async () => {
  const care = await activeCare();
  const record = await saveCare(care.encounter, care.doctor);
  assert.equal(record.weightKg, 8.125);
  assert.equal(record.temperatureC, 38.2);
  assert.equal(
    (await app.inject({ url: `/api/encounters/${record.id}`, headers: reception.headers }))
      .statusCode,
    403,
  );
  assert.equal(
    (await app.inject({ url: `/api/pets/${care.pet.id}/history`, headers: reception.headers }))
      .statusCode,
    403,
  );
  for (const actor of [admin, other])
    assert.equal(
      (
        await app.inject({
          method: 'PUT',
          url: `/api/encounters/${record.id}`,
          headers: actor.headers,
          payload: { ...notes, version: record.version },
        })
      ).statusCode,
      403,
    );
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: `/api/encounters/${record.id}`,
        headers: care.doctor.headers,
        payload: { ...notes, version: record.version, veterinarianId: other.id },
      })
    ).statusCode,
    400,
  );
  const appt = await app.inject({
    url: `/api/appointments/${care.appointment.id}`,
    headers: reception.headers,
  });
  assert.equal(appt.json().status, 'in_progress');
  assert.doesNotMatch(appt.body, /Hallazgos ficticios|Evaluación ficticia|Plan de prueba/);
});
test('consulta completa guarda, cierra cita e historia; el contenido cerrado rechaza ediciones', async () => {
  const care = await activeCare();
  const blank = await post(
    `/api/encounters/${care.encounter.id}/close`,
    { version: 1 },
    care.doctor,
  );
  assert.equal(blank.statusCode, 400);
  const saved = await saveCare(care.encounter, care.doctor);
  const closed = await post(
    `/api/encounters/${saved.id}/close`,
    { version: saved.version },
    care.doctor,
  );
  assert.equal(closed.statusCode, 200, closed.body);
  assert.ok(closed.json().closedAt);
  const appt = (
    await app.inject({
      url: `/api/appointments/${care.appointment.id}`,
      headers: reception.headers,
    })
  ).json();
  assert.equal(appt.status, 'completed');
  assert.equal(appt.encounterId, saved.id);
  const history = await app.inject({
    url: `/api/pets/${care.pet.id}/history?pageSize=1`,
    headers: other.headers,
  });
  assert.equal(history.statusCode, 200);
  assert.equal(history.json().total, 1);
  assert.equal(history.json().items[0].diagnosis, notes.diagnosis);
  assert.doesNotMatch(history.body, /contacto-privado|"email"|"phone"/);
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: `/api/encounters/${saved.id}`,
        headers: care.doctor.headers,
        payload: { ...notes, version: closed.json().version },
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await post(
        `/api/encounters/${saved.id}/close`,
        { version: closed.json().version },
        care.doctor,
      )
    ).statusCode,
    409,
  );
  await assert.rejects(
    pool.query("UPDATE encounters SET diagnosis='No permitido' WHERE id=$1", [saved.id]),
    (error: unknown) => (error as { code: string }).code === '23514',
  );
  await assert.rejects(
    pool.query(
      "UPDATE appointments SET starts_at=starts_at+interval '1 day',ends_at=ends_at+interval '1 day' WHERE id=$1",
      [appt.id],
    ),
    (error: unknown) => (error as { code: string }).code === '23514',
  );
});
test('guardar dos borradores concurrentes conserva uno y avisa del conflicto', async () => {
  const care = await activeCare();
  const results = await Promise.all(
    ['uno', 'dos'].map((text) =>
      app.inject({
        method: 'PUT',
        url: `/api/encounters/${care.encounter.id}`,
        headers: care.doctor.headers,
        payload: { ...notes, findings: text, version: 1 },
      }),
    ),
  );
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
  assert.equal(results.find((r) => r.statusCode === 409)!.json().code, 'VERSION_CONFLICT');
  for (const field of [
    { weightKg: 0 },
    { weightKg: 1.2345 },
    { temperatureC: 90 },
    { temperatureC: 38.22 },
    { diagnosis: 'x'.repeat(4001) },
  ])
    assert.equal(
      (
        await app.inject({
          method: 'PUT',
          url: `/api/encounters/${care.encounter.id}`,
          headers: care.doctor.headers,
          payload: { ...notes, ...field, version: 2 },
        })
      ).statusCode,
      400,
    );
});
test('inicio concurrente crea una única atención y no permite alterar horario después', async () => {
  const doctor = await person('veterinarian'),
    pet = await patient();
  const instant = new Date(Date.now() + 10 * 60000);
  const d = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
  const t = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Lima',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);
  let appt = await book(future(pet.id, doctor.id, d, t));
  appt = await state(appt, 'arrived');
  const results = await Promise.all([
    post(`/api/appointments/${appt.id}/start`, { version: appt.version }, doctor),
    post(`/api/appointments/${appt.id}/start`, { version: appt.version }, doctor),
  ]);
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [201, 409]);
  const actual = (
    await app.inject({ url: `/api/appointments/${appt.id}`, headers: admin.headers })
  ).json<AppointmentRecord>();
  assert.equal((await reschedule(actual, future(pet.id, doctor.id, '2040-03-10'))).statusCode, 409);
  assert.equal(
    (
      await post(`/api/appointments/${appt.id}/status`, {
        version: actual.version,
        status: 'cancelled',
      })
    ).statusCode,
    409,
  );
});
test('fallo de auditoría revierte el cierre clínico y el estado de la cita', async () => {
  const care = await activeCare();
  const saved = await saveCare(care.encounter, care.doctor);
  await pool.query(
    `ALTER TABLE audit_logs ADD CONSTRAINT agenda_test_audit_failure CHECK (actor_id <> '${care.doctor.id}'::uuid) NOT VALID`,
  );
  try {
    const result = await post(
      `/api/encounters/${saved.id}/close`,
      { version: saved.version },
      care.doctor,
    );
    assert.equal(result.statusCode, 500);
    const record = (
      await app.inject({ url: `/api/encounters/${saved.id}`, headers: care.doctor.headers })
    ).json();
    assert.equal(record.closedAt, null);
    assert.equal(record.version, saved.version);
    assert.equal(
      (
        await app.inject({
          url: `/api/appointments/${care.appointment.id}`,
          headers: reception.headers,
        })
      ).json().status,
      'in_progress',
    );
  } finally {
    await pool.query('ALTER TABLE audit_logs DROP CONSTRAINT agenda_test_audit_failure');
  }
  const log = (
    await pool.query(
      "SELECT metadata FROM audit_logs WHERE entity_id=$1 AND action='encounter.updated'",
      [saved.id],
    )
  ).rows[0];
  assert.doesNotMatch(
    JSON.stringify(log),
    /Hallazgos ficticios|Evaluación ficticia|Plan de prueba/,
  );
});
