import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, ReceiptText } from 'lucide-react';
import {
  saleStatusLabels,
  paymentMethodLabels,
  type SaleRecord,
  type SaleDetail,
  type PageResult,
  type ClientRecord,
} from '@nexovet/shared';
import { useApi, ApiError } from '../api';
import { Dialog, ErrorNotice } from '../patients/Forms';
import { Table } from '../components';
import { useRead, LoadError, Pager, money, units, stamp } from '../inventory/common';
import { SaleForm, ConfirmSaleForm } from './Forms';
function SaleDetails({
  record,
  onClose,
  onEdit,
  onConfirm,
  onSaved,
  onReload,
}: {
  record: SaleDetail;
  onClose: () => void;
  onEdit: () => void;
  onConfirm: () => void;
  onSaved: (r: SaleDetail) => void;
  onReload: () => void;
}) {
  const api = useApi(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<ApiError | null>(null);
  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await api<SaleDetail>(`/api/sales/${record.id}/cancel`, {
          method: 'POST',
          body: { version: record.version },
        }),
      );
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={record.number} onClose={onClose} busy={busy}>
      <div className="record-dialog-body">
        <div className="stock-summary">
          <ReceiptText size={27} />
          <div>
            <strong>{record.clientName ?? 'Sin cliente asociado'}</strong>
            <p>
              {stamp(record.createdAt)} · {record.createdByName}
            </p>
          </div>
          <span className={`status status-${record.status}`}>
            {saleStatusLabels[record.status]}
          </span>
        </div>
        {record.note && <p className="stock-note">{record.note}</p>}
        <div className="purchase-document">
          <Table headers={['Concepto', 'Cantidad', 'Precio unitario', 'Importe']}>
            {record.lines.map((l) => (
              <tr key={l.id}>
                <td>
                  <strong>{l.description}</strong>
                  <small className="table-secondary">
                    {l.sku ?? 'Servicio'}
                    {!l.active ? ' · Archivado' : ''}
                  </small>
                </td>
                <td>{units(l.quantity)}</td>
                <td>{money(l.unitPrice)}</td>
                <td>{money(l.lineTotal)}</td>
              </tr>
            ))}
          </Table>
        </div>
        <p className="purchase-total">
          Total de la venta <strong>{money(record.total)}</strong>
        </p>
        <p className="record-help">
          Registro interno en soles. No sustituye una boleta o factura electrónica ni calcula
          impuestos adicionales.
        </p>
        <ErrorNotice error={error} onReload={onReload} />
        {record.status === 'draft' ? (
          <>
            <p className="auth-notice">
              El borrador no reserva existencias. Al confirmar se verificará el stock disponible.
            </p>
            <div className="appointment-actions">
              <button className="secondary-button" disabled={busy} onClick={onEdit}>
                Editar venta
              </button>
              <button
                className="button"
                disabled={busy || error?.code === 'VERSION_CONFLICT'}
                onClick={onConfirm}
              >
                Registrar cobros y confirmar
              </button>
              <button
                className="secondary-button"
                disabled={busy || error?.code === 'VERSION_CONFLICT'}
                onClick={() => void cancel()}
              >
                Cancelar venta
              </button>
            </div>
          </>
        ) : record.status === 'confirmed' ? (
          <>
            <p className="auth-notice">
              Confirmada el {stamp(record.confirmedAt!)} por {record.confirmedByName}. Las salidas y
              cobros ya están registrados.
            </p>
            <h3 className="followup-subtitle">Cobros registrados</h3>
            {record.payments.length ? (
              <ul className="stock-history">
                {record.payments.map((p) => (
                  <li key={p.id}>
                    <div>
                      <strong>{paymentMethodLabels[p.method]}</strong>
                      <b>{money(p.amount)}</b>
                    </div>
                    {p.reference && <p>Referencia: {p.reference}</p>}
                    <small>
                      {stamp(p.paidAt)} · {p.recordedByName}
                    </small>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="record-help">Venta con total cero, sin cobros.</p>
            )}
            <p className="purchase-total">
              Total registrado <strong>{money(record.paid)}</strong>
            </p>
          </>
        ) : (
          <p className="auth-notice">
            Venta cancelada. No se registraron cobros ni salidas de stock.
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
function ClientFilter({ id, onClear }: { id: string; onClear: () => void }) {
  const client = useRead<ClientRecord>(`/api/clients/${id}`);
  return (
    <div className="sale-client-filter">
      <span>Ventas de {client.data?.name ?? 'este cliente'}</span>
      <button className="text-link" onClick={onClear}>
        Ver todos los clientes
      </button>
      {client.error && <small>No pudimos cargar su ficha. Puedes quitar el filtro.</small>}
    </div>
  );
}
export function SalesBoard() {
  const api = useApi(),
    [params, setParams] = useSearchParams(),
    [attempt, setAttempt] = useState(0),
    [record, setRecord] = useState<SaleDetail | null>(null),
    [mode, setMode] = useState<'new' | 'edit' | 'confirm' | 'details' | null>(null),
    [notice, setNotice] = useState(''),
    [openError, setOpenError] = useState('');
  const q = params.get('q') ?? '',
    status = params.get('status') ?? 'all',
    clientId = params.get('clientId') ?? '',
    raw = Number(params.get('page') ?? 1),
    page = Number.isInteger(raw) && raw >= 1 ? raw : 1,
    [search, setSearch] = useState(q);
  useEffect(() => setSearch(q), [q]);
  const query = new URLSearchParams({
      q,
      status,
      page: String(page),
      ...(clientId ? { clientId } : {}),
    }),
    list = useRead<PageResult<SaleRecord>>(`/api/sales?${query}`, attempt);

  function filter(v: Record<string, string>) {
    setParams(
      { q, status, page: String(page), ...(clientId ? { clientId } : {}), ...v },
      { replace: true },
    );
  }
  async function open(id: string) {
    setOpenError('');
    try {
      setRecord(await api<SaleDetail>(`/api/sales/${id}`));
      setMode('details');
    } catch (e) {
      setOpenError((e as Error).message);
    }
  }
  function saved(r: SaleDetail) {
    setRecord(r);
    setMode('details');
    setAttempt((x) => x + 1);
    setNotice(
      r.status === 'confirmed'
        ? 'Venta confirmada. Cobros y salidas registrados.'
        : r.status === 'cancelled'
          ? 'Venta cancelada.'
          : 'Venta guardada correctamente.',
    );
    if (mode === 'new')
      filter({
        q: r.number,
        status: 'all',
        page: '1',
        ...(clientId && r.clientId !== clientId ? { clientId: '' } : {}),
      });
  }
  return (
    <section className="patient-directory stock-page">
      <div className="directory-heading">
        <div>
          <span className="eyebrow">UNA VENTA, TODO REGISTRADO</span>
          <h1>Ventas y cobros</h1>
          <p>Prepara ventas, registra los pagos recibidos y consulta cada operación.</p>
        </div>
        <button
          className="button"
          onClick={() => {
            setRecord(null);
            setMode('new');
          }}
        >
          <Plus size={16} />
          Nueva venta
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
      {clientId && (
        <ClientFilter id={clientId} onClear={() => filter({ clientId: '', page: '1', q: '' })} />
      )}
      <div className="panel directory-panel">
        <form
          className="directory-search"
          onSubmit={(e) => {
            e.preventDefault();
            filter({ q: search.trim(), page: '1' });
          }}
        >
          <input
            className="stock-search"
            type="search"
            aria-label="Buscar ventas"
            placeholder="Número o cliente"
            value={search}
            maxLength={100}
            onChange={(e) => setSearch(e.target.value)}
          />
          <label className="directory-status">
            <span>Estado de venta</span>
            <select
              aria-label="Estado de venta"
              value={status}
              onChange={(e) => filter({ status: e.target.value, page: '1' })}
            >
              <option value="all">Todas</option>
              {Object.entries(saleStatusLabels).map(([v, label]) => (
                <option value={v} key={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button className="secondary-button">Buscar</button>
        </form>
        {list.loading ? (
          <p className="directory-empty" role="status">
            Cargando ventas…
          </p>
        ) : list.error ? (
          <LoadError retry={() => setAttempt((x) => x + 1)}>{list.error}</LoadError>
        ) : list.data?.items.length ? (
          <>
            <Table
              headers={['Número', 'Cliente', 'Fecha', 'Conceptos', 'Total', 'Estado', 'Ficha']}
            >
              {list.data.items.map((r) => (
                <tr key={r.id}>
                  <td className="code">{r.number}</td>
                  <td>{r.clientName ?? 'Sin cliente asociado'}</td>
                  <td>{stamp(r.createdAt)}</td>
                  <td>{r.lineCount}</td>
                  <td>{money(r.total)}</td>
                  <td>
                    <span className={`status status-${r.status}`}>
                      {saleStatusLabels[r.status]}
                    </span>
                  </td>
                  <td>
                    <button
                      className="record-link"
                      aria-label={`Abrir venta ${r.number}`}
                      onClick={() => void open(r.id)}
                    >
                      Abrir
                    </button>
                  </td>
                </tr>
              ))}
            </Table>
            <Pager value={list.data} onPage={(page) => filter({ page: String(page) })} />
          </>
        ) : (
          <div className="directory-empty">
            <h2>No hay ventas con estos filtros</h2>
            <p>Prueba otro estado o prepara una venta.</p>
            {page > 1 && (
              <button className="text-link" onClick={() => filter({ page: '1' })}>
                Primera página
              </button>
            )}
          </div>
        )}
      </div>
      {(mode === 'new' || mode === 'edit') && (
        <SaleForm
          key={record?.id ?? 'new'}
          initial={mode === 'edit' ? record! : undefined}
          onClose={() => (record ? void open(record.id) : setMode(null))}
          onSaved={saved}
        />
      )}
      {mode === 'confirm' && record && (
        <ConfirmSaleForm initial={record} onClose={() => void open(record.id)} onSaved={saved} />
      )}
      {mode === 'details' && record && (
        <SaleDetails
          key={`${record.id}-${record.version}`}
          record={record}
          onClose={() => setMode(null)}
          onEdit={() => setMode('edit')}
          onConfirm={() => setMode('confirm')}
          onSaved={saved}
          onReload={() => void open(record.id)}
        />
      )}
    </section>
  );
}
