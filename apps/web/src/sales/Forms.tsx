import { useEffect, useState, type FormEvent } from 'react';
import {
  paymentMethodLabels,
  type SaleDetail,
  type SaleInput,
  type SaleLineInput,
  type SaleConfirmInput,
  type PaymentInput,
  type SaleItemKind,
} from '@nexovet/shared';
import { useApi, ApiError } from '../api';
import { Dialog, Field, ErrorNotice } from '../patients/Forms';
import { LoadError, money, units } from '../inventory/common';
type Choice = {
  id: string;
  name: string;
  sku?: string | null;
  price?: string;
  stock?: string | null;
  documentNumber?: string | null;
};
export function SalesSearch({
  kind,
  onSelect,
}: {
  kind: SaleItemKind | 'client';
  onSelect: (v: Choice) => void;
}) {
  const api = useApi(),
    [q, setQ] = useState(''),
    [items, setItems] = useState<Choice[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0);
  const noun = kind === 'product' ? 'producto' : kind === 'service' ? 'servicio' : 'cliente';
  useEffect(() => {
    if (q.trim().length < 2) {
      setItems([]);
      setBusy(false);
      return;
    }
    const c = new AbortController();
    setBusy(true);
    setError('');
    const timer = setTimeout(() => {
      void api<Choice[]>(
        kind === 'client'
          ? `/api/sales/clients?q=${encodeURIComponent(q.trim())}`
          : `/api/sales/items?kind=${kind}&q=${encodeURIComponent(q.trim())}`,
        { signal: c.signal },
      )
        .then((v) => {
          if (!c.signal.aborted) setItems(v);
        })
        .catch((e) => {
          if (!c.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!c.signal.aborted) setBusy(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [api, q, kind, attempt]);
  return (
    <div className="stock-lookup">
      <label>
        Buscar {noun}
        <input
          aria-label={`Buscar ${noun} de venta`}
          value={q}
          maxLength={100}
          placeholder={
            kind === 'client'
              ? 'Nombre, documento o contacto'
              : kind === 'product'
                ? 'Nombre o SKU'
                : 'Nombre del servicio'
          }
          onChange={(e) => {
            setQ(e.target.value);
            setItems([]);
          }}
        />
      </label>
      <p className="record-help">Escribe al menos dos caracteres y elige una opción activa.</p>
      {error ? (
        <LoadError retry={() => setAttempt((x) => x + 1)}>{error}</LoadError>
      ) : busy ? (
        <p role="status">Buscando…</p>
      ) : (
        <ul className="owner-results">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                aria-label={`Agregar ${noun} ${item.name}`}
                onClick={() => {
                  onSelect(item);
                  setQ('');
                  setItems([]);
                }}
              >
                <strong>{item.name}</strong>
                <small>
                  {kind === 'client'
                    ? (item.documentNumber ?? `Ref. ${item.id.slice(-8)}`)
                    : `${item.sku ?? 'Servicio'} · ${money(item.price!)}${item.stock !== null && item.stock !== undefined ? ` · Stock ${units(item.stock)}` : ''}`}
                </small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!busy && !error && q.trim().length >= 2 && !items.length && (
        <p className="record-help">No encontramos coincidencias activas.</p>
      )}
    </div>
  );
}
function FieldErrors({ error }: { error: ApiError | null }) {
  return error && Object.keys(error.fields).length ? (
    <ul className="auth-error">
      {[...new Set(Object.values(error.fields))].map((m) => (
        <li key={m}>{m}</li>
      ))}
    </ul>
  ) : null;
}
type DraftLine = SaleLineInput & { name: string; sku: string | null; price: string };
export function SaleForm({
  initial,
  onClose,
  onSaved,
}: {
  initial?: SaleDetail;
  onClose: () => void;
  onSaved: (r: SaleDetail) => void;
}) {
  const api = useApi(),
    [record, setRecord] = useState(initial),
    [client, setClient] = useState<Choice | null>(
      initial?.clientId ? { id: initial.clientId, name: initial.clientName! } : null,
    ),
    [clientSearch, setClientSearch] = useState(false),
    [note, setNote] = useState(initial?.note ?? ''),
    [kind, setKind] = useState<SaleItemKind>('product'),
    [lines, setLines] = useState<DraftLine[]>(
      initial?.lines.map((l) => ({ ...l, name: l.description, price: l.unitPrice })) ?? [],
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<ApiError | null>(null),
    [requestId, setRequestId] = useState(() => crypto.randomUUID()),
    [pending, setPending] = useState<(SaleInput & { requestId: string }) | null>(null);
  async function reload() {
    setBusy(true);
    try {
      const r = await api<SaleDetail>(`/api/sales/${record!.id}`);
      if (r.status !== 'draft') {
        onSaved(r);
        return;
      }
      setRecord(r);
      setClient(r.clientId ? { id: r.clientId, name: r.clientName! } : null);
      setLines(r.lines.map((l) => ({ ...l, name: l.description, price: l.unitPrice })));
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
    if (!lines.length) {
      setError(new ApiError('Agrega al menos un producto o servicio.', 400));
      return;
    }
    const b: SaleInput = {
      clientId: client?.id ?? null,
      note,
      lines: lines.map(({ kind, itemId, quantity }) => ({ kind, itemId, quantity })),
    };
    const payload = pending ?? (record ? { ...b, version: record.version } : { ...b, requestId });
    if (!record) setPending(payload as SaleInput & { requestId: string });
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await api<SaleDetail>(record ? `/api/sales/${record.id}` : '/api/sales', {
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
  function add(v: Choice) {
    if (lines.some((l) => l.kind === kind && l.itemId === v.id)) {
      setError(new ApiError('Ese concepto ya está agregado. Cambia la cantidad de su línea.', 400));
      return;
    }
    setLines([
      ...lines,
      { kind, itemId: v.id, quantity: '1', name: v.name, sku: v.sku ?? null, price: v.price! },
    ]);
    setError(null);
  }
  return (
    <Dialog title={record ? 'Editar venta' : 'Nueva venta'} onClose={onClose} busy={busy}>
      <form onSubmit={(e) => void submit(e)}>
        <div className="record-dialog-body">
          <p className="record-help">
            El borrador no reserva ni descuenta stock. Al guardar se aplican los precios actuales
            del catálogo; revisa el total antes de confirmar.
          </p>
          <ErrorNotice error={error} onReload={record ? () => void reload() : undefined} />
          <FieldErrors error={error} />
          {pending && !busy && (
            <p className="auth-notice" role="status">
              No pudimos confirmar el resultado. Reintenta los mismos datos para evitar otra venta.
            </p>
          )}
          <fieldset className="stock-purchase-fields" disabled={busy || !!pending}>
            <div className="sale-client">
              <strong>Cliente</strong>
              {client ? (
                <div className="selected-owner">
                  <div>
                    <strong>{client.name}</strong>
                  </div>
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => {
                      setClient(null);
                      setClientSearch(false);
                    }}
                  >
                    Quitar cliente
                  </button>
                </div>
              ) : (
                <>
                  <p className="record-help">Sin cliente asociado.</p>
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => setClientSearch((x) => !x)}
                  >
                    {clientSearch ? 'Cerrar búsqueda' : 'Asociar cliente'}
                  </button>
                  {clientSearch && (
                    <SalesSearch
                      kind="client"
                      onSelect={(v) => {
                        setClient(v);
                        setClientSearch(false);
                      }}
                    />
                  )}
                </>
              )}
            </div>
            <label className="stock-label">
              Nota de la venta
              <textarea
                aria-label="Nota de la venta"
                value={note}
                maxLength={1000}
                rows={2}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <h3>Productos y servicios</h3>
            {lines.map((l, i) => (
              <div key={`${l.kind}:${l.itemId}`} className="purchase-line-editor sale-line-editor">
                <div>
                  <strong>{l.name}</strong>
                  <small>
                    {l.sku ?? 'Servicio'} · Precio de referencia {money(l.price)}
                  </small>
                </div>
                <Field name={`quantity${i}`} label={`Cantidad de ${l.sku ?? l.name} *`}>
                  {(props) => (
                    <input
                      {...props}
                      required
                      inputMode={l.kind === 'service' ? 'numeric' : 'decimal'}
                      value={l.quantity}
                      maxLength={13}
                      onChange={(e) =>
                        setLines(
                          lines.map((row, j) =>
                            j === i ? { ...row, quantity: e.target.value } : row,
                          ),
                        )
                      }
                    />
                  )}
                </Field>
                <button
                  type="button"
                  className="text-link"
                  aria-label={`Quitar concepto ${l.sku ?? l.name}`}
                  onClick={() => setLines(lines.filter((_, j) => j !== i))}
                >
                  Quitar
                </button>
              </div>
            ))}
            {lines.length < 40 && (
              <>
                <Field name="kind" label="Agregar a la venta" wide>
                  {(props) => (
                    <select
                      {...props}
                      value={kind}
                      onChange={(e) => setKind(e.target.value as SaleItemKind)}
                    >
                      <option value="product">Producto</option>
                      <option value="service">Servicio</option>
                    </select>
                  )}
                </Field>
                <SalesSearch key={kind} kind={kind} onSelect={add} />
              </>
            )}
            <p className="record-help">
              Hasta 40 conceptos distintos. Productos: hasta 3 decimales; servicios: cantidades
              enteras de 1 a 1000.
            </p>
          </fieldset>
        </div>
        <div className="record-dialog-actions">
          <button className="secondary-button" type="button" disabled={busy} onClick={onClose}>
            Cancelar
          </button>
          <button className="button" disabled={busy || error?.code === 'VERSION_CONFLICT'}>
            {busy ? 'Guardando…' : pending ? 'Reintentar venta' : 'Guardar venta'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
type PaymentDraft = {
  key: string;
  method: PaymentInput['method'] | '';
  amount: string;
  reference: string;
};
const paymentDraft = (amount = ''): PaymentDraft => ({
  key: crypto.randomUUID(),
  method: '',
  amount,
  reference: '',
});
export function ConfirmSaleForm({
  initial,
  onClose,
  onSaved,
}: {
  initial: SaleDetail;
  onClose: () => void;
  onSaved: (r: SaleDetail) => void;
}) {
  const api = useApi(),
    [record, setRecord] = useState(initial),
    [payments, setPayments] = useState<PaymentDraft[]>(
      initial.total === '0.00' ? [] : [paymentDraft(initial.total)],
    ),
    [requestId, setRequestId] = useState(() => crypto.randomUUID()),
    [pending, setPending] = useState<SaleConfirmInput | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<ApiError | null>(null),
    [notice, setNotice] = useState('');
  async function reload() {
    setBusy(true);
    try {
      const r = await api<SaleDetail>(`/api/sales/${record.id}`);
      if (r.status !== 'draft') {
        onSaved(r);
        return;
      }
      setRecord(r);
      setError(null);
      setRequestId(crypto.randomUUID());
      setPending(null);
      if (r.total === '0.00') setPayments([]);
      setNotice('Versión actual cargada. Revisa el total y los importes antes de confirmar.');
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = pending ?? {
      requestId,
      version: record.version,
      payments: payments.map(({ method, amount, reference }) => ({
        method: method as PaymentInput['method'],
        amount,
        reference: reference.trim() || null,
      })),
    };
    setPending(body);
    setBusy(true);
    setError(null);
    try {
      onSaved(await api<SaleDetail>(`/api/sales/${record.id}/confirm`, { method: 'POST', body }));
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
  function change(i: number, field: 'method' | 'amount' | 'reference', value: string) {
    setPayments(payments.map((p, j) => (i === j ? { ...p, [field]: value } : p)));
  }
  const validAmounts = payments.every((p) => /^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(p.amount));
  const cents = validAmounts
    ? payments.reduce((sum, p) => {
        const [a, b = ''] = p.amount.split('.');
        return sum + BigInt(a!) * 100n + BigInt(b.padEnd(2, '0'));
      }, 0n)
    : null;
  const paid = cents === null ? null : `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
  return (
    <Dialog title={`Confirmar ${record.number}`} onClose={onClose} busy={busy}>
      <form onSubmit={(e) => void submit(e)}>
        <div className="record-dialog-body">
          <p className="record-help">
            Registra pagos ya recibidos. Esta pantalla no cobra tarjetas ni realiza transferencias.
            Al confirmar se guardan los cobros y se descuentan los productos de la venta.
          </p>
          <div className="sale-payment-summary">
            <div>
              <span>Total a registrar</span>
              <strong>{money(record.total)}</strong>
            </div>
            <div>
              <span>Cobros ingresados</span>
              <strong>{paid === null ? 'Revisa importes' : money(paid)}</strong>
            </div>
          </div>
          <p className="record-help">
            Cliente: {record.clientName ?? 'Sin cliente asociado'}. Registra el importe aplicado a
            la venta, sin vuelto.
          </p>
          <ErrorNotice error={error} onReload={() => void reload()} />
          <FieldErrors error={error} />
          {notice && (
            <p className="auth-notice" role="status">
              {notice}
            </p>
          )}
          {pending && !busy && (
            <p className="auth-notice" role="status">
              El resultado no pudo confirmarse. Reintenta sin cambiar los datos; no se repetirán
              cobros ni salidas.
            </p>
          )}
          <fieldset className="stock-purchase-fields" disabled={busy || !!pending}>
            {record.total === '0.00' && (
              <p className="auth-notice">El total es cero. La venta se confirmará sin cobros.</p>
            )}
            {payments.map((p, i) => (
              <div className="sale-payment-editor" key={p.key}>
                <Field name={`method${i}`} label={`Medio de pago ${i + 1} *`}>
                  {(props) => (
                    <select
                      {...props}
                      required
                      value={p.method}
                      onChange={(e) => change(i, 'method', e.target.value)}
                    >
                      <option value="" disabled>
                        Elegir medio
                      </option>
                      {Object.entries(paymentMethodLabels).map(([v, label]) => (
                        <option key={v} value={v}>
                          {label}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field name={`amount${i}`} label={`Importe del pago ${i + 1} (S/) *`}>
                  {(props) => (
                    <input
                      {...props}
                      required
                      inputMode="decimal"
                      maxLength={13}
                      value={p.amount}
                      onChange={(e) => change(i, 'amount', e.target.value)}
                    />
                  )}
                </Field>
                <Field
                  name={`reference${i}`}
                  label={`Referencia del pago ${i + 1}${p.method === 'card' || p.method === 'transfer' ? ' *' : ''}`}
                  wide
                >
                  {(props) => (
                    <input
                      {...props}
                      maxLength={100}
                      required={p.method === 'card' || p.method === 'transfer'}
                      minLength={p.method === 'card' || p.method === 'transfer' ? 3 : undefined}
                      value={p.reference}
                      placeholder="Código de operación; no ingreses datos de tarjeta"
                      onChange={(e) => change(i, 'reference', e.target.value)}
                    />
                  )}
                </Field>
                <button
                  className="text-link"
                  type="button"
                  aria-label={`Quitar pago ${i + 1}`}
                  onClick={() => setPayments(payments.filter((_, j) => i !== j))}
                >
                  Quitar pago
                </button>
              </div>
            ))}
            {payments.length < 5 && record.total !== '0.00' && (
              <button
                className="secondary-button"
                type="button"
                onClick={() => setPayments([...payments, paymentDraft()])}
              >
                Agregar otro pago
              </button>
            )}
            <p className="record-help">
              Hasta 5 pagos. Sus importes deben sumar exactamente el total. Para tarjeta y
              transferencia, registra una referencia de operación.
            </p>
          </fieldset>
        </div>
        <div className="record-dialog-actions">
          <button className="secondary-button" type="button" disabled={busy} onClick={onClose}>
            Volver
          </button>
          <button className="button" disabled={busy || error?.code === 'VERSION_CONFLICT'}>
            {busy ? 'Confirmando…' : pending ? 'Reintentar confirmación' : 'Confirmar venta'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
