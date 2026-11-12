import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Plus,
  Search,
  ClipboardList,
  Phone,
  Clock3,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  followupStatusLabels,
  contactChannelLabels,
  contactOutcomeLabels,
  type FollowupRecord,
  type FollowupStats,
  type FollowupOptions,
  type ContactRecord,
  type PageResult,
} from '@nexovet/shared';
import { useApi, ApiError } from '../api';
import { useAuth } from '../auth';
import { Table } from '../components';
import { Dialog, ErrorNotice } from '../patients/Forms';
import { FollowupForm, ContactForm } from './Forms';
const stamp = (value: string) =>
  new Intl.DateTimeFormat('es-PE', {
    timeZone: 'America/Lima',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
function useRead<T>(url: string, attempt = 0) {
  const api = useApi();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void api<T>(url, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [api, url, attempt]);
  return { data, error, loading };
}
function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  return (
    <div className="directory-pager">
      <span>
        {total
          ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} de ${total}`
          : '0 registros'}
      </span>
      <div>
        <button
          className="secondary-button"
          aria-label="Página anterior de seguimiento"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft size={16} />
        </button>
        <span>Página {page}</span>
        <button
          className="secondary-button"
          aria-label="Página siguiente de seguimiento"
          disabled={page * pageSize >= total}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
function TaskStatus({ record }: { record: FollowupRecord }) {
  return (
    <span className={`status ${record.overdue ? 'followup-overdue' : `status-${record.status}`}`}>
      {record.overdue ? 'Vencido' : followupStatusLabels[record.status]}
    </span>
  );
}
export function ContactList({
  clientId,
  taskId,
  q = '',
  attempt = 0,
}: {
  clientId?: string;
  taskId?: string;
  q?: string;
  attempt?: number;
}) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [q, clientId, taskId]);
  const query = new URLSearchParams({
    page: String(page),
    q,
    ...(clientId ? { clientId } : {}),
    ...(taskId ? { taskId } : {}),
  });
  const [retry, setRetry] = useState(0);
  const { data, error, loading } = useRead<PageResult<ContactRecord>>(
    `/api/contact-events?${query}`,
    attempt + retry,
  );
  if (loading)
    return (
      <p role="status" className="record-help followup-space">
        Cargando contactos…
      </p>
    );
  if (error)
    return (
      <div className="auth-error" role="alert">
        {error}{' '}
        <button className="text-link" onClick={() => setRetry((x) => x + 1)}>
          Reintentar contactos
        </button>
      </div>
    );
  if (!data?.total)
    return (
      <div className="directory-empty">
        <Phone size={28} />
        <h3>Sin contactos registrados</h3>
        <p>Las comunicaciones que registres aparecerán aquí.</p>
      </div>
    );
  return (
    <>
      <ul className="contact-timeline">
        {data.items.map((item) => (
          <li key={item.id}>
            <span className="contact-dot" />
            <div>
              <div className="contact-event-heading">
                <strong>{contactChannelLabels[item.channel]}</strong>
                <span>{contactOutcomeLabels[item.outcome]}</span>
              </div>
              <p>
                {item.clientName}
                {item.taskTitle ? ` · ${item.taskTitle}` : ''}
              </p>
              <small>
                {stamp(item.occurredAt)} · Registró {item.recorderName}
              </small>
              {item.note && <p className="contact-note">{item.note}</p>}
            </div>
          </li>
        ))}
      </ul>
      <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
    </>
  );
}
export function ContactHistoryDialog({
  clientId,
  clientName,
  onClose,
  onNew,
}: {
  clientId: string;
  clientName: string;
  onClose: () => void;
  onNew?: () => void;
}) {
  return (
    <Dialog title={`Contactos de ${clientName}`} onClose={onClose}>
      <div className="record-dialog-body">
        <p className="record-help">
          Registro manual de comunicaciones. Aquí no se envían llamadas ni mensajes.
        </p>
        <ContactList clientId={clientId} />
      </div>
      <div className="record-dialog-actions">
        {onNew && (
          <button className="button" onClick={onNew}>
            Registrar contacto
          </button>
        )}
        <button className="secondary-button" onClick={onClose}>
          Cerrar
        </button>
      </div>
    </Dialog>
  );
}
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children ?? 'Sin registrar'}</dd>
    </div>
  );
}
function TaskDetails({
  record,
  onClose,
  onEdit,
  onContact,
  onUpdated,
  onReload,
}: {
  record: FollowupRecord;
  onClose: () => void;
  onEdit: () => void;
  onContact: () => void;
  onUpdated: (record: FollowupRecord) => void;
  onReload: () => void;
}) {
  const coordinate = useAuth().session!.user.role !== 'veterinarian';
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  async function status(status: 'completed' | 'cancelled') {
    setBusy(true);
    setError(null);
    try {
      onUpdated(
        await api<FollowupRecord>(`/api/follow-ups/${record.id}/status`, {
          method: 'POST',
          body: { version: record.version, status },
        }),
      );
    } catch (error) {
      setError(error as ApiError);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={record.title} onClose={onClose} busy={busy}>
      <div className="record-dialog-body">
        <div className="care-summary">
          <ClipboardList size={27} />
          <div>
            <strong>{record.petName ?? record.clientName}</strong>
            <p>{record.petName ? record.clientName : 'Seguimiento del cliente'}</p>
          </div>
          <TaskStatus record={record} />
        </div>
        <dl className="record-facts">
          <Fact label="Fecha límite">{stamp(record.dueAt)}</Fact>
          <Fact label="Responsable del equipo">{record.assigneeName ?? 'Sin asignar'}</Fact>
          <Fact label="Creó">{record.createdByName ?? 'Registro inicial de demostración'}</Fact>
          <Fact label="Última actualización">{stamp(record.updatedAt)}</Fact>
          {record.completedAt && <Fact label="Se completó">{stamp(record.completedAt)}</Fact>}
        </dl>
        {record.description && (
          <section className="followup-description">
            <h3>Indicaciones para el equipo</h3>
            <p>{record.description}</p>
          </section>
        )}
        <ErrorNotice error={error} onReload={onReload} />
        <div className="appointment-actions followup-space">
          {record.status === 'pending' && (
            <>
              <button className="secondary-button" disabled={busy} onClick={onEdit}>
                Editar seguimiento
              </button>
              <button className="button" disabled={busy} onClick={() => void status('completed')}>
                Completar seguimiento
              </button>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => void status('cancelled')}
              >
                Cancelar seguimiento
              </button>
            </>
          )}
          {coordinate && (
            <button className="secondary-button" disabled={busy} onClick={onContact}>
              Registrar contacto
            </button>
          )}
        </div>
        {coordinate && (
          <section className="followup-space">
            <h3 className="followup-subtitle">Contactos vinculados</h3>
            <ContactList taskId={record.id} />
          </section>
        )}
      </div>
      <div className="record-dialog-actions">
        <button className="secondary-button" disabled={busy} onClick={onClose}>
          Cerrar
        </button>
      </div>
    </Dialog>
  );
}
type Modal =
  | { kind: 'create' }
  | { kind: 'edit' | 'details'; record: FollowupRecord }
  | { kind: 'contact'; record: FollowupRecord };
export function FollowupBoard() {
  const user = useAuth().session!.user,
    coordinate = user.role !== 'veterinarian',
    api = useApi();
  const [params, setParams] = useSearchParams();
  const tab = coordinate && params.get('tab') === 'contacts' ? 'contacts' : 'tasks';
  const q = params.get('q') ?? '',
    status = params.get('status') ?? 'pending',
    period = params.get('period') ?? 'all',
    assignee = params.get('assignee') ?? 'all';
  const raw = Number(params.get('page') ?? 1),
    page = Number.isInteger(raw) && raw >= 1 ? raw : 1;
  const [search, setSearch] = useState(q);
  useEffect(() => setSearch(q), [q]);
  const [attempt, setAttempt] = useState(0);
  const [modal, setModal] = useState<Modal | null>(null);
  const [notice, setNotice] = useState('');
  const [openError, setOpenError] = useState('');
  const options = useRead<FollowupOptions>('/api/follow-ups/options', attempt),
    stats = useRead<FollowupStats>('/api/follow-ups/stats', attempt);
  const query = new URLSearchParams({ q, status, period, assignee, page: String(page) });
  const list = useRead<PageResult<FollowupRecord>>(`/api/follow-ups?${query}`, attempt);
  function filter(values: Record<string, string>) {
    setParams(
      { tab, q, status, period, assignee, page: String(page), ...values },
      { replace: true },
    );
  }
  async function open(id: string, edit = false) {
    setOpenError('');
    try {
      const record = await api<FollowupRecord>(`/api/follow-ups/${id}`);
      setModal({ kind: edit ? 'edit' : 'details', record });
    } catch (error) {
      setOpenError((error as Error).message);
    }
  }
  function saved(record: FollowupRecord) {
    setNotice('Seguimiento guardado correctamente.');
    setModal({ kind: 'details', record });
    setAttempt((x) => x + 1);
    if (modal?.kind === 'create')
      filter({ q: record.title, status: 'pending', period: 'all', assignee: 'all', page: '1' });
  }
  return (
    <section className="patient-directory followup-page">
      <div className="directory-heading">
        <div>
          <span className="eyebrow">ACOMPAÑAR TAMBIÉN ES CUIDAR</span>
          <h1>{coordinate ? 'Seguimientos del equipo' : 'Mis seguimientos'}</h1>
          <p>
            {coordinate
              ? 'Organiza las próximas gestiones y conserva el resultado de cada contacto.'
              : 'Revisa y organiza los seguimientos asignados a tu cuenta.'}
          </p>
        </div>
        <button className="button" onClick={() => setModal({ kind: 'create' })}>
          <Plus size={16} /> Nuevo seguimiento
        </button>
      </div>
      {notice && (
        <p className="auth-notice" role="status">
          {notice}
        </p>
      )}
      {openError && (
        <p className="auth-error" role="alert">
          {openError}
        </p>
      )}
      {stats.error ? (
        <p className="auth-error" role="alert">
          No pudimos cargar los indicadores.{' '}
          <button className="text-link" onClick={() => setAttempt((x) => x + 1)}>
            Reintentar indicadores
          </button>
        </p>
      ) : (
        <div className="followup-metrics">
          {[
            {
              label: coordinate ? 'Pendientes del equipo' : 'Mis pendientes',
              value: stats.data?.pending,
              icon: ClipboardList,
            },
            { label: 'Vencidos', value: stats.data?.overdue, icon: Clock3 },
            { label: 'Pendientes para hoy', value: stats.data?.today, icon: Clock3 },
            { label: 'Completados', value: stats.data?.completed, icon: CheckCheck },
          ].map((card) => (
            <article key={card.label}>
              <span>
                <card.icon size={17} />
                {card.label}
              </span>
              <strong>{stats.loading ? '…' : (card.value ?? '—')}</strong>
            </article>
          ))}
        </div>
      )}
      {coordinate && options.error && (
        <p className="auth-error" role="alert">
          No pudimos cargar el equipo.{' '}
          <button className="text-link" onClick={() => setAttempt((x) => x + 1)}>
            Reintentar equipo
          </button>
        </p>
      )}
      <div className="panel directory-panel">
        <div className="directory-tabs">
          <button
            className={tab === 'tasks' ? 'selected' : ''}
            aria-pressed={tab === 'tasks'}
            onClick={() => filter({ tab: 'tasks', q: '', page: '1' })}
          >
            Seguimientos
          </button>
          {coordinate && (
            <button
              className={tab === 'contacts' ? 'selected' : ''}
              aria-pressed={tab === 'contacts'}
              onClick={() => filter({ tab: 'contacts', q: '', page: '1' })}
            >
              Contactos registrados
            </button>
          )}
        </div>
        <form
          className="directory-search"
          onSubmit={(event) => {
            event.preventDefault();
            filter({ q: search.trim(), page: '1' });
          }}
        >
          <label className="search-input">
            <Search size={17} />
            <input
              aria-label={tab === 'tasks' ? 'Buscar seguimientos' : 'Buscar contactos'}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              maxLength={100}
              placeholder={
                tab === 'tasks' ? 'Tarea, cliente o paciente' : 'Cliente o título del seguimiento'
              }
            />
          </label>
          {tab === 'tasks' && (
            <>
              <label className="directory-status">
                <span>Estado del seguimiento</span>
                <select
                  aria-label="Estado del seguimiento"
                  value={status}
                  onChange={(event) => filter({ status: event.target.value, page: '1' })}
                >
                  <option value="all">Todos</option>
                  {Object.entries(followupStatusLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="directory-status">
                <span>Vencimiento</span>
                <select
                  aria-label="Vencimiento"
                  value={period}
                  onChange={(event) => filter({ period: event.target.value, page: '1' })}
                >
                  <option value="all">Todos</option>
                  <option value="overdue">Vencidos</option>
                  <option value="today">Para hoy</option>
                  <option value="next7">Próximos 7 días</option>
                </select>
              </label>
              {coordinate && (
                <label className="directory-status">
                  <span>Asignado a</span>
                  <select
                    aria-label="Asignado a"
                    value={assignee}
                    onChange={(event) => filter({ assignee: event.target.value, page: '1' })}
                  >
                    <option value="all">Todo el equipo</option>
                    <option value="mine">Mis tareas</option>
                    <option value="unassigned">Sin asignar</option>
                    {options.data?.team.map((person) => (
                      <option value={person.id} key={person.id}>
                        {person.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}
          <button type="submit" className="secondary-button">
            Buscar
          </button>
        </form>
        {tab === 'contacts' ? (
          <ContactList q={q} attempt={attempt} />
        ) : list.loading ? (
          <div role="status" className="directory-empty">
            <span className="loader" />
            <p>Cargando seguimientos…</p>
          </div>
        ) : list.error ? (
          <div className="directory-empty" role="alert">
            <p>{list.error}</p>
            <button className="button" onClick={() => setAttempt((x) => x + 1)}>
              Intentar nuevamente
            </button>
          </div>
        ) : !list.data?.items.length ? (
          <div className="directory-empty">
            <ClipboardList size={30} />
            <h2>No hay seguimientos con estos filtros</h2>
            <p>Prueba otro estado o registra una nueva gestión.</p>
            {page > 1 && (
              <button className="text-link" onClick={() => filter({ page: '1' })}>
                Primera página
              </button>
            )}
          </div>
        ) : (
          <>
            <Table
              headers={[
                'Seguimiento',
                'Cliente / paciente',
                'Fecha límite',
                'Responsable',
                'Estado',
                'Ficha',
              ]}
            >
              {list.data.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.title}</strong>
                    <small className="table-secondary">
                      {coordinate
                        ? `${item.contactCount} contactos vinculados`
                        : 'Asignado a mi cuenta'}
                    </small>
                  </td>
                  <td>
                    {item.petName ?? item.clientName}
                    {item.petName && <small className="table-secondary">{item.clientName}</small>}
                  </td>
                  <td>{stamp(item.dueAt)}</td>
                  <td>{item.assigneeName ?? 'Sin asignar'}</td>
                  <td>
                    <TaskStatus record={item} />
                  </td>
                  <td>
                    <button
                      className="record-link"
                      aria-label={`Abrir seguimiento ${item.title}`}
                      onClick={() => void open(item.id)}
                    >
                      Abrir ficha
                    </button>
                  </td>
                </tr>
              ))}
            </Table>
            <Pager
              page={list.data.page}
              pageSize={list.data.pageSize}
              total={list.data.total}
              onPage={(page) => filter({ page: String(page) })}
            />
          </>
        )}
      </div>
      {(modal?.kind === 'create' || modal?.kind === 'edit') && (
        <FollowupForm
          key={modal.kind === 'edit' ? `${modal.record.id}-${modal.record.version}` : 'new'}
          record={modal.kind === 'edit' ? modal.record : undefined}
          onClose={() => setModal(null)}
          onSaved={saved}
        />
      )}
      {modal?.kind === 'details' && (
        <TaskDetails
          key={`${modal.record.id}-${modal.record.version}`}
          record={modal.record}
          onClose={() => setModal(null)}
          onEdit={() => setModal({ kind: 'edit', record: modal.record })}
          onContact={() => setModal({ kind: 'contact', record: modal.record })}
          onUpdated={(record) => {
            setModal({ kind: 'details', record });
            setAttempt((x) => x + 1);
            setNotice('Estado del seguimiento actualizado.');
          }}
          onReload={() => void open(modal.record.id)}
        />
      )}
      {modal?.kind === 'contact' && (
        <ContactForm
          task={modal.record}
          clientId={modal.record.clientId}
          onClose={() => void open(modal.record.id)}
          onSaved={(event) => {
            setAttempt((x) => x + 1);
            setNotice('Contacto registrado correctamente.');
            if (event.taskId) void open(event.taskId);
            else setModal(null);
          }}
        />
      )}
    </section>
  );
}
