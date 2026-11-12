export type Role = 'admin' | 'reception' | 'veterinarian';
export interface DemoOverview {
  demo: true;
  businessName: string;
  today: string;
  totals: {
    clients: number;
    pets: number;
    products: number;
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
