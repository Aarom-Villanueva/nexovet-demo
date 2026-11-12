import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Package, Plus, Truck } from 'lucide-react';
import {
  purchaseStatusLabels,
  stockKindLabels,
  type ProductRecord,
  type SupplierRecord,
  type PageResult,
  type PurchaseRecord,
  type PurchaseDetail,
  type StockMovement,
  type InventoryStats,
} from '@nexovet/shared';
import { useAuth } from '../auth';
import { ApiError, useApi } from '../api';
import { Table } from '../components';
import { Dialog, ErrorNotice } from '../patients/Forms';
import { CatalogForm, PurchaseForm, AdjustmentForm } from './Forms';
import { useRead, LoadError, Pager, stamp, units, money, type Choice } from './common';
function MovementHistory({ id }: { id: string }) {
  const [page, setPage] = useState(1),
    [attempt, setAttempt] = useState(0);
  const r = useRead<PageResult<StockMovement>>(
    `/api/products/${id}/movements?page=${page}`,
    attempt,
  );
  return r.loading ? (
    <p role="status">Cargando movimientos…</p>
  ) : r.error ? (
    <LoadError retry={() => setAttempt((x) => x + 1)}>{r.error}</LoadError>
  ) : r.data ? (
    <>
      <ul className="stock-history">
        {r.data.items.map((m) => (
          <li key={m.id}>
            <div>
              <strong>{stockKindLabels[m.kind]}</strong>
              <b>
                {Number(m.quantity) > 0 ? '+' : ''}
                {units(m.quantity)}
              </b>
            </div>
            <p>{m.reason}</p>
            <small>
              {stamp(m.createdAt)} · {m.recordedByName}
              {m.purchaseNumber || m.saleNumber ? ` · ${m.purchaseNumber ?? m.saleNumber}` : ''}
            </small>
          </li>
        ))}
      </ul>
      {!r.data.total && <p className="record-help">Este producto aún no tiene movimientos.</p>}
      <Pager value={r.data} onPage={setPage} />
    </>
  ) : null;
}
function ProductDetails({
  record,
  onClose,
  onEdit,
  onAdjust,
  admin,
}: {
  record: ProductRecord;
  onClose: () => void;
  onEdit: () => void;
  onAdjust: () => void;
  admin: boolean;
}) {
  return (
    <Dialog title={record.name} onClose={onClose}>
      <div className="record-dialog-body">
        <div className="stock-summary">
          <Package size={28} />
          <div>
            <strong>{record.sku}</strong>
            <p>
              {record.categoryName ?? 'Sin categoría'} · {record.active ? 'Activo' : 'Archivado'}
            </p>
          </div>
          <b>{units(record.stock)} unidades</b>
        </div>
        <dl className="record-facts">
          <div>
            <dt>Precio de venta</dt>
            <dd>{money(record.salePrice)}</dd>
          </div>
          <div>
            <dt>Stock mínimo</dt>
            <dd>{units(record.minimumStock)}</dd>
          </div>
        </dl>
        <h3>Movimientos de existencias</h3>
        <p className="record-help">Entradas y salidas registradas, con su motivo y responsable.</p>
        <MovementHistory id={record.id} />
      </div>
      <div className="record-dialog-actions followup-actions">
        {admin && (
          <button className="secondary-button" onClick={onEdit}>
            Editar producto
          </button>
        )}
        {admin && record.active && (
          <button className="button" onClick={onAdjust}>
            Ajustar existencias
          </button>
        )}
        <button className="secondary-button" onClick={onClose}>
          Cerrar
        </button>
      </div>
    </Dialog>
  );
}
type CatalogModal =
  | { kind: 'new' }
  | { kind: 'edit'; record: ProductRecord | SupplierRecord }
  | { kind: 'product' | 'adjust'; record: ProductRecord };
