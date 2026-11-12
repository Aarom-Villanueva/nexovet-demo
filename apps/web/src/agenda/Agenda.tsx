import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarDays, Plus, ChevronLeft, ChevronRight, Search, HeartPulse } from 'lucide-react';
import {
  appointmentLabels,
  canManagePatients,
  type AppointmentRecord,
  type AppointmentStatus,
  type AgendaOptions,
  type EncounterRecord,
  type PageResult,
} from '@nexovet/shared';
import { Dialog, ErrorNotice } from '../patients/Forms';
import { date, time, Table, Status } from '../components';
import { useAuth } from '../auth';
import { ApiError, useApi } from '../api';
import { AppointmentForm } from './AppointmentForm';
import { CareDialog, HistoryDialog } from './Care';
const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const shift = (day: string, days: number) =>
  new Date(Date.parse(`${day}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
function safeDay(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return today();
  const timestamp = Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
    ? value
    : today();
}
function AppointmentDetails({
  record,
  onClose,
  onEdit,
  onUpdated,
  onCare,
  onHistory,
  onReload,
}: {
  record: AppointmentRecord;
  onClose: () => void;
  onEdit: () => void;
  onUpdated: (record: AppointmentRecord) => void;
  onCare: (record: EncounterRecord) => void;
  onHistory: () => void;
  onReload: () => void;
}) {
  const auth = useAuth();
  const api = useApi();
  const user = auth.session!.user;
  const manage = canManagePatients(user.role);
  const clinical = user.role !== 'reception';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  async function status(status: AppointmentStatus) {
    setBusy(true);
    setError(null);
    try {
      onUpdated(
        await api<AppointmentRecord>(`/api/appointments/${record.id}/status`, {
          method: 'POST',
          body: { status, version: record.version },
        }),
      );
    } catch (error) {
      setError(error as ApiError);
    } finally {
      setBusy(false);
    }
  }
  async function start() {
    setBusy(true);
    setError(null);
    try {
      onCare(
        await api<EncounterRecord>(`/api/appointments/${record.id}/start`, {
          method: 'POST',
          body: { version: record.version },
        }),
      );
    } catch (error) {
      setError(error as ApiError);
    } finally {
      setBusy(false);
    }
  }
  async function care() {
    setBusy(true);
    setError(null);
    try {
      onCare(await api<EncounterRecord>(`/api/encounters/${record.encounterId}`));
    } catch (error) {
      setError(error as ApiError);
    } finally {
      setBusy(false);
    }
  }
  const waiting = record.status === 'scheduled' || record.status === 'confirmed';
  return (
    <Dialog title={`Cita de ${record.petName}`} onClose={onClose} busy={busy}>
      <div className="record-dialog-body">
        <div className="care-summary">
          <CalendarDays size={28} />
          <div>
            <strong>
              {date(record.startsAt)} · {time(record.startsAt)}–{time(record.endsAt)}
            </strong>
            <p>{record.durationMinutes} minutos · Hora de Lima</p>
          </div>
          <Status value={record.status} appointment />
        </div>
        <dl className="record-facts">
          <div>
            <dt>Responsable</dt>
            <dd>{record.ownerName}</dd>
          </div>
          <div>
            <dt>Veterinario</dt>
            <dd>{record.professionalName}</dd>
          </div>
          <div>
            <dt>Servicio</dt>
            <dd>{record.serviceName}</dd>
          </div>
          <div>
            <dt>Motivo de la visita</dt>
            <dd>{record.reason ?? 'Sin registrar'}</dd>
          </div>
        </dl>
        <ErrorNotice error={error} onReload={onReload} />
        <div className="appointment-actions">
          {manage && waiting && (
            <button className="secondary-button" disabled={busy} onClick={onEdit}>
              Reprogramar cita
            </button>
          )}
          {manage && record.status === 'scheduled' && (
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => void status('confirmed')}
            >
              Confirmar cita
            </button>
          )}
          {manage && waiting && (
            <button className="button" disabled={busy} onClick={() => void status('arrived')}>
              Registrar llegada
            </button>
          )}
          {manage && (waiting || record.status === 'arrived') && (
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => void status('cancelled')}
            >
              Cancelar cita
            </button>
          )}
          {manage && waiting && new Date(record.startsAt).getTime() <= Date.now() && (
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => void status('no_show')}
            >
              Marcar inasistencia
            </button>
          )}
          {user.role === 'veterinarian' &&
            user.id === record.professionalId &&
            record.status === 'arrived' && (
              <button className="button" disabled={busy} onClick={() => void start()}>
                <HeartPulse size={16} /> Iniciar atención
              </button>
            )}
          {clinical && record.encounterId && (
            <button className="button" disabled={busy} onClick={() => void care()}>
              {record.status === 'in_progress' && user.id === record.professionalId
                ? 'Continuar atención'
                : 'Ver atención'}
            </button>
          )}
          {clinical && (
            <button className="secondary-button" disabled={busy} onClick={onHistory}>
              Historia clínica
            </button>
          )}
        </div>
        {record.status === 'arrived' && user.id === record.professionalId && (
          <p className="record-help care-help">
            Puedes iniciar la atención desde 30 minutos antes del horario reservado.
          </p>
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
  | { kind: 'details' | 'edit'; record: AppointmentRecord }
  | { kind: 'care'; record: EncounterRecord }
  | { kind: 'history'; petId: string; petName: string };
export function Agenda() {
  const api = useApi();
  const auth = useAuth();
  const user = auth.session!.user;
  const manage = canManagePatients(user.role);
  const [params, setParams] = useSearchParams();
  const day = safeDay(params.get('date'));
  const week = params.get('view') === 'week';
  const weekday = new Date(`${day}T12:00Z`).getUTCDay();
  const from = week ? shift(day, -((weekday + 6) % 7)) : day;
  const to = week ? shift(from, 6) : day;
  const professionalId = params.get('professionalId') ?? '';
  const status = params.get('status') ?? 'all';
  const q = params.get('q') ?? '';
  const raw = Number(params.get('page') ?? 1);
  const page = Number.isInteger(raw) && raw >= 1 ? raw : 1;
  const [options, setOptions] = useState<AgendaOptions | null>(null);
  const [optionsError, setOptionsError] = useState('');
  const [data, setData] = useState<PageResult<AppointmentRecord> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [modal, setModal] = useState<Modal | null>(null);
  const [search, setSearch] = useState(q);
  const [notice, setNotice] = useState('');
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState('');
  useEffect(() => setSearch(q), [q]);
  useEffect(() => {
    const controller = new AbortController();
    setOptionsError('');
    void api<AgendaOptions>('/api/agenda/options', { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setOptions(value);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setOptionsError(error.message);
      });
    return () => controller.abort();
  }, [api, attempt]);
  const query = new URLSearchParams({
    from,
    to,
    status,
    q,
    page: String(page),
    ...(professionalId ? { professionalId } : {}),
  }).toString();
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void api<PageResult<AppointmentRecord>>(`/api/appointments?${query}`, {
      signal: controller.signal,
    })
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
  }, [api, query, attempt]);
  function filter(change: Record<string, string>) {
    setParams(
      {
        date: day,
        view: week ? 'week' : 'day',
        status,
        q,
        professionalId,
        page: String(page),
        ...change,
      },
      { replace: true },
    );
  }
  async function open(id: string, edit = false) {
    setOpening(true);
    setOpenError('');
    try {
      const record = await api<AppointmentRecord>(`/api/appointments/${id}`);
      setModal({ kind: edit ? 'edit' : 'details', record });
    } catch (error) {
      setOpenError((error as Error).message);
    } finally {
      setOpening(false);
    }
  }
  function saved(record: AppointmentRecord) {
    setModal({ kind: 'details', record });
    setNotice('Cita guardada correctamente.');
    setAttempt((x) => x + 1);
    filter({ date: record.date, page: '1', status: 'all', q: '', professionalId: '' });
  }
  const canCreate = !!options?.professionals.length && !!options.services.length;
  return (
    <section className="patient-directory agenda-page">
      <div className="directory-heading">
        <div>
          <span className="eyebrow">TIEMPO PARA CUIDAR</span>
          <h1>
            {week
              ? 'Agenda de la semana'
              : day === (options?.today ?? today())
                ? 'Agenda de hoy'
                : 'Agenda del día'}
          </h1>
          <p>Organiza las visitas y acompaña cada consulta, de principio a fin.</p>
        </div>
        {manage && (
          <button
            className="button"
            disabled={!canCreate}
            onClick={() => setModal({ kind: 'create' })}
          >
            <Plus size={17} /> Nueva cita
          </button>
        )}
      </div>
      {notice && (
        <p className="auth-notice" role="status">
          {notice}
        </p>
      )}
      {openError && (
        <p role="alert" className="auth-error">
          {openError}
        </p>
      )}
      {opening && (
        <p role="status" className="record-help">
          Abriendo cita…
        </p>
      )}
      {optionsError && (
        <p role="alert" className="auth-error">
          {optionsError}{' '}
          <button className="text-link" onClick={() => setAttempt((x) => x + 1)}>
            Reintentar
          </button>
        </p>
      )}
      {manage && options && !canCreate && (
        <p className="auth-notice">
          Se necesita al menos un veterinario habilitado y un servicio activo para programar citas.
        </p>
      )}
      <div className="panel directory-panel">
        <div className="agenda-toolbar">
          <div className="agenda-date-controls">
            <button
              className="secondary-button"
              aria-label="Periodo anterior"
              onClick={() => filter({ date: shift(day, week ? -7 : -1), page: '1' })}
            >
              <ChevronLeft size={17} />
            </button>
            <label>
              <span>Fecha de agenda</span>
              <input
                type="date"
                value={day}
                onChange={(event) => {
                  if (event.target.value) filter({ date: event.target.value, page: '1' });
                }}
              />
            </label>
            <button
              className="secondary-button"
              aria-label="Periodo siguiente"
              onClick={() => filter({ date: shift(day, week ? 7 : 1), page: '1' })}
            >
              <ChevronRight size={17} />
            </button>
            <button
              className="secondary-button"
              onClick={() => filter({ date: options?.today ?? today(), page: '1' })}
            >
              Hoy
            </button>
          </div>
          <div className="agenda-view">
            <button
              aria-pressed={!week}
              className={!week ? 'selected' : ''}
              onClick={() => filter({ view: 'day', page: '1' })}
            >
              Día
            </button>
            <button
              aria-pressed={week}
              className={week ? 'selected' : ''}
              onClick={() => filter({ view: 'week', page: '1' })}
            >
              Semana
            </button>
          </div>
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
              type="search"
              aria-label="Buscar en agenda"
              placeholder="Paciente o responsable"
              value={search}
              maxLength={100}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label className="directory-status">
            <span>Veterinario de agenda</span>
            <select
              value={professionalId}
              onChange={(event) => filter({ professionalId: event.target.value, page: '1' })}
            >
              <option value="">Todos</option>
              {options?.professionals.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="directory-status">
            <span>Estado de cita</span>
            <select
              value={status}
              onChange={(event) => filter({ status: event.target.value, page: '1' })}
            >
              <option value="all">Todos</option>
              {Object.entries(appointmentLabels).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button className="secondary-button" type="submit">
            Buscar
          </button>
        </form>
        <div className="directory-list-heading">
          <h2>
            {week
              ? `${date(`${from}T12:00-05:00`)} – ${date(`${to}T12:00-05:00`)}`
              : 'Visitas programadas'}
          </h2>
          <span>{loading ? 'Consultando…' : `${data?.total ?? 0} citas · Hora de Lima`}</span>
        </div>
        {loading ? (
          <div role="status" className="directory-empty">
            <span className="loader" />
            <p>Cargando agenda…</p>
          </div>
        ) : error ? (
          <div role="alert" className="directory-empty">
            <p>{error}</p>
            <button className="button" onClick={() => setAttempt((x) => x + 1)}>
              Intentar nuevamente
            </button>
          </div>
        ) : !data?.items.length ? (
          <div className="directory-empty">
            <CalendarDays size={34} />
            <h3>No hay citas con estos filtros</h3>
            <p>Puedes cambiar de fecha o revisar otro profesional.</p>
            {page > 1 && (
              <button className="text-link" onClick={() => filter({ page: '1' })}>
                Primera página
              </button>
            )}
          </div>
        ) : (
          <>
            <Table
              headers={['Fecha / hora', 'Paciente', 'Servicio', 'Veterinario', 'Estado', 'Ficha']}
            >
              {data.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>
                      {time(item.startsAt)}–{time(item.endsAt)}
                    </strong>
                    <small className="table-secondary">{date(item.startsAt)}</small>
                  </td>
                  <td>
                    <strong>{item.petName}</strong>
                    <small className="table-secondary">{item.ownerName}</small>
                  </td>
                  <td>{item.serviceName}</td>
                  <td>{item.professionalName}</td>
                  <td>
                    <Status value={item.status} appointment />
                  </td>
                  <td>
                    <button
                      className="record-link"
                      onClick={() => void open(item.id)}
                      aria-label={`Abrir cita de ${item.petName}`}
                    >
                      Abrir cita
                    </button>
                  </td>
                </tr>
              ))}
            </Table>
            <div className="directory-pager">
              <span>
                {(data.page - 1) * data.pageSize + 1}–
                {Math.min(data.page * data.pageSize, data.total)} de {data.total}
              </span>
              <div>
                <button
                  className="secondary-button"
                  aria-label="Página anterior de agenda"
                  disabled={page <= 1}
                  onClick={() => filter({ page: String(page - 1) })}
                >
                  <ChevronLeft size={16} />
                </button>
                <span>Página {page}</span>
                <button
                  className="secondary-button"
                  aria-label="Página siguiente de agenda"
                  disabled={page * data.pageSize >= data.total}
                  onClick={() => filter({ page: String(page + 1) })}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
      {(modal?.kind === 'create' || modal?.kind === 'edit') && options && (
        <AppointmentForm
          key={modal.kind === 'edit' ? `${modal.record.id}-${modal.record.version}` : 'new'}
          record={modal.kind === 'edit' ? modal.record : undefined}
          options={options}
          day={day}
          onClose={() => setModal(null)}
          onSaved={saved}
          onReload={() => {
            if (modal.kind === 'edit') void open(modal.record.id, true);
          }}
        />
      )}
      {modal?.kind === 'details' && (
        <AppointmentDetails
          key={`${modal.record.id}-${modal.record.version}`}
          record={modal.record}
          onClose={() => setModal(null)}
          onEdit={() => setModal({ kind: 'edit', record: modal.record })}
          onUpdated={(record) => {
            setModal({ kind: 'details', record });
            setAttempt((x) => x + 1);
            setNotice('Estado de la cita actualizado.');
          }}
          onCare={(record) => {
            setModal({ kind: 'care', record });
            setAttempt((x) => x + 1);
          }}
          onHistory={() =>
            setModal({ kind: 'history', petId: modal.record.petId, petName: modal.record.petName })
          }
          onReload={() => void open(modal.record.id)}
        />
      )}
      {modal?.kind === 'care' && (
        <CareDialog
          initial={modal.record}
          onClose={() => setModal(null)}
          onChanged={() => setAttempt((x) => x + 1)}
        />
      )}
      {modal?.kind === 'history' && (
        <HistoryDialog petId={modal.petId} petName={modal.petName} onClose={() => setModal(null)} />
      )}
    </section>
  );
}
