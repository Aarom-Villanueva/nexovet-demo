import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

export const newToken = () => randomBytes(32).toString('base64url');
export const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
export const csrfFor = (token: string) =>
  createHmac('sha256', token).update('nexovet-csrf-v1').digest('base64url');
export function constantEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  return `scrypt$32768$8$1$${salt.toString('base64url')}$${(await derive(password, salt)).toString('base64url')}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts.slice(0, 4).join('$') !== 'scrypt$32768$8$1') return false;
  const salt = Buffer.from(parts[4]!, 'base64url');
  const expected = Buffer.from(parts[5]!, 'base64url');
  if (salt.length !== 16 || expected.length !== 64) return false;
  return timingSafeEqual(await derive(password, salt), expected);
}
// Misma operación costosa para usuarios inexistentes o deshabilitados.
export const dummyHash = `scrypt$32768$8$1$${Buffer.alloc(16, 1).toString('base64url')}$${Buffer.alloc(64, 1).toString('base64url')}`;
