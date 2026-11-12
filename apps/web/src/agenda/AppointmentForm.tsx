import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Search, PawPrint, Clock3 } from 'lucide-react';
import type {
  AppointmentRecord,
  AgendaOptions,
  AgendaPatient,
  SlotAvailability,
} from '@nexovet/shared';
import { Dialog, Field, ErrorNotice } from '../patients/Forms';
import { ApiError, useApi } from '../api';

function PatientPicker({
  selected,
  onSelect,
  error,
}: {
  selected: AgendaPatient | null;
  onSelect: (patient: AgendaPatient | null) => void;
  error?: string;
}) {
  const api = useApi();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<AgendaPatient[]>([]);
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
      void api<AgendaPatient[]>(`/api/agenda/patients?q=${encodeURIComponent(q.trim())}`, {
        signal: controller.signal,
      })
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
      controller.abort();
      clearTimeout(timer);
    };
  }, [api, q, selected, attempt]);
  return (
    <div className="field-wide">
      {selected ? (
        <div className="selected-owner">
          <PawPrint size={21} />
          <div>
            <strong>{selected.name}</strong>
            <small>{selected.ownerName}</small>
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
      ) : (
        <>
          <Field name="petId" label="Buscar paciente *" error={error}>
            {(props) => (
              <div className="search-input">
                <Search size={17} />
                <input
                  {...props}
                  value={q}
                  onChange={(event) => {
                    setQ(event.target.value);
                    setItems([]);
                  }}
                  maxLength={100}
                  autoComplete="off"
                  placeholder="Nombre, responsable o microchip"
                />
              </div>
            )}
          </Field>
          <p className="record-help">
            Escribe al menos dos caracteres y selecciona una mascota. El paciente y su responsable
            deben estar activos.
          </p>
          {loading ? (
            <p role="status" className="record-help">
              Buscando pacientes…
            </p>
          ) : failed ? (
            <p role="alert" className="auth-error">
              No pudimos buscar pacientes.{' '}
              <button type="button" className="text-link" onClick={() => setAttempt((x) => x + 1)}>
                Reintentar
              </button>
            </p>
          ) : q.trim().length >= 2 && !items.length ? (
            <p className="record-help">
              No encontramos pacientes activos. Prueba un nombre más preciso.
            </p>
          ) : (
            <ul className="owner-results">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-label={`Seleccionar paciente ${item.name}`}
                    onClick={() => onSelect(item)}
                  >
                    <strong>{item.name}</strong>
                    <small>{item.ownerName}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
export function AppointmentForm({
  record,
  options,
  day,
  onClose,
  onSaved,
  onReload,
}: {
  record?: AppointmentRecord;
  options: AgendaOptions;
  day: string;
  onClose: () => void;
  onSaved: (record: AppointmentRecord) => void;
  onReload: () => void;
}) {
  const api = useApi();
  const formRef = useRef<HTMLFormElement>(null);
  const slotRevision = useRef(0);
  const [selected, setSelected] = useState<AgendaPatient | null>(
    record
      ? {
          id: record.petId,
          name: record.petName,
          ownerName: record.ownerName,
          species: record.species,
        }
      : null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [slot, setSlot] = useState<SlotAvailability | null>(null);
  const [checking, setChecking] = useState(false);
  const [duration, setDuration] = useState(record?.durationMinutes ?? 30);
  function values() {
    const form = new FormData(formRef.current!);
    return {
      professionalId: String(form.get('professionalId')),
      serviceId: String(form.get('serviceId')),
      date: String(form.get('date')),
      startTime: String(form.get('startTime')),
      durationMinutes: Number(form.get('durationMinutes')),
      reason: String(form.get('reason') ?? '').trim() || null,
    };
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) {
      setError(
        new ApiError('Selecciona al paciente de la cita.', 400, {
          petId: 'Busca y selecciona una mascota activa',
        }),
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const input = values();
      const saved = await api<AppointmentRecord>(
        record ? `/api/appointments/${record.id}` : '/api/appointments',
        {
          method: record ? 'PUT' : 'POST',
          body: record ? { ...input, version: record.version } : { ...input, petId: selected.id },
        },
      );
      onSaved(saved);
    } catch (error) {
      setError(error instanceof ApiError ? error : new ApiError('No se pudo guardar la cita.', 0));
    } finally {
      setBusy(false);
    }
  }
  async function check() {
    if (!formRef.current!.reportValidity()) return;
    if (!selected) {
      setError(
        new ApiError('Selecciona al paciente antes de comprobar el horario.', 400, {
          petId: 'Selecciona una mascota',
        }),
      );
      return;
    }
    setChecking(true);
    setError(null);
    const revision = ++slotRevision.current;
    try {
      const { serviceId: _, reason: __, ...input } = values();
      const result = await api<SlotAvailability>(
        `/api/appointments/availability?${new URLSearchParams({ ...input, durationMinutes: String(input.durationMinutes), petId: selected.id, ...(record ? { excludeId: record.id } : {}) })}`,
      );
      if (revision === slotRevision.current) setSlot(result);
    } catch (error) {
      if (revision === slotRevision.current) setError(error as ApiError);
    } finally {
      setChecking(false);
    }
  }
  return (
    <Dialog title={record ? 'Reprogramar cita' : 'Programar cita'} onClose={onClose} busy={busy}>
      <form
        ref={formRef}
        onSubmit={(event) => void submit(event)}
        onChange={() => {
          slotRevision.current++;
          setSlot(null);
        }}
      >
        <div className="record-dialog-body">
          <p className="record-help">
            Horarios en Lima (UTC−5). Los campos con * son obligatorios. El horario se reserva al
            guardar.
          </p>
          <ErrorNotice error={error} onReload={onReload} />
          <fieldset className="record-grid" disabled={busy}>
            {record ? (
              <div className="selected-owner field-wide">
                <PawPrint size={22} />
                <div>
                  <strong>{record.petName}</strong>
                  <small>{record.ownerName} · El paciente de esta cita se conserva</small>
                </div>
              </div>
            ) : (
              <PatientPicker
                selected={selected}
                onSelect={(value) => {
                  slotRevision.current++;
                  setSelected(value);
                  setSlot(null);
                }}
                error={error?.fields.petId}
              />
            )}
            <Field
              name="professionalId"
              label="Veterinario *"
              error={error?.fields.professionalId}
              wide
            >
              {(props) => (
                <select
                  {...props}
                  name="professionalId"
                  defaultValue={record?.professionalId ?? ''}
                  required
                >
                  <option value="" disabled>
                    Selecciona al profesional
                  </option>
                  {record &&
                    !options.professionals.some((item) => item.id === record.professionalId) && (
                      <option value={record.professionalId} disabled>
                        {record.professionalName} · No disponible
                      </option>
                    )}
                  {options.professionals.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field name="serviceId" label="Servicio *" error={error?.fields.serviceId} wide>
              {(props) => (
                <select
                  {...props}
                  name="serviceId"
                  defaultValue={record?.serviceId ?? ''}
                  required
                  onChange={(event) => {
                    const service = options.services.find((item) => item.id === event.target.value);
                    if (service) setDuration(service.durationMinutes);
                  }}
                >
                  <option value="" disabled>
                    Selecciona un servicio
                  </option>
                  {record && !options.services.some((item) => item.id === record.serviceId) && (
                    <option value={record.serviceId} disabled>
                      {record.serviceName} · No disponible
                    </option>
                  )}
                  {options.services.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field name="date" label="Fecha *" error={error?.fields.date}>
              {(props) => (
                <input
                  {...props}
                  name="date"
                  type="date"
                  required
                  min={options.today}
                  defaultValue={record?.date ?? day}
                />
              )}
            </Field>
            <Field name="startTime" label="Hora de inicio *" error={error?.fields.startTime}>
              {(props) => (
                <input
                  {...props}
                  name="startTime"
                  type="time"
                  required
                  defaultValue={record?.startTime}
                />
              )}
            </Field>
            <Field
              name="durationMinutes"
              label="Duración en minutos *"
              error={error?.fields.durationMinutes}
              wide
            >
              {(props) => (
                <input
                  {...props}
                  name="durationMinutes"
                  type="number"
                  required
                  min={5}
                  max={480}
                  step={1}
                  value={duration}
                  onChange={(event) => setDuration(Number(event.target.value))}
                />
              )}
            </Field>
            <Field name="reason" label="Motivo de la visita" error={error?.fields.reason} wide>
              {(props) => (
                <textarea
                  {...props}
                  name="reason"
                  rows={2}
                  maxLength={1000}
                  defaultValue={record?.reason ?? ''}
                  placeholder="Información para preparar la visita"
                />
              )}
            </Field>
            <div className="field-wide slot-check">
              <button
                type="button"
                className="secondary-button"
                onClick={() => void check()}
                disabled={checking}
              >
                <Clock3 size={16} />
                {checking ? 'Comprobando…' : 'Comprobar horario'}
              </button>
              {slot && (
                <p className={slot.available ? 'slot-free' : 'field-error'} role="status">
                  {slot.available
                    ? 'Sin cruces en este horario. La reserva se confirma al guardar.'
                    : 'Hay otra cita del profesional o del paciente en ese horario. Elige otro.'}
                </p>
              )}
            </div>
          </fieldset>
        </div>
        <div className="record-dialog-actions">
          <button className="secondary-button" type="button" disabled={busy} onClick={onClose}>
            Cancelar
          </button>
          <button
            className="button"
            type="submit"
            disabled={busy || error?.code === 'VERSION_CONFLICT'}
          >
            {busy ? 'Guardando…' : record ? 'Guardar horario' : 'Guardar cita'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
