import { z } from 'zod';
z.config(z.locales.es());

// Los UUID históricos de la semilla son md5::uuid; PostgreSQL no exige versión RFC.
export const idSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    'Identificador inválido',
  );
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null)
    .nullable();
const name = z
  .string()
  .trim()
  .min(2, 'Escribe al menos dos caracteres')
  .max(150, 'Máximo 150 caracteres');
const email = optionalText(254)
  .refine(
    (value) => value === null || z.email().safeParse(value).success,
    'Ingresa un correo válido',
  )
  .transform((value) => value?.toLowerCase() ?? null);
const phone = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s().-]/g, '') || null)
  .nullable()
  .refine(
    (value) => value === null || /^\+?[0-9]{7,15}$/.test(value),
    'Usa entre 7 y 15 dígitos; puedes incluir + al inicio',
  );
function clientRefinements(
  value: {
    documentType: string | null;
    documentNumber: string | null;
    contactConsent: boolean;
    contactConsentNote: string | null;
  },
  ctx: z.RefinementCtx,
) {
  if ((value.documentType === null) !== (value.documentNumber === null))
    ctx.addIssue({
      code: 'custom',
      path: ['documentNumber'],
      message: 'Completa el tipo y número de documento, o deja ambos vacíos',
    });
  if (value.documentType === 'DNI' && !/^\d{8}$/.test(value.documentNumber ?? ''))
    ctx.addIssue({
      code: 'custom',
      path: ['documentNumber'],
      message: 'El DNI debe tener 8 dígitos',
    });
  if (value.documentType === 'RUC' && !/^\d{11}$/.test(value.documentNumber ?? ''))
    ctx.addIssue({
      code: 'custom',
      path: ['documentNumber'],
      message: 'El RUC debe tener 11 dígitos',
    });
  if (value.documentType === 'CE' && !/^[A-Z0-9]{6,20}$/.test(value.documentNumber ?? ''))
    ctx.addIssue({
      code: 'custom',
      path: ['documentNumber'],
      message: 'El CE debe tener entre 6 y 20 letras o dígitos',
    });
  if (value.documentType === 'other' && (value.documentNumber?.length ?? 0) < 3)
    ctx.addIssue({
      code: 'custom',
      path: ['documentNumber'],
      message: 'El documento debe tener al menos 3 caracteres',
    });
  if (value.contactConsent && !value.contactConsentNote)
    ctx.addIssue({
      code: 'custom',
      path: ['contactConsentNote'],
      message: 'Indica cómo se obtuvo la autorización de contacto',
    });
  if (!value.contactConsent && value.contactConsentNote)
    ctx.addIssue({
      code: 'custom',
      path: ['contactConsentNote'],
      message: 'La nota requiere autorización de contacto',
    });
}
const clientShape = {
  name,
  email,
  phone,
  documentType: z.enum(['DNI', 'CE', 'RUC', 'other']).nullable(),
  documentNumber: optionalText(30).transform((value) => value?.toUpperCase() ?? null),
  address: optionalText(300),
  contactConsent: z.boolean(),
  contactConsentNote: optionalText(500),
  active: z.boolean(),
};
export const clientSchema = z.object(clientShape).strict().superRefine(clientRefinements);
export const clientEditSchema = z
  .object({ ...clientShape, version: z.number().int().positive().max(2147483646) })
  .strict()
  .superRefine(clientRefinements);
export const todayInLima = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const birthDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Usa una fecha válida')
  .refine((value) => {
    const date = new Date(`${value}T12:00:00Z`);
    return (
      value.slice(0, 4) !== '0000' &&
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value &&
      value <= todayInLima()
    );
  }, 'La fecha debe existir y no puede ser futura')
  .nullable();
const petShape = {
  name,
  species: z.enum(['dog', 'cat', 'bird', 'rabbit', 'other']),
  breed: optionalText(100),
  sex: z.enum(['female', 'male', 'unknown']),
  birthDate,
  microchip: optionalText(40).transform((value) => value?.toUpperCase() ?? null),
  allergies: optionalText(2000),
  active: z.boolean(),
};
export const petSchema = z.object({ ...petShape, clientId: idSchema }).strict();
export const petEditSchema = z
  .object({ ...petShape, version: z.number().int().positive().max(2147483646) })
  .strict();
export const listSchema = z
  .object({
    q: z.string().trim().max(100).default(''),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
    status: z.enum(['active', 'archived', 'all']).default('active'),
    clientId: idSchema.optional(),
  })
  .strict();
export const searchPattern = (value: string) =>
  `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
