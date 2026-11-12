import { useState, type FormEvent } from 'react';
import type {
  ProductRecord,
  SupplierRecord,
  PurchaseDetail,
  PurchaseInput,
  StockAdjustmentInput,
  StockMovement,
} from '@nexovet/shared';
import { Dialog, Field, ErrorNotice } from '../patients/Forms';
import { useApi, ApiError } from '../api';
import { Lookup, useRead, LoadError, units, type Choice } from './common';
export function CatalogForm({
  kind,
  initial,
  onClose,
  onSaved,
}: {
  kind: 'products' | 'suppliers';
  initial?: ProductRecord | SupplierRecord;
  onClose: () => void;
  onSaved: () => void;
}) {
  const api = useApi(),
    [record, setRecord] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<ApiError | null>(null),
    [attempt, setAttempt] = useState(0);
  const categories = useRead<Choice[]>('/api/inventory/categories', attempt),
    isProduct = kind === 'products';
  const p = record as ProductRecord | undefined,
    s = record as SupplierRecord | undefined;
  async function reload() {
    setBusy(true);
    try {
      setRecord(await api<ProductRecord | SupplierRecord>(`/api/${kind}/${record!.id}`));
      setError(null);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const text = (n: string) => String(f.get(n) ?? '').trim();
    const body = isProduct
      ? {
          sku: text('sku'),
          name: text('name'),
          categoryId: text('categoryId') || null,
          salePrice: text('salePrice'),
          minimumStock: text('minimumStock'),
          active: text('active') === 'true',
        }
      : {
          name: text('name'),
          taxId: text('taxId') || null,
          email: text('email') || null,
          phone: text('phone') || null,
          address: text('address') || null,
          active: text('active') === 'true',
        };
    setBusy(true);
    setError(null);
    try {
      await api(`/api/${kind}${record ? `/${record.id}` : ''}`, {
        method: record ? 'PUT' : 'POST',
        body: { ...body, ...(record ? { version: record.version } : {}) },
      });
      onSaved();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }
  const field = (
    name: string,
    label: string,
    value: string | null | undefined,
    type = 'text',
    maxLength = 150,
  ) => (
    <Field key={name} name={name} label={label} error={error?.fields[name]} wide>
      {(props) => (
        <input
          {...props}
          name={name}
          defaultValue={value ?? ''}
          type={type}
          required={['name', 'sku', 'salePrice', 'minimumStock'].includes(name)}
          maxLength={maxLength}
          inputMode={['salePrice', 'minimumStock'].includes(name) ? 'decimal' : undefined}
        />
      )}
    </Field>
  );
  return (
    <Dialog
      title={`${record ? 'Editar' : 'Nuevo'} ${isProduct ? 'producto' : 'proveedor'}`}
      onClose={onClose}
      busy={busy}
    >
      <form onSubmit={(e) => void submit(e)}>
        <div className="record-dialog-body">
          <p className="record-help">
            Los campos con * son obligatorios.
            {isProduct
              ? ' El saldo se registra con compras o ajustes, por separado.'
              : ' El RUC es opcional; no se valida su vigencia en SUNAT.'}
          </p>
          <ErrorNotice error={error} onReload={() => void reload()} />
          {isProduct && categories.error && (
            <LoadError retry={() => setAttempt((x) => x + 1)}>{categories.error}</LoadError>
          )}
          <fieldset
            key={`${record?.version ?? 0}-${isProduct && categories.loading ? 'loading' : 'ready'}`}
            className="record-grid"
            disabled={busy || (isProduct && !categories.data)}
          >
            {isProduct && field('sku', 'Código SKU *', p?.sku)}
            {field(
              'name',
              isProduct ? 'Nombre del producto *' : 'Nombre del proveedor *',
              record?.name,
            )}
            {isProduct ? (
              <>
                <Field name="categoryId" label="Categoría" wide>
                  {(props) => (
                    <select {...props} name="categoryId" defaultValue={p?.categoryId ?? ''}>
                      <option value="">Sin categoría</option>
                      {categories.data?.map((c) => (
                        <option value={c.id} key={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                {field('salePrice', 'Precio de venta (S/) *', p?.salePrice ?? '0', 'text', 13)}
                {field('minimumStock', 'Stock mínimo *', p?.minimumStock ?? '0', 'text', 13)}
              </>
            ) : (
              <>
                {field('taxId', 'RUC', s?.taxId, 'text', 11)}
                {field('email', 'Correo del proveedor', s?.email, 'email', 254)}
                {field('phone', 'Teléfono del proveedor', s?.phone, 'tel', 30)}
                {field('address', 'Dirección del proveedor', s?.address, 'text', 300)}
              </>
            )}
            <Field name="active" label="Estado de la ficha" wide>
              {(props) => (
                <select {...props} name="active" defaultValue={String(record?.active ?? true)}>
                  <option value="true">Activo</option>
                  <option value="false">Archivado</option>
                </select>
              )}
            </Field>
          </fieldset>
        </div>
        <div className="record-dialog-actions">
          <button className="secondary-button" type="button" disabled={busy} onClick={onClose}>
            Cancelar
          </button>
          <button
            className="button"
            disabled={busy || (isProduct && !categories.data) || error?.code === 'VERSION_CONFLICT'}
          >
            {busy ? 'Guardando…' : 'Guardar ficha'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
type DraftLine = {
  productId: string;
  name: string;
  sku: string;
  quantity: string;
  unitCost: string;
};
export function PurchaseForm({
  initial,
  onClose,
  onSaved,
}: {
  initial?: PurchaseDetail;
  onClose: () => void;
  onSaved: (v: PurchaseDetail) => void;
}) {
  const api = useApi(),
    [record, setRecord] = useState(initial),
    [supplier, setSupplier] = useState<Choice | null>(
      initial ? { id: initial.supplierId, name: initial.supplierName } : null,
    ),
    [note, setNote] = useState(initial?.note ?? ''),
    [lines, setLines] = useState<DraftLine[]>(
      initial?.lines.map((l) => ({ ...l, name: l.productName })) ?? [],
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<ApiError | null>(null),
    [requestId, setRequestId] = useState(() => crypto.randomUUID()),
    [pending, setPending] = useState<(PurchaseInput & { requestId: string }) | null>(null);
  async function reload() {
    setBusy(true);
    try {
      const r = await api<PurchaseDetail>(`/api/purchases/${record!.id}`);
      setRecord(r);
      setSupplier({ id: r.supplierId, name: r.supplierName });
      setLines(r.lines.map((l) => ({ ...l, name: l.productName })));
      setNote(r.note);
      setError(null);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!supplier || !lines.length) {
      setError(new ApiError('Selecciona un proveedor y agrega al menos un producto.', 400));
      return;
    }
    const body: PurchaseInput = {
      supplierId: supplier.id,
      note,
      lines: lines.map(({ productId, quantity, unitCost }) => ({ productId, quantity, unitCost })),
    };
    const payload =
      pending ?? (record ? { ...body, version: record.version } : { ...body, requestId });
    if (!record) setPending(payload as PurchaseInput & { requestId: string });
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await api<PurchaseDetail>(record ? `/api/purchases/${record.id}` : '/api/purchases', {
          method: record ? 'PUT' : 'POST',
          body: payload,
        }),
      );
    } catch (e) {
      const issue = e as ApiError;
      setError(issue);
      if (issue.status >= 400 && issue.status < 500) {
        setPending(null);
        setRequestId(crypto.randomUUID());
      }
    } finally {
      setBusy(false);
    }
  }
  function add(v: Choice | null) {
    if (!v) return;
    if (lines.some((l) => l.productId === v.id)) {
      setError(new ApiError('Ese producto ya está agregado. Cambia su cantidad en la línea.', 400));
      return;
    }
    setLines([
      ...lines,
      { productId: v.id, name: v.name, sku: v.sku!, quantity: '1', unitCost: '0' },
    ]);
    setError(null);
  }
  return (
    <Dialog title={record ? 'Editar borrador' : 'Nueva compra'} onClose={onClose} busy={busy}>
      <form onSubmit={(e) => void submit(e)}>
        <div className="record-dialog-body">
          <p className="record-help">
            Guarda los productos y costos acordados. El borrador no modifica existencias.
            Cantidades: hasta 3 decimales; costos: hasta 2, con punto.
          </p>
          <ErrorNotice error={error} onReload={record ? () => void reload() : undefined} />
          {error && Object.keys(error.fields).length > 0 && (
            <ul className="auth-error">
              {[...new Set(Object.values(error.fields))].map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
          {pending && !busy && (
            <p className="auth-notice" role="status">
              El resultado no pudo confirmarse. Reintenta los mismos datos para evitar otra compra.
            </p>
          )}
          {record && record.status !== 'draft' && (
            <p className="auth-notice">Esta compra ya finalizó y es de solo lectura.</p>
          )}
          <fieldset
            className="stock-purchase-fields"
            disabled={busy || !!pending || (!!record && record.status !== 'draft')}
          >
            <Lookup kind="suppliers" selected={supplier} onSelect={setSupplier} />
            <label className="stock-label">
              Nota de la compra
              <textarea
                aria-label="Nota de la compra"
                value={note}
                maxLength={1000}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
              />
            </label>
            <h3>Productos de la compra</h3>
            {lines.map((l, i) => (
              <div className="purchase-line-editor" key={l.productId}>
                <div>
                  <strong>{l.name}</strong>
                  <small>{l.sku}</small>
                </div>
                <Field name={`quantity${i}`} label={`Cantidad de ${l.sku} *`}>
                  {(props) => (
                    <input
                      {...props}
                      required
                      inputMode="decimal"
                      value={l.quantity}
                      maxLength={13}
                      onChange={(e) =>
                        setLines(
                          lines.map((row, j) =>
                            i === j ? { ...row, quantity: e.target.value } : row,
                          ),
                        )
                      }
                    />
                  )}
                </Field>
                <Field name={`cost${i}`} label={`Costo de ${l.sku} (S/) *`}>
                  {(props) => (
                    <input
                      {...props}
                      required
                      inputMode="decimal"
                      value={l.unitCost}
                      maxLength={13}
                      onChange={(e) =>
                        setLines(
                          lines.map((row, j) =>
                            i === j ? { ...row, unitCost: e.target.value } : row,
                          ),
                        )
                      }
                    />
                  )}
                </Field>
                <button
                  className="text-link"
                  type="button"
                  aria-label={`Quitar producto ${l.sku}`}
                  onClick={() => setLines(lines.filter((_, j) => i !== j))}
                >
                  Quitar
                </button>
              </div>
            ))}
            {lines.length < 40 && <Lookup kind="products" selected={null} onSelect={add} />}
            <p className="record-help">
              Máximo 40 productos distintos. El total se calcula al guardar; el costo no cambia el
              precio de venta del catálogo.
            </p>
          </fieldset>
        </div>
        <div className="record-dialog-actions">
          <button className="secondary-button" type="button" disabled={busy} onClick={onClose}>
            Cancelar
          </button>
          <button
            className="button"
            disabled={
              busy || error?.code === 'VERSION_CONFLICT' || (!!record && record.status !== 'draft')
            }
          >
            {busy ? 'Guardando…' : pending ? 'Reintentar compra' : 'Guardar borrador'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
export function AdjustmentForm({
  product,
  onClose,
  onSaved,
}: {
  product: ProductRecord;
  onClose: () => void;
  onSaved: () => void;
}) {
  const api = useApi(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<ApiError | null>(null),
    [pending, setPending] = useState<StockAdjustmentInput | null>(null),
    [requestId, setRequestId] = useState(() => crypto.randomUUID());
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = pending ?? {
      requestId,
      quantity: String(f.get('quantity')),
      reason: String(f.get('reason')),
    };
    setBusy(true);
    setPending(body);
    setError(null);
    try {
      await api<StockMovement>(`/api/products/${product.id}/adjustments`, { method: 'POST', body });
      onSaved();
    } catch (e) {
      const issue = e as ApiError;
      setError(issue);
      if (issue.status >= 400 && issue.status < 500) {
        setPending(null);
        setRequestId(crypto.randomUUID());
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Ajustar existencias" onClose={onClose} busy={busy}>
      <form onSubmit={(e) => void submit(e)}>
        <div className="record-dialog-body">
          <p>
            <strong>{product.name}</strong> · {product.sku}
          </p>
          <p className="auth-notice">
            Saldo al abrir: {units(product.stock)}. Usa un valor positivo para ingresar unidades o
            negativo para retirarlas. El ajuste se aplica al saldo disponible al guardar.
          </p>
          <ErrorNotice error={error} />
          {pending && !busy && (
            <p role="status" className="auth-notice">
              Reintenta con los mismos datos; el resultado anterior no pudo confirmarse.
            </p>
          )}
          <fieldset className="record-grid" disabled={busy || !!pending}>
            <Field
              name="quantity"
              label="Variación de unidades *"
              error={error?.fields.quantity}
              wide
            >
              {(props) => (
                <input
                  {...props}
                  name="quantity"
                  required
                  inputMode="decimal"
                  placeholder="Ej.: -2 o 3.5"
                  maxLength={14}
                />
              )}
            </Field>
            <Field name="reason" label="Motivo del ajuste *" error={error?.fields.reason} wide>
              {(props) => (
                <textarea
                  {...props}
                  name="reason"
                  required
                  minLength={5}
                  maxLength={500}
                  rows={3}
                />
              )}
            </Field>
          </fieldset>
        </div>
        <div className="record-dialog-actions">
          <button className="secondary-button" type="button" disabled={busy} onClick={onClose}>
            Cancelar
          </button>
          <button className="button" disabled={busy}>
            {busy ? 'Guardando…' : pending ? 'Reintentar ajuste' : 'Registrar ajuste'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
