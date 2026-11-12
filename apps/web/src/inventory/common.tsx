import { useEffect, useState, type ReactNode } from 'react';
import type { PageResult } from '@nexovet/shared';
import { useApi } from '../api';
export function useRead<T>(url: string, attempt = 0) {
  const api = useApi();
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setError('');
    setData(null);
    void api<T>(url, { signal: c.signal })
      .then((v) => {
        if (!c.signal.aborted) setData(v);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [api, url, attempt]);
  return { data, error, loading };
}
export function LoadError({ children, retry }: { children: ReactNode; retry: () => void }) {
  return (
    <div className="auth-error" role="alert">
      <p>{children}</p>
      <button className="text-link" type="button" onClick={retry}>
        Intentar nuevamente
      </button>
    </div>
  );
}
export function Pager({
  value,
  onPage,
}: {
  value: PageResult<unknown>;
  onPage: (n: number) => void;
}) {
  return (
    <div className="directory-pager">
      <span>
        {value.total
          ? `${(value.page - 1) * value.pageSize + 1}–${Math.min(value.total, value.page * value.pageSize)} de ${value.total}`
          : '0 registros'}
      </span>
      <div>
        <button
          className="secondary-button"
          aria-label="Página anterior"
          disabled={value.page <= 1}
          onClick={() => onPage(value.page - 1)}
        >
          Anterior
        </button>
        <span>Página {value.page}</span>
        <button
          className="secondary-button"
          aria-label="Página siguiente"
          disabled={value.page * value.pageSize >= value.total}
          onClick={() => onPage(value.page + 1)}
        >
          Siguiente
        </button>
      </div>
    </div>
  );
}
export type Choice = { id: string; name: string; sku?: string };
export function Lookup({
  kind,
  selected,
  onSelect,
}: {
  kind: 'products' | 'suppliers';
  selected: Choice | null;
  onSelect: (v: Choice | null) => void;
}) {
  const api = useApi(),
    [q, setQ] = useState(''),
    [items, setItems] = useState<Choice[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (selected || q.trim().length < 2) {
      setItems([]);
      return;
    }
    const c = new AbortController();
    setBusy(true);
    setError('');
    const t = setTimeout(() => {
      void api<PageResult<Choice>>(`/api/${kind}?q=${encodeURIComponent(q.trim())}&status=active`, {
        signal: c.signal,
      })
        .then((v) => {
          if (!c.signal.aborted) setItems(v.items);
        })
        .catch((e) => {
          if (!c.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!c.signal.aborted) setBusy(false);
        });
    }, 250);
    return () => {
      clearTimeout(t);
      c.abort();
    };
  }, [api, kind, q, selected, attempt]);
  const noun = kind === 'products' ? 'producto' : 'proveedor';
  return selected ? (
    <div className="selected-owner">
      <div>
        <strong>{selected.name}</strong>
        <small>{selected.sku}</small>
      </div>
      <button
        type="button"
        className="text-link"
        onClick={() => {
          setQ('');
          onSelect(null);
        }}
      >
        Cambiar {noun}
      </button>
    </div>
  ) : (
    <div className="stock-lookup">
      <label>
        Buscar {noun} *
        <input
          aria-label={`Buscar ${noun} *`}
          value={q}
          maxLength={100}
          placeholder={kind === 'products' ? 'Nombre o código' : 'Nombre o RUC'}
          onChange={(e) => {
            setQ(e.target.value);
            setItems([]);
          }}
        />
      </label>
      <p className="record-help">Escribe al menos dos caracteres y selecciona una opción activa.</p>
      {error ? (
        <LoadError retry={() => setAttempt((x) => x + 1)}>{error}</LoadError>
      ) : busy && q.length >= 2 ? (
        <p role="status">Buscando…</p>
      ) : (
        <ul className="owner-results">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                aria-label={`Seleccionar ${noun} ${item.name}`}
                onClick={() => {
                  onSelect(item);
                  setQ('');
                  setItems([]);
                }}
              >
                <strong>{item.name}</strong>
                <small>{item.sku}</small>
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
export const units = (value: string) => {
  const negative = value.startsWith('-'),
    absolute = negative ? value.slice(1) : value;
  const [whole, decimal = ''] = absolute.split('.');
  const fraction = decimal.replace(/0+$/, '');
  return `${negative ? '-' : ''}${new Intl.NumberFormat('es-PE').format(BigInt(whole!))}${fraction ? '.' + fraction : ''}`;
};
export const stamp = (s: string) =>
  new Intl.DateTimeFormat('es-PE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Lima',
  }).format(new Date(s));

// Los importes ya llegan redondeados desde PostgreSQL. Se formatean sin convertir
// el total a Number, para conservar centavos también en importes grandes.
export function money(value: string) {
  const [whole, decimal = '00'] = value.split('.');
  return `S/\u00a0${new Intl.NumberFormat('es-PE').format(BigInt(whole!))}.${decimal.padEnd(2, '0')}`;
}
