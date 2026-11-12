import { useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, Link } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  CalendarDays,
  ChartNoAxesCombined,
  CheckCheck,
  ChevronRight,
  ClipboardList,
  HeartPulse,
  LayoutDashboard,
  Menu,
  Package,
  PawPrint,
  Settings,
  ShoppingBag,
  ShoppingCart,
  UsersRound,
  X,
} from 'lucide-react';
import type { DemoOverview } from '@nexovet/shared';
import { useOverview } from './useOverview';
import { Appointments, date, labels, money, SectionTitle, Status, Table } from './components';

const navigation = [
  { to: '/', label: 'Resumen', icon: LayoutDashboard },
  { to: '/agenda', label: 'Agenda', icon: CalendarDays },
  { to: '/clientes', label: 'Clientes y mascotas', icon: UsersRound },
  { to: '/seguimiento', label: 'Seguimiento', icon: ClipboardList },
  { to: '/inventario', label: 'Inventario', icon: Package },
  { to: '/compras', label: 'Compras', icon: ShoppingBag },
  { to: '/ventas', label: 'Ventas', icon: ShoppingCart },
  { to: '/reportes', label: 'Reportes', icon: ChartNoAxesCombined },
  { to: '/administracion', label: 'Administración', icon: Settings },
];

function Overview({ data }: { data: DemoOverview }) {
  const cards = [
    {
      label: 'Citas de hoy',
      value: data.totals.appointmentsToday,
      detail: 'En la agenda de demostración',
      icon: CalendarDays,
      color: 'teal',
    },
    {
      label: 'Clientes registrados',
      value: data.totals.clients,
      detail: 'Familias que forman parte de NexoVet',
      icon: UsersRound,
      color: 'blue',
    },
    {
      label: 'Mascotas registradas',
      value: data.totals.pets,
      detail: 'Cada paciente, una historia',
      icon: PawPrint,
      color: 'peach',
    },
    {
      label: 'Seguimientos pendientes',
      value: data.totals.pendingTasks,
      detail: 'Para acompañar su bienestar',
      icon: CheckCheck,
      color: 'purple',
    },
  ];
  return (
    <>
      <section className="welcome">
        <div>
          <span className="eyebrow">UN NUEVO DÍA PARA CUIDAR</span>
          <h1>
            Todo listo para recibirlos<span>.</span>
          </h1>
          <p>
            Tu agenda, tus pacientes y los pequeños detalles
            <br className="desktop-break" /> que hacen grande el cuidado de cada mascota.
          </p>
          <Link className="button" to="/agenda">
            Revisar agenda <ArrowRight size={17} />
          </Link>
        </div>
        <div className="welcome-art" aria-hidden="true">
          <HeartPulse className="heart" />
          <PawPrint className="big-paw" />
          <span className="art-tag">
            <span /> El cuidado empieza aquí
          </span>
        </div>
      </section>
      <section className="metrics" aria-label="Resumen de actividad">
        {cards.map((card) => (
          <article className="metric" key={card.label}>
            <div className="metric-top">
              <span>{card.label}</span>
              <span className={`metric-icon ${card.color}`}>
                <card.icon size={19} />
              </span>
            </div>
            <strong>{card.value.toLocaleString('es-PE')}</strong>
            <small>{card.detail}</small>
          </article>
        ))}
      </section>
      <section className="panel">
        <SectionTitle
          title="La agenda de hoy"
          subtitle="Un vistazo a los pacientes que nos visitan."
          href="/agenda"
        />
        <Appointments items={data.appointments} />
      </section>
      <div className="bottom-grid">
        <section className="panel compact">
          <SectionTitle
            title="Acompañar también es cuidar"
            subtitle="Los próximos seguimientos de tus pacientes."
          />
          {data.tasks
            .filter((task) => task.status === 'pending')
            .slice(0, 3)
            .map((task) => (
              <div className="task-row" key={task.id}>
                <span className="task-dot" />
                <div>
                  <strong>{task.title}</strong>
                  <small>{task.client}</small>
                </div>
                <span>{date(task.dueAt)}</span>
              </div>
            ))}
        </section>
        <section className="care-note">
          <span className="metric-icon teal">
            <HeartPulse size={22} />
          </span>
          <h2>
            Más tiempo para
            <br />
            lo que importa.
          </h2>
          <p>Una experiencia pensada para las personas que cuidan de quienes más queremos.</p>
          <Link className="text-link" to="/clientes">
            Conocer a los pacientes <ChevronRight size={16} />
          </Link>
        </section>
      </div>
    </>
  );
}
function ComingSoon({ title }: { title: string }) {
  return (
    <section className="panel empty">
      <HeartPulse size={36} />
      <h2>{title}, en preparación</h2>
      <p>
        Esta sección todavía no está disponible. Puedes recorrer los datos de ejemplo desde el
        resumen.
      </p>
      <Link className="button" to="/">
        Volver al resumen <ArrowRight size={16} />
      </Link>
    </section>
  );
}
function DataViews({ data }: { data: DemoOverview }) {
  return (
    <Routes>
      <Route path="/" element={<Overview data={data} />} />
      <Route
        path="/agenda"
        element={
          <section className="panel">
            <SectionTitle
              title="Agenda de hoy"
              subtitle="Vista previa de las citas registradas. La edición estará disponible más adelante."
            />
            <Appointments items={data.appointments} />
          </section>
        }
      />
      <Route
        path="/clientes"
        element={
          <>
            <section className="panel">
              <SectionTitle
                title="Clientes"
                subtitle="Muestra de clientes ficticios. Vista de consulta, sin edición."
              />
              <Table headers={['Nombre', 'Correo de ejemplo', 'Mascotas']}>
                {data.clients.map((client) => (
                  <tr key={client.id}>
                    <td>
                      <strong>{client.name}</strong>
                    </td>
                    <td>{client.email ?? 'Sin correo'}</td>
                    <td>{client.pets}</td>
                  </tr>
                ))}
              </Table>
            </section>
            <section className="panel">
              <SectionTitle
                title="Mascotas"
                subtitle="Una muestra de los pacientes de demostración."
              />
              <Table headers={['Paciente', 'Especie', 'Responsable']}>
                {data.pets.map((pet) => (
                  <tr key={pet.id}>
                    <td>
                      <strong>{pet.name}</strong>
                    </td>
                    <td>{labels[pet.species] ?? pet.species}</td>
                    <td>{pet.owner}</td>
                  </tr>
                ))}
              </Table>
            </section>
          </>
        }
      />
      <Route
        path="/inventario"
        element={
          <section className="panel">
            <SectionTitle
              title="Inventario"
              subtitle="Productos ficticios. Existencias calculadas a partir de sus movimientos."
            />
            <Table headers={['Código', 'Producto', 'Precio', 'Disponible', 'Estado']}>
              {data.products.map((product) => (
                <tr key={product.id}>
                  <td className="code">{product.sku}</td>
                  <td>
                    <strong>{product.name}</strong>
                  </td>
                  <td>{money(product.price)}</td>
                  <td>{Number(product.stock)}</td>
                  <td>
                    <span
                      className={`status ${Number(product.stock) < Number(product.minimumStock) ? 'status-pending' : 'status-confirmed'}`}
                    >
                      {Number(product.stock) < Number(product.minimumStock)
                        ? 'Stock bajo'
                        : 'Disponible'}
                    </span>
                  </td>
                </tr>
              ))}
            </Table>
          </section>
        }
      />
      <Route
        path="/seguimiento"
        element={
          <section className="panel">
            <SectionTitle
              title="Seguimiento"
              subtitle="Tareas de ejemplo. El registro de contactos estará disponible más adelante."
            />
            <Table headers={['Tarea', 'Cliente', 'Fecha', 'Estado']}>
              {data.tasks.map((task) => (
                <tr key={task.id}>
                  <td>
                    <strong>{task.title}</strong>
                  </td>
                  <td>{task.client}</td>
                  <td>{date(task.dueAt)}</td>
                  <td>
                    <Status value={task.status} />
                  </td>
                </tr>
              ))}
            </Table>
          </section>
        }
      />
      {navigation.slice(5).map((item) => (
        <Route key={item.to} path={item.to} element={<ComingSoon title={item.label} />} />
      ))}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
export function App() {
  const { data, error, loading, retry } = useOverview();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const title = navigation.find((item) => item.to === location.pathname)?.label ?? 'Resumen';
  const today = data
    ? new Intl.DateTimeFormat('es-PE', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        timeZone: 'America/Lima',
      }).format(new Date(`${data.today}T12:00:00-05:00`))
    : 'NexoVet';
  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Ir al contenido
      </a>
      {menuOpen && (
        <button
          className="menu-scrim"
          aria-label="Cerrar menú"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`} aria-label="Navegación principal">
        <Link to="/" className="brand" onClick={() => setMenuOpen(false)}>
          <span className="brand-icon">
            <PawPrint size={25} />
          </span>
          <span>
            Nexo<span className="brand-light">Vet</span>
            <small>CUIDAMOS CONTIGO</small>
          </span>
        </Link>
        <div className="clinic">
          <span className="clinic-icon">
            <HeartPulse size={19} />
          </span>
          <div>
            <strong>Veterinaria NexoVet</strong>
            <small>Una sede · Lima, Perú</small>
          </div>
        </div>
        <span className="nav-label">TU VETERINARIA</span>
        <nav>
          {navigation.map((item) => (
            <NavLink key={item.to} to={item.to} end onClick={() => setMenuOpen(false)}>
              <item.icon size={19} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="preview-dot" />
          <div>
            <strong>Vista previa</strong>
            <small>Solo datos ficticios</small>
          </div>
          <PawPrint size={21} />
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(!menuOpen)}
            >
              {menuOpen ? <X /> : <Menu />}
            </button>
            <span>Mi veterinaria</span>
            <ChevronRight size={14} />
            <strong>{title}</strong>
          </div>
          <span className="today">
            <CalendarDays size={16} />
            {today}
          </span>
        </header>
        <div className="preview-banner">
          <Activity size={15} />
          <span>
            Vista previa con datos ficticios · Solo consulta, sin acceso de usuarios reales.
          </span>
        </div>
        <main id="main" tabIndex={-1}>
          {loading ? (
            <div className="panel empty" role="status">
              <span className="loader" />
              <p>Cargando tu vista previa…</p>
            </div>
          ) : error || !data ? (
            <section className="panel empty" role="alert">
              <HeartPulse size={36} />
              <h1>No pudimos cargar la vista previa</h1>
              <p>Los datos no están disponibles en este momento. Puedes volver a intentarlo.</p>
              <button className="button" onClick={retry}>
                Intentar nuevamente
              </button>
            </section>
          ) : (
            <DataViews data={data} />
          )}
          <footer className="page-footer">
            <span>NexoVet · Hecho para cuidar</span>
            <span>Vista previa · PEN · Hora de Lima</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
