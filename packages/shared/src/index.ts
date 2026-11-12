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
