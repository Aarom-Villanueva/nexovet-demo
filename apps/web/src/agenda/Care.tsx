import { useEffect, useState, type FormEvent } from 'react';
import { HeartPulse, ClipboardCheck, ChevronLeft, ChevronRight } from 'lucide-react';
import type { EncounterRecord, EncounterInput, PageResult } from '@nexovet/shared';
import { Dialog, Field, ErrorNotice } from '../patients/Forms';
import { time } from '../components';
const date = (value: string) =>
  new Intl.DateTimeFormat('es-PE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'America/Lima',
  }).format(new Date(value));
import { useAuth } from '../auth';
import { ApiError, useApi } from '../api';
const values = (record: EncounterRecord): EncounterInput => ({
  weightKg: record.weightKg,
  temperatureC: record.temperatureC,
  findings: record.findings,
  diagnosis: record.diagnosis,
  treatment: record.treatment,
});
export function CareDialog({
  initial,
  onClose,
  onChanged,
}: {
  initial: EncounterRecord;
  onClose: () => void;
  onChanged: () => void;
}) {
  const api = useApi();
  const auth = useAuth();
  const [record, setRecord] = useState(initial);
  const [draft, setDraft] = useState(values(initial));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState('');
  const editable =
    auth.session!.user.role === 'veterinarian' &&
    auth.session!.user.id === record.veterinarianId &&
    !record.closedAt;
  function change<K extends keyof EncounterInput>(key: K, value: EncounterInput[K]) {
    setDraft({ ...draft, [key]: value });
    setDirty(true);
    setNotice('');
  }
  async function reload() {
    setBusy(true);
    try {
      const fresh = await api<EncounterRecord>(`/api/encounters/${record.id}`);
      setRecord(fresh);
      setDraft(values(fresh));
      setDirty(false);
      setError(null);
      setNotice('Versión actual cargada.');
    } catch (error) {
      setError(error as ApiError);
    } finally {
      setBusy(false);
    }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const saved = await api<EncounterRecord>(`/api/encounters/${record.id}`, {
        method: 'PUT',
        body: { ...draft, version: record.version },
      });
      setRecord(saved);
      setDraft(values(saved));
      setDirty(false);
      setNotice('Cambios de la atención guardados.');
      onChanged();
    } catch (error) {
      setError(error as ApiError);
    } finally {
      setBusy(false);
    }
  }
  async function close() {
    setBusy(true);
    setError(null);
    try {
      const saved = await api<EncounterRecord>(`/api/encounters/${record.id}/close`, {
        method: 'POST',
        body: { version: record.version },
      });
      setRecord(saved);
      setNotice('Atención cerrada. La cita figura como atendida.');
      onChanged();
    } catch (error) {
      setError(error as ApiError);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={`Atención de ${record.petName}`} onClose={onClose} busy={busy}>
      <form onSubmit={(event) => void save(event)}>
        <div className="record-dialog-body">
          <div className="care-summary">
            <HeartPulse size={28} />
            <div>
              <strong>{record.veterinarianName}</strong>
              <p>
                {date(record.startsAt)} · {time(record.startsAt)} · {record.serviceName}
              </p>
            </div>
            <span
              className={`status ${record.closedAt ? 'status-completed' : 'status-in_progress'}`}
            >
              {record.closedAt ? 'Atención cerrada' : 'En consulta'}
            </span>
          </div>
          <p className="record-help">Responsable: {record.ownerName}</p>
          {record.closedAt && (
            <p className="record-help">
              Cierre: {date(record.closedAt)} · {time(record.closedAt)}. Este registro conserva su
              contenido.
            </p>
          )}
          {notice && (
            <p className="auth-notice" role="status">
              {notice}
            </p>
          )}
          <ErrorNotice error={error} onReload={() => void reload()} />
          {editable ? (
            <>
              <p className="record-help care-help">
                Registra tu evaluación profesional. Puedes guardar un borrador; para cerrar,
                completa hallazgos, evaluación y plan.
              </p>
              <fieldset disabled={busy} className="record-grid">
                <Field name="weightKg" label="Peso (kg)" error={error?.fields.weightKg}>
                  {(props) => (
                    <input
                      {...props}
                      type="number"
                      min={0.001}
                      max={9999.999}
                      step={0.001}
                      value={draft.weightKg ?? ''}
                      onChange={(event) =>
                        change(
                          'weightKg',
                          event.target.value === '' ? null : Number(event.target.value),
                        )
                      }
                    />
                  )}
                </Field>
                <Field
                  name="temperatureC"
                  label="Temperatura (°C)"
                  error={error?.fields.temperatureC}
                >
                  {(props) => (
                    <input
                      {...props}
                      type="number"
                      min={10}
                      max={50}
                      step={0.1}
                      value={draft.temperatureC ?? ''}
                      onChange={(event) =>
                        change(
                          'temperatureC',
                          event.target.value === '' ? null : Number(event.target.value),
                        )
                      }
                    />
                  )}
                </Field>
                <Field
                  name="findings"
                  label="Hallazgos de la consulta"
                  error={error?.fields.findings}
                  wide
                >
                  {(props) => (
                    <textarea
                      {...props}
                      rows={4}
                      maxLength={4000}
                      value={draft.findings}
                      onChange={(event) => change('findings', event.target.value)}
                    />
                  )}
                </Field>
                <Field
                  name="diagnosis"
                  label="Evaluación / diagnóstico"
                  error={error?.fields.diagnosis}
                  wide
                >
                  {(props) => (
                    <textarea
                      {...props}
                      rows={4}
                      maxLength={4000}
                      value={draft.diagnosis}
                      onChange={(event) => change('diagnosis', event.target.value)}
                    />
                  )}
                </Field>
                <Field
                  name="treatment"
                  label="Plan e indicaciones"
                  error={error?.fields.treatment}
                  wide
                >
                  {(props) => (
                    <textarea
                      {...props}
                      rows={4}
                      maxLength={4000}
                      value={draft.treatment}
                      onChange={(event) => change('treatment', event.target.value)}
                    />
                  )}
                </Field>
              </fieldset>
              {dirty && (
                <p className="record-help care-help">
                  Hay cambios sin guardar. Guárdalos antes de cerrar la atención.
                </p>
              )}
            </>
          ) : (
            <>
              <dl className="record-facts care-help">
                <div>
                  <dt>Peso</dt>
                  <dd>{record.weightKg === null ? 'Sin registrar' : `${record.weightKg} kg`}</dd>
                </div>
                <div>
                  <dt>Temperatura</dt>
                  <dd>
                    {record.temperatureC === null ? 'Sin registrar' : `${record.temperatureC} °C`}
                  </dd>
                </div>
              </dl>
              {[
                ['Hallazgos', record.findings],
                ['Evaluación / diagnóstico', record.diagnosis],
                ['Plan e indicaciones', record.treatment],
              ].map(([label, value]) => (
                <section className="clinical-note care-note-block" key={label}>
                  <h3>{label}</h3>
                  <p>{value || 'Sin registrar.'}</p>
                </section>
              ))}
            </>
          )}
        </div>
        <div className="record-dialog-actions care-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>
            Volver
          </button>
          {editable && (
            <>
              <button
                className="secondary-button"
                type="button"
                disabled={busy || dirty || error?.code === 'VERSION_CONFLICT'}
                onClick={() => void close()}
              >
                <ClipboardCheck size={16} /> Cerrar atención
              </button>
              <button
                className="button"
                type="submit"
                disabled={busy || error?.code === 'VERSION_CONFLICT'}
              >
                {busy ? 'Guardando…' : 'Guardar atención'}
              </button>
            </>
          )}
        </div>
      </form>
    </Dialog>
  );
}
export function HistoryDialog({
  petId,
  petName,
  onClose,
}: {
  petId: string;
  petName: string;
  onClose: () => void;
}) {
  const api = useApi();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PageResult<EncounterRecord> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<EncounterRecord | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void api<PageResult<EncounterRecord>>(`/api/pets/${petId}/history?page=${page}`, {
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
  }, [api, petId, page, attempt]);
  async function open(id: string) {
    try {
      setSelected(await api<EncounterRecord>(`/api/encounters/${id}`));
    } catch (error) {
      setError((error as Error).message);
    }
  }
  if (selected)
    return (
      <CareDialog
        initial={selected}
        onClose={() => setSelected(null)}
        onChanged={() => setAttempt((x) => x + 1)}
      />
    );
  return (
    <Dialog title={`Historia de ${petName}`} onClose={onClose}>
      <div className="record-dialog-body">
        <p className="record-help">
          Atenciones de este paciente, de la más reciente a la más antigua. Los borradores se
          identifican como en consulta.
        </p>
        {loading ? (
          <p role="status" className="record-help care-help">
            Cargando historia…
          </p>
        ) : error ? (
          <div role="alert" className="auth-error">
            {error}{' '}
            <button className="text-link" onClick={() => setAttempt((x) => x + 1)}>
              Reintentar
            </button>
          </div>
        ) : !data?.total ? (
          <div className="directory-empty">
            <HeartPulse size={32} />
            <h3>Aún no hay atenciones</h3>
            <p>Las consultas registradas aparecerán aquí.</p>
          </div>
        ) : (
          <>
            <ul className="care-history">
              {data.items.map((item) => (
                <li key={item.id}>
                  <span className="record-avatar">
                    <HeartPulse size={22} />
                  </span>
                  <div>
                    <strong>
                      {date(item.startsAt)} · {time(item.startsAt)}
                    </strong>
                    <p>
                      {item.serviceName} · {item.veterinarianName}
                    </p>
                    <small>{item.closedAt ? 'Atención cerrada' : 'En consulta · Borrador'}</small>
                  </div>
                  <button className="text-link" onClick={() => void open(item.id)}>
                    Ver atención
                  </button>
                </li>
              ))}
            </ul>
            <div className="directory-pager">
              <span>{data.total} atenciones</span>
              <div>
                <button
                  className="secondary-button"
                  aria-label="Historia anterior"
                  disabled={page <= 1}
                  onClick={() => setPage((x) => x - 1)}
                >
                  <ChevronLeft size={16} />
                </button>
                <span>Página {page}</span>
                <button
                  className="secondary-button"
                  aria-label="Historia siguiente"
                  disabled={page * data.pageSize >= data.total}
                  onClick={() => setPage((x) => x + 1)}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
      <div className="record-dialog-actions">
        <button className="secondary-button" onClick={onClose}>
          Cerrar
        </button>
      </div>
    </Dialog>
  );
}
