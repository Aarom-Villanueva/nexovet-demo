import { z } from 'zod';
import { idSchema } from '../patients/validation.js';
import { daySchema, versionSchema } from '../agenda/validation.js';
const guid = idSchema.toLowerCase();
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Usa una hora entre 00:00 y 23:59');
const shape = {
  assignedTo: guid.nullable(),
  title: z.string().trim().min(3, 'Escribe al menos tres caracteres').max(150),
  description: z.string().trim().max(1000),
  date: daySchema,
  time: clock,
};
export const taskSchema = z.object({ ...shape, clientId: guid, petId: guid.nullable() }).strict();
export const taskEditSchema = z.object({ ...shape, version: versionSchema }).strict();
export const taskStateSchema = z
  .object({ version: versionSchema, status: z.enum(['completed', 'cancelled']) })
  .strict();
export const taskQuerySchema = z
  .object({
    q: z.string().trim().max(100).default(''),
    status: z.enum(['all', 'pending', 'completed', 'cancelled']).default('pending'),
    period: z.enum(['all', 'overdue', 'today', 'next7']).default('all'),
    assignee: z.union([z.enum(['all', 'mine', 'unassigned']), guid]).default('all'),
    clientId: guid.optional(),
    petId: guid.optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export const targetSchema = z
  .object({ q: z.string().trim().min(2).max(100), kind: z.enum(['client', 'pet']) })
  .strict();
export const contactSchema = z
  .object({
    requestId: guid,
    clientId: guid,
    taskId: guid.nullable(),
    taskVersion: versionSchema.nullable(),
    channel: z.enum(['phone', 'whatsapp', 'email', 'in_person']),
    outcome: z.enum([
      'contacted',
      'no_answer',
      'rescheduled',
      'declined',
      'wrong_contact',
      'other',
    ]),
    note: z.string().trim().max(2000),
    date: daySchema,
    time: clock,
    completeTask: z.boolean(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.taskId === null) !== (value.taskVersion === null))
      ctx.addIssue({
        code: 'custom',
        path: ['taskVersion'],
        message: 'El contacto vinculado requiere la versión del seguimiento',
      });
    if (
      value.completeTask &&
      (!value.taskId || !['contacted', 'rescheduled'].includes(value.outcome))
    )
      ctx.addIssue({
        code: 'custom',
        path: ['completeTask'],
        message:
          'Para completar el seguimiento, vincúlalo y registra un contacto realizado o una coordinación reprogramada',
      });
  });
export const contactQuerySchema = z
  .object({
    q: z.string().trim().max(100).default(''),
    clientId: guid.optional(),
    taskId: guid.optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(10),
  })
  .strict();
export const localInstant = (date: string, time: string) =>
  new Date(`${date}T${time}:00-05:00`).toISOString();
