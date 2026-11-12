import { z } from 'zod';
import { idSchema } from '../patients/validation.js';
import { versionSchema } from '../agenda/validation.js';
export const guid = idSchema.toLowerCase();
const nullable = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => s || null)
    .nullable();
const amount = z
  .string()
  .regex(/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/, 'Usa hasta 10 enteros y 2 decimales, con punto');
const units = z
  .string()
  .regex(/^(0|[1-9]\d{0,8})(\.\d{1,3})?$/, 'Usa hasta 9 enteros y 3 decimales, con punto');
export const productSchema = z
  .object({
    sku: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9._-]{1,39}$/, 'Usa 2–40 letras, números, puntos o guiones'),
    name: z.string().trim().min(2).max(150),
    categoryId: guid.nullable(),
    salePrice: amount,
    minimumStock: units,
    active: z.boolean(),
  })
  .strict();
export const productEditSchema = productSchema.extend({ version: versionSchema });
export const supplierSchema = z
  .object({
    name: z.string().trim().min(2).max(150),
    taxId: nullable(11).refine(
      (v) => v === null || /^\d{11}$/.test(v),
      'El RUC debe tener 11 dígitos',
    ),
    email: nullable(254)
      .refine((v) => v === null || z.email().safeParse(v).success, 'Correo inválido')
      .transform((v) => v?.toLowerCase() ?? null),
    phone: nullable(30)
      .transform((v) => v?.replace(/[\s().-]/g, '') || null)
      .refine((v) => v === null || /^\+?\d{7,15}$/.test(v), 'Usa entre 7 y 15 dígitos'),
    address: nullable(300),
    active: z.boolean(),
  })
  .strict();
export const supplierEditSchema = supplierSchema.extend({ version: versionSchema });
const line = z
  .object({
    productId: guid,
    quantity: units.refine((v) => /[1-9]/.test(v), 'La cantidad debe ser mayor a cero'),
    unitCost: amount,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      !/^(0|[1-9]\d{0,8})(\.\d{1,3})?$/.test(v.quantity) ||
      !/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(v.unitCost)
    )
      return;
    const scaled = (value: string, n: number) => {
      const [whole, part = ''] = value.split('.');
      return BigInt(whole!) * 10n ** BigInt(n) + BigInt(part.padEnd(n, '0'));
    };
    const cents = (scaled(v.quantity, 3) * scaled(v.unitCost, 2) + 500n) / 1000n;
    if (cents > 9999999999999999n)
      ctx.addIssue({
        code: 'custom',
        path: ['unitCost'],
        message: 'El importe de una línea supera el máximo permitido',
      });
  });
export const purchaseSchema = z
  .object({
    supplierId: guid,
    note: z.string().trim().max(1000),
    lines: z.array(line).min(1).max(40),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (new Set(v.lines.map((l) => l.productId)).size !== v.lines.length)
      ctx.addIssue({
        code: 'custom',
        path: ['lines'],
        message: 'Cada producto debe aparecer una sola vez',
      });
  });
export const purchaseCreateSchema = purchaseSchema.safeExtend({ requestId: guid });
export const purchaseEditSchema = purchaseSchema.safeExtend({ version: versionSchema });
export const stateSchema = z.object({ version: versionSchema }).strict();
export const adjustmentSchema = z
  .object({
    requestId: guid,
    quantity: z
      .string()
      .regex(/^-?(0|[1-9]\d{0,8})(\.\d{1,3})?$/, 'Usa una cantidad con hasta 3 decimales')
      .refine((v) => /[1-9]/.test(v), 'El ajuste no puede ser cero'),
    reason: z.string().trim().min(5, 'Explica el motivo con al menos 5 caracteres').max(500),
  })
  .strict();
const paging = {
  q: z.string().trim().max(100).default(''),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
};
export const productQuery = z
  .object({
    ...paging,
    status: z.enum(['active', 'archived', 'all']).default('active'),
    stock: z.enum(['all', 'low', 'empty']).default('all'),
    categoryId: guid.optional(),
  })
  .strict();
export const supplierQuery = z
  .object({ ...paging, status: z.enum(['active', 'archived', 'all']).default('active') })
  .strict();
export const purchaseQuery = z
  .object({ ...paging, status: z.enum(['all', 'draft', 'received', 'cancelled']).default('all') })
  .strict();
export const movementQuery = z.object({ page: paging.page, pageSize: paging.pageSize }).strict();
