import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';
import type { Config } from '../config.js';

export interface ResetMail {
  to: string;
  url: string;
}
export type SendResetMail = (mail: ResetMail) => Promise<void>;
export const localDirectory = fileURLToPath(new URL('../../../../.local/', import.meta.url));
export function createMailer(config: Config): SendResetMail {
  if (config.MAIL_DELIVERY === 'local') {
    if (config.NODE_ENV === 'production') throw new Error('Buzón local prohibido en producción');
    return async (mail) => {
      await mkdir(`${localDirectory}/mail`, { recursive: true, mode: 0o700 });
      await writeFile(
        `${localDirectory}/mail/${randomUUID()}.json`,
        JSON.stringify(
          { ...mail, subject: 'Recupera tu acceso a NexoVet', createdAt: new Date().toISOString() },
          null,
          2,
        ),
        { mode: 0o600, flag: 'wx' },
      );
    };
  }
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE === 'true',
    requireTLS: config.SMTP_SECURE !== 'true',
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } : undefined,
    connectionTimeout: 10000,
    socketTimeout: 10000,
  });
  return async ({ to, url }) => {
    await transport.sendMail({
      from: config.MAIL_FROM,
      to,
      subject: 'Recupera tu acceso a NexoVet',
      text: `Solicitaste cambiar tu contraseña de NexoVet. Abre este enlace en los próximos 30 minutos:\n${url}\n\nSi no lo solicitaste, ignora este mensaje.`,
    });
  };
}
