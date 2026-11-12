import { z } from 'zod';
import { idSchema } from '../patients/validation.js';
import { versionSchema } from '../agenda/validation.js';
export const guid = idSchema.toLowerCase();
export const quantity = z
  .string()
  .regex(/^(0|[1-9]\d{0,8})(\.\d{1,3})?$/, 'Usa hasta 9 enteros y 3 decimales, con punto')
  .refine((v) => /[1-9]/.test(v), 'La cantidad debe ser mayor a cero');
export const lineSchema = z
  .object({ kind: z.enum(['product', 'service']), itemId: guid, quantity })
  .strict()
  .superRefine((v, ctx) => {
    if (v.kind === 'service' && !/^(?:[1-9]\d{0,2}|1000)(?:\.0{1,3})?$/.test(v.quantity))
      ctx.addIssue({
        code: 'custom',
        path: ['quantity'],
        message: 'Los servicios usan cantidades enteras de 1 a 1000',
      });
  });
export const saleSchema = z
  .object({
    clientId: guid.nullable(),
    note: z.string().trim().max(1000),
    lines: z.array(lineSchema).min(1).max(40),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (new Set(v.lines.map((l) => `${l.kind}:${l.itemId}`)).size !== v.lines.length)
      ctx.addIssue({
        code: 'custom',
        path: ['lines'],
        message: 'Cada producto o servicio debe aparecer una sola vez',
      });
  });
export const createSchema = saleSchema.safeExtend({ requestId: guid });
export const editSchema = saleSchema.safeExtend({ version: versionSchema });
export const stateSchema = z.object({ version: versionSchema }).strict();
export const paymentSchema = z
  .object({
    method: z.enum(['cash', 'card', 'transfer']),
    amount: z
      .string()
      .regex(
        /^(0|[1-9]\d{0,9})(\.\d{1,2})?$/,
        'Importe con hasta 10 enteros y 2 decimales, con punto',
      )
      .refine((v) => /[1-9]/.test(v), 'El pago debe ser mayor a cero'),
    reference: z
      .string()
      .trim()
      .max(100)
      .transform((v) => v || null)
      .nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.method !== 'cash' && (!v.reference || v.reference.length < 3))
      ctx.addIssue({
        code: 'custom',
        path: ['reference'],
        message: 'Indica una referencia de al menos 3 caracteres para tarjeta o transferencia',
      });
  });
export const confirmSchema = z
  .object({ requestId: guid, version: versionSchema, payments: z.array(paymentSchema).max(5) })
  .strict();
export const querySchema = z
  .object({
    q: z.string().trim().max(100).default(''),
    status: z.enum(['all', 'draft', 'confirmed', 'cancelled']).default('all'),
    clientId: guid.optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export const itemQuery = z
  .object({ q: z.string().trim().min(2).max(100), kind: z.enum(['product', 'service']) })
  .strict();
export const clientQuery = z.object({ q: z.string().trim().min(2).max(100) }).strict();
export function scaled(value: string, digits: number) {
  const [whole, part = ''] = value.split('.');
  return BigInt(whole!) * 10n ** BigInt(digits) + BigInt(part.padEnd(digits, '0'));
}
