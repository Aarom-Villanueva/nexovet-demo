import { z } from 'zod';
import { idSchema } from '../patients/validation.js';
export const versionSchema = z.number().int().positive().max(2147483646);
export const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Usa una fecha válida')
  .refine((value) => {
    const date = new Date(`${value}T12:00:00Z`);
    return (
      value >= '2000-01-01' &&
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  }, 'Usa una fecha real desde el año 2000');
const slotShape = {
  professionalId: idSchema,
  date: daySchema,
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Usa una hora entre 00:00 y 23:59'),
  durationMinutes: z.number().int().min(5).max(480),
};
const reason = z
  .string()
  .trim()
  .max(1000)
  .transform((value) => value || null)
  .nullable();
export const appointmentSchema = z
  .object({ ...slotShape, petId: idSchema, serviceId: idSchema, reason })
  .strict();
export const rescheduleSchema = z
  .object({ ...slotShape, serviceId: idSchema, reason, version: versionSchema })
  .strict();
export const stateSchema = z
  .object({
    version: versionSchema,
    status: z.enum(['confirmed', 'arrived', 'cancelled', 'no_show']),
  })
  .strict();
export const actionSchema = z.object({ version: versionSchema }).strict();
export const availabilitySchema = z
  .object({
    ...slotShape,
    durationMinutes: z.coerce.number().int().min(5).max(480),
    petId: idSchema,
    excludeId: idSchema.optional(),
  })
  .strict();
export const agendaQuerySchema = z
  .object({
    from: daySchema,
    to: daySchema,
    professionalId: idSchema.optional(),
    status: z
      .enum([
        'all',
        'scheduled',
        'confirmed',
        'arrived',
        'in_progress',
        'completed',
        'cancelled',
        'no_show',
      ])
      .default('all'),
    q: z.string().trim().max(100).default(''),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict()
  .refine(
    (value) =>
      value.to >= value.from &&
      (Date.parse(`${value.to}T12:00Z`) - Date.parse(`${value.from}T12:00Z`)) / 86400000 <= 30,
    { message: 'Consulta un rango de 1 a 31 días', path: ['to'] },
  );
const decimal = (places: number, min: number, max: number) =>
  z
    .number()
    .min(min)
    .max(max)
    .refine(
      (value) => Math.abs(value * 10 ** places - Math.round(value * 10 ** places)) < 1e-7,
      `Usa hasta ${places} decimales`,
    )
    .nullable();
export const encounterSchema = z
  .object({
    version: versionSchema,
    weightKg: decimal(3, 0.001, 9999.999),
    temperatureC: decimal(1, 10, 50),
    findings: z.string().trim().max(4000),
    diagnosis: z.string().trim().max(4000),
    treatment: z.string().trim().max(4000),
  })
  .strict();
export const historySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(20).default(5),
  })
  .strict();
export function slotTimes(input: { date: string; startTime: string; durationMinutes: number }) {
  const start = new Date(`${input.date}T${input.startTime}:00-05:00`);
  return {
    start: start.toISOString(),
    end: new Date(start.getTime() + input.durationMinutes * 60000).toISOString(),
  };
}
