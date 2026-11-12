import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import type { Pool, PoolClient } from 'pg';
import { databaseDirectory } from './migrations.js';

// Verifica sin ejecutar DDL. Una imagen anterior tampoco acepta una base más nueva.
export async function checkDatabase(db: Pick<Pool | PoolClient, 'query'>, production = false) {
  const names = (await readdir(`${databaseDirectory}/migrations`))
    .filter((name) => /^\d+_.*\.sql$/.test(name))
    .sort();
  const actual = (
    await db.query<{ name: string; checksum: string }>(
      'SELECT name,checksum FROM schema_migrations ORDER BY name',
    )
  ).rows;
  if (actual.length !== names.length) throw new Error('Migraciones pendientes o incompatibles');
  for (let i = 0; i < names.length; i++) {
    const checksum = createHash('sha256')
      .update(await readFile(`${databaseDirectory}/migrations/${names[i]}`, 'utf8'))
      .digest('hex');
    if (actual[i]?.name !== names[i] || actual[i]?.checksum !== checksum)
      throw new Error('Migraciones incompatibles con esta versión');
  }
  const business = (await db.query<{ is_demo: boolean }>('SELECT is_demo FROM business_settings'))
    .rows;
  if (business.length !== 1) throw new Error('Configura primero la veterinaria');
  if (production && business[0]!.is_demo)
    throw new Error('Base demostrativa prohibida en producción');
}
