import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { AuditRecord, PageResult } from '@nexovet/shared';
import { Table } from '../components';
import { useRead, LoadError, Pager, stamp } from '../inventory/common';
type Options = { from: string; to: string; actions: string[]; entityTypes: string[] };
const summaryLabels: Record<string, string> = {
  version: 'Versión',
  status: 'Estado',
  previousStatus: 'Estado anterior',
  active: 'Activo',
  role: 'Rol',
  loginEnabled: 'Ingreso habilitado',
  passwordChanged: 'Contraseña actualizada',
  sessionsRevoked: 'Sesiones cerradas',
  lineCount: 'Líneas',
  paymentCount: 'Pagos',
  total: 'Total',
  quantity: 'Cantidad',
  fields: 'Campos',
};
export function Audit() {
  const [params, setParams] = useSearchParams(),
    [attempt, setAttempt] = useState(0),
    [search, setSearch] = useState(params.get('q') ?? ''),
    [from, setFrom] = useState(params.get('from') ?? ''),
    [to, setTo] = useState(params.get('to') ?? '');
  const q = params.get('q') ?? '',
    action = params.get('action') ?? '',
    entityType = params.get('entityType') ?? '',
    entityId = params.get('entityId') ?? '',
    raw = Number(params.get('page') ?? 1),
    page = Number.isInteger(raw) && raw >= 1 ? raw : 1,
    options = useRead<Options>('/api/admin/audit/options', attempt);
  const urlFrom = params.get('from'),
    urlTo = params.get('to');
  useEffect(() => setSearch(q), [q]);
  useEffect(() => {
    setFrom(urlFrom ?? '');
    setTo(urlTo ?? '');
  }, [urlFrom, urlTo]);
  useEffect(() => {
    if (!urlFrom) setFrom((current) => current || options.data?.from || '');
    if (!urlTo) setTo((current) => current || options.data?.to || '');
  }, [options.data, urlFrom, urlTo]);
  const query = new URLSearchParams({
      q,
      action,
      entityType,
      page: String(page),
      ...(params.get('from') ? { from: params.get('from')! } : {}),
      ...(params.get('to') ? { to: params.get('to')! } : {}),
      ...(entityId ? { entityId } : {}),
    }),
    r = useRead<PageResult<AuditRecord>>(`/api/admin/audit?${query}`, attempt);
  function filter(v: Record<string, string>) {
    setParams(
      {
        tab: 'audit',
        q,
        action,
        entityType,
        page: String(page),
        ...(params.get('from') ? { from: params.get('from')! } : {}),
        ...(params.get('to') ? { to: params.get('to')! } : {}),
        ...(entityId ? { entityId } : {}),
        ...v,
      },
      { replace: true },
    );
  }
  return (
    <section className="panel directory-panel">
      <form
        className="directory-search audit-filters"
        onSubmit={(e) => {
          e.preventDefault();
          filter({ q: search.trim(), from, to, page: '1' });
          setAttempt((x) => x + 1);
        }}
      >
        <label>
          Desde
          <input
            type="date"
            aria-label="Auditoría desde"
            min="2000-01-01"
            required
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          Hasta inclusive
          <input
            type="date"
            aria-label="Auditoría hasta"
            min="2000-01-01"
            required
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <input
          className="stock-search"
          aria-label="Buscar actividad"
          placeholder="Persona, acción o ID de registro"
          maxLength={100}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label>
          Acción
          <select
            aria-label="Acción auditada"
            value={action}
            onChange={(e) => filter({ action: e.target.value, page: '1' })}
          >
            <option value="">Todas</option>
            {options.data?.actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tipo de registro
          <select
            aria-label="Tipo de registro auditado"
            value={entityType}
            onChange={(e) => filter({ entityType: e.target.value, page: '1' })}
          >
            <option value="">Todos</option>
            {options.data?.entityTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <button className="secondary-button" disabled={!from || !to}>
          Consultar actividad
        </button>
        <p className="record-help">
          Hasta 366 días por consulta. Historial de solo lectura; las notas clínicas, contraseñas y
          referencias de cobro no se muestran aquí.
        </p>
      </form>
      {options.error && (
        <LoadError retry={() => setAttempt((x) => x + 1)}>{options.error}</LoadError>
      )}
      {entityId && (
        <p className="auth-notice">
          Historial del registro <code>{entityId}</code>{' '}
          <button className="text-link" onClick={() => filter({ entityId: '', page: '1' })}>
            Quitar filtro de registro
          </button>
        </p>
      )}
      {r.loading ? (
        <p className="directory-empty" role="status">
          Cargando auditoría…
        </p>
      ) : r.error ? (
        <LoadError retry={() => setAttempt((x) => x + 1)}>{r.error}</LoadError>
      ) : r.data?.items.length ? (
        <>
          <Table headers={['Fecha', 'Integrante', 'Acción', 'Registro', 'Resumen']}>
            {r.data.items.map((a) => (
              <tr key={a.id}>
                <td>
                  {stamp(a.createdAt)}
                  <small className="table-secondary">Evento {a.id}</small>
                </td>
                <td>{a.actorName ?? 'Sistema'}</td>
                <td className="audit-code">{a.action}</td>
                <td>
                  <strong>{a.entityType}</strong>
                  {a.entityId && (
                    <>
                      <code className="audit-id">{a.entityId}</code>
                      <button
                        className="record-link"
                        aria-label={`Ver historial del registro ${a.entityId}`}
                        onClick={() =>
                          filter({
                            entityId: a.entityId!,
                            entityType: a.entityType,
                            q: '',
                            page: '1',
                          })
                        }
                      >
                        Ver historial
                      </button>
                    </>
                  )}
                </td>
                <td>
                  <dl className="audit-summary">
                    {Object.entries(a.summary).map(([key, value]) => (
                      <div key={key}>
                        <dt>{summaryLabels[key] ?? key}</dt>
                        <dd>
                          {Array.isArray(value)
                            ? value.join(', ')
                            : typeof value === 'boolean'
                              ? value
                                ? 'Sí'
                                : 'No'
                              : String(value)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {!Object.keys(a.summary).length && (
                    <span className="record-help">Sin detalle adicional</span>
                  )}
                </td>
              </tr>
            ))}
          </Table>
          <Pager value={r.data} onPage={(page) => filter({ page: String(page) })} />
        </>
      ) : (
        <div className="directory-empty">
          <h2>No hay actividad con estos filtros</h2>
          <p>Cambia las fechas, acción o búsqueda.</p>
          {page > 1 && (
            <button className="text-link" onClick={() => filter({ page: '1' })}>
              Primera página
            </button>
          )}
        </div>
      )}
    </section>
  );
}
