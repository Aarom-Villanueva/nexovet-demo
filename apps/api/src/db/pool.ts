import pg from 'pg';
export function createPool(connectionString: string) {
  const pool = new pg.Pool({
    connectionString,
    max: 8,
    connectionTimeoutMillis: 3000,
    statement_timeout: 8000,
    application_name: 'nexovet',
  });
  // pg descarta clientes ociosos desconectados. La API debe seguir respondiendo
  // /health y anunciar /ready=503, sin un error no controlado ni datos de conexión.
  pool.on('error', () => {});
  return pool;
}
