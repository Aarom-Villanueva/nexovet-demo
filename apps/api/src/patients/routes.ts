import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import type { z } from 'zod';
import type { ClientRecord, PetRecord, Role } from '@nexovet/shared';
import {
  clientSchema,
  clientEditSchema,
  petSchema,
  petEditSchema,
  listSchema,
  idSchema,
  searchPattern,
} from './validation.js';

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | void>;
interface Options {
  pool: Pool;
  requireSession: Guard;
  requireWrite: Guard;
  permit: (roles: readonly Role[]) => Guard;
}
class Problem extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}
const clientColumns = `c.id,c.name,c.email,c.phone,c.document_type AS "documentType",c.document_number AS "documentNumber",c.address,c.contact_consent_at::text AS "contactConsentAt",c.contact_consent_note AS "contactConsentNote",c.active,c.version,c.created_at::text AS "createdAt",c.updated_at::text AS "updatedAt",(SELECT count(*)::int FROM pets p WHERE p.client_id=c.id) AS pets`;
const petColumns = `p.id,p.client_id AS "clientId",p.name,p.species,p.breed,p.sex,p.birth_date::text AS "birthDate",p.microchip,p.allergies,p.active,p.version,p.created_at::text AS "createdAt",p.updated_at::text AS "updatedAt",c.name AS "ownerName",c.active AS "ownerActive"`;
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw result.error;
  return result.data;
}
async function transaction<T>(
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
async function getClient(client: PoolClient, id: string) {
  const row = (
    await client.query<ClientRecord>(`SELECT ${clientColumns} FROM clients c WHERE c.id=$1`, [id])
  ).rows[0];
  if (!row) throw new Problem(404, 'No encontramos ese cliente.');
  return row;
}
async function getPet(client: PoolClient, id: string) {
  const row = (
    await client.query<PetRecord>(
      `SELECT ${petColumns} FROM pets p JOIN clients c ON c.id=p.client_id WHERE p.id=$1`,
      [id],
    )
  ).rows[0];
  if (!row) throw new Problem(404, 'No encontramos esa mascota.');
  return row;
}
async function ensureUpdated(
  client: PoolClient,
  table: 'clients' | 'pets',
  id: string,
  count: number | null,
) {
  if (count) return;
  if (!(await client.query(`SELECT 1 FROM ${table} WHERE id=$1`, [id])).rowCount)
    throw new Problem(404, 'El registro ya no está disponible.');
  throw new Problem(
    409,
    'Otra persona actualizó esta ficha. Recarga la versión actual antes de guardar.',
    'VERSION_CONFLICT',
  );
}
async function audit(
  client: PoolClient,
  request: FastifyRequest,
  entity: 'client' | 'pet',
  id: string,
  action: 'created' | 'updated',
  fields: string[],
  version: number,
) {
  // Auditar qué cambió, sin duplicar teléfonos, documentos ni notas clínicas.
  await client.query(
    'INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,$3,$4,$5)',
    [request.identity!.user.id, `${entity}.${action}`, entity, id, { fields, version }],
  );
}
export async function registerPatients(
  app: FastifyInstance,
  { pool, requireSession, requireWrite, permit }: Options,
) {
  await app.register(async (scope) => {
    scope.setErrorHandler((error, _request, reply) => {
      if (error instanceof Problem)
        return reply.code(error.status).send({ message: error.message, code: error.code });
      if (error && typeof error === 'object' && 'issues' in error && Array.isArray(error.issues)) {
        const fields: Record<string, string> = {};
        for (const issue of error.issues as Array<{
          path: Array<string | number>;
          message: string;
        }>)
          fields[String(issue.path[0] ?? 'form')] = issue.message;
        return reply.code(400).send({ message: 'Revisa los campos indicados.', fields });
      }
      const code = (error as { code?: string }).code;
      if (code === '23505')
        return reply.code(409).send({
          message:
            (error as { constraint?: string }).constraint === 'clients_document_unique'
              ? 'Ya existe un cliente con ese tipo y número de documento.'
              : 'Ese microchip ya está registrado en otra mascota.',
          code: 'DUPLICATE',
        });
      if (code === '23503')
        return reply
          .code(409)
          .send({ message: 'El registro está relacionado con otros datos. Recarga la ficha.' });
      const status = (error as { statusCode?: number }).statusCode;
      scope.log.error({ code }, 'No se pudo procesar una ficha');
      return reply
        .code(status && status >= 400 && status < 500 ? status : 500)
        .send({ message: 'No se pudo completar la operación. Intenta nuevamente.' });
    });
    const readClients = [requireSession, permit(['admin', 'reception'])];
    const readPets = [requireSession, permit(['admin', 'reception', 'veterinarian'])];
    const write = [requireSession, permit(['admin', 'reception']), requireWrite];
    scope.get('/api/clients', { preHandler: readClients }, async (request) => {
      const query = parse(listSchema.omit({ clientId: true }), request.query);
      return transaction(
        pool,
        async (client) => {
          const where = `($1='all' OR c.active=($1='active')) AND (c.name ILIKE $2 OR c.email ILIKE $2 OR c.phone ILIKE $2 OR c.document_number ILIKE $2)`;
          const values = [query.status, searchPattern(query.q)];
          const total = (
            await client.query<{ total: number }>(
              `SELECT count(*)::int AS total FROM clients c WHERE ${where}`,
              values,
            )
          ).rows[0]!.total;
          const items = (
            await client.query<ClientRecord>(
              `SELECT ${clientColumns} FROM clients c WHERE ${where} ORDER BY lower(c.name),c.id LIMIT $3 OFFSET $4`,
              [...values, query.pageSize, (query.page - 1) * query.pageSize],
            )
          ).rows;
          return { items, total, page: query.page, pageSize: query.pageSize };
        },
        true,
      );
    });
    scope.get('/api/pets', { preHandler: readPets }, async (request) => {
      const query = parse(listSchema, request.query);
      return transaction(
        pool,
        async (client) => {
          const where = `($1='all' OR p.active=($1='active')) AND (p.name ILIKE $2 OR c.name ILIKE $2 OR p.microchip ILIKE $2) AND ($3::uuid IS NULL OR p.client_id=$3)`;
          const values = [query.status, searchPattern(query.q), query.clientId ?? null];
          const total = (
            await client.query<{ total: number }>(
              `SELECT count(*)::int AS total FROM pets p JOIN clients c ON c.id=p.client_id WHERE ${where}`,
              values,
            )
          ).rows[0]!.total;
          const items = (
            await client.query<PetRecord>(
              `SELECT ${petColumns} FROM pets p JOIN clients c ON c.id=p.client_id WHERE ${where} ORDER BY lower(p.name),p.id LIMIT $4 OFFSET $5`,
              [...values, query.pageSize, (query.page - 1) * query.pageSize],
            )
          ).rows;
          return { items, total, page: query.page, pageSize: query.pageSize };
        },
        true,
      );
    });
    scope.get('/api/clients/:id', { preHandler: readClients }, async (request) =>
      transaction(
        pool,
        (client) => getClient(client, parse(idSchema, (request.params as { id: string }).id)),
        true,
      ),
    );
    scope.get('/api/pets/:id', { preHandler: readPets }, async (request) =>
      transaction(
        pool,
        (client) => getPet(client, parse(idSchema, (request.params as { id: string }).id)),
        true,
      ),
    );
    scope.post('/api/clients', { preHandler: write }, async (request, reply) => {
      const input = parse(clientSchema, request.body);
      const row = await transaction(pool, async (client) => {
        const result = await client.query<{ id: string }>(
          `INSERT INTO clients(name,email,phone,document_type,document_number,address,contact_consent_at,contact_consent_note,active) VALUES ($1,$2,$3,$4,$5,$6,CASE WHEN $7::boolean THEN now() END,$8,$9) RETURNING id`,
          [
            input.name,
            input.email,
            input.phone,
            input.documentType,
            input.documentNumber,
            input.address,
            input.contactConsent,
            input.contactConsentNote,
            input.active,
          ],
        );
        const id = result.rows[0]!.id;
        await audit(client, request, 'client', id, 'created', Object.keys(input), 1);
        return getClient(client, id);
      });
      return reply.header('Location', `/api/clients/${row.id}`).code(201).send(row);
    });
    scope.put('/api/clients/:id', { preHandler: write }, async (request) => {
      const id = parse(idSchema, (request.params as { id: string }).id);
      const input = parse(clientEditSchema, request.body);
      return transaction(pool, async (client) => {
        const old = await client.query('SELECT * FROM clients WHERE id=$1 FOR UPDATE', [id]);
        if (!old.rowCount) throw new Problem(404, 'No encontramos ese cliente.');
        const result = await client.query(
          `UPDATE clients SET name=$1,email=$2,phone=$3,document_type=$4,document_number=$5,address=$6,contact_consent_at=CASE WHEN $7::boolean THEN COALESCE(contact_consent_at,now()) END,contact_consent_note=$8,active=$9,version=version+1,updated_at=now() WHERE id=$10 AND version=$11`,
          [
            input.name,
            input.email,
            input.phone,
            input.documentType,
            input.documentNumber,
            input.address,
            input.contactConsent,
            input.contactConsentNote,
            input.active,
            id,
            input.version,
          ],
        );
        await ensureUpdated(client, 'clients', id, result.rowCount);
        await audit(
          client,
          request,
          'client',
          id,
          'updated',
          Object.keys(input).filter((key) => key !== 'version'),
          input.version + 1,
        );
        return getClient(client, id);
      });
    });
    scope.post('/api/pets', { preHandler: write }, async (request, reply) => {
      const input = parse(petSchema, request.body);
      const row = await transaction(pool, async (client) => {
        const owner = (
          await client.query<{ active: boolean }>(
            'SELECT active FROM clients WHERE id=$1 FOR SHARE',
            [input.clientId],
          )
        ).rows[0];
        if (!owner) throw new Problem(404, 'No encontramos al responsable seleccionado.');
        if (!owner.active)
          throw new Problem(
            409,
            'Reactiva la ficha del responsable antes de registrar otra mascota.',
          );
        const result = await client.query<{ id: string }>(
          `INSERT INTO pets(client_id,name,species,breed,sex,birth_date,microchip,allergies,active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [
            input.clientId,
            input.name,
            input.species,
            input.breed,
            input.sex,
            input.birthDate,
            input.microchip,
            input.allergies,
            input.active,
          ],
        );
        const id = result.rows[0]!.id;
        await audit(client, request, 'pet', id, 'created', Object.keys(input), 1);
        return getPet(client, id);
      });
      return reply.header('Location', `/api/pets/${row.id}`).code(201).send(row);
    });
    scope.put('/api/pets/:id', { preHandler: write }, async (request) => {
      const id = parse(idSchema, (request.params as { id: string }).id);
      // clientId no se acepta: transferir pacientes requiere un flujo e historial propios.
      const input = parse(petEditSchema, request.body);
      return transaction(pool, async (client) => {
        const result = await client.query(
          `UPDATE pets SET name=$1,species=$2,breed=$3,sex=$4,birth_date=$5,microchip=$6,allergies=$7,active=$8,version=version+1,updated_at=now() WHERE id=$9 AND version=$10`,
          [
            input.name,
            input.species,
            input.breed,
            input.sex,
            input.birthDate,
            input.microchip,
            input.allergies,
            input.active,
            id,
            input.version,
          ],
        );
        await ensureUpdated(client, 'pets', id, result.rowCount);
        await audit(
          client,
          request,
          'pet',
          id,
          'updated',
          Object.keys(input).filter((key) => key !== 'version'),
          input.version + 1,
        );
        return getPet(client, id);
      });
    });
  });
}
