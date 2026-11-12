import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseConfig, assertDevelopmentDatabase } from '../config.js';
import { createPool } from '../db/pool.js';
import { hashPassword, newToken, verifyPassword } from './crypto.js';
import { localDirectory } from './mail.js';

assertDevelopmentDatabase(process.env);
const config = parseConfig(process.env);
const pool = createPool(config.DATABASE_URL);
const database = new URL(config.DATABASE_URL).pathname.slice(1);
const path = `${localDirectory}/demo-credentials-${database}.json`;
interface Credentials {
  database: string;
  accounts: Array<{ email: string; role: string; password: string }>;
}
try {
  let saved: Credentials | null = null;
  try {
    saved = JSON.parse(await readFile(path, 'utf8')) as Credentials;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (saved && saved.database !== database) throw new Error('Archivo de credenciales de otra base');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (!(await client.query('SELECT 1 FROM business_settings WHERE is_demo')).rowCount)
      throw new Error('Se requiere una veterinaria de demostración');
    const users = await client.query<{
      id: string;
      email: string;
      role: string;
      login_enabled: boolean;
      password_hash: string | null;
    }>(
      "SELECT id,email,role,login_enabled,password_hash FROM users WHERE id IN (md5('user:admin')::uuid,md5('user:reception')::uuid,md5('user:vet1')::uuid,md5('user:vet2')::uuid) ORDER BY email FOR UPDATE",
    );
    if (users.rows.length !== 4) throw new Error('Primero ejecuta db:seed');
    const credentials: Credentials = { database, accounts: [] };
    for (const user of users.rows) {
      const existing = saved?.accounts.find((account) => account.email === user.email);
      if (
        user.login_enabled &&
        (!existing ||
          !user.password_hash ||
          !(await verifyPassword(existing.password, user.password_hash)))
      )
        throw new Error(
          'Una cuenta ya tiene otra contraseña. No se sobrescribirá: usa recuperación.',
        );
      const password = existing?.password ?? newToken();
      if (!user.login_enabled)
        await client.query('UPDATE users SET password_hash=$2,login_enabled=true WHERE id=$1', [
          user.id,
          await hashPassword(password),
        ]);
      credentials.accounts.push({ email: user.email, role: user.role, password });
    }
    await mkdir(localDirectory, { recursive: true, mode: 0o700 });
    await writeFile(path, JSON.stringify(credentials, null, 2), { mode: 0o600 });
    await client.query('COMMIT');
    console.info(`Accesos locales preparados. Consulta el archivo privado ${path}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'No se pudieron preparar los accesos');
  process.exitCode = 1;
} finally {
  await pool.end();
}
