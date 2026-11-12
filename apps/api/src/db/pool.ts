import pg from 'pg';
export function createPool(connectionString: string) {
  return new pg.Pool({
    connectionString,
    max: 8,
    connectionTimeoutMillis: 3000,
    statement_timeout: 8000,
    application_name: 'nexovet',
  });
}
