import { useEffect, useState } from 'react';
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
import { canVisit, roleLabels, type DemoOverview, type AuthUser } from '@nexovet/shared';
import { AuthProvider, LoginPage, useAuth } from './auth';
import { useOverview } from './useOverview';
import { PatientDirectory } from './patients/Directory';
import { Agenda } from './agenda/Agenda';
import { SalesBoard } from './sales/Board';
import { InventoryBoard, PurchaseBoard } from './inventory/Boards';
import { FollowupBoard } from './follow-ups/Board';
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
      detail: 'En tu agenda de hoy',
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
function UserAccounts() {
  const auth = useAuth();
  const [users, setUsers] = useState<Array<
    AuthUser & { active: boolean; loginEnabled: boolean }
  > | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/users', {
      signal: controller.signal,
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then(async (response) => {
        if (response.status === 401) auth.expire();
        if (!response.ok) throw new Error('No disponible');
        const value = await response.json();
        if (!controller.signal.aborted) setUsers(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, []);
  return (
    <section className="panel">
      <SectionTitle
        title="Accesos del equipo"
        subtitle="Consulta los roles y accesos habilitados de tu equipo."
      />
      {error ? (
        <p role="alert">No se pudieron consultar los accesos. Recarga la página para reintentar.</p>
      ) : !users ? (
        <p role="status">Cargando accesos…</p>
      ) : (
        <Table headers={['Nombre', 'Correo', 'Rol', 'Acceso']}>
          {users.map((user) => (
            <tr key={user.id}>
              <td>{user.name}</td>
              <td>{user.email}</td>
              <td>{roleLabels[user.role]}</td>
              <td>{user.active && user.loginEnabled ? 'Habilitado' : 'Deshabilitado'}</td>
            </tr>
          ))}
        </Table>
      )}
    </section>
  );
}
function DataViews({ data }: { data: DemoOverview }) {
  const auth = useAuth();
  const role = auth.session!.user.role;
  const location = useLocation();
  if (
    navigation.some((item) => item.to === location.pathname) &&
    !canVisit(role, location.pathname)
  )
    return (
      <section className="panel empty" role="alert">
        <h1>Acceso restringido</h1>
        <p>Tu rol no tiene acceso a esta sección.</p>
        <Link className="button" to="/">
          Volver al resumen
        </Link>
      </section>
    );
  return (
    <Routes>
      <Route path="/" element={<Overview data={data} />} />
      <Route path="/agenda" element={<Agenda />} />
      <Route path="/clientes" element={<PatientDirectory />} />
      <Route path="/inventario" element={<InventoryBoard />} />
      <Route path="/compras" element={<PurchaseBoard />} />
      <Route path="/ventas" element={<SalesBoard />} />
      <Route path="/seguimiento" element={<FollowupBoard />} />
      <Route path="/administracion" element={<UserAccounts />} />
      {navigation
        .slice(7)
        .filter((item) => item.to !== '/administracion')
        .map((item) => (
          <Route key={item.to} path={item.to} element={<ComingSoon title={item.label} />} />
        ))}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
export function App() {
  return (
    <AuthProvider>
      <AuthGateway />
    </AuthProvider>
  );
}
function AuthGateway() {
  const auth = useAuth();
  const location = useLocation();
  if (auth.loading)
    return (
      <main className="auth-loading" role="status">
        <span className="loader" />
        <p>Preparando tu acceso…</p>
      </main>
    );
  if (auth.unavailable)
    return (
      <main className="auth-loading" role="alert">
        <h1>No pudimos conectar</h1>
        <p>Intenta nuevamente en unos momentos.</p>
        <button className="button" onClick={auth.reload}>
          Intentar nuevamente
        </button>
      </main>
    );
  if (location.pathname === '/restablecer' || location.pathname === '/recuperar')
    return <LoginPage key={location.pathname} />;
  if (!auth.session) return <LoginPage key={location.pathname} />;
  if (location.pathname === '/ingresar') return <Navigate to="/" replace />;
  return <Workspace key={auth.session.user.id} />;
}
function Workspace() {
  const auth = useAuth();
  const user = auth.session!.user;
  const [logoutError, setLogoutError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  async function logout() {
    setLoggingOut(true);
    setLogoutError('');
    try {
      await auth.logout();
    } catch (error) {
      setLogoutError((error as Error).message);
    } finally {
      setLoggingOut(false);
    }
  }
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
            <strong>{data?.businessName ?? 'Mi veterinaria'}</strong>
            <small>Una sede · Perú</small>
          </div>
        </div>
        <span className="nav-label">TU VETERINARIA</span>
        <nav>
          {navigation
            .filter((item) => canVisit(user.role, item.to))
            .map((item) => (
              <NavLink key={item.to} to={item.to} end onClick={() => setMenuOpen(false)}>
                <item.icon size={19} />
                <span>
                  {user.role === 'veterinarian' && item.to === '/clientes'
                    ? 'Mascotas'
                    : item.label}
                </span>
              </NavLink>
            ))}
        </nav>
        <div className="sidebar-footer">
          <span className="preview-dot" />
          <div>
            <strong>{user.name}</strong>
            <small>{roleLabels[user.role]}</small>
          </div>
        </div>
        <button className="logout-button" onClick={() => void logout()} disabled={loggingOut}>
          {loggingOut ? 'Cerrando…' : 'Cerrar sesión'}
        </button>
        {logoutError && (
          <p className="auth-error" role="alert">
            {logoutError}
          </p>
        )}
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
        {data?.demo && (
          <div className="preview-banner">
            <Activity size={15} />
            <span>Demostración con datos ficticios · Agenda, pacientes y atención por rol.</span>
          </div>
        )}
        <main id="main" tabIndex={-1}>
          {loading && !data ? (
            <div className="panel empty" role="status">
              <span className="loader" />
              <p>Cargando tu vista previa…</p>
            </div>
          ) : !data ? (
            <section className="panel empty" role="alert">
              <HeartPulse size={36} />
              <h1>No pudimos cargar la vista previa</h1>
              <p>Los datos no están disponibles en este momento. Puedes volver a intentarlo.</p>
              <button className="button" onClick={retry}>
                Intentar nuevamente
              </button>
            </section>
          ) : (
            <>
              {error && (
                <p className="auth-error" role="alert">
                  No pudimos actualizar el resumen.{' '}
                  <button className="text-link" onClick={retry}>
                    Reintentar
                  </button>
                </p>
              )}
              <DataViews data={data} />
            </>
          )}
          <footer className="page-footer">
            <span>NexoVet · Hecho para cuidar</span>
            <span>{data?.demo ? 'Demostración · ' : ''}PEN · Hora de Lima</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
