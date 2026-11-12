import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import {
  roleLabels,
  type UserAccount,
  type ServiceRecord,
  type CategoryRecord,
  type BusinessSettings,
  type PageResult,
} from '@nexovet/shared';
import { Table } from '../components';
import { useAuth } from '../auth';
import { useApi } from '../api';
import { useRead, LoadError, Pager, money, stamp } from '../inventory/common';
import { AccountForm, CatalogSettingsForm, BusinessForm } from './Forms';
import { Audit } from './Audit';
type Kind = 'users' | 'services' | 'categories';
type Row = UserAccount | ServiceRecord | CategoryRecord;
const titles = {
  users: 'Accesos del equipo',
  business: 'Configuración del negocio',
  services: 'Servicios veterinarios',
  categories: 'Categorías de productos',
  audit: 'Auditoría de actividad',
};
function Directory({ kind }: { kind: Kind }) {
  const api = useApi(),
    auth = useAuth(),
    [params, setParams] = useSearchParams(),
    [attempt, setAttempt] = useState(0),
    [notice, setNotice] = useState(''),
    [error, setError] = useState(''),
    [modal, setModal] = useState<{ record?: Row } | null>(null),
    [opening, setOpening] = useState(false);
  const q = params.get('q') ?? '',
    status = params.get('status') ?? 'active',
    raw = Number(params.get('page') ?? 1),
    page = Number.isInteger(raw) && raw >= 1 ? raw : 1,
    [search, setSearch] = useState(q);
  useEffect(() => setSearch(q), [q]);
  const query = new URLSearchParams({
      q,
      page: String(page),
      ...(kind !== 'categories' ? { status } : {}),
    }),
    r = useRead<PageResult<Row>>(`/api/admin/${kind}?${query}`, attempt);
  function filter(v: Record<string, string>) {
    setParams({ tab: kind, q, status, page: String(page), ...v }, { replace: true });
  }
  async function edit(id: string) {
    setOpening(true);
    setError('');
    try {
      setModal({ record: await api<Row>(`/api/admin/${kind}/${id}`) });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOpening(false);
    }
  }
  function saved() {
    setModal(null);
    setAttempt((x) => x + 1);
    setNotice('Configuración guardada correctamente.');
  }
  return (
    <>
      {notice && (
        <p className="auth-notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      <div className="management-toolbar">
        <p className="record-help">
          {kind === 'users'
            ? 'Los permisos se verifican también en la API. No hay registro público de personal.'
            : kind === 'services'
              ? 'Servicios disponibles para la agenda y ventas. Los cambios no modifican documentos ya guardados.'
              : 'Las categorías conservan sus productos al renombrarse.'}
        </p>
        <button className="button" disabled={opening} onClick={() => setModal({})}>
          <Plus size={15} />
          {kind === 'users'
            ? 'Nueva cuenta'
            : kind === 'services'
              ? 'Nuevo servicio'
              : 'Nueva categoría'}
        </button>
      </div>
      <section className="panel directory-panel">
        <form
          className="directory-search"
          onSubmit={(e) => {
            e.preventDefault();
            filter({ q: search.trim(), page: '1' });
            setAttempt((x) => x + 1);
          }}
        >
          <input
            className="stock-search"
            type="search"
            aria-label={
              kind === 'users'
                ? 'Buscar integrantes'
                : kind === 'services'
                  ? 'Buscar servicios'
                  : 'Buscar categorías'
            }
            placeholder={kind === 'users' ? 'Nombre o correo' : 'Nombre'}
            value={search}
            maxLength={100}
            onChange={(e) => setSearch(e.target.value)}
          />
          {kind !== 'categories' && (
            <label className="directory-status">
              <span>Estado</span>
              <select
                aria-label="Estado de configuración"
                value={status}
                onChange={(e) => filter({ status: e.target.value, page: '1' })}
              >
                <option value="active">Activos</option>
                <option value="archived">Archivados</option>
                <option value="all">Todos</option>
              </select>
            </label>
          )}
          <button className="secondary-button">Buscar</button>
        </form>
        {r.loading ? (
          <p className="directory-empty" role="status">
            Cargando configuración…
          </p>
        ) : r.error ? (
          <LoadError retry={() => setAttempt((x) => x + 1)}>{r.error}</LoadError>
        ) : r.data?.items.length ? (
          <>
            {kind === 'users' ? (
              <Table headers={['Nombre', 'Correo', 'Rol', 'Acceso', 'Ficha']}>
                {(r.data.items as UserAccount[]).map((u) => (
                  <tr key={u.id}>
                    <td>
                      <strong>{u.name}</strong>
                      {u.id === auth.session!.user.id && (
                        <small className="table-secondary">Tu cuenta</small>
                      )}
                    </td>
                    <td>{u.email}</td>
                    <td>{roleLabels[u.role]}</td>
                    <td>
                      {!u.active ? 'Archivado' : u.loginEnabled ? 'Habilitado' : 'Deshabilitado'}
                    </td>
                    <td>
                      <button
                        className="record-link"
                        disabled={opening}
                        aria-label={`Editar cuenta ${u.email}`}
                        onClick={() => void edit(u.id)}
                      >
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </Table>
            ) : kind === 'services' ? (
              <Table headers={['Servicio', 'Duración', 'Precio', 'Estado', 'Ficha']}>
                {(r.data.items as ServiceRecord[]).map((s) => (
                  <tr key={s.id}>
                    <td>
                      <strong>{s.name}</strong>
                    </td>
                    <td>{s.durationMinutes} min</td>
                    <td>{money(s.price)}</td>
                    <td>{s.active ? 'Activo' : 'Archivado'}</td>
                    <td>
                      <button
                        className="record-link"
                        disabled={opening}
                        aria-label={`Editar servicio ${s.name}`}
                        onClick={() => void edit(s.id)}
                      >
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </Table>
            ) : (
              <Table headers={['Categoría', 'Actualizada', 'Ficha']}>
                {(r.data.items as CategoryRecord[]).map((c) => (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.name}</strong>
                    </td>
                    <td>{stamp(c.updatedAt)}</td>
                    <td>
                      <button
                        className="record-link"
                        disabled={opening}
                        aria-label={`Editar categoría ${c.name}`}
                        onClick={() => void edit(c.id)}
                      >
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </Table>
            )}
            <Pager value={r.data} onPage={(page) => filter({ page: String(page) })} />
          </>
        ) : (
          <div className="directory-empty">
            <h2>No hay registros con estos filtros</h2>
            {page > 1 && (
              <button className="text-link" onClick={() => filter({ page: '1' })}>
                Primera página
              </button>
            )}
          </div>
        )}
      </section>
      {modal &&
        (kind === 'users' ? (
          <AccountForm
            initial={modal.record as UserAccount | undefined}
            onClose={() => setModal(null)}
            onSaved={(user, passwordChanged) => {
              saved();
              if (user.id === auth.session!.user.id) {
                if (passwordChanged) auth.expire();
                else auth.reload();
              }
            }}
          />
        ) : (
          <CatalogSettingsForm
            kind={kind}
            initial={modal.record as ServiceRecord | CategoryRecord | undefined}
            onClose={() => setModal(null)}
            onSaved={saved}
          />
        ))}
    </>
  );
}
function Business({ onSaved }: { onSaved: () => void }) {
  const [attempt, setAttempt] = useState(0),
    r = useRead<BusinessSettings>('/api/admin/business', attempt);
  return r.loading ? (
    <p role="status" className="directory-empty">
      Cargando datos del negocio…
    </p>
  ) : r.error ? (
    <LoadError retry={() => setAttempt((x) => x + 1)}>{r.error}</LoadError>
  ) : r.data ? (
    <BusinessForm initial={r.data} onSaved={onSaved} />
  ) : null;
}
export function Administration({ onBusinessSaved }: { onBusinessSaved: () => void }) {
  const [params, setParams] = useSearchParams(),
    raw = params.get('tab') ?? 'users',
    tab = Object.hasOwn(titles, raw) ? (raw as keyof typeof titles) : 'users';
  return (
    <section className="patient-directory management-page">
      <div className="directory-heading">
        <div>
          <span className="eyebrow">GESTIONAR CON CLARIDAD</span>
          <h1>{titles[tab]}</h1>
          <p>Ajustes de la veterinaria y trazabilidad de las operaciones.</p>
        </div>
      </div>
      <div
        className="panel management-tabs directory-tabs"
        aria-label="Secciones de administración"
      >
        {[
          ['users', 'Equipo'],
          ['business', 'Negocio'],
          ['services', 'Servicios'],
          ['categories', 'Categorías'],
          ['audit', 'Auditoría'],
        ].map(([value, label]) => (
          <button
            key={value}
            className={tab === value ? 'selected' : ''}
            aria-pressed={tab === value}
            onClick={() => setParams({ tab: value!, page: '1' }, { replace: true })}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'audit' ? (
        <Audit />
      ) : tab === 'business' ? (
        <Business onSaved={onBusinessSaved} />
      ) : (
        <Directory key={tab} kind={tab} />
      )}
    </section>
  );
}
