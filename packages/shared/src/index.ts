export type Role = 'admin' | 'reception' | 'veterinarian';
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}
export interface AuthSession {
  user: AuthUser;
  csrfToken: string;
}
export const roleLabels: Record<Role, string> = {
  admin: 'Administrador',
  reception: 'Recepción',
  veterinarian: 'Veterinario',
};
export const routeRoles: Record<string, readonly Role[]> = {
  '/': ['admin', 'reception', 'veterinarian'],
  '/agenda': ['admin', 'reception', 'veterinarian'],
  '/clientes': ['admin', 'reception', 'veterinarian'],
  '/seguimiento': ['admin', 'reception', 'veterinarian'],
  '/inventario': ['admin', 'reception'],
  '/compras': ['admin', 'reception'],
  '/ventas': ['admin', 'reception'],
  '/reportes': ['admin'],
  '/administracion': ['admin'],
};
export function canVisit(role: Role, path: string) {
  return routeRoles[path]?.includes(role) ?? false;
}
export const canManagePatients = (role: Role) => role === 'admin' || role === 'reception';
export const speciesLabels = {
  dog: 'Perro',
  cat: 'Gato',
  bird: 'Ave',
  rabbit: 'Conejo',
  other: 'Otra especie',
} as const;
export const sexLabels = { female: 'Hembra', male: 'Macho', unknown: 'Sin determinar' } as const;
export type Species = keyof typeof speciesLabels;
export type PetSex = keyof typeof sexLabels;
export type DocumentType = 'DNI' | 'CE' | 'RUC' | 'other';
export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
export interface ClientInput {
  name: string;
  email: string | null;
  phone: string | null;
  documentType: DocumentType | null;
  documentNumber: string | null;
  address: string | null;
  contactConsent: boolean;
  contactConsentNote: string | null;
  active: boolean;
}
export interface ClientRecord extends Omit<ClientInput, 'contactConsent'> {
  id: string;
  contactConsentAt: string | null;
  version: number;
  pets: number;
  createdAt: string;
  updatedAt: string;
}
export interface PetInput {
  name: string;
  species: Species;
  breed: string | null;
  sex: PetSex;
  birthDate: string | null;
  microchip: string | null;
  allergies: string | null;
  active: boolean;
}
export interface PetRecord extends PetInput {
  id: string;
  clientId: string;
  ownerName: string;
  ownerActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export const appointmentLabels = {
  scheduled: 'Programada',
  confirmed: 'Confirmada',
  arrived: 'En espera',
  in_progress: 'En consulta',
  completed: 'Atendida',
  cancelled: 'Cancelada',
  no_show: 'No asistió',
} as const;
export type AppointmentStatus = keyof typeof appointmentLabels;
export interface AgendaOptions {
  professionals: Array<{ id: string; name: string }>;
  services: Array<{ id: string; name: string; durationMinutes: number }>;
  today: string;
  timezone: 'America/Lima';
}
export interface AppointmentInput {
  petId: string;
  professionalId: string;
  serviceId: string;
  date: string;
  startTime: string;
  durationMinutes: number;
  reason: string | null;
}
export interface AppointmentRecord extends AppointmentInput {
  id: string;
  petName: string;
  species: Species;
  ownerName: string;
  professionalName: string;
  serviceName: string;
  startsAt: string;
  endsAt: string;
  endTime: string;
  status: AppointmentStatus;
  version: number;
  encounterId: string | null;
  encounterClosedAt: string | null;
}
export interface EncounterInput {
  weightKg: number | null;
  temperatureC: number | null;
  findings: string;
  diagnosis: string;
  treatment: string;
}
export interface EncounterRecord extends EncounterInput {
  id: string;
  appointmentId: string;
  petId: string;
  petName: string;
  ownerName: string;
  veterinarianId: string;
  veterinarianName: string;
  serviceName: string;
  startsAt: string;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}
export interface SlotAvailability {
  available: boolean;
  conflicts: Array<{ kind: 'professional' | 'pet'; startsAt: string; endsAt: string }>;
}
export interface AgendaPatient {
  id: string;
  name: string;
  ownerName: string;
  species: Species;
}
export const followupStatusLabels = {
  pending: 'Pendiente',
  completed: 'Completado',
  cancelled: 'Cancelado',
} as const;
export const contactChannelLabels = {
  phone: 'Llamada',
  whatsapp: 'WhatsApp',
  email: 'Correo',
  in_person: 'Presencial',
} as const;
export const contactOutcomeLabels = {
  contacted: 'Contacto realizado',
  no_answer: 'Sin respuesta',
  rescheduled: 'Coordinación reprogramada',
  declined: 'Cliente declinó',
  wrong_contact: 'Dato de contacto incorrecto',
  other: 'Otro resultado',
} as const;
export type FollowupStatus = keyof typeof followupStatusLabels;
export type ContactChannel = keyof typeof contactChannelLabels;
export type ContactOutcome = keyof typeof contactOutcomeLabels;
export interface FollowupTarget {
  clientId: string;
  clientName: string;
  petId: string | null;
  petName: string | null;
}
export interface FollowupInput {
  clientId: string;
  petId: string | null;
  assignedTo: string | null;
  title: string;
  description: string;
  date: string;
  time: string;
}
export interface FollowupRecord extends FollowupTarget {
  id: string;
  assignedTo: string | null;
  assigneeName: string | null;
  title: string;
  description: string;
  dueAt: string;
  date: string;
  time: string;
  status: FollowupStatus;
  completedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  createdByName: string | null;
  contactCount: number;
  overdue: boolean;
}
export interface FollowupOptions {
  team: Array<{ id: string; name: string; role: Role }>;
  today: string;
  time: string;
  canCoordinate: boolean;
}
export interface FollowupStats {
  pending: number;
  overdue: number;
  today: number;
  completed: number;
}
export interface ContactInput {
  requestId: string;
  clientId: string;
  taskId: string | null;
  taskVersion: number | null;
  channel: ContactChannel;
  outcome: ContactOutcome;
  note: string;
  date: string;
  time: string;
  completeTask: boolean;
}
export interface ContactRecord {
  id: string;
  clientId: string;
  clientName: string;
  taskId: string | null;
  taskTitle: string | null;
  recordedBy: string;
  recorderName: string;
  channel: ContactChannel;
  outcome: ContactOutcome;
  note: string;
  occurredAt: string;
  createdAt: string;
}
export interface DemoOverview {
  demo: boolean;
  businessName: string;
  today: string;
  totals: {
    clients: number;
    pets: number;
    products: number | null;
    appointmentsToday: number;
    pendingTasks: number;
  };
  appointments: Array<{
    id: string;
    pet: string;
    owner: string;
    service: string;
    professional: string;
    startsAt: string;
    status: string;
  }>;
  clients: Array<{ id: string; name: string; email: string | null; pets: number }>;
  pets: Array<{ id: string; name: string; species: string; owner: string }>;
  products: Array<{
    id: string;
    sku: string;
    name: string;
    price: string;
    stock: string;
    minimumStock: string;
  }>;
  tasks: Array<{ id: string; title: string; client: string; dueAt: string; status: string }>;
}

export interface ProductInput {
  sku: string;
  name: string;
  categoryId: string | null;
  salePrice: string;
  minimumStock: string;
  active: boolean;
}
export interface ProductRecord extends ProductInput {
  id: string;
  categoryName: string | null;
  stock: string;
  lowStock: boolean;
  version: number;
  updatedAt: string;
}
export interface SupplierInput {
  name: string;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  active: boolean;
}
export interface SupplierRecord extends SupplierInput {
  id: string;
  version: number;
  updatedAt: string;
}
export interface PurchaseLineInput {
  productId: string;
  quantity: string;
  unitCost: string;
}
export interface PurchaseInput {
  supplierId: string;
  note: string;
  lines: PurchaseLineInput[];
}
export const purchaseStatusLabels = {
  draft: 'Borrador',
  received: 'Recibida',
  cancelled: 'Cancelada',
} as const;
export interface PurchaseRecord {
  id: string;
  number: string;
  supplierId: string;
  supplierName: string;
  status: keyof typeof purchaseStatusLabels;
  note: string;
  version: number;
  orderedAt: string;
  updatedAt: string;
  receivedAt: string | null;
  createdByName: string;
  receivedByName: string | null;
  total: string;
  lineCount: number;
}
export interface PurchaseDetail extends PurchaseRecord {
  lines: Array<
    PurchaseLineInput & {
      id: string;
      sku: string;
      productName: string;
      productActive: boolean;
      lineTotal: string;
    }
  >;
}
export const stockKindLabels = {
  opening: 'Saldo inicial',
  purchase: 'Compra recibida',
  sale: 'Venta',
  adjustment: 'Ajuste',
} as const;
export interface StockMovement {
  id: string;
  productId: string;
  quantity: string;
  kind: keyof typeof stockKindLabels;
  reason: string;
  recordedByName: string;
  createdAt: string;
  purchaseId: string | null;
  purchaseNumber: string | null;
}
export interface StockAdjustmentInput {
  requestId: string;
  quantity: string;
  reason: string;
}
export interface InventoryStats {
  active: number;
  low: number;
  empty: number;
}
