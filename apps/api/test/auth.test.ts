import { before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Role } from '@nexovet/shared';
import { buildApp } from '../src/app.js';
import { parseConfig } from '../src/config.js';
import { createPool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrations.js';
import { seed } from '../src/db/seeds.js';
import { getDemoOverview } from '../src/demo.js';
import { hashPassword, verifyPassword, tokenHash, newToken } from '../src/auth/crypto.js';
import type { ResetMail } from '../src/auth/mail.js';

const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/nexovet_test')
  throw new Error('Se requiere TEST_DATABASE_URL nexovet_test');
const pool = createPool(url);
const origin = 'http://127.0.0.1:5173';
const config = parseConfig({ DATABASE_URL: url, NODE_ENV: 'test', APP_ORIGIN: origin });
const password = 'Solo para pruebas 2026!';
const users = Object.fromEntries(
  (['admin', 'reception', 'veterinarian'] as const).map((role) => [
    role,
    { id: randomUUID(), email: `test-${role}-${randomUUID()}@example.invalid`, role },
  ]),
) as Record<Role, { id: string; email: string; role: Role }>;
const disabled = `disabled-${randomUUID()}@example.invalid`;
const deliveries: ResetMail[] = [];
const app = buildApp({
  ready: async () => {},
  overview: (role) => getDemoOverview(pool, role),
  auth: {
    pool,
    config,
    sendMail: async (mail) => {
      deliveries.push(mail);
    },
  },
});
before(async () => {
  await migrate(pool);
  await seed(pool, { NODE_ENV: 'test', DATABASE_URL: url });
  const hash = await hashPassword(password);
  for (const user of Object.values(users))
    await pool.query(
      'INSERT INTO users(id,name,email,role,password_hash,login_enabled) VALUES ($1,$2,$3,$4,$5,true)',
      [user.id, `Prueba ${user.role}`, user.email, user.role, hash],
    );
  await pool.query("INSERT INTO users(name,email,role) VALUES ('Sin acceso',$1,'reception')", [
    disabled,
  ]);
  await app.ready();
});
beforeEach(async () => {
  await pool.query('DELETE FROM auth_rate_limits');
  deliveries.length = 0;
});
after(async () => {
  await app.close();
  await pool.query('UPDATE users SET active=false,login_enabled=false WHERE id=ANY($1::uuid[])', [
    Object.values(users).map((user) => user.id),
  ]);
  await pool.query('DELETE FROM users WHERE email=$1', [disabled]);
  await pool.end();
});
function post(path: string, payload: unknown, headers: Record<string, string> = {}) {
  return app.inject({
    method: 'POST',
    url: `/api/auth/${path}`,
    headers: { origin, ...headers },
    payload,
  });
}
async function login(role: Role = 'admin') {
  const response = await post('login', { email: users[role].email, password });
  assert.equal(response.statusCode, 200, response.body);
  const raw = response.cookies.find((cookie) => cookie.name === 'nexovet_session')!.value;
  return {
    cookie: `nexovet_session=${raw}`,
    token: raw,
    csrf: response.json().csrfToken as string,
    response,
  };
}
test('scrypt utiliza sales distintas; rechaza contraseña equivocada sin almacenar texto', async () => {
  const a = await hashPassword(password);
  const b = await hashPassword(password);
  assert.notEqual(a, b);
  assert.equal(await verifyPassword(password, a), true);
  assert.equal(await verifyPassword('otra contraseña', a), false);
  assert.equal(await verifyPassword(password, 'hash inválido'), false);
  assert.equal(tokenHash(newToken()).length, 64);
  assert.doesNotMatch(a, /Solo para pruebas/);
});
test('todas las lecturas de negocio requieren sesión y la antigua ruta pública no existe', async () => {
  for (const path of ['overview', 'clients', 'pets', 'products', 'users', 'auth/session'])
    assert.equal((await app.inject(`/api/${path}`)).statusCode, 401, path);
  assert.equal((await app.inject('/api/demo/overview')).statusCode, 404);
});
test('login normaliza el correo, devuelve cookie HttpOnly y guarda solo hash del token', async () => {
  const response = await post('login', {
    email: `  ${users.admin.email.toUpperCase()}  `,
    password,
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.match(String(response.headers['set-cookie']), /HttpOnly/);
  assert.match(String(response.headers['set-cookie']), /SameSite=Lax/);
  const token = response.cookies[0]!.value;
  const row = (
    await pool.query('SELECT token_hash FROM user_sessions WHERE token_hash=$1', [tokenHash(token)])
  ).rows[0];
  assert.ok(row);
  assert.notEqual(row.token_hash, token);
  const restored = await app.inject({
    url: '/api/auth/session',
    headers: { cookie: `nexovet_session=${token}` },
  });
  assert.equal(restored.statusCode, 200);
  assert.equal(restored.json().csrfToken, response.json().csrfToken);
  assert.doesNotMatch(restored.body, /password_hash|token_hash/);
});
test('cuenta desconocida, contraseña incorrecta y cuenta sin acceso tienen el mismo error', async () => {
  const a = await post('login', { email: users.admin.email, password: 'incorrecta' });
  const b = await post('login', { email: 'no-existe@example.invalid', password });
  const c = await post('login', { email: disabled, password });
  assert.equal(a.statusCode, 401);
  assert.equal(b.statusCode, 401);
  assert.equal(c.statusCode, 401);
  assert.equal(a.body, b.body);
  assert.equal(b.body, c.body);
  assert.equal(a.cookies.length, 0);
});
test('origen y CSRF se validan; cerrar sesión revoca el acceso y rota al ingresar otra vez', async () => {
  assert.equal(
    (
      await post(
        'login',
        { email: users.admin.email, password },
        { origin: 'https://ajeno.invalid' },
      )
    ).statusCode,
    403,
  );
  const session = await login();
  assert.equal((await post('logout', {}, { cookie: session.cookie })).statusCode, 403);
  assert.equal(
    (await post('logout', {}, { cookie: session.cookie, 'x-csrf-token': 'falso' })).statusCode,
    403,
  );
  assert.equal(
    (await post('logout', {}, { cookie: session.cookie, 'x-csrf-token': session.csrf })).statusCode,
    204,
  );
  assert.equal(
    (await app.inject({ url: '/api/overview', headers: { cookie: session.cookie } })).statusCode,
    401,
  );
  assert.notEqual((await login()).token, session.token);
});
test('permisos se aplican en API: veterinario sin correos/precios; recepción sin cuentas del equipo', async () => {
  for (const role of ['admin', 'reception', 'veterinarian'] as const) {
    const session = await login(role);
    const headers = { cookie: session.cookie };
    const overview = await app.inject({ url: '/api/overview', headers });
    assert.equal(overview.statusCode, 200);
    assert.equal(
      (await app.inject({ url: '/api/users', headers })).statusCode,
      role === 'admin' ? 200 : 403,
    );
    for (const path of ['clients', 'products'])
      assert.equal(
        (await app.inject({ url: `/api/${path}`, headers })).statusCode,
        role === 'veterinarian' ? 403 : 200,
      );
    if (role === 'veterinarian') {
      assert.deepEqual(overview.json().clients, []);
      assert.deepEqual(overview.json().products, []);
      assert.doesNotMatch(overview.body, /@example|"price"|"email"/);
      assert.ok(overview.json().pets.length);
    }
  }
});
test('sesiones vencidas por inactividad y por límite de ocho horas se rechazan', async () => {
  for (const absolute of [false, true]) {
    const session = await login();
    await pool.query(
      `UPDATE user_sessions SET created_at=now()-interval '${absolute ? '9' : '2'} hours',expires_at=now()+interval '${absolute ? '1 hour' : '-1 hour'}' WHERE token_hash=$1`,
      [tokenHash(session.token)],
    );
    const response = await app.inject({
      url: '/api/auth/session',
      headers: { cookie: session.cookie },
    });
    assert.equal(response.statusCode, 401);
    assert.match(String(response.headers['set-cookie']), /Max-Age=0/);
  }
});
test('cambiar el rol o desactivar una cuenta afecta inmediatamente a sesiones existentes', async () => {
  const session = await login();
  const headers = { cookie: session.cookie };
  try {
    await pool.query("UPDATE users SET role='veterinarian' WHERE id=$1", [users.admin.id]);
    assert.equal((await app.inject({ url: '/api/users', headers })).statusCode, 403);
    assert.equal(
      (await app.inject({ url: '/api/auth/session', headers })).json().user.role,
      'veterinarian',
    );
    await pool.query('UPDATE users SET active=false WHERE id=$1', [users.admin.id]);
    assert.equal((await app.inject({ url: '/api/overview', headers })).statusCode, 401);
  } finally {
    await pool.query("UPDATE users SET role='admin',active=true WHERE id=$1", [users.admin.id]);
  }
});
test('límite de intentos persiste entre instancias y solicitudes concurrentes', async () => {
  const email = `ausente-${randomUUID()}@example.invalid`;
  const results = await Promise.all(
    Array.from({ length: 12 }, () => post('login', { email, password: 'incorrecta' })),
  );
  assert.equal(results.filter((response) => response.statusCode === 401).length, 10);
  assert.equal(results.filter((response) => response.statusCode === 429).length, 2);
  const other = buildApp({
    ready: async () => {},
    overview: async () => null,
    auth: { pool, config, sendMail: async () => {} },
  });
  try {
    assert.equal(
      (
        await other.inject({
          method: 'POST',
          url: '/api/auth/login',
          headers: { origin },
          payload: { email, password },
        })
      ).statusCode,
      429,
    );
  } finally {
    await other.close();
  }
});
test('recuperación: respuesta uniforme, token vencido/consumido, consumo concurrente y revocación de todas las sesiones', async () => {
  const session1 = await login('reception');
  const session2 = await login('reception');
  const absent = await post('forgot-password', { email: 'nadie@example.invalid' });
  const known = await post('forgot-password', { email: users.reception.email });
  assert.equal(known.statusCode, 202);
  assert.equal(absent.body, known.body);
  assert.doesNotMatch(known.body, /token|@example/);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const token = new URLSearchParams(new URL(deliveries[0]!.url).hash.slice(1)).get('token')!;
  assert.ok(
    (
      await pool.query('SELECT 1 FROM password_reset_tokens WHERE token_hash=$1', [
        tokenHash(token),
      ])
    ).rowCount,
  );
  await pool.query(
    "UPDATE password_reset_tokens SET created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' WHERE token_hash=$1",
    [tokenHash(token)],
  );
  assert.equal(
    (await post('reset-password', { token, password: 'Nueva contraseña segura 2026' })).statusCode,
    400,
  );
  await post('forgot-password', { email: users.reception.email });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const fresh = new URLSearchParams(new URL(deliveries.at(-1)!.url).hash.slice(1)).get('token')!;
  const results = await Promise.all([
    post('reset-password', { token: fresh, password: 'Nueva contraseña segura 2026' }),
    post('reset-password', { token: fresh, password: 'Nueva contraseña segura 2026' }),
  ]);
  assert.deepEqual(results.map((response) => response.statusCode).sort(), [200, 400]);
  for (const session of [session1, session2])
    assert.equal(
      (await app.inject({ url: '/api/overview', headers: { cookie: session.cookie } })).statusCode,
      401,
    );
  assert.equal((await post('login', { email: users.reception.email, password })).statusCode, 401);
  assert.equal(
    (
      await post('login', {
        email: users.reception.email,
        password: 'Nueva contraseña segura 2026',
      })
    ).statusCode,
    200,
  );
  assert.equal((await post('reset-password', { token: fresh, password })).statusCode, 400);
});
test('producción emite cookies Secure y exige HTTPS y SMTP configurado', async () => {
  assert.throws(() => parseConfig({ DATABASE_URL: url, NODE_ENV: 'production' }));
  const production = parseConfig({
    DATABASE_URL: url,
    NODE_ENV: 'production',
    APP_ORIGIN: 'https://vet.example.invalid',
    MAIL_DELIVERY: 'smtp',
    SMTP_HOST: 'smtp.example.invalid',
    MAIL_FROM: 'nexo@example.invalid',
  });
  const secure = buildApp({
    production: true,
    ready: async () => {},
    overview: async () => null,
    auth: { pool, config: production, sendMail: async () => {} },
  });
  try {
    const response = await secure.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: production.APP_ORIGIN },
      payload: { email: users.admin.email, password },
    });
    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers['set-cookie']), /; Secure/);
  } finally {
    await secure.close();
  }
});
