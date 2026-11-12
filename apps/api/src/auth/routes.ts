import cookie from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { AuthUser, Role, DemoOverview } from '@nexovet/shared';
import type { Config } from '../config.js';
import {
  constantEqual,
  csrfFor,
  dummyHash,
  hashPassword,
  newToken,
  tokenHash,
  verifyPassword,
} from './crypto.js';
import type { SendResetMail, ResetMail } from './mail.js';
import { registerPatients } from '../patients/routes.js';
import { registerAgenda } from '../agenda/routes.js';
import { registerSales } from '../sales/routes.js';
import { registerInventory } from '../inventory/routes.js';
import { registerFollowups } from '../follow-ups/routes.js';

interface Identity {
  user: AuthUser;
  sessionId: string;
  csrfToken: string;
}
declare module 'fastify' {
  interface FastifyRequest {
    identity: Identity | null;
    resetMail: ResetMail | null;
  }
}
export interface AuthOptions {
  pool: Pool;
  config: Config;
  sendMail: SendResetMail;
  overview: (role: Role, userId?: string) => Promise<DemoOverview | null>;
}
const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const passwordSchema = z.string().min(12).max(128);
const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128) });
const forgotSchema = z.object({ email: emailSchema });
const resetSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  password: passwordSchema,
});
const COOKIE = 'nexovet_session';
const genericForgot = {
  message: 'Si el correo tiene acceso habilitado, recibirás un enlace para cambiar tu contraseña.',
};

