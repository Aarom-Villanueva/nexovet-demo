import { z } from 'zod';
import { daySchema, versionSchema } from '../agenda/validation.js';
import { idSchema, todayInLima } from '../patients/validation.js';
export const guid = idSchema.toLowerCase();
const name = z.string().trim().min(2).max(150),
  password = z.string().min(12).max(128);
export const businessSchema = z
  .object({ name, address: z.string().trim().min(3).max(300), version: versionSchema })
  .strict();
export const serviceSchema = z
  .object({
    name,
    durationMinutes: z.number().int().min(5).max(480),
    price: z
      .string()
      .regex(/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/, 'Usa hasta 10 enteros y 2 decimales, con punto'),
    active: z.boolean(),
  })
  .strict();
export const serviceEdit = serviceSchema.extend({ version: versionSchema });
export const categorySchema = z.object({ name }).strict();
export const categoryEdit = categorySchema.extend({ version: versionSchema });
const userShape = {
  name,
  role: z.enum(['admin', 'reception', 'veterinarian']),
  active: z.boolean(),
  loginEnabled: z.boolean(),
};
const access = (v: { active: boolean; loginEnabled: boolean }, ctx: z.RefinementCtx) => {
  if (!v.active && v.loginEnabled)
    ctx.addIssue({
      code: 'custom',
      path: ['loginEnabled'],
      message: 'Una cuenta archivada debe tener el acceso deshabilitado',
    });
};
export const userCreate = z
  .object({
    ...userShape,
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
    password,
  })
  .strict()
  .superRefine(access);
export const userEdit = z
  .object({ ...userShape, password: password.nullable(), version: versionSchema })
  .strict()
  .superRefine(access);
const paging = {
  q: z.string().trim().max(100).default(''),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
};
export const listSchema = z
  .object({ ...paging, status: z.enum(['all', 'active', 'archived']).default('active') })
  .strict();
export const categoryQuery = z.object(paging).strict();
export const periodSchema = z
  .object({ from: daySchema, to: daySchema })
  .strict()
  .superRefine((v, ctx) => {
    const days = (Date.parse(v.to + 'T12:00:00Z') - Date.parse(v.from + 'T12:00:00Z')) / 86400000;
    if (days < 0 || days > 365)
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'El período debe ser ordenado y abarcar como máximo 366 días',
      });
  });
export const auditSchema = z
  .object({
    ...paging,
    from: daySchema,
    to: daySchema,
    action: z.string().trim().max(80).default(''),
    entityType: z.string().trim().max(80).default(''),
    actorId: guid.optional(),
    entityId: guid.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!periodSchema.safeParse({ from: v.from, to: v.to }).success)
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'El período debe ser ordenado y abarcar como máximo 366 días',
      });
  });
export function defaults() {
  const today = todayInLima();
  return { today, from: today.slice(0, 8) + '01', to: today };
}
export const bounds = (from: string, to: string) => [
  `${from}T00:00:00-05:00`,
  new Date(Date.parse(`${to}T00:00:00-05:00`) + 86400000).toISOString(),
];
