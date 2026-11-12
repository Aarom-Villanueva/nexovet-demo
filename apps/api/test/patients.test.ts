import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { ClientInput, ClientRecord, PetInput, PetRecord, Role } from '@nexovet/shared';
import { buildApp } from '../src/app.js';
import { parseConfig } from '../src/config.js';
import { createPool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrations.js';
import { seed } from '../src/db/seeds.js';
import { hashPassword } from '../src/auth/crypto.js';

const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/nexovet_test') throw new Error('Se requiere nexovet_test');
const pool = createPool(url);
const origin = 'http://127.0.0.1:5173';
const config = parseConfig({ NODE_ENV: 'test', DATABASE_URL: url, APP_ORIGIN: origin });
const app = buildApp({
  ready: async () => {},
  overview: async () => null,
  auth: { pool, config, sendMail: async () => {} },
});
const identities = Object.fromEntries(
  (['admin', 'reception', 'veterinarian'] as const).map((role) => [
    role,
    { id: randomUUID(), email: `patients-${randomUUID()}@example.invalid`, role },
  ]),
);
const headers: Record<string, Record<string, string>> = {};
const clientIds: string[] = [];
const petIds: string[] = [];
const tag = `qa-${randomUUID()}`;
const clientInput = (overrides: Partial<ClientInput> = {}): ClientInput => ({
  name: `Cliente ${tag} ${randomUUID().slice(0, 6)}`,
  email: null,
  phone: null,
  documentType: null,
  documentNumber: null,
  address: null,
  contactConsent: false,
  contactConsentNote: null,
  active: true,
  ...overrides,
});
const petInput = (overrides: Partial<PetInput> = {}): PetInput => ({
  name: `Mascota ${tag} ${randomUUID().slice(0, 6)}`,
  species: 'dog',
  breed: null,
  sex: 'unknown',
  birthDate: null,
  microchip: null,
  allergies: null,
  active: true,
  ...overrides,
});
before(async () => {
  await migrate(pool);
  await seed(pool, { NODE_ENV: 'test', DATABASE_URL: url });
  await pool.query('DELETE FROM auth_rate_limits');
  const hash = await hashPassword('Contraseña de prueba pacientes');
  for (const user of Object.values(identities)) {
    await pool.query(
      'INSERT INTO users(id,name,email,role,password_hash,login_enabled) VALUES ($1,$2,$3,$4,$5,true)',
      [user.id, 'Prueba de fichas', user.email, user.role, hash],
    );
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin },
      payload: { email: user.email, password: 'Contraseña de prueba pacientes' },
    });
    assert.equal(login.statusCode, 200, login.body);
    headers[user.role] = {
      origin,
      cookie: `nexovet_session=${login.cookies[0]!.value}`,
      'x-csrf-token': login.json().csrfToken,
    };
  }
});
after(async () => {
  await app.close();
  await pool.query('DELETE FROM pets WHERE id=ANY($1::uuid[])', [petIds]);
  await pool.query('DELETE FROM clients WHERE id=ANY($1::uuid[])', [clientIds]);
  await pool.query('UPDATE users SET active=false,login_enabled=false WHERE id=ANY($1::uuid[])', [
    Object.values(identities).map((user) => user.id),
  ]);
  await pool.end();
});
async function createClient(input = clientInput(), role: Role = 'admin') {
  const response = await app.inject({
    method: 'POST',
    url: '/api/clients',
    headers: headers[role],
    payload: input,
  });
  assert.equal(response.statusCode, 201, response.body);
  clientIds.push(response.json().id);
  return response.json<ClientRecord>();
}
async function createPet(clientId: string, input = petInput(), role: Role = 'admin') {
  const response = await app.inject({
    method: 'POST',
    url: '/api/pets',
    headers: headers[role],
    payload: { ...input, clientId },
  });
  assert.equal(response.statusCode, 201, response.body);
  petIds.push(response.json().id);
  return response.json<PetRecord>();
}
test('registra, normaliza y persiste cliente y mascota con su vínculo', async () => {
  const input = clientInput({
    name: `  Familia ${tag}  `,
    email: '  FAMILIA@example.invalid ',
    phone: ' +51 (000) 000-000 ',
    documentType: 'DNI',
    documentNumber: '00000000',
    contactConsent: true,
    contactConsentNote: ' Autorización ficticia en recepción ',
  });
  const client = await createClient(input, 'reception');
  assert.equal(client.name, `Familia ${tag}`);
  assert.equal(client.email, 'familia@example.invalid');
  assert.equal(client.phone, '+51000000000');
  assert.ok(client.contactConsentAt);
  assert.equal(client.version, 1);
  const pet = await createPet(
    client.id,
    petInput({
      birthDate: '2020-02-29',
      microchip: ` ${`chip-${tag}`.slice(0, 40)} `,
      allergies: 'Observación clínica ficticia',
    }),
    'reception',
  );
  assert.equal(pet.clientId, client.id);
  assert.equal(pet.ownerName, client.name);
  assert.equal(pet.microchip, `CHIP-${tag.toUpperCase()}`.slice(0, 40));
  const detail = await app.inject({ url: `/api/clients/${client.id}`, headers: headers.reception });
  assert.equal(detail.json().pets, 1);
  assert.equal(
    (await pool.query('SELECT client_id FROM pets WHERE id=$1', [pet.id])).rows[0].client_id,
    client.id,
  );
  const edited = await app.inject({
    method: 'PUT',
    url: `/api/clients/${client.id}`,
    headers: headers.reception,
    payload: { ...input, name: 'Nombre corregido', version: client.version },
  });
  assert.equal(edited.statusCode, 200, edited.body);
  assert.equal(edited.json().contactConsentAt, client.contactConsentAt);
  assert.equal(edited.json().version, 2);
});
test('búsqueda de clientes por contacto/documento y paginación determinista', async () => {
  const prefix = `Listado ${tag}`;
  for (let i = 0; i < 5; i++)
    await createClient(
      clientInput({
        name: `${prefix} ${i}`,
        email: `lista${i}@example.invalid`,
        documentType: 'other',
        documentNumber: `DOC-${tag}-${i}`.slice(-30),
      }),
    );
  const fetchPage = async (page: number) =>
    (
      await app.inject({
        url: `/api/clients?q=${encodeURIComponent(prefix)}&page=${page}&pageSize=2`,
        headers: headers.admin,
      })
    ).json();
  const first = await fetchPage(1);
  const second = await fetchPage(2);
  assert.equal(first.total, 5);
  assert.equal(first.items.length, 2);
  assert.equal(first.pageSize, 2);
  assert.notDeepEqual(
    first.items.map((x: ClientRecord) => x.id),
    second.items.map((x: ClientRecord) => x.id),
  );
  assert.deepEqual(first, await fetchPage(1));
  for (const query of ['lista3@example.invalid', first.items[0].documentNumber]) {
    const response = await app.inject({
      url: `/api/clients?q=${encodeURIComponent(query)}`,
      headers: headers.admin,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().total, 1);
  }
  const beyond = await fetchPage(10);
  assert.equal(beyond.total, 5);
  assert.deepEqual(beyond.items, []);
});
test('búsquedas tratan % y _ como texto y rechazan parámetros e identificadores inválidos', async () => {
  await createClient(clientInput({ name: `Literal %_ ${tag}` }));
  const escaped = await app.inject({ url: '/api/clients?q=%25_', headers: headers.admin });
  assert.equal(escaped.json().total, 1);
  const injection = await app.inject({
    url: `/api/clients?q=${encodeURIComponent("' OR 1=1 --")}`,
    headers: headers.admin,
  });
  assert.equal(injection.json().total, 0);
  for (const path of [
    '/api/clients?page=0',
    '/api/pets?pageSize=999',
    '/api/clients?status=otro',
    '/api/pets?clientId=incorrecto',
    '/api/clients/no-uuid',
    '/api/pets?extra=1',
  ])
    assert.equal((await app.inject({ url: path, headers: headers.admin })).statusCode, 400, path);
  const seed = (await pool.query("SELECT md5('client:1')::uuid AS id")).rows[0].id;
  assert.equal(
    (await app.inject({ url: `/api/clients/${seed}`, headers: headers.admin })).statusCode,
    200,
  );
});
test('validaciones de cliente no crean filas y devuelven errores de campo', async () => {
  const before = Number((await pool.query('SELECT count(*) FROM clients')).rows[0].count);
  for (const bad of [
    { name: ' ' },
    { email: 'sin-arroba' },
    { phone: '123abc4567' },
    { documentType: 'DNI' },
    { documentType: 'DNI', documentNumber: '123' },
    { documentType: 'RUC', documentNumber: '12345678' },
    { documentType: null, documentNumber: '12345678' },
    { contactConsent: true },
    { contactConsent: false, contactConsentNote: 'No autorizado' },
    { address: 'x'.repeat(301) },
  ]) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/clients',
      headers: headers.admin,
      payload: clientInput(bad as Partial<ClientInput>),
    });
    assert.equal(response.statusCode, 400, response.body);
    assert.ok(Object.keys(response.json().fields).length);
  }
  assert.equal(Number((await pool.query('SELECT count(*) FROM clients')).rows[0].count), before);
});
test('duplicados de documentos y microchips se resuelven incluso en peticiones concurrentes', async () => {
  const input = clientInput({
    documentType: 'CE',
    documentNumber: randomUUID().replaceAll('-', '').slice(0, 12).toLowerCase(),
  });
  const responses = await Promise.all([
    app.inject({ method: 'POST', url: '/api/clients', headers: headers.admin, payload: input }),
    app.inject({
      method: 'POST',
      url: '/api/clients',
      headers: headers.reception,
      payload: { ...input, documentNumber: input.documentNumber!.toUpperCase() },
    }),
  ]);
  assert.deepEqual(responses.map((r) => r.statusCode).sort(), [201, 409]);
  const owner = responses.find((r) => r.statusCode === 201)!.json<ClientRecord>();
  clientIds.push(owner.id);
  const pet = petInput({ microchip: `chip-${randomUUID()}`.slice(0, 40) });
  const pets = await Promise.all([
    app.inject({
      method: 'POST',
      url: '/api/pets',
      headers: headers.admin,
      payload: { ...pet, clientId: owner.id },
    }),
    app.inject({
      method: 'POST',
      url: '/api/pets',
      headers: headers.reception,
      payload: { ...pet, microchip: pet.microchip!.toUpperCase(), clientId: owner.id },
    }),
  ]);
  assert.deepEqual(pets.map((r) => r.statusCode).sort(), [201, 409]);
  petIds.push(pets.find((r) => r.statusCode === 201)!.json().id);
  assert.doesNotMatch(responses.find((r) => r.statusCode === 409)!.body, /23505|INSERT|constraint/);
});
test('edición concurrente de cliente y mascota no sobrescribe cambios ganadores', async () => {
  const client = await createClient();
  const pet = await createPet(client.id);
  for (const [resource, record, input] of [
    ['clients', client, clientInput()],
    ['pets', pet, petInput()],
  ] as const) {
    const responses = await Promise.all(
      ['primero', 'segundo'].map((name) =>
        app.inject({
          method: 'PUT',
          url: `/api/${resource}/${record.id}`,
          headers: headers.admin,
          payload: { ...input, name: `Cambio ${name}`, version: record.version },
        }),
      ),
    );
    assert.deepEqual(responses.map((r) => r.statusCode).sort(), [200, 409]);
    assert.equal(responses.find((r) => r.statusCode === 409)!.json().code, 'VERSION_CONFLICT');
    const persisted = (
      await app.inject({ url: `/api/${resource}/${record.id}`, headers: headers.admin })
    ).json();
    assert.equal(persisted.version, 2);
    assert.equal(persisted.name, responses.find((r) => r.statusCode === 200)!.json().name);
  }
});
test('mascotas requieren un responsable activo, conservan propietario y validan fechas reales', async () => {
  const owner = await createClient();
  const pet = await createPet(owner.id);
  for (const birthDate of ['2025-02-29', '2024-02-30', '2999-01-01', '0000-01-01', 'hoy']) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/pets',
      headers: headers.admin,
      payload: { ...petInput({ birthDate }), clientId: owner.id },
    });
    assert.equal(response.statusCode, 400, response.body);
    assert.ok(response.json().fields.birthDate);
  }
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/pets',
        headers: headers.admin,
        payload: { ...petInput(), clientId: randomUUID() },
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: `/api/pets/${pet.id}`,
        headers: headers.admin,
        payload: { ...petInput(), clientId: randomUUID(), version: pet.version },
      })
    ).statusCode,
    400,
  );
  await app.inject({
    method: 'PUT',
    url: `/api/clients/${owner.id}`,
    headers: headers.admin,
    payload: { ...clientInput({ active: false }), version: owner.version },
  });
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/pets',
        headers: headers.admin,
        payload: { ...petInput(), clientId: owner.id },
      })
    ).statusCode,
    409,
  );
  const saved = (await app.inject({ url: `/api/pets/${pet.id}`, headers: headers.admin })).json();
  assert.equal(saved.clientId, owner.id);
  assert.equal(saved.active, true);
  assert.equal(saved.ownerActive, false);
});
test('archivo, reactivación y filtros conservan registros sin borrado físico', async () => {
  const owner = await createClient();
  const input = petInput();
  const pet = await createPet(owner.id, input);
  const archived = await app.inject({
    method: 'PUT',
    url: `/api/pets/${pet.id}`,
    headers: headers.reception,
    payload: { ...input, active: false, version: pet.version },
  });
  assert.equal(archived.statusCode, 200);
  const list = async (status: string) =>
    (
      await app.inject({
        url: `/api/pets?status=${status}&clientId=${owner.id}`,
        headers: headers.admin,
      })
    ).json();
  assert.equal((await list('active')).total, 0);
  assert.equal((await list('archived')).total, 1);
  assert.equal((await list('all')).items[0].id, pet.id);
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: `/api/pets/${pet.id}`,
        headers: headers.admin,
        payload: { ...input, active: true, version: 2 },
      })
    ).statusCode,
    200,
  );
  assert.equal((await list('active')).total, 1);
  assert.equal(
    (await app.inject({ method: 'DELETE', url: `/api/pets/${pet.id}`, headers: headers.admin }))
      .statusCode,
    404,
  );
});
test('veterinario consulta ficha clínica sin contactos y no puede escribir ni consultar clientes', async () => {
  const owner = await createClient(
    clientInput({
      email: 'contacto-privado@example.invalid',
      phone: '000000000',
      address: 'Dirección privada ficticia',
    }),
  );
  const pet = await createPet(owner.id, petInput({ allergies: 'Observación para el veterinario' }));
  for (const path of [`/api/pets/${pet.id}`, `/api/pets?clientId=${owner.id}`]) {
    const response = await app.inject({ url: path, headers: headers.veterinarian });
    assert.equal(response.statusCode, 200);
    assert.doesNotMatch(
      response.body,
      /"email"|"phone"|"address"|documentNumber|contactConsent|contacto-privado/,
    );
    assert.match(response.body, /Observación para el veterinario/);
  }
  assert.equal(
    (await app.inject({ url: `/api/clients/${owner.id}`, headers: headers.veterinarian }))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({ url: '/api/pets?q=contacto-privado', headers: headers.veterinarian })
    ).json().total,
    0,
  );
  for (const [method, path, payload] of [
    ['POST', '/api/clients', clientInput()],
    ['POST', '/api/pets', { ...petInput(), clientId: owner.id }],
    ['PUT', `/api/pets/${pet.id}`, { ...petInput(), version: 1 }],
    ['PUT', `/api/clients/${owner.id}`, { ...clientInput(), version: 1 }],
  ] as const)
    assert.equal(
      (await app.inject({ method, url: path, headers: headers.veterinarian, payload })).statusCode,
      403,
    );
});
test('escrituras exigen sesión, origen correcto y CSRF, incluso con IDs válidos', async () => {
  const payload = clientInput();
  assert.equal(
    (await app.inject({ method: 'POST', url: '/api/clients', payload })).statusCode,
    401,
  );
  for (const extra of [
    { origin: 'https://ajeno.invalid' },
    { 'x-csrf-token': '' },
    { 'x-csrf-token': 'inventado' },
  ])
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/clients',
          headers: { ...headers.admin, ...extra },
          payload,
        })
      ).statusCode,
      403,
    );
  assert.equal(
    (await app.inject({ url: `/api/clients/${randomUUID()}`, headers: headers.admin })).statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: `/api/pets/${randomUUID()}`,
        headers: headers.admin,
        payload: { ...petInput(), version: 1 },
      })
    ).statusCode,
    404,
  );
});
test('auditoría registra actor y versión sin duplicar datos privados; fallo de auditoría revierte el cambio', async () => {
  const owner = await createClient(clientInput({ email: 'no-auditar@example.invalid' }));
  const audit = (
    await pool.query(
      "SELECT actor_id,metadata FROM audit_logs WHERE entity_id=$1 AND action='client.created'",
      [owner.id],
    )
  ).rows[0];
  assert.equal(audit.actor_id, identities.admin!.id);
  assert.equal(audit.metadata.version, 1);
  assert.doesNotMatch(JSON.stringify(audit.metadata), /no-auditar/);
  await pool.query(
    `ALTER TABLE audit_logs ADD CONSTRAINT patients_test_audit_failure CHECK (actor_id <> '${identities.admin!.id}'::uuid) NOT VALID`,
  );
  try {
    const input = clientInput({ name: `Rollback ${tag}` });
    const failed = await app.inject({
      method: 'POST',
      url: '/api/clients',
      headers: headers.admin,
      payload: input,
    });
    assert.equal(failed.statusCode, 500);
    assert.equal(
      (await pool.query('SELECT count(*) FROM clients WHERE name=$1', [input.name])).rows[0].count,
      '0',
    );
    const edit = await app.inject({
      method: 'PUT',
      url: `/api/clients/${owner.id}`,
      headers: headers.admin,
      payload: { ...clientInput({ name: 'No debe persistir' }), version: owner.version },
    });
    assert.equal(edit.statusCode, 500);
    const current = (
      await app.inject({ url: `/api/clients/${owner.id}`, headers: headers.admin })
    ).json();
    assert.equal(current.name, owner.name);
    assert.equal(current.version, 1);
  } finally {
    await pool.query('ALTER TABLE audit_logs DROP CONSTRAINT patients_test_audit_failure');
  }
});