export async function registerAuth(app: FastifyInstance, options: AuthOptions) {
  const { pool, config } = options;
  const production = config.NODE_ENV === 'production';
  const cookieOptions = { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: production };
  await app.register(cookie);
  app.decorateRequest('identity', null);
  app.decorateRequest('resetMail', null);
  const deliveries = new Set<Promise<void>>();
  // Enviar después de responder: el estado de SMTP no revela qué correos existen.
  app.addHook('onResponse', async (request) => {
    if (!request.resetMail) return;
    const delivery = Promise.resolve()
      .then(() => options.sendMail(request.resetMail!))
      .catch(() => {
        app.log.error(
          'No se pudo entregar un correo de recuperación; revisar el servicio de correo.',
        );
      });
    deliveries.add(delivery);
    void delivery.finally(() => deliveries.delete(delivery));
  });
  app.addHook('onClose', async () => {
    await Promise.all(deliveries);
  });
  function originAllowed(request: FastifyRequest) {
    const origin = request.headers.origin;
    if (origin === config.APP_ORIGIN) return true;
    if (production) return false;
    const expected = new URL(config.APP_ORIGIN);
    return (
      ['localhost', '127.0.0.1'].includes(expected.hostname) &&
      ['localhost', '127.0.0.1'].some(
        (host) => origin === `${expected.protocol}//${host}:${expected.port}`,
      )
    );
  }
  async function limit(key: string, max: number) {
    const result = await pool.query<{ attempts: number }>(
      `INSERT INTO auth_rate_limits(key,attempts,window_ends_at) VALUES ($1,1,now()+interval '15 minutes')
      ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN auth_rate_limits.window_ends_at<=now() THEN 1 ELSE auth_rate_limits.attempts+1 END,
      window_ends_at=CASE WHEN auth_rate_limits.window_ends_at<=now() THEN now()+interval '15 minutes' ELSE auth_rate_limits.window_ends_at END RETURNING attempts`,
      [tokenHash(key)],
    );
    return result.rows[0]!.attempts <= max;
  }
  async function authEntry(request: FastifyRequest, reply: FastifyReply) {
    if (!originAllowed(request))
      return reply.code(403).send({ message: 'Origen de solicitud no permitido.' });
    if (!(await limit(`auth:ip:${request.ip}`, 100)))
      return reply
        .header('Retry-After', '900')
        .code(429)
        .send({ message: 'Demasiados intentos. Intenta dentro de 15 minutos.' });
  }
  async function requireSession(request: FastifyRequest, reply: FastifyReply) {
    const token = request.cookies[COOKIE];
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
      return reply.code(401).send({ message: 'Ingresa para continuar.' });
    const result = await pool.query<AuthUser & { sessionId: string }>(
      `UPDATE user_sessions s SET expires_at=LEAST(s.created_at+interval '8 hours',now()+interval '30 minutes') FROM users u
      WHERE s.user_id=u.id AND s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND s.created_at>now()-interval '8 hours'
      AND u.active AND u.login_enabled RETURNING u.id,u.name,u.email,u.role,s.id AS "sessionId"`,
      [tokenHash(token)],
    );
    const row = result.rows[0];
    if (!row) {
      reply.clearCookie(COOKIE, cookieOptions);
      return reply.code(401).send({ message: 'Tu sesión terminó. Vuelve a ingresar.' });
    }
    const { sessionId, ...user } = row;
    request.identity = { user, sessionId, csrfToken: csrfFor(token) };
  }
  const permit =
    (roles: readonly Role[]) => async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.identity || !roles.includes(request.identity.user.role))
        return reply.code(403).send({ message: 'Tu rol no tiene acceso a esta sección.' });
    };
  async function requireWrite(request: FastifyRequest, reply: FastifyReply) {
    if (!originAllowed(request))
      return reply.code(403).send({ message: 'Origen de solicitud no permitido.' });
    const csrf = request.headers['x-csrf-token'];
    if (
      typeof csrf !== 'string' ||
      !request.identity ||
      !constantEqual(csrf, request.identity.csrfToken)
    )
      return reply.code(403).send({ message: 'Solicitud no válida. Recarga la página.' });
  }
  app.post('/api/auth/login', { preHandler: authEntry }, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ message: 'Revisa el correo y la contraseña.' });
    const { email, password } = parsed.data;
    if (!(await limit(`login:email:${email}`, 10)))
      return reply
        .header('Retry-After', '900')
        .code(429)
        .send({ message: 'Demasiados intentos. Intenta dentro de 15 minutos.' });
    const result = await pool.query<
      AuthUser & { password_hash: string | null; login_enabled: boolean; active: boolean }
    >(
      'SELECT id,name,email,role,password_hash,login_enabled,active FROM users WHERE lower(email)=$1',
      [email],
    );
    const candidate = result.rows[0];
    const valid = await verifyPassword(
      password,
      candidate?.active && candidate.login_enabled
        ? (candidate.password_hash ?? dummyHash)
        : dummyHash,
    );
    if (!valid || !candidate?.active || !candidate.login_enabled) {
      await pool.query(
        "INSERT INTO audit_logs(action,entity_type,metadata) VALUES ('auth.login_failed','auth',$1)",
        [{ emailFingerprint: tokenHash(email) }],
      );
      return reply.code(401).send({ message: 'Correo o contraseña incorrectos.' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Serializa el alta de sesiones con cambios de contraseña.
      const locked = await client.query<AuthUser & { password_hash: string }>(
        'SELECT id,name,email,role,password_hash FROM users WHERE id=$1 AND active AND login_enabled FOR UPDATE',
        [candidate.id],
      );
      const row = locked.rows[0];
      if (!row || row.password_hash !== candidate.password_hash) {
        await client.query('ROLLBACK');
        return reply.code(401).send({ message: 'Correo o contraseña incorrectos.' });
      }
      const token = newToken();
      if (request.cookies[COOKIE])
        await client.query(
          'UPDATE user_sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL',
          [tokenHash(request.cookies[COOKIE]!)],
        );
      await client.query(
        "INSERT INTO user_sessions(user_id,token_hash,expires_at) VALUES ($1,$2,now()+interval '30 minutes')",
        [row.id, tokenHash(token)],
      );
      await client.query(
        "INSERT INTO audit_logs(actor_id,action,entity_type,entity_id) VALUES ($1,'auth.login','user',$1)",
        [row.id],
      );
      await client.query('COMMIT');
      const { password_hash: _, ...user } = row;
      return reply
        .setCookie(COOKIE, token, cookieOptions)
        .send({ user, csrfToken: csrfFor(token) });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
  app.get('/api/auth/session', { preHandler: requireSession }, async (request) => ({
    user: request.identity!.user,
    csrfToken: request.identity!.csrfToken,
  }));
  app.post(
    '/api/auth/logout',
    { preHandler: [authEntry, requireSession] },
    async (request, reply) => {
      const csrf = request.headers['x-csrf-token'];
      if (typeof csrf !== 'string' || !constantEqual(csrf, request.identity!.csrfToken))
        return reply.code(403).send({ message: 'Solicitud no válida. Recarga la página.' });
      await pool.query('UPDATE user_sessions SET revoked_at=now() WHERE id=$1', [
        request.identity!.sessionId,
      ]);
      await pool.query(
        "INSERT INTO audit_logs(actor_id,action,entity_type,entity_id) VALUES ($1,'auth.logout','user',$1)",
        [request.identity!.user.id],
      );
      return reply.clearCookie(COOKIE, cookieOptions).code(204).send();
    },
  );
  app.post('/api/auth/forgot-password', { preHandler: authEntry }, async (request, reply) => {
    const parsed = forgotSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: 'Ingresa un correo válido.' });
    // Mismo resultado para direcciones existentes, desconocidas y limitadas.
    if (!(await limit(`forgot:email:${parsed.data.email}`, 3)))
      return reply.code(202).send(genericForgot);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const user = (
        await client.query<AuthUser>(
          'SELECT id,name,email,role FROM users WHERE lower(email)=$1 AND active AND login_enabled FOR UPDATE',
          [parsed.data.email],
        )
      ).rows[0];
      if (user) {
        const token = newToken();
        await client.query(
          'UPDATE password_reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL',
          [user.id],
        );
        await client.query(
          "INSERT INTO password_reset_tokens(user_id,token_hash,expires_at) VALUES ($1,$2,now()+interval '30 minutes')",
          [user.id, tokenHash(token)],
        );
        await client.query(
          "INSERT INTO audit_logs(actor_id,action,entity_type,entity_id) VALUES ($1,'auth.reset_requested','user',$1)",
          [user.id],
        );
        request.resetMail = {
          to: user.email,
          url: `${config.APP_ORIGIN}/restablecer#token=${token}`,
        };
      }
      await client.query('COMMIT');
      return reply.code(202).send(genericForgot);
    } catch (error) {
      request.resetMail = null;
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
  app.post('/api/auth/reset-password', { preHandler: authEntry }, async (request, reply) => {
    const parsed = resetSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ message: 'Usa el enlace recibido y una contraseña de 12 a 128 caracteres.' });
    const hash = await hashPassword(parsed.data.password);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const user = (
        await client.query<{ id: string }>(
          `SELECT u.id FROM users u JOIN password_reset_tokens t ON t.user_id=u.id WHERE t.token_hash=$1 AND t.used_at IS NULL AND t.expires_at>now() AND u.active AND u.login_enabled FOR UPDATE OF u`,
          [tokenHash(parsed.data.token)],
        )
      ).rows[0];
      const consumed =
        user &&
        (await client.query(
          'UPDATE password_reset_tokens SET used_at=now() WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() RETURNING id',
          [tokenHash(parsed.data.token)],
        ));
      if (!consumed?.rowCount) {
        await client.query('ROLLBACK');
        return reply
          .code(400)
          .send({ message: 'El enlace venció o ya se utilizó. Solicita uno nuevo.' });
      }
      await client.query('UPDATE users SET password_hash=$2 WHERE id=$1', [user!.id, hash]);
      await client.query(
        'UPDATE user_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',
        [user!.id],
      );
      await client.query(
        'UPDATE password_reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL',
        [user!.id],
      );
      await client.query(
        "INSERT INTO audit_logs(actor_id,action,entity_type,entity_id) VALUES ($1,'auth.reset_completed','user',$1)",
        [user!.id],
      );
      await client.query('COMMIT');
      return reply
        .clearCookie(COOKIE, cookieOptions)
        .send({ message: 'Contraseña actualizada. Ya puedes ingresar.' });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
  async function overview(request: FastifyRequest, reply: FastifyReply) {
    try {
      const data = await options.overview(request.identity!.user.role, request.identity!.user.id);
      if (!data)
        return reply.code(409).send({ message: 'La veterinaria todavía no está configurada.' });
      return data;
    } catch {
      return reply
        .code(503)
        .send({ message: 'No se pudieron cargar los datos. Intenta nuevamente.' });
    }
  }
  app.get('/api/overview', { preHandler: requireSession }, overview);
  app.get(
    '/api/users',
    { preHandler: [requireSession, permit(['admin'])] },
    async () =>
      (
        await pool.query(
          'SELECT id,name,email,role,active,login_enabled AS "loginEnabled" FROM users ORDER BY name',
        )
      ).rows,
  );
  await registerPatients(app, { pool, requireSession, requireWrite, permit });
  await registerAgenda(app, { pool, requireSession, requireWrite, permit });
  await registerFollowups(app, { pool, requireSession, requireWrite, permit });
  await registerInventory(app, { pool, requireSession, requireWrite, permit });
  await registerSales(app, { pool, requireSession, requireWrite, permit });
}
