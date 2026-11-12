import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
  Pencil,
  PawPrint,
  UserRound,
  X,
} from 'lucide-react';
import {
  canManagePatients,
  speciesLabels,
  sexLabels,
  type ClientRecord,
  type PetRecord,
  type PageResult,
} from '@nexovet/shared';
import { Table, date } from '../components';
import { useAuth } from '../auth';
import { useApi } from '../api';
import { ClientForm, PetForm, Dialog } from './Forms';
import { HistoryDialog } from '../agenda/Care';

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
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
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
          type="button"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          aria-label="Página anterior"
        >
          <ChevronLeft size={16} />
        </button>
        <span>
          Página {page} de {pages}
        </span>
        <button
          className="secondary-button"
          type="button"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
          aria-label="Página siguiente"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children || 'Sin registrar'}</dd>
    </div>
  );
}
function ClientDetails({
  client,
  onClose,
  onEdit,
  onAddPet,
  onPet,
}: {
  client: ClientRecord;
  onClose: () => void;
  onEdit: () => void;
  onAddPet: () => void;
  onPet: (id: string) => void;
}) {
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const { data, error, loading } = useRead<PageResult<PetRecord>>(
    `/api/pets?status=all&clientId=${client.id}&page=${page}&pageSize=5`,
    attempt,
  );
  return (
    <Dialog title={client.name} onClose={onClose}>
      <div className="record-dialog-body">
        <div className="record-summary">
          <span className="record-avatar">
            <UserRound size={28} />
          </span>
          <div>
            <span className={`status ${client.active ? 'status-confirmed' : 'status-cancelled'}`}>
              {client.active ? 'Cliente activo' : 'Cliente archivado'}
            </span>
            <p className="record-help">Actualizado el {date(client.updatedAt)}</p>
          </div>
          <button className="secondary-button" onClick={onEdit}>
            <Pencil size={15} /> Editar cliente
          </button>
        </div>
        <dl className="record-facts">
          <Fact label="Teléfono">{client.phone}</Fact>
          <Fact label="Correo">{client.email}</Fact>
          <Fact label="Documento">
            {client.documentType &&
              `${client.documentType === 'other' ? 'Otro' : client.documentType} · ${client.documentNumber}`}
          </Fact>
          <Fact label="Dirección">{client.address}</Fact>
          <Fact label="Contacto para seguimientos">
            {client.contactConsentAt
              ? `Autorizado · ${date(client.contactConsentAt)}`
              : 'Sin autorización registrada'}
          </Fact>
          <Fact label="Constancia de autorización">{client.contactConsentNote}</Fact>
        </dl>
        <div className="related-heading">
          <h3>Mascotas de este responsable</h3>
          {client.active && (
            <button className="text-link" onClick={onAddPet}>
              <Plus size={15} /> Registrar mascota
            </button>
          )}
        </div>
        {loading ? (
          <p className="record-help" role="status">
            Cargando mascotas…
          </p>
        ) : error ? (
          <div className="auth-error" role="alert">
            {error}{' '}
            <button className="text-link" onClick={() => setAttempt((x) => x + 1)}>
              Reintentar
            </button>
          </div>
        ) : !data?.total ? (
          <p className="record-help">Aún no tiene mascotas registradas.</p>
        ) : (
          <>
            <ul className="related-pets">
              {data.items.map((pet) => (
                <li key={pet.id}>
                  <PawPrint size={18} />
                  <button className="record-link" onClick={() => onPet(pet.id)}>
                    {pet.name}
                  </button>
                  <span>
                    {speciesLabels[pet.species]}
                    {!pet.active ? ' · Archivada' : ''}
                  </span>
                </li>
              ))}
            </ul>
            <Pager
              page={data.page}
              total={data.total}
              pageSize={data.pageSize}
              onChange={setPage}
            />
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
function PetDetails({
  pet,
  onClose,
  onEdit,
  onHistory,
}: {
  pet: PetRecord;
  onClose: () => void;
  onEdit?: () => void;
  onHistory?: () => void;
}) {
  return (
    <Dialog title={pet.name} onClose={onClose}>
      <div className="record-dialog-body">
        <div className="record-summary">
          <span className="record-avatar">
            <PawPrint size={28} />
          </span>
          <div>
            <span className={`status ${pet.active ? 'status-confirmed' : 'status-cancelled'}`}>
              {pet.active ? 'Paciente activo' : 'Paciente archivado'}
            </span>
            <p className="record-help">Actualizado el {date(pet.updatedAt)}</p>
          </div>
          {onEdit && (
            <button className="secondary-button" onClick={onEdit}>
              <Pencil size={15} /> Editar mascota
            </button>
          )}
        </div>
        <dl className="record-facts">
          <Fact label="Responsable">
            {pet.ownerName}
            {!pet.ownerActive ? ' · Archivado' : ''}
          </Fact>
          <Fact label="Especie">{speciesLabels[pet.species]}</Fact>
          <Fact label="Raza">{pet.breed}</Fact>
          <Fact label="Sexo">{sexLabels[pet.sex]}</Fact>
          <Fact label="Nacimiento">
            {pet.birthDate ? date(`${pet.birthDate}T12:00:00-05:00`) : null}
          </Fact>
          <Fact label="Microchip">{pet.microchip}</Fact>
        </dl>
        <div className="clinical-note">
          <h3>Alergias y observaciones relevantes</h3>
          <p>{pet.allergies ?? 'Sin información registrada.'}</p>
        </div>
      </div>
      <div className="record-dialog-actions">
        {onHistory && (
          <button className="button" onClick={onHistory}>
            Historia clínica
          </button>
        )}
        <button className="secondary-button" onClick={onClose}>
          Cerrar
        </button>
      </div>
    </Dialog>
  );
}
type OpenDialog =
  | { kind: 'clientForm'; record?: ClientRecord }
  | { kind: 'clientDetails'; record: ClientRecord }
  | { kind: 'petForm'; record?: PetRecord; owner?: ClientRecord }
  | { kind: 'petDetails'; record: PetRecord }
  | { kind: 'petHistory'; record: PetRecord };
export function PatientDirectory() {
  const auth = useAuth();
  const api = useApi();
  const manage = canManagePatients(auth.session!.user.role);
  const [params, setParams] = useSearchParams();
  const tab = manage && params.get('tab') !== 'pets' ? 'clients' : 'pets';
  const q = params.get('q') ?? '';
  const rawStatus = params.get('status');
  const status = rawStatus === 'all' || rawStatus === 'archived' ? rawStatus : 'active';
  const rawPage = Number(params.get('page') ?? 1);
  const page = Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= 10000 ? rawPage : 1;
  const [search, setSearch] = useState(q);
  const [attempt, setAttempt] = useState(0);
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const [notice, setNotice] = useState('');
  const [openError, setOpenError] = useState('');
  const [opening, setOpening] = useState(false);
  useEffect(() => setSearch(q), [q]);
  const query = new URLSearchParams({ q, status, page: String(page) });
  const { data, error, loading } = useRead<PageResult<ClientRecord | PetRecord>>(
    `/api/${tab}?${query}`,
    attempt,
  );
  function filter(change: Record<string, string>) {
    setParams({ tab, q, status, page: String(page), ...change }, { replace: true });
  }
  async function openClient(id: string, edit = false) {
    setOpening(true);
    setOpenError('');
    try {
      const record = await api<ClientRecord>(`/api/clients/${id}`);
      setDialog(edit ? { kind: 'clientForm', record } : { kind: 'clientDetails', record });
    } catch (error) {
      setOpenError((error as Error).message);
    } finally {
      setOpening(false);
    }
  }
  async function openPet(id: string, edit = false) {
    setOpening(true);
    setOpenError('');
    try {
      const record = await api<PetRecord>(`/api/pets/${id}`);
      setDialog(edit ? { kind: 'petForm', record } : { kind: 'petDetails', record });
    } catch (error) {
      setOpenError((error as Error).message);
    } finally {
      setOpening(false);
    }
  }
  function savedClient(record: ClientRecord) {
    setNotice('Cliente guardado correctamente.');
    setDialog({ kind: 'clientDetails', record });
    setAttempt((x) => x + 1);
    if (!dialog || (dialog.kind === 'clientForm' && !dialog.record))
      filter({
        tab: 'clients',
        q: record.name,
        status: record.active ? 'active' : 'archived',
        page: '1',
      });
  }
  function savedPet(record: PetRecord) {
    setNotice('Mascota guardada correctamente.');
    setDialog({ kind: 'petDetails', record });
    setAttempt((x) => x + 1);
    if (dialog?.kind === 'petForm' && !dialog.record)
      filter({
        tab: 'pets',
        q: record.name,
        status: record.active ? 'active' : 'archived',
        page: '1',
      });
  }
  return (
    <section className="patient-directory">
      <div className="directory-heading">
        <div>
          <span className="eyebrow">CADA PACIENTE, UNA HISTORIA</span>
          <h1>{manage ? 'Clientes y mascotas' : 'Nuestros pacientes'}</h1>
          <p>
            {manage
              ? 'Las personas que confían en ti y las mascotas que acompañas.'
              : 'Consulta los datos y observaciones de cada mascota.'}
          </p>
        </div>
        {manage && (
          <div className="directory-actions">
            <button className="secondary-button" onClick={() => setDialog({ kind: 'petForm' })}>
              <Plus size={16} /> Nueva mascota
            </button>
            <button className="button" onClick={() => setDialog({ kind: 'clientForm' })}>
              <Plus size={16} /> Nuevo cliente
            </button>
          </div>
        )}
      </div>
      {notice && (
        <div className="directory-notice" role="status">
          <span>{notice}</span>
          <button className="icon-button" aria-label="Cerrar aviso" onClick={() => setNotice('')}>
            <X size={16} />
          </button>
        </div>
      )}
      {openError && (
        <p className="auth-error" role="alert">
          {openError}
        </p>
      )}
      {opening && (
        <p role="status" className="record-help">
          Abriendo ficha…
        </p>
      )}
      <div className="panel directory-panel">
        <div className="directory-tabs" aria-label="Tipo de ficha">
          {manage && (
            <button
              className={tab === 'clients' ? 'selected' : ''}
              onClick={() => filter({ tab: 'clients', q: '', page: '1' })}
              aria-pressed={tab === 'clients'}
            >
              <UserRound size={17} /> Clientes
            </button>
          )}
          <button
            className={tab === 'pets' ? 'selected' : ''}
            onClick={() => filter({ tab: 'pets', q: '', page: '1' })}
            aria-pressed={tab === 'pets'}
          >
            <PawPrint size={17} /> Mascotas
          </button>
        </div>
        <form
          className="directory-search"
          onSubmit={(event) => {
            event.preventDefault();
            filter({ q: search.trim(), page: '1' });
          }}
        >
          <label className="search-input">
            <Search size={18} />
            <input
              type="search"
              aria-label={tab === 'clients' ? 'Buscar clientes' : 'Buscar mascotas'}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              maxLength={100}
              placeholder={
                tab === 'clients'
                  ? 'Nombre, teléfono, documento o correo'
                  : 'Mascota, responsable o microchip'
              }
            />
          </label>
          <label className="directory-status">
            <span>Estado</span>
            <select
              value={status}
              onChange={(event) =>
                filter({ status: event.target.value, q: search.trim(), page: '1' })
              }
            >
              <option value="active">Activos</option>
              <option value="archived">Archivados</option>
              <option value="all">Todos</option>
            </select>
          </label>
          <button type="submit" className="secondary-button">
            Buscar
          </button>
          {q && (
            <button
              type="button"
              className="text-link"
              onClick={() => {
                setSearch('');
                filter({ q: '', page: '1' });
              }}
            >
              Limpiar
            </button>
          )}
        </form>
        <div className="directory-list-heading">
          <h2>{tab === 'clients' ? 'Clientes' : 'Mascotas'}</h2>
          <span>{loading ? 'Consultando…' : `${data?.total ?? 0} registros`}</span>
        </div>
        {loading ? (
          <div className="directory-empty" role="status">
            <span className="loader" />
            <p>Cargando fichas…</p>
          </div>
        ) : error ? (
          <div className="directory-empty" role="alert">
            <p>{error}</p>
            <button className="button" onClick={() => setAttempt((x) => x + 1)}>
              Intentar nuevamente
            </button>
          </div>
        ) : !data?.items.length ? (
          <div className="directory-empty">
            <PawPrint size={32} />
            <h3>No encontramos registros</h3>
            <p>
              {q ? 'Prueba otro nombre o cambia los filtros.' : 'No hay fichas con este estado.'}
            </p>
            {page > 1 && (
              <button className="text-link" onClick={() => filter({ page: '1' })}>
                Volver a la primera página
              </button>
            )}
          </div>
        ) : tab === 'clients' ? (
          <Table headers={['Cliente', 'Contacto', 'Documento', 'Mascotas', 'Estado', 'Acciones']}>
            {(data.items as ClientRecord[]).map((client) => (
              <tr key={client.id}>
                <td>
                  <button
                    className="record-link"
                    onClick={() => void openClient(client.id)}
                    aria-label={`Ver ficha de ${client.name}`}
                  >
                    {client.name}
                  </button>
                  <small className="table-secondary">Registrado el {date(client.createdAt)}</small>
                </td>
                <td>
                  {client.phone ?? 'Sin teléfono'}
                  <small className="table-secondary">{client.email ?? 'Sin correo'}</small>
                </td>
                <td>
                  {client.documentNumber
                    ? `${client.documentType === 'other' ? 'Otro' : client.documentType} ${client.documentNumber}`
                    : 'Sin documento'}
                </td>
                <td>{client.pets}</td>
                <td>
                  <span
                    className={`status ${client.active ? 'status-confirmed' : 'status-cancelled'}`}
                  >
                    {client.active ? 'Activo' : 'Archivado'}
                  </span>
                </td>
                <td>
                  <button
                    className="record-edit"
                    aria-label={`Editar a ${client.name}`}
                    onClick={() => void openClient(client.id, true)}
                  >
                    <Pencil size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Table
            headers={[
              'Paciente',
              'Especie / raza',
              'Responsable',
              'Estado',
              ...(manage ? ['Acciones'] : []),
            ]}
          >
            {(data.items as PetRecord[]).map((pet) => (
              <tr key={pet.id}>
                <td>
                  <button
                    className="record-link"
                    onClick={() => void openPet(pet.id)}
                    aria-label={`Ver ficha de ${pet.name}`}
                  >
                    {pet.name}
                  </button>
                  <small className="table-secondary">
                    {pet.microchip ? `Chip ${pet.microchip}` : 'Sin microchip'}
                  </small>
                </td>
                <td>
                  {speciesLabels[pet.species]}
                  <small className="table-secondary">{pet.breed ?? 'Raza sin registrar'}</small>
                </td>
                <td>{pet.ownerName}</td>
                <td>
                  <span
                    className={`status ${pet.active ? 'status-confirmed' : 'status-cancelled'}`}
                  >
                    {pet.active ? 'Activa' : 'Archivada'}
                  </span>
                </td>
                {manage && (
                  <td>
                    <button
                      className="record-edit"
                      aria-label={`Editar a ${pet.name}`}
                      onClick={() => void openPet(pet.id, true)}
                    >
                      <Pencil size={16} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </Table>
        )}
        {!loading && !error && data && data.items.length > 0 && (
          <Pager
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            onChange={(page) => filter({ page: String(page) })}
          />
        )}
      </div>
      {dialog?.kind === 'clientForm' && (
        <ClientForm
          key={`client-${dialog.record?.id ?? 'new'}-${dialog.record?.version ?? 0}`}
          client={dialog.record}
          onClose={() => setDialog(null)}
          onSaved={savedClient}
          onReload={() => {
            if (dialog.record) void openClient(dialog.record.id, true);
          }}
        />
      )}
      {dialog?.kind === 'petForm' && (
        <PetForm
          key={`pet-${dialog.record?.id ?? 'new'}-${dialog.record?.version ?? 0}`}
          pet={dialog.record}
          owner={dialog.owner}
          onClose={() => setDialog(null)}
          onSaved={savedPet}
          onReload={() => {
            if (dialog.record) void openPet(dialog.record.id, true);
          }}
        />
      )}
      {dialog?.kind === 'clientDetails' && (
        <ClientDetails
          key={dialog.record.id}
          client={dialog.record}
          onClose={() => setDialog(null)}
          onEdit={() => setDialog({ kind: 'clientForm', record: dialog.record })}
          onAddPet={() => setDialog({ kind: 'petForm', owner: dialog.record })}
          onPet={(id) => void openPet(id)}
        />
      )}
      {dialog?.kind === 'petDetails' && (
        <PetDetails
          pet={dialog.record}
          onClose={() => setDialog(null)}
          onHistory={
            auth.session!.user.role !== 'reception'
              ? () => setDialog({ kind: 'petHistory', record: dialog.record })
              : undefined
          }
          onEdit={manage ? () => setDialog({ kind: 'petForm', record: dialog.record }) : undefined}
        />
      )}
      {dialog?.kind === 'petHistory' && (
        <HistoryDialog
          petId={dialog.record.id}
          petName={dialog.record.name}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  );
}
