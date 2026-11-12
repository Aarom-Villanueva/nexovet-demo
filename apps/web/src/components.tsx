import type { ReactNode } from 'react';
import { ArrowUpRight, CalendarDays, PawPrint } from 'lucide-react';
import { Link } from 'react-router-dom';
import { appointmentLabels, type DemoOverview } from '@nexovet/shared';

export const labels: Record<string, string> = {
  ...appointmentLabels,
  completed: 'Completada',
  pending: 'Pendiente',
  dog: 'Perro',
  cat: 'Gato',
  bird: 'Ave',
  rabbit: 'Conejo',
  other: 'Otro',
};
export const date = (value: string) =>
  new Intl.DateTimeFormat('es-PE', {
    day: '2-digit',
    month: 'short',
    timeZone: 'America/Lima',
  }).format(new Date(value));
export const time = (value: string) =>
  new Intl.DateTimeFormat('es-PE', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Lima',
  }).format(new Date(value));
export const money = (value: string) =>
  new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(Number(value));

export function Status({ value, appointment = false }: { value: string; appointment?: boolean }) {
  const label = appointment
    ? appointmentLabels[value as keyof typeof appointmentLabels]
    : labels[value];
  return <span className={`status status-${value}`}>{label ?? value}</span>;
}
export function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header} scope="col">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
export function Appointments({ items }: { items: DemoOverview['appointments'] }) {
  if (!items.length)
    return (
      <div className="empty">
        <CalendarDays />
        <h3>La agenda de hoy está libre</h3>
        <p>No hay citas registradas para esta fecha en la vista previa.</p>
      </div>
    );
  return (
    <Table headers={['Hora', 'Paciente', 'Servicio', 'Profesional', 'Estado']}>
      {items.map((item) => (
        <tr key={item.id}>
          <td className="hour">{time(item.startsAt)}</td>
          <td>
            <div className="patient">
              <span className="pet-icon">
                <PawPrint size={17} />
              </span>
              <span>
                <strong>{item.pet}</strong>
                <small>{item.owner}</small>
              </span>
            </div>
          </td>
          <td>{item.service}</td>
          <td>{item.professional}</td>
          <td>
            <Status value={item.status} appointment />
          </td>
        </tr>
      ))}
    </Table>
  );
}
export function SectionTitle({
  title,
  subtitle,
  href,
}: {
  title: string;
  subtitle: string;
  href?: string;
}) {
  return (
    <div className="section-title">
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {href && (
        <Link className="text-link" to={href}>
          Ver agenda <ArrowUpRight size={16} />
        </Link>
      )}
    </div>
  );
}
