import { useEffect, useState, type FormEvent } from 'react';
import { ClipboardList, Search, UserRound } from 'lucide-react';
import {
  contactChannelLabels,
  contactOutcomeLabels,
  type FollowupOptions,
  type FollowupTarget,
  type FollowupRecord,
  type ContactInput,
  type ContactRecord,
  type ClientRecord,
} from '@nexovet/shared';
import { useAuth } from '../auth';
import { useApi, ApiError } from '../api';
import { Dialog, Field, ErrorNotice } from '../patients/Forms';

export function TargetPicker({
  selected,
  onSelect,
  canCoordinate,
  error,
}: {
  selected: FollowupTarget | null;
  onSelect: (value: FollowupTarget | null) => void;
  canCoordinate: boolean;
  error?: string;
}) {
  const api = useApi();
  const [kind, setKind] = useState<'pet' | 'client'>('pet');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<FollowupTarget[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (selected || q.trim().length < 2) {
      setItems([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    const timer = window.setTimeout(() => {
      void api<FollowupTarget[]>(
        `/api/follow-ups/targets?kind=${kind}&q=${encodeURIComponent(q.trim())}`,
        { signal: controller.signal },
      )
        .then((value) => {
          if (!controller.signal.aborted) setItems(value);
        })
        .catch(() => {
          if (!controller.signal.aborted) setFailed(true);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [api, kind, q, selected, attempt]);
  if (selected)
    return (
      <div className="selected-owner field-wide">
        <ClipboardList size={21} />
        <div>
          <strong>{selected.petName ?? selected.clientName}</strong>
          <small>{selected.petName ? selected.clientName : 'Seguimiento del cliente'}</small>
        </div>
        <button
          type="button"
          className="text-link"
          onClick={() => {
            onSelect(null);
            setQ('');
          }}
        >
          Cambiar
        </button>
      </div>
    );
  return (
    <div className="field-wide">
      {canCoordinate && (
        <Field name="targetKind" label="Seguimiento para">
          {(props) => (
            <select
              {...props}
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as 'pet' | 'client');
                setItems([]);
                setQ('');
              }}
            >
              <option value="pet">Una mascota</option>
              <option value="client">Un cliente</option>
            </select>
          )}
        </Field>
      )}
      <Field
        name="target"
        label={kind === 'pet' ? 'Buscar mascota *' : 'Buscar cliente *'}
        error={error}
      >
        {(props) => (
          <div className="search-input">
            <Search size={17} />
            <input
              {...props}
              value={q}
              maxLength={100}
              onChange={(event) => {
                setQ(event.target.value);
                setItems([]);
              }}
              placeholder={
                kind === 'pet'
                  ? 'Paciente, responsable o microchip'
                  : 'Nombre, documento, teléfono o correo'
              }
              autoComplete="off"
            />
          </div>
        )}
      </Field>
      <p className="record-help">Escribe al menos dos caracteres y selecciona una ficha activa.</p>
      {loading ? (
        <p role="status" className="record-help">
          Buscando fichas…
        </p>
      ) : failed ? (
        <p className="auth-error" role="alert">
          No pudimos buscar las fichas.{' '}
          <button type="button" className="text-link" onClick={() => setAttempt((x) => x + 1)}>
            Reintentar
          </button>
        </p>
      ) : q.trim().length >= 2 && !items.length ? (
        <p className="record-help">No hay coincidencias activas. Prueba otro nombre.</p>
      ) : (
        <ul className="owner-results">
          {items.map((item) => (
            <li key={item.petId ?? item.clientId}>
              <button
                type="button"
                aria-label={`Seleccionar seguimiento de ${item.petName ?? item.clientName}`}
                onClick={() => onSelect(item)}
              >
                <strong>{item.petName ?? item.clientName}</strong>
                <small>{item.petName ? item.clientName : 'Ficha del cliente'}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
export function FollowupForm({
  record,
  target,
  onClose,
  onSaved,
}: {
  record?: FollowupRecord;
  target?: FollowupTarget;
  onClose: () => void;
  onSaved: (record: FollowupRecord) => void;
}) {
  const api = useApi();
  const user = useAuth().session!.user;
  const [options, setOptions] = useState<FollowupOptions | null>(null);
  const [optionError, setOptionError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<FollowupTarget | null>(record ?? target ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [current, setCurrent] = useState(record);
  const [formKey, setFormKey] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setOptionError('');
    void api<FollowupOptions>('/api/follow-ups/options', { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setOptions(value);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setOptionError(error.message);
      });
    return () => controller.abort();
  }, [api, attempt]);
  async function reload() {
    if (!current) return;
    setBusy(true);
    try {
      const fresh = await api<FollowupRecord>(`/api/follow-ups/${current.id}`);
      setCurrent(fresh);
      setSelected(fresh);
      setFormKey((x) => x + 1);
      setError(null);
    } catch (error) {
      setError(error as ApiError);
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) {
      setError(
        new ApiError('Selecciona una ficha para el seguimiento.', 400, {
          target: 'Selecciona una mascota o cliente activo',
        }),
      );
      return;
    }
    const form = new FormData(event.currentTarget);
    const input = {
      assignedTo: String(form.get('assignedTo') ?? '') || null,
      title: String(form.get('title')),
      description: String(form.get('description') ?? ''),
      date: String(form.get('date')),
      time: String(form.get('time')),
    };
    setBusy(true);
    setError(null);
    try {
      const saved = await api<FollowupRecord>(
        current ? `/api/follow-ups/${current.id}` : '/api/follow-ups',
        {
          method: current ? 'PUT' : 'POST',
          body: current
            ? { ...input, version: current.version }
            : { ...input, clientId: selected.clientId, petId: selected.petId },
        },
      );
      onSaved(saved);
    } catch (error) {
      setError(error as ApiError);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={current ? 'Editar seguimiento' : 'Programar seguimiento'}
      onClose={onClose}
      busy={busy}
    >
      <form key={formKey} onSubmit={(event) => void submit(event)}>
        <div className="record-dialog-body">
          <p className="record-help">
            Organiza una gestión del equipo. Los campos con * son obligatorios. Horas de Lima.
          </p>
          {optionError && (
            <p className="auth-error" role="alert">
              {optionError}{' '}
              <button type="button" className="text-link" onClick={() => setAttempt((x) => x + 1)}>
                Reintentar
              </button>
            </p>
          )}
          <ErrorNotice error={error} onReload={() => void reload()} />
          <fieldset
            key={options ? 'ready' : 'loading'}
            className="record-grid"
            disabled={busy || !options}
          >
            {current ? (
              <div className="selected-owner field-wide">
                <ClipboardList size={21} />
                <div>
                  <strong>{current.petName ?? current.clientName}</strong>
                  <small>
                    {current.petName ? current.clientName : 'Ficha del cliente'} · El vínculo se
                    conserva
                  </small>
                </div>
              </div>
            ) : (
              <TargetPicker
                selected={selected}
                onSelect={setSelected}
                canCoordinate={user.role !== 'veterinarian'}
                error={error?.fields.target}
              />
            )}
            <Field name="title" label="Qué hay que hacer *" error={error?.fields.title} wide>
              {(props) => (
                <input
                  {...props}
                  name="title"
                  required
                  minLength={3}
                  maxLength={150}
                  defaultValue={current?.title}
                  placeholder="Ej.: coordinar control del paciente"
                />
              )}
            </Field>
            <Field
              name="description"
              label="Indicaciones para el equipo"
              error={error?.fields.description}
              wide
            >
              {(props) => (
                <textarea
                  {...props}
                  name="description"
                  rows={3}
                  maxLength={1000}
                  defaultValue={current?.description ?? ''}
                  placeholder="Detalle operativo para realizar el seguimiento"
                />
              )}
            </Field>
            <Field
              name="assignedTo"
              label="Responsable del equipo"
              error={error?.fields.assignedTo}
              wide
            >
              {(props) => (
                <select
                  {...props}
                  name="assignedTo"
                  defaultValue={
                    current?.assignedTo ?? (user.role === 'veterinarian' ? user.id : '')
                  }
                  required={user.role === 'veterinarian'}
                >
                  {user.role !== 'veterinarian' && <option value="">Sin asignar</option>}
                  {current?.assignedTo &&
                    options &&
                    !options.team.some((person) => person.id === current.assignedTo) && (
                      <option value={current.assignedTo}>
                        {current.assigneeName} · No disponible
                      </option>
                    )}
                  {options?.team.map((person) => (
                    <option value={person.id} key={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field name="date" label="Fecha límite *" error={error?.fields.date}>
              {(props) => (
                <input
                  {...props}
                  name="date"
                  type="date"
                  required
                  defaultValue={current?.date ?? options?.today}
                />
              )}
            </Field>
            <Field name="time" label="Hora límite *" error={error?.fields.time}>
              {(props) => (
                <input
                  {...props}
                  name="time"
                  type="time"
                  required
                  defaultValue={current?.time ?? '09:00'}
                />
              )}
            </Field>
          </fieldset>
          {current && current.status !== 'pending' && (
            <p className="auth-notice">
              Este seguimiento ya terminó. Puedes consultar sus datos y crear otro para una nueva
              gestión.
            </p>
          )}
        </div>
        <div className="record-dialog-actions">
          <button className="secondary-button" type="button" disabled={busy} onClick={onClose}>
            Cancelar
          </button>
          <button
            className="button"
            type="submit"
            disabled={
              busy ||
              !options ||
              error?.code === 'VERSION_CONFLICT' ||
              (!!current && current.status !== 'pending')
            }
          >
            {busy ? 'Guardando…' : current ? 'Guardar seguimiento' : 'Crear seguimiento'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
export function ContactForm({
  task,
  clientId,
  onClose,
  onSaved,
}: {
  task?: FollowupRecord;
  clientId: string;
  onClose: () => void;
  onSaved: (record: ContactRecord) => void;
}) {
  const api = useApi();
  const [client, setClient] = useState<ClientRecord | null>(null);
  const [options, setOptions] = useState<FollowupOptions | null>(null);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [current, setCurrent] = useState(task);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [outcome, setOutcome] = useState('');
  const [complete, setComplete] = useState(false);
  const [locked, setLocked] = useState(false);
  const [pending, setPending] = useState<ContactInput | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoadError('');
    void Promise.all([
      api<ClientRecord>(`/api/clients/${clientId}`, { signal: controller.signal }),
      api<FollowupOptions>('/api/follow-ups/options', { signal: controller.signal }),
    ])
      .then(([client, options]) => {
        if (!controller.signal.aborted) {
          setClient(client);
          setOptions(options);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setLoadError(error.message);
      });
    return () => controller.abort();
  }, [api, clientId, attempt]);
  async function reloadTask() {
    if (!current) return;
    setBusy(true);
    try {
      setCurrent(await api<FollowupRecord>(`/api/follow-ups/${current.id}`));
      setRequestId(crypto.randomUUID());
      setError(null);
      setLocked(false);
      setPending(null);
    } catch (error) {
      setError(error as ApiError);
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = pending ?? {
      requestId,
      clientId,
      taskId: current?.id ?? null,
      taskVersion: current?.version ?? null,
      channel: form.get('channel') as ContactInput['channel'],
      outcome: outcome as ContactInput['outcome'],
      note: String(form.get('note') ?? ''),
      date: String(form.get('date')),
      time: String(form.get('time')),
      completeTask: complete && current?.status === 'pending',
    };
    setPending(payload);
    setBusy(true);
    setError(null);
    setLocked(true);
    try {
      const record = await api<ContactRecord>('/api/contact-events', {
        method: 'POST',
        body: payload,
      });
      onSaved(record);
    } catch (error) {
      const issue = error as ApiError;
      setError(issue);
      if (issue.status >= 400 && issue.status < 500) {
        setLocked(false);
        setPending(null);
        setRequestId(crypto.randomUUID());
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Registrar contacto realizado" onClose={onClose} busy={busy}>
      <form onSubmit={(event) => void submit(event)}>
        <div className="record-dialog-body">
          <p className="record-help">
            Deja constancia de una comunicación ya realizada. Este formulario no llama ni envía
            mensajes.
          </p>
          {loadError && (
            <p className="auth-error" role="alert">
              {loadError}{' '}
              <button className="text-link" type="button" onClick={() => setAttempt((x) => x + 1)}>
                Reintentar
              </button>
            </p>
          )}
          <ErrorNotice error={error} onReload={current ? () => void reloadTask() : undefined} />
          {client && (
            <div className="contact-client">
              <UserRound size={22} />
              <div>
                <strong>{client.name}</strong>
                <p>
                  {client.phone ?? 'Sin teléfono'} · {client.email ?? 'Sin correo'}
                </p>
                <small>
                  {client.contactConsentAt
                    ? 'Autorización de contacto registrada'
                    : 'Sin autorización de contacto registrada'}
                </small>
              </div>
            </div>
          )}
          {current && <p className="auth-notice">Seguimiento: {current.title}</p>}
          {locked && !busy && (
            <p className="auth-notice" role="status">
              El resultado del guardado no pudo confirmarse. Reintenta con los mismos datos para
              evitar duplicados.
            </p>
          )}
          <fieldset
            key={options ? 'ready' : 'loading'}
            className="record-grid"
            disabled={busy || locked || !options}
          >
            <Field name="channel" label="Canal utilizado *" error={error?.fields.channel}>
              {(props) => (
                <select {...props} name="channel" required defaultValue="">
                  <option value="" disabled>
                    Seleccionar canal
                  </option>
                  {Object.entries(contactChannelLabels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field name="outcome" label="Resultado *" error={error?.fields.outcome}>
              {(props) => (
                <select
                  {...props}
                  name="outcome"
                  required
                  value={outcome}
                  onChange={(event) => {
                    setOutcome(event.target.value);
                    setComplete(false);
                  }}
                >
                  <option value="" disabled>
                    Seleccionar resultado
                  </option>
                  {Object.entries(contactOutcomeLabels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field name="date" label="Fecha del contacto *" error={error?.fields.date}>
              {(props) => (
                <input
                  {...props}
                  type="date"
                  name="date"
                  required
                  max={options?.today}
                  defaultValue={options?.today}
                />
              )}
            </Field>
            <Field name="time" label="Hora del contacto *" error={error?.fields.time}>
              {(props) => (
                <input {...props} type="time" name="time" required defaultValue={options?.time} />
              )}
            </Field>
            <Field name="note" label="Nota del contacto" error={error?.fields.note} wide>
              {(props) => (
                <textarea
                  {...props}
                  name="note"
                  maxLength={2000}
                  rows={3}
                  placeholder="Qué se conversó y cuál es el siguiente paso"
                />
              )}
            </Field>
            {current?.status === 'pending' && ['contacted', 'rescheduled'].includes(outcome) && (
              <label className="record-check field-wide">
                <input
                  type="checkbox"
                  checked={complete}
                  onChange={(event) => setComplete(event.target.checked)}
                />
                <span>Marcar también el seguimiento como completado</span>
              </label>
            )}
          </fieldset>
        </div>
        <div className="record-dialog-actions">
          <button className="secondary-button" type="button" disabled={busy} onClick={onClose}>
            Cancelar
          </button>
          <button
            className="button"
            type="submit"
            disabled={busy || !client || !options || error?.code === 'VERSION_CONFLICT'}
          >
            {busy ? 'Guardando…' : locked ? 'Reintentar registro' : 'Guardar contacto'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
