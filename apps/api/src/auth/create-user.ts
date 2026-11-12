import { z } from 'zod';
import { parseConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { hashPassword } from './crypto.js';
import { passwordSchema } from './routes.js';

// Operación del responsable del servidor; nunca un endpoint público de registro.
const parsed = z
  .object({
    NEW_USER_EMAIL: z.string().trim().toLowerCase().pipe(z.email().max(254)),
    NEW_USER_NAME: z.string().trim().min(1).max(150),
    NEW_USER_ROLE: z.enum(['admin', 'reception', 'veterinarian']).default('admin'),
    NEW_USER_PASSWORD: passwordSchema,
  })
  .safeParse(process.env);
if (!parsed.success) {
  console.error(
    'Define NEW_USER_EMAIL, NEW_USER_NAME, NEW_USER_ROLE y NEW_USER_PASSWORD (12–128 caracteres) de forma privada.',
  );
  process.exitCode = 1;
} else {
  const input = parsed.data;
  delete process.env.NEW_USER_PASSWORD;
  const pool = createPool(parseConfig(process.env).DATABASE_URL);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (!(await client.query('SELECT 1 FROM business_settings')).rowCount)
      throw new Error('Configura primero la veterinaria');
    const user = await client.query<{ id: string }>(
      'INSERT INTO users(name,email,role,password_hash,login_enabled) VALUES ($1,$2,$3,$4,true) RETURNING id',
      [
        input.NEW_USER_NAME,
        input.NEW_USER_EMAIL,
        input.NEW_USER_ROLE,
        await hashPassword(input.NEW_USER_PASSWORD),
      ],
    );
    await client.query(
      "INSERT INTO audit_logs(action,entity_type,entity_id) VALUES ('auth.user_provisioned','user',$1)",
      [user.rows[0]!.id],
    );
    await client.query('COMMIT');
    console.info('Usuario creado; no se modificaron cuentas existentes.');
  } catch {
    await client.query('ROLLBACK');
    console.error('No se creó el usuario. Revisa configuración, conexión o correo ya registrado.');
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}