export function InventoryBoard() {
  const api = useApi(),
    admin = useAuth().session!.user.role === 'admin',
    [params, setParams] = useSearchParams(),
    [attempt, setAttempt] = useState(0),
    [modal, setModal] = useState<CatalogModal | null>(null),
    [notice, setNotice] = useState(''),
    [openError, setOpenError] = useState('');
  const tab = params.get('tab') === 'suppliers' ? 'suppliers' : 'products',
    q = params.get('q') ?? '',
    status = params.get('status') ?? 'active',
    stock = params.get('stock') ?? 'all',
    category = params.get('category') ?? '';
  const raw = Number(params.get('page') ?? 1),
    page = Number.isInteger(raw) && raw >= 1 ? raw : 1;
  const [search, setSearch] = useState(q);
  useEffect(() => setSearch(q), [q]);
  const query = new URLSearchParams({
    q,
    status,
    page: String(page),
    ...(tab === 'products' ? { stock, ...(category ? { categoryId: category } : {}) } : {}),
  });
  const result = useRead<PageResult<ProductRecord | SupplierRecord>>(
      `/api/${tab}?${query}`,
      attempt,
    ),
    stats = useRead<InventoryStats>('/api/inventory/stats', attempt),
    categories = useRead<Choice[]>('/api/inventory/categories', attempt);
  function filter(v: Record<string, string>) {
    setParams({ tab, q, status, stock, category, page: String(page), ...v }, { replace: true });
  }
  async function open(id: string, edit = false) {
    setOpenError('');
    try {
      const record = await api<ProductRecord | SupplierRecord>(`/api/${tab}/${id}`);
      setModal(
        tab === 'suppliers' || edit
          ? { kind: 'edit', record }
          : { kind: 'product', record: record as ProductRecord },
      );
    } catch (e) {
      setOpenError((e as Error).message);
    }
  }
  function saved() {
    setModal(null);
    setAttempt((x) => x + 1);
    setNotice('Ficha guardada correctamente.');
  }
  return (
    <section className="patient-directory stock-page">
      <div className="directory-heading">
        <div>
          <span className="eyebrow">CADA UNIDAD CUENTA</span>
          <h1>{tab === 'products' ? 'Inventario' : 'Proveedores'}</h1>
          <p>
            {tab === 'products'
              ? 'Consulta productos, existencias y movimientos de tu almacén.'
              : 'Mantén los datos de quienes abastecen la veterinaria.'}
          </p>
        </div>
        {(admin || tab === 'suppliers') && (
          <button className="button" onClick={() => setModal({ kind: 'new' })}>
            <Plus size={16} />
            {tab === 'products' ? 'Nuevo producto' : 'Nuevo proveedor'}
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
      {stats.error ? (
        <LoadError retry={() => setAttempt((x) => x + 1)}>{stats.error}</LoadError>
      ) : (
        <div className="followup-metrics stock-metrics">
          {[
            ['Productos activos', stats.data?.active],
            ['Stock bajo', stats.data?.low],
            ['Sin existencias', stats.data?.empty],
          ].map(([label, value]) => (
            <article key={label}>
              <span>{label}</span>
              <strong>{stats.loading ? '…' : (value ?? '—')}</strong>
            </article>
          ))}
        </div>
      )}
      <div className="panel directory-panel">
        <div className="directory-tabs">
          <button
            className={tab === 'products' ? 'selected' : ''}
            aria-pressed={tab === 'products'}
            onClick={() => filter({ tab: 'products', q: '', page: '1' })}
          >
            Productos
          </button>
          <button
            className={tab === 'suppliers' ? 'selected' : ''}
            aria-pressed={tab === 'suppliers'}
            onClick={() => filter({ tab: 'suppliers', q: '', page: '1' })}
          >
            Proveedores
          </button>
        </div>
        <form
          className="directory-search"
          onSubmit={(e) => {
            e.preventDefault();
            filter({ q: search.trim(), page: '1' });
          }}
        >
          <input
            className="stock-search"
            aria-label={tab === 'products' ? 'Buscar productos' : 'Buscar proveedores'}
            type="search"
            placeholder={tab === 'products' ? 'Nombre o código SKU' : 'Nombre, RUC o contacto'}
            maxLength={100}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <label className="directory-status">
            <span>Estado</span>
            <select
              aria-label="Estado del catálogo"
              value={status}
              onChange={(e) => filter({ status: e.target.value, page: '1' })}
            >
              <option value="active">Activos</option>
              <option value="archived">Archivados</option>
              <option value="all">Todos</option>
            </select>
          </label>
          {tab === 'products' && (
            <>
              <label className="directory-status">
                <span>Existencias</span>
                <select
                  aria-label="Existencias"
                  value={stock}
                  onChange={(e) => filter({ stock: e.target.value, page: '1' })}
                >
                  <option value="all">Todas</option>
                  <option value="low">Stock bajo</option>
                  <option value="empty">Sin existencias</option>
                </select>
              </label>
              <label className="directory-status">
                <span>Categoría</span>
                <select
                  aria-label="Categoría de productos"
                  value={category}
                  onChange={(e) => filter({ category: e.target.value, page: '1' })}
                >
                  <option value="">Todas</option>
                  {categories.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          <button className="secondary-button">Buscar</button>
        </form>
        {tab === 'products' && categories.error && (
          <LoadError retry={() => setAttempt((x) => x + 1)}>{categories.error}</LoadError>
        )}
        {result.loading ? (
          <p role="status" className="directory-empty">
            Cargando catálogo…
          </p>
        ) : result.error ? (
          <LoadError retry={() => setAttempt((x) => x + 1)}>{result.error}</LoadError>
        ) : result.data?.items.length ? (
          <>
            {tab === 'products' ? (
              <Table headers={['Código', 'Producto', 'Precio', 'Disponible', 'Estado', 'Ficha']}>
                {(result.data.items as ProductRecord[]).map((p) => (
                  <tr key={p.id}>
                    <td className="code">{p.sku}</td>
                    <td>
                      <strong>{p.name}</strong>
                      <small className="table-secondary">{p.categoryName ?? 'Sin categoría'}</small>
                    </td>
                    <td>{money(p.salePrice)}</td>
                    <td>
                      {units(p.stock)}
                      <small className="table-secondary">Mínimo {units(p.minimumStock)}</small>
                    </td>
                    <td>
                      <span
                        className={`status ${!p.active ? 'status-cancelled' : p.lowStock || Number(p.stock) === 0 ? 'status-pending' : 'status-confirmed'}`}
                      >
                        {!p.active
                          ? 'Archivado'
                          : Number(p.stock) === 0
                            ? 'Sin existencias'
                            : p.lowStock
                              ? 'Stock bajo'
                              : 'Disponible'}
                      </span>
                    </td>
                    <td>
                      <button
                        className="record-link"
                        aria-label={`Ver producto ${p.sku}`}
                        onClick={() => void open(p.id)}
                      >
                        Ver movimientos
                      </button>
                    </td>
                  </tr>
                ))}
              </Table>
            ) : (
              <Table headers={['Proveedor', 'RUC', 'Contacto', 'Estado', 'Ficha']}>
                {(result.data.items as SupplierRecord[]).map((s) => (
                  <tr key={s.id}>
                    <td>
                      <strong>{s.name}</strong>
                      <small className="table-secondary">{s.address}</small>
                    </td>
                    <td>{s.taxId ?? 'Sin RUC'}</td>
                    <td>
                      {s.phone ?? 'Sin teléfono'}
                      <small className="table-secondary">{s.email}</small>
                    </td>
                    <td>{s.active ? 'Activo' : 'Archivado'}</td>
                    <td>
                      <button
                        className="record-link"
                        aria-label={`Editar proveedor ${s.name}`}
                        onClick={() => void open(s.id, true)}
                      >
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </Table>
            )}
            <Pager value={result.data} onPage={(page) => filter({ page: String(page) })} />
          </>
        ) : (
          <div className="directory-empty">
            <h2>No encontramos registros con estos filtros</h2>
            <p>Prueba otro nombre o cambia el estado.</p>
            {page > 1 && (
              <button className="text-link" onClick={() => filter({ page: '1' })}>
                Primera página
              </button>
            )}
          </div>
        )}
      </div>
      {(modal?.kind === 'new' || modal?.kind === 'edit') && (
        <CatalogForm
          key={modal.kind === 'edit' ? modal.record.id : 'new'}
          kind={tab}
          initial={modal.kind === 'edit' ? modal.record : undefined}
          onClose={() => setModal(null)}
          onSaved={saved}
        />
      )}
      {modal?.kind === 'product' && (
        <ProductDetails
          record={modal.record}
          admin={admin}
          onClose={() => setModal(null)}
          onEdit={() => setModal({ kind: 'edit', record: modal.record })}
          onAdjust={() => setModal({ kind: 'adjust', record: modal.record })}
        />
      )}
      {modal?.kind === 'adjust' && (
        <AdjustmentForm
          product={modal.record}
          onClose={() => void open(modal.record.id)}
          onSaved={() => {
            setAttempt((x) => x + 1);
            setNotice('Ajuste registrado correctamente.');
            void open(modal.record.id);
          }}
        />
      )}
    </section>
  );
}
function PurchaseDetails({
  record,
  onClose,
  onEdit,
  onUpdated,
  onReload,
}: {
  record: PurchaseDetail;
  onClose: () => void;
  onEdit: () => void;
  onUpdated: (v: PurchaseDetail) => void;
  onReload: () => void;
}) {
  const api = useApi(),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<ApiError | null>(null);
  async function action(action: 'receive' | 'cancel') {
    setBusy(true);
    setError(null);
    try {
      onUpdated(
        await api<PurchaseDetail>(`/api/purchases/${record.id}/${action}`, {
          method: 'POST',
          body: { version: record.version },
        }),
      );
      setConfirm(false);
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
          <Truck size={27} />
          <div>
            <strong>{record.supplierName}</strong>
            <p>
              {stamp(record.orderedAt)} · {record.createdByName}
            </p>
          </div>
          <span className={`status status-${record.status}`}>
            {purchaseStatusLabels[record.status]}
          </span>
        </div>
        {record.note && <p className="stock-note">{record.note}</p>}
        <div className="purchase-document">
          <Table headers={['Producto', 'Cantidad', 'Costo unitario', 'Importe']}>
            {record.lines.map((l) => (
              <tr key={l.id}>
                <td>
                  <strong>{l.productName}</strong>
                  <small className="table-secondary">
                    {l.sku}
                    {!l.productActive ? ' · Archivado' : ''}
                  </small>
                </td>
                <td>{units(l.quantity)}</td>
                <td>{money(l.unitCost)}</td>
                <td>{money(l.lineTotal)}</td>
              </tr>
            ))}
          </Table>
        </div>
        <p className="purchase-total">
          Total de productos <strong>{money(record.total)}</strong>
        </p>
        <p className="record-help">
          Total según cantidades y costos ingresados. No calcula impuestos, envío ni pagos al
          proveedor.
        </p>
        {record.receivedAt && (
          <p className="auth-notice">
            Recibida el {stamp(record.receivedAt)} por{' '}
            {record.receivedByName ?? 'Personal registrado'}. Las entradas ya forman parte del
            stock.
          </p>
        )}
        <ErrorNotice error={error} onReload={onReload} />
        {record.status === 'draft' && (
          <>
            {confirm ? (
              <div className="stock-receive-confirm">
                <h3>Confirmar ingreso al almacén</h3>
                <p>
                  Se registrarán completas las {record.lines.length} líneas de esta compra. Revisa
                  que coincidan con lo entregado por el proveedor. La recepción finaliza el
                  documento.
                </p>
                <button
                  className="button"
                  disabled={busy || error?.code === 'VERSION_CONFLICT'}
                  onClick={() => void action('receive')}
                >
                  {busy ? 'Registrando…' : 'Confirmar recepción'}
                </button>
                <button className="text-link" disabled={busy} onClick={() => setConfirm(false)}>
                  Volver a revisar
                </button>
              </div>
            ) : (
              <div className="appointment-actions">
                <button className="secondary-button" disabled={busy} onClick={onEdit}>
                  Editar borrador
                </button>
                <button
                  className="button"
                  disabled={busy || error?.code === 'VERSION_CONFLICT'}
                  onClick={() => setConfirm(true)}
                >
                  Recibir compra
                </button>
                <button
                  className="secondary-button"
                  disabled={busy || error?.code === 'VERSION_CONFLICT'}
                  onClick={() => void action('cancel')}
                >
                  Cancelar borrador
                </button>
              </div>
            )}
          </>
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
export function PurchaseBoard() {
  const api = useApi(),
    [params, setParams] = useSearchParams(),
    [attempt, setAttempt] = useState(0),
    [record, setRecord] = useState<PurchaseDetail | null>(null),
    [mode, setMode] = useState<'new' | 'edit' | 'details' | null>(null),
    [openError, setOpenError] = useState(''),
    [notice, setNotice] = useState('');
  const q = params.get('q') ?? '',
    status = params.get('status') ?? 'all',
    raw = Number(params.get('page') ?? 1),
    page = Number.isInteger(raw) && raw >= 1 ? raw : 1,
    [search, setSearch] = useState(q);
  useEffect(() => setSearch(q), [q]);
  const list = useRead<PageResult<PurchaseRecord>>(
    `/api/purchases?${new URLSearchParams({ q, status, page: String(page) })}`,
    attempt,
  );
  function filter(v: Record<string, string>) {
    setParams({ q, status, page: String(page), ...v }, { replace: true });
  }
  async function open(id: string) {
    setOpenError('');
    try {
      setRecord(await api<PurchaseDetail>(`/api/purchases/${id}`));
      setMode('details');
    } catch (e) {
      setOpenError((e as Error).message);
    }
  }
  function saved(r: PurchaseDetail) {
    setRecord(r);
    setMode('details');
    setAttempt((x) => x + 1);
    setNotice('Compra guardada correctamente.');
    if (mode === 'new') filter({ q: r.number, status: 'all', page: '1' });
  }
  return (
    <section className="patient-directory stock-page">
      <div className="directory-heading">
        <div>
          <span className="eyebrow">DEL PROVEEDOR AL ALMACÉN</span>
          <h1>Compras</h1>
          <p>Prepara tus compras y registra la mercadería cuando llegue.</p>
        </div>
        <button
          className="button"
          onClick={() => {
            setRecord(null);
            setMode('new');
          }}
        >
          <Plus size={16} />
          Nueva compra
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
      <div className="panel directory-panel">
        <form
          className="directory-search"
          onSubmit={(e) => {
            e.preventDefault();
            filter({ q: search.trim(), page: '1' });
          }}
        >
          <input
            type="search"
            className="stock-search"
            aria-label="Buscar compras"
            placeholder="Número o proveedor"
            maxLength={100}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <label className="directory-status">
            <span>Estado de compra</span>
            <select
              aria-label="Estado de compra"
              value={status}
              onChange={(e) => filter({ status: e.target.value, page: '1' })}
            >
              <option value="all">Todas</option>
              {Object.entries(purchaseStatusLabels).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <button className="secondary-button">Buscar</button>
        </form>
        {list.loading ? (
          <p className="directory-empty" role="status">
            Cargando compras…
          </p>
        ) : list.error ? (
          <LoadError retry={() => setAttempt((x) => x + 1)}>{list.error}</LoadError>
        ) : list.data?.items.length ? (
          <>
            <Table
              headers={['Número', 'Proveedor', 'Fecha', 'Productos', 'Total', 'Estado', 'Ficha']}
            >
              {list.data.items.map((r) => (
                <tr key={r.id}>
                  <td className="code">{r.number}</td>
                  <td>{r.supplierName}</td>
                  <td>{stamp(r.orderedAt)}</td>
                  <td>{r.lineCount}</td>
                  <td>{money(r.total)}</td>
                  <td>
                    <span className={`status status-${r.status}`}>
                      {purchaseStatusLabels[r.status]}
                    </span>
                  </td>
                  <td>
                    <button
                      className="record-link"
                      aria-label={`Abrir compra ${r.number}`}
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
            <h2>No hay compras con estos filtros</h2>
            <p>Prueba otro estado o prepara una compra.</p>
            {page > 1 && (
              <button className="text-link" onClick={() => filter({ page: '1' })}>
                Primera página
              </button>
            )}
          </div>
        )}
      </div>
      {(mode === 'new' || mode === 'edit') && (
        <PurchaseForm
          key={record?.id ?? 'new'}
          initial={mode === 'edit' ? record! : undefined}
          onClose={() => setMode(record ? 'details' : null)}
          onSaved={saved}
        />
      )}
      {mode === 'details' && record && (
        <PurchaseDetails
          key={`${record.id}-${record.version}`}
          record={record}
          onClose={() => setMode(null)}
          onEdit={() => setMode('edit')}
          onUpdated={saved}
          onReload={() => void open(record.id)}
        />
      )}
    </section>
  );
}
