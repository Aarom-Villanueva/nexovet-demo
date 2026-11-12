import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { X, Search, UserRound, PawPrint } from 'lucide-react';
import {
  speciesLabels,
  sexLabels,
  type ClientInput,
  type ClientRecord,
  type PetInput,
  type PetRecord,
  type PageResult,
} from '@nexovet/shared';
import { ApiError, useApi } from '../api';

export function Dialog({
  title,
  children,
  onClose,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="record-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="record-dialog-head">
        <div>
          <span className="eyebrow">NEXOVET · FICHAS</span>
          <h2 id={titleId}>{title}</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Cerrar ficha"
          disabled={busy}
          onClick={onClose}
        >
          <X size={21} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
interface FieldProps {
  label: string;
  name: string;
  error?: string;
  children: (props: {
    id: string;
    'aria-invalid': boolean;
    'aria-describedby'?: string;
  }) => ReactNode;
  wide?: boolean;
}
function Field({ label, name, error, children, wide }: FieldProps) {
  const id = useId();
  return (
    <div className={`record-field ${wide ? 'field-wide' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children({
        id,
        'aria-invalid': !!error,
        'aria-describedby': error ? `${id}-error` : undefined,
      })}
      {error && (
        <small className="field-error" id={`${id}-error`}>
          {error}
        </small>
      )}
    </div>
  );
}
function ErrorNotice({ error, onReload }: { error: ApiError | null; onReload?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) ref.current?.focus();
  }, [error]);
  return error ? (
    <div className="auth-error form-error" role="alert" tabIndex={-1} ref={ref}>
      <p>{error.message}</p>
      {error.code === 'VERSION_CONFLICT' && onReload && (
        <button type="button" className="text-link" onClick={onReload}>
          Recargar ficha actual
        </button>
      )}
    </div>
  ) : null;
}
const nullable = (value: FormDataEntryValue | null) => String(value ?? '').trim() || null;
const toError = (error: unknown) =>
  error instanceof ApiError ? error : new ApiError('No se pudo guardar. Intenta nuevamente.', 0);
interface ClientFormProps {
  client?: ClientRecord;
  onClose: () => void;
  onSaved: (client: ClientRecord) => void;
  onReload: () => void;
}
export function ClientForm({ client, onClose, onSaved, onReload }: ClientFormProps) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [consent, setConsent] = useState(!!client?.contactConsentAt);
  const [documentType, setDocumentType] = useState(client?.documentType ?? '');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input: ClientInput = {
      name: String(form.get('name')),
      email: nullable(form.get('email')),
      phone: nullable(form.get('phone')),
      documentType: (form.get('documentType') || null) as ClientInput['documentType'],
      documentNumber: nullable(form.get('documentNumber')),
      address: nullable(form.get('address')),
      contactConsent: consent,
      contactConsentNote: consent ? nullable(form.get('contactConsentNote')) : null,
      active: form.get('active') !== 'false',
    };
    setBusy(true);
    setError(null);
    try {
      const value = await api<ClientRecord>(client ? `/api/clients/${client.id}` : '/api/clients', {
        method: client ? 'PUT' : 'POST',
        body: client ? { ...input, version: client.version } : input,
      });
      onSaved(value);
    } catch (error) {
      setError(toError(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={client ? 'Editar cliente' : 'Registrar cliente'} onClose={onClose} busy={busy}>
      <form onSubmit={(event) => void submit(event)}>
        <div className="record-dialog-body">
          <p className="record-help">
            El nombre es obligatorio. Los datos de contacto y documento son opcionales.
          </p>
          <ErrorNotice error={error} onReload={onReload} />
          <fieldset disabled={busy} className="record-grid">
            <Field label="Nombre completo *" name="name" error={error?.fields.name} wide>
              {(props) => (
                <input
                  {...props}
                  name="name"
                  defaultValue={client?.name}
                  required
                  minLength={2}
                  maxLength={150}
                  autoComplete="name"
                  autoFocus
                />
              )}
            </Field>
            <Field label="Teléfono" name="phone" error={error?.fields.phone}>
              {(props) => (
                <input
                  {...props}
                  name="phone"
                  type="tel"
                  defaultValue={client?.phone ?? ''}
                  maxLength={40}
                  placeholder="Ej.: +51 900 000 000"
                  autoComplete="tel"
                />
              )}
            </Field>
            <Field label="Correo electrónico" name="email" error={error?.fields.email}>
              {(props) => (
                <input
                  {...props}
                  name="email"
                  type="email"
                  defaultValue={client?.email ?? ''}
                  maxLength={254}
                  autoComplete="email"
                />
              )}
            </Field>
            <Field label="Tipo de documento" name="documentType" error={error?.fields.documentType}>
              {(props) => (
                <select
                  {...props}
                  name="documentType"
                  value={documentType}
                  onChange={(event) => setDocumentType(event.target.value)}
                >
                  <option value="">Sin documento</option>
                  <option value="DNI">DNI</option>
                  <option value="CE">Carné de extranjería</option>
                  <option value="RUC">RUC</option>
                  <option value="other">Otro documento</option>
                </select>
              )}
            </Field>
            <Field
              label="Número de documento"
              name="documentNumber"
              error={error?.fields.documentNumber}
            >
              {(props) => (
                <input
                  {...props}
                  name="documentNumber"
                  defaultValue={client?.documentNumber ?? ''}
                  maxLength={30}
                  required={!!documentType}
                  autoComplete="off"
                />
              )}
            </Field>
            <Field label="Dirección" name="address" error={error?.fields.address} wide>
              {(props) => (
                <input
                  {...props}
                  name="address"
                  defaultValue={client?.address ?? ''}
                  maxLength={300}
                  autoComplete="street-address"
                />
              )}
            </Field>
            <div className="field-wide consent-box">
              <label className="record-check">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                <span>Autoriza contacto para seguimientos y recordatorios</span>
              </label>
              <p>Marca esta opción únicamente si obtuviste autorización del responsable.</p>
            </div>
            {consent && (
              <Field
                label="Cómo se obtuvo la autorización *"
                name="contactConsentNote"
                error={error?.fields.contactConsentNote}
                wide
              >
                {(props) => (
                  <input
                    {...props}
                    name="contactConsentNote"
                    defaultValue={client?.contactConsentNote ?? ''}
                    required
                    maxLength={500}
                    placeholder="Ej.: autorización verbal durante la recepción"
                  />
                )}
              </Field>
            )}
            {client && (
              <Field label="Estado del cliente" name="active" error={error?.fields.active} wide>
                {(props) => (
                  <select {...props} name="active" defaultValue={String(client.active)}>
                    <option value="true">Activo</option>
                    <option value="false">Archivado</option>
                  </select>
                )}
              </Field>
            )}
            {client && (
              <p className="record-help field-wide">
                Archivar conserva sus mascotas e historial. Para registrar otra mascota, el
                responsable debe estar activo.
              </p>
            )}
          </fieldset>
        </div>
        <div className="record-dialog-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>
            Cancelar
          </button>
          <button
            type="submit"
            className="button"
            disabled={busy || error?.code === 'VERSION_CONFLICT'}
          >
            {busy ? 'Guardando…' : client ? 'Guardar cambios' : 'Registrar cliente'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
function OwnerPicker({
  selected,
  onSelect,
  error,
}: {
  selected: ClientRecord | null;
  onSelect: (owner: ClientRecord | null) => void;
  error?: string;
}) {
  const api = useApi();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<ClientRecord[]>([]);
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
      void api<PageResult<ClientRecord>>(
        `/api/clients?pageSize=8&q=${encodeURIComponent(q.trim())}`,
        { signal: controller.signal },
      )
        .then((value) => {
          if (!controller.signal.aborted) setItems(value.items);
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
      window.clearTimeout(timer);
    };
  }, [q, selected, api, attempt]);
  return (
    <div className="field-wide owner-picker">
      {selected ? (
        <div className="selected-owner">
          <UserRound size={20} />
          <div>
            <strong>{selected.name}</strong>
            <small>Responsable seleccionado</small>
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
          <Field name="owner" label="Buscar responsable *" error={error}>
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
                  placeholder="Nombre, documento, correo o teléfono"
                  maxLength={100}
                  autoComplete="off"
                />
              </div>
            )}
          </Field>
          <p className="record-help">
            Escribe al menos dos caracteres y selecciona un cliente activo. Si no existe, regístralo
            primero en Clientes.
          </p>
          {loading && (
            <p role="status" className="record-help">
              Buscando responsables…
            </p>
          )}
          {failed ? (
            <p className="auth-error" role="alert">
              No se pudieron buscar responsables.{' '}
              <button type="button" className="text-link" onClick={() => setAttempt((x) => x + 1)}>
                Reintentar
              </button>
            </p>
          ) : !loading && q.trim().length >= 2 && !items.length ? (
            <p className="record-help">No encontramos clientes activos con esa búsqueda.</p>
          ) : (
            <ul className="owner-results">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(item)}
                    aria-label={`Seleccionar a ${item.name}`}
                  >
                    <strong>{item.name}</strong>
                    <small>{item.documentNumber ?? item.email ?? 'Sin documento ni correo'}</small>
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
interface PetFormProps {
  pet?: PetRecord;
  owner?: ClientRecord;
  onClose: () => void;
  onSaved: (pet: PetRecord) => void;
  onReload: () => void;
}
export function PetForm({ pet, owner, onClose, onSaved, onReload }: PetFormProps) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [selected, setSelected] = useState<ClientRecord | null>(owner ?? null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!pet && !selected) {
      setError(
        new ApiError('Selecciona al responsable de la mascota.', 400, {
          clientId: 'Busca y selecciona un cliente activo',
        }),
      );
      return;
    }
    const input: PetInput = {
      name: String(form.get('name')),
      species: form.get('species') as PetInput['species'],
      breed: nullable(form.get('breed')),
      sex: form.get('sex') as PetInput['sex'],
      birthDate: nullable(form.get('birthDate')),
      microchip: nullable(form.get('microchip')),
      allergies: nullable(form.get('allergies')),
      active: form.get('active') !== 'false',
    };
    setBusy(true);
    setError(null);
    try {
      const value = await api<PetRecord>(pet ? `/api/pets/${pet.id}` : '/api/pets', {
        method: pet ? 'PUT' : 'POST',
        body: pet ? { ...input, version: pet.version } : { ...input, clientId: selected!.id },
      });
      onSaved(value);
    } catch (error) {
      setError(toError(error));
    } finally {
      setBusy(false);
    }
  }
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return (
    <Dialog title={pet ? 'Editar mascota' : 'Registrar mascota'} onClose={onClose} busy={busy}>
      <form onSubmit={(event) => void submit(event)}>
        <div className="record-dialog-body">
          <p className="record-help">
            Completa los datos del paciente. Los campos con * son obligatorios.
          </p>
          <ErrorNotice error={error} onReload={onReload} />
          <fieldset disabled={busy} className="record-grid">
            {pet ? (
              <div className="selected-owner field-wide">
                <UserRound size={20} />
                <div>
                  <strong>{pet.ownerName}</strong>
                  <small>Responsable de la mascota · El vínculo se conserva</small>
                </div>
              </div>
            ) : (
              <OwnerPicker
                selected={selected}
                onSelect={setSelected}
                error={error?.fields.clientId}
              />
            )}
            <Field name="name" label="Nombre de la mascota *" error={error?.fields.name} wide>
              {(props) => (
                <input
                  {...props}
                  name="name"
                  required
                  minLength={2}
                  maxLength={150}
                  defaultValue={pet?.name}
                  autoFocus
                />
              )}
            </Field>
            <Field name="species" label="Especie *" error={error?.fields.species}>
              {(props) => (
                <select {...props} name="species" defaultValue={pet?.species ?? 'dog'}>
                  {Object.entries(speciesLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field name="breed" label="Raza" error={error?.fields.breed}>
              {(props) => (
                <input
                  {...props}
                  name="breed"
                  maxLength={100}
                  defaultValue={pet?.breed ?? ''}
                  placeholder="Ej.: mestizo"
                />
              )}
            </Field>
            <Field name="sex" label="Sexo" error={error?.fields.sex}>
              {(props) => (
                <select {...props} name="sex" defaultValue={pet?.sex ?? 'unknown'}>
                  {Object.entries(sexLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field name="birthDate" label="Fecha de nacimiento" error={error?.fields.birthDate}>
              {(props) => (
                <input
                  {...props}
                  type="date"
                  name="birthDate"
                  max={today}
                  defaultValue={pet?.birthDate ?? ''}
                />
              )}
            </Field>
            <Field name="microchip" label="Microchip" error={error?.fields.microchip} wide>
              {(props) => (
                <input
                  {...props}
                  name="microchip"
                  maxLength={40}
                  defaultValue={pet?.microchip ?? ''}
                  autoComplete="off"
                />
              )}
            </Field>
            <Field
              name="allergies"
              label="Alergias y observaciones relevantes"
              error={error?.fields.allergies}
              wide
            >
              {(props) => (
                <textarea
                  {...props}
                  name="allergies"
                  maxLength={2000}
                  rows={3}
                  defaultValue={pet?.allergies ?? ''}
                  placeholder="Registra únicamente información conocida del paciente"
                />
              )}
            </Field>
            {pet && (
              <Field name="active" label="Estado de la mascota" error={error?.fields.active} wide>
                {(props) => (
                  <select {...props} name="active" defaultValue={String(pet.active)}>
                    <option value="true">Activa</option>
                    <option value="false">Archivada</option>
                  </select>
                )}
              </Field>
            )}
          </fieldset>
        </div>
        <div className="record-dialog-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>
            Cancelar
          </button>
          <button
            type="submit"
            className="button"
            disabled={busy || error?.code === 'VERSION_CONFLICT'}
          >
            {busy ? 'Guardando…' : pet ? 'Guardar cambios' : 'Registrar mascota'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
