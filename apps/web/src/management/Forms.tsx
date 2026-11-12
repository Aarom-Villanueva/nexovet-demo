import { useState, type FormEvent } from 'react';
import {
  roleLabels,
  type UserAccount,
  type UserAccountInput,
  type UserAccountEdit,
  type ServiceRecord,
  type CategoryRecord,
  type BusinessSettings,
} from '@nexovet/shared';
import { Dialog, Field, ErrorNotice } from '../patients/Forms';
import { useApi, ApiError } from '../api';
import { useAuth } from '../auth';
export function AccountForm({
  initial,
  onClose,
  onSaved,
}: {
  initial?: UserAccount;
  onClose: () => void;
  onSaved: (r: UserAccount, passwordChanged: boolean) => void;
}) {
  const api = useApi(),
    self = useAuth().session!.user.id === initial?.id,
    [record, setRecord] = useState(initial),
    [active, setActive] = useState(initial?.active ?? true),
    [enabled, setEnabled] = useState(initial?.loginEnabled ?? true),
    [changePassword, setChangePassword] = useState(!initial),
    [show, setShow] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<ApiError | null>(null);
  async function reload() {
    setBusy(true);
    try {
      const r = await api<UserAccount>(`/api/admin/users/${record!.id}`);
      setRecord(r);
      setActive(r.active);
      setEnabled(r.loginEnabled);
      setChangePassword(false);
      setShow(false);
      setError(null);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      base = {
        name: String(f.get('name')).trim(),
        role: String(f.get('role')) as UserAccount['role'],
        active,
        loginEnabled: enabled,
      };
    const b: UserAccountInput | UserAccountEdit = record
      ? {
          ...base,
          password: changePassword ? String(f.get('password')) : null,
          version: record.version,
        }
      : { ...base, email: String(f.get('email')).trim(), password: String(f.get('password')) };
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await api<UserAccount>(record ? `/api/admin/users/${record.id}` : '/api/admin/users', {
          method: record ? 'PUT' : 'POST',
          body: b,
        }),
        changePassword,
      );
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={record ? 'Editar cuenta' : 'Nueva cuenta del equipo'}
      onClose={onClose}
      busy={busy}
    >
      <form onSubmit={(e) => void submit(e)}>
        <div className="record-dialog-body">
          <p className="record-help">
            Acceso interno del personal. No se envía un correo al guardar. El correo de una cuenta
            existente se conserva.
          </p>
          <ErrorNotice error={error} onReload={record ? () => void reload() : undefined} />
          <fieldset key={record?.version ?? 'new'} className="record-grid" disabled={busy}>
            <Field name="name" label="Nombre del integrante *" error={error?.fields.name} wide>
              {(props) => (
                <input
                  {...props}
                  name="name"
                  required
                  minLength={2}
                  maxLength={150}
                  defaultValue={record?.name}
                />
              )}
            </Field>
            <Field name="email" label="Correo de acceso *" error={error?.fields.email} wide>
              {(props) => (
                <input
                  {...props}
                  name="email"
                  type="email"
                  required
                  readOnly={!!record}
                  maxLength={254}
                  defaultValue={record?.email}
                />
              )}
            </Field>
            <Field name="role" label="Rol del equipo *" error={error?.fields.role} wide>
              {(props) => (
                <select
                  {...props}
                  name="role"
                  defaultValue={record?.role ?? 'reception'}
                  disabled={self}
                >
                  {Object.entries(roleLabels).map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {self && <input type="hidden" name="role" value="admin" />}
            <label className="record-check field-wide">
              <input
                type="checkbox"
                checked={active}
                disabled={self}
                onChange={(e) => {
                  setActive(e.target.checked);
                  if (!e.target.checked) setEnabled(false);
                }}
              />
              Cuenta activa
            </label>
            <label className="record-check field-wide">
              <input
                type="checkbox"
                checked={enabled}
                disabled={self || !active}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              Permitir ingreso
            </label>
            {self && (
              <p className="record-help field-wide">
                Tu cuenta conserva su rol y acceso administrativo. Si cambias tu contraseña, deberás
                ingresar otra vez.
              </p>
            )}
            {record && !record.hasPassword && (
              <p className="auth-notice field-wide">
                Esta cuenta necesita una contraseña para habilitar su ingreso.
              </p>
            )}
            {record && (
              <label className="record-check field-wide">
                <input
                  type="checkbox"
                  checked={changePassword}
                  onChange={(e) => {
                    setChangePassword(e.target.checked);
                    setShow(false);
                  }}
                />
                Establecer nueva contraseña
              </label>
            )}
            {changePassword && (
              <Field
                name="password"
                label={record ? 'Nueva contraseña *' : 'Contraseña inicial *'}
                error={error?.fields.password}
                wide
              >
                {(props) => (
                  <>
                    <input
                      {...props}
                      name="password"
                      type={show ? 'text' : 'password'}
                      required
                      minLength={12}
                      maxLength={128}
                      autoComplete="new-password"
                    />
                    <button className="text-link" type="button" onClick={() => setShow((x) => !x)}>
                      {show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    </button>
                    <small className="record-help">
                      De 12 a 128 caracteres. No se mostrará después de guardar.
                    </small>
                  </>
                )}
              </Field>
            )}
          </fieldset>
          {record && (
            <p className="record-help">
              Cambiar rol, actividad, permiso de ingreso o contraseña cierra las sesiones existentes
              y deja sin uso los enlaces anteriores de recuperación.
            </p>
          )}
        </div>
        <div className="record-dialog-actions">
          <button className="secondary-button" type="button" disabled={busy} onClick={onClose}>
            Cancelar
          </button>
          <button className="button" disabled={busy || error?.code === 'VERSION_CONFLICT'}>
            {busy ? 'Guardando…' : 'Guardar cuenta'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
export function CatalogSettingsForm({
  kind,
  initial,
  onClose,
  onSaved,
}: {
  kind: 'services' | 'categories';
  initial?: ServiceRecord | CategoryRecord;
  onClose: () => void;
  onSaved: () => void;
}) {
  const api = useApi(),
    [record, setRecord] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<ApiError | null>(null),
    isService = kind === 'services';
  const service = record as ServiceRecord | undefined;
  async function reload() {
    setBusy(true);
    try {
      setRecord(await api<ServiceRecord | CategoryRecord>(`/api/admin/${kind}/${record!.id}`));
      setError(null);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      b = {
        name: String(f.get('name')).trim(),
        ...(isService
          ? {
              durationMinutes: Number(f.get('durationMinutes')),
              price: String(f.get('price')).trim(),
              active: f.get('active') === 'true',
            }
          : {}),
        ...(record ? { version: record.version } : {}),
      };
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/${kind}${record ? `/${record.id}` : ''}`, {
        method: record ? 'PUT' : 'POST',
        body: b,
      });
      onSaved();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={`${record ? 'Editar' : isService ? 'Nuevo' : 'Nueva'} ${isService ? 'servicio' : 'categoría'}`}
      onClose={onClose}
      busy={busy}
    >
      <form onSubmit={(e) => void submit(e)}>
        <div className="record-dialog-body">
          <ErrorNotice error={error} onReload={record ? () => void reload() : undefined} />
          <fieldset key={record?.version ?? 'new'} className="record-grid" disabled={busy}>
            <Field
              name="name"
              label={isService ? 'Nombre del servicio *' : 'Nombre de la categoría *'}
              error={error?.fields.name}
              wide
            >
              {(props) => (
                <input
                  {...props}
                  name="name"
                  required
                  minLength={2}
                  maxLength={150}
                  defaultValue={record?.name}
                />
              )}
            </Field>
            {isService && (
              <>
                <Field
                  name="durationMinutes"
                  label="Duración (minutos) *"
                  error={error?.fields.durationMinutes}
                >
                  {(props) => (
                    <input
                      {...props}
                      name="durationMinutes"
                      type="number"
                      min={5}
                      max={480}
                      step={1}
                      required
                      defaultValue={service?.durationMinutes ?? 30}
                    />
                  )}
                </Field>
                <Field name="price" label="Precio del servicio (S/) *" error={error?.fields.price}>
                  {(props) => (
                    <input
                      {...props}
                      name="price"
                      inputMode="decimal"
                      maxLength={13}
                      required
                      defaultValue={service?.price ?? '0.00'}
                    />
                  )}
                </Field>
                <Field name="active" label="Estado del servicio" wide>
                  {(props) => (
                    <select {...props} name="active" defaultValue={String(service?.active ?? true)}>
                      <option value="true">Activo</option>
                      <option value="false">Archivado</option>
                    </select>
                  )}
                </Field>
              </>
            )}
          </fieldset>
          <p className="record-help">
            {isService
              ? 'El precio se aplica a nuevos borradores de venta. La duración se propone al reservar; no cambia horarios ya guardados. Archivar impide nuevas reservas y ventas sin eliminar historial.'
              : 'Las categorías organizan los productos. Cambiar el nombre conserva sus asociaciones; no se eliminan desde esta pantalla.'}
          </p>
        </div>
        <div className="record-dialog-actions">
          <button className="secondary-button" type="button" disabled={busy} onClick={onClose}>
            Cancelar
          </button>
          <button className="button" disabled={busy || error?.code === 'VERSION_CONFLICT'}>
            {busy ? 'Guardando…' : 'Guardar configuración'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
export function BusinessForm({
  initial,
  onSaved,
}: {
  initial: BusinessSettings;
  onSaved: () => void;
}) {
  const api = useApi(),
    [record, setRecord] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<ApiError | null>(null),
    [notice, setNotice] = useState('');
  async function reload() {
    setBusy(true);
    try {
      setRecord(await api<BusinessSettings>('/api/admin/business'));
      setError(null);
      setNotice('Versión actual cargada.');
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      setRecord(
        await api<BusinessSettings>('/api/admin/business', {
          method: 'PUT',
          body: {
            name: String(f.get('name')).trim(),
            address: String(f.get('address')).trim(),
            version: record.version,
          },
        }),
      );
      setNotice('Datos del negocio guardados.');
      onSaved();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="panel management-panel" onSubmit={(e) => void submit(e)}>
      <h2>Datos de la veterinaria</h2>
      <p className="record-help">
        Una sede y un almacén. La moneda, zona horaria y condición de demostración se conservan.
      </p>
      {notice && (
        <p className="auth-notice" role="status">
          {notice}
        </p>
      )}
      <ErrorNotice error={error} onReload={() => void reload()} />
      <fieldset key={record.version} className="record-grid" disabled={busy}>
        <Field name="name" label="Nombre del negocio *" error={error?.fields.name} wide>
          {(props) => (
            <input
              {...props}
              name="name"
              required
              minLength={2}
              maxLength={150}
              defaultValue={record.name}
            />
          )}
        </Field>
        <Field name="address" label="Dirección del negocio *" error={error?.fields.address} wide>
          {(props) => (
            <textarea
              {...props}
              name="address"
              required
              minLength={3}
              maxLength={300}
              defaultValue={record.address}
              rows={3}
            />
          )}
        </Field>
      </fieldset>
      <dl className="record-facts">
        <div>
          <dt>Moneda</dt>
          <dd>PEN · Soles</dd>
        </div>
        <div>
          <dt>Zona horaria</dt>
          <dd>America/Lima</dd>
        </div>
        <div>
          <dt>Entorno del negocio</dt>
          <dd>{record.demo ? 'Demostración con datos ficticios' : 'Operación'}</dd>
        </div>
      </dl>
      <button className="button" disabled={busy || error?.code === 'VERSION_CONFLICT'}>
        {busy ? 'Guardando…' : 'Guardar negocio'}
      </button>
    </form>
  );
}
