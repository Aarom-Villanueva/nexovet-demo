import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { assertDevelopmentDatabase, parseConfig } from '../src/config.js';

test('salud disponible; disponibilidad no expone el error de PostgreSQL', async () => {
  const app = buildApp({
    ready: async () => {
      throw new Error('password=privado');
    },
    overview: async () => null,
  });
  try {
    assert.equal((await app.inject('/api/health')).statusCode, 200);
    const response = await app.inject('/api/ready');
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { status: 'unavailable' });
    assert.doesNotMatch(response.body, /privado/);
    assert.equal((await app.inject('/api/demo/overview')).statusCode, 404);
  } finally {
    await app.close();
  }
});
test('vista previa no existe en producción y no se puede habilitar por accidente', async () => {
  assert.throws(() =>
    buildApp({
      production: true,
      enableDemo: true,
      ready: async () => {},
      overview: async () => null,
    }),
  );
  const app = buildApp({ production: true, ready: async () => {}, overview: async () => null });
  try {
    assert.equal((await app.inject('/api/demo/overview')).statusCode, 404);
  } finally {
    await app.close();
  }
});
test('la ruta temporal pública fue retirada incluso en modo demostración', async () => {
  const app = buildApp({ enableDemo: true, ready: async () => {}, overview: async () => null });
  try {
    const result = await app.inject('/api/demo/overview');
    assert.equal(result.statusCode, 404);
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.equal(result.headers['referrer-policy'], 'no-referrer');
  } finally {
    await app.close();
  }
});
test('configuración y semilla impiden producción y bases ajenas', () => {
  assert.throws(() =>
    parseConfig({
      DATABASE_URL: 'postgres://u:p@localhost/db',
      NODE_ENV: 'production',
      ENABLE_DEMO: 'true',
    }),
  );
  assert.throws(() => parseConfig({ DATABASE_URL: 'https://example.invalid' }));
  assert.throws(() =>
    assertDevelopmentDatabase({ DATABASE_URL: 'postgres://localhost/clientes_reales' }),
  );
  assert.throws(() =>
    assertDevelopmentDatabase({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://localhost/nexovet_dev',
    }),
  );
  assert.doesNotThrow(() =>
    assertDevelopmentDatabase({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://localhost/nexovet_test',
    }),
  );
});
