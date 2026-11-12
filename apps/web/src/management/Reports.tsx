import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Download, RefreshCw } from 'lucide-react';
import { appointmentLabels, paymentMethodLabels, type OperationsReport } from '@nexovet/shared';
import { Table } from '../components';
import { useAuth } from '../auth';
import { useRead, LoadError, money, units, stamp } from '../inventory/common';
type Options = { from: string; to: string; today: string };
export function Reports() {
  const auth = useAuth(),
    [params, setParams] = useSearchParams(),
    [attempt, setAttempt] = useState(0),
    [from, setFrom] = useState(params.get('from') ?? ''),
    [to, setTo] = useState(params.get('to') ?? ''),
    [downloading, setDownloading] = useState(false),
    [downloadError, setDownloadError] = useState(''),
    [selected, setSelected] = useState('');
  const options = useRead<Options>('/api/reports/options'),
    query = new URLSearchParams({
      ...(params.get('from') ? { from: params.get('from')! } : {}),
      ...(params.get('to') ? { to: params.get('to')! } : {}),
    }),
    r = useRead<OperationsReport>(`/api/reports/operations?${query}`, attempt);
  const urlFrom = params.get('from'),
    urlTo = params.get('to');
  useEffect(() => {
    setFrom(urlFrom ?? '');
    setTo(urlTo ?? '');
  }, [urlFrom, urlTo]);
  // Las sugerencias que llegan tarde solo completan campos aún vacíos.
  useEffect(() => {
    if (!urlFrom) setFrom((current) => current || options.data?.from || '');
    if (!urlTo) setTo((current) => current || options.data?.to || '');
  }, [options.data, urlFrom, urlTo]);
  async function download() {
    if (!r.data) return;
    setDownloading(true);
    setDownloadError('');
    try {
      const p = new URLSearchParams({ from: r.data.from, to: r.data.to });
      const response = await fetch(`/api/reports/operations.csv?${p}`, {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (response.status === 401) auth.expire();
      if (!response.ok)
        throw Error(
          (await response.json().catch(() => null))?.message ?? 'No pudimos exportar el reporte.',
        );
      const blob = await response.blob(),
        url = URL.createObjectURL(blob),
        a = document.createElement('a');
      a.href = url;
      a.download = `nexovet-reporte-${r.data.from}-${r.data.to}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setDownloadError((e as Error).message);
    } finally {
      setDownloading(false);
    }
  }
  const data = r.data,
    day = data?.dailySales.find((d) => d.date === selected) ?? data?.dailySales.at(-1),
    max = Math.max(0, ...(data?.dailySales.map((d) => Number(d.total)) ?? []));
  return (
    <section className="patient-directory report-page">
      <div className="directory-heading">
        <div>
          <span className="eyebrow">DATOS PARA DECIDIR</span>
          <h1>Reportes operativos</h1>
          <p>Ventas, cobros y actividad de la veterinaria, con fechas de Lima.</p>
        </div>
        <button
          className="secondary-button"
          disabled={!data || r.loading || downloading}
          onClick={() => void download()}
        >
          <Download size={16} />
          {downloading ? 'Exportando…' : 'Exportar CSV'}
        </button>
      </div>
      <form
        className="panel management-period"
        onSubmit={(e) => {
          e.preventDefault();
          setParams({ from, to });
          setSelected('');
          setAttempt((x) => x + 1);
        }}
      >
        <label>
          Desde
          <input
            aria-label="Reporte desde"
            type="date"
            min="2000-01-01"
            value={from}
            required
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          Hasta inclusive
          <input
            aria-label="Reporte hasta"
            type="date"
            min="2000-01-01"
            value={to}
            required
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <button className="button" disabled={!from || !to}>
          <RefreshCw size={15} />
          Actualizar reporte
        </button>
        <p className="record-help">
          Máximo 366 días. La exportación consulta de nuevo los datos del período mostrado.
        </p>
      </form>
      {options.error && (
        <p className="auth-error" role="alert">
          No pudimos sugerir las fechas; puedes ingresarlas manualmente.
        </p>
      )}
      {downloadError && (
        <p className="auth-error" role="alert">
          {downloadError}
        </p>
      )}
      {r.loading ? (
        <div className="directory-empty" role="status">
          Calculando reporte…
        </div>
      ) : r.error ? (
        <LoadError retry={() => setAttempt((x) => x + 1)}>{r.error}</LoadError>
      ) : data ? (
        <>
          <p className="report-context">
            {data.businessName} · {data.from} al {data.to} · Consultado {stamp(data.generatedAt)}
          </p>
          <div className="followup-metrics report-financial">
            {[
              [
                'Ventas confirmadas',
                data.financial.salesTotal,
                `${data.financial.confirmedSales} ventas`,
              ],
              [
                'Cobros registrados',
                data.financial.paymentsTotal,
                `${data.financial.paymentCount} pagos`,
              ],
              [
                'Compras recibidas',
                data.financial.purchasesTotal,
                `${data.financial.receivedPurchases} compras`,
              ],
            ].map(([label, total, n]) => (
              <article key={label}>
                <span>{label}</span>
                <strong>{money(total!)}</strong>
                <small>{n}</small>
              </article>
            ))}
          </div>
          <p className="record-help report-space">
            Ventas por confirmación, cobros por fecha de registro y compras por recepción. Los
            importes no representan utilidad ni conciliación bancaria.
          </p>
          <section className="panel management-panel">
            <h2>Ventas por día</h2>
            <p className="record-help">
              Elige una barra para consultar su importe y cantidad de ventas.
            </p>
            <div className="report-bars" aria-label="Ventas diarias del período">
              {data.dailySales.map((d) => (
                <button
                  key={d.date}
                  type="button"
                  aria-label={`Ver día ${d.date}`}
                  aria-pressed={day?.date === d.date}
                  title={`${d.date}: ${money(d.total)} · ${d.count} ventas`}
                  onClick={() => setSelected(d.date)}
                >
                  <span
                    className="report-bar"
                    style={{ height: `${max ? (Number(d.total) / max) * 100 : 0}%` }}
                  />
                  <small>{d.date.slice(8)}</small>
                </button>
              ))}
            </div>
            {day && (
              <p className="report-day" role="status">
                {day.date} · {day.count} ventas confirmadas · {money(day.total)}
              </p>
            )}
          </section>
          <div className="management-columns">
            <section className="panel management-panel">
              <h2>Cobros por medio</h2>
              <Table headers={['Medio', 'Pagos', 'Total registrado']}>
                {data.paymentsByMethod.map((p) => (
                  <tr key={p.method}>
                    <td>{paymentMethodLabels[p.method]}</td>
                    <td>{p.count}</td>
                    <td>{money(p.total)}</td>
                  </tr>
                ))}
              </Table>
            </section>
            <section className="panel management-panel">
              <h2>Citas según fecha de inicio</h2>
              {data.appointmentsByStatus.length ? (
                <Table headers={['Estado actual', 'Cantidad']}>
                  {data.appointmentsByStatus.map((a) => (
                    <tr key={a.status}>
                      <td>{appointmentLabels[a.status]}</td>
                      <td>{a.count}</td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <p className="record-help">No hay citas que comiencen en este período.</p>
              )}
            </section>
          </div>
          <section className="panel management-panel">
            <h2>Actividad del período</h2>
            <div className="management-kpis">
              {[
                ['Citas por inicio', data.activity.appointments],
                ['Atenciones cerradas', data.activity.closedEncounters],
                ['Clientes registrados', data.activity.newClients],
                ['Mascotas registradas', data.activity.newPets],
              ].map(([label, n]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{n}</strong>
                </div>
              ))}
            </div>
            <h3>Seguimientos por vencimiento en el período</h3>
            <p className="record-help">
              Estado actual de esas tareas. Vencidos son los pendientes cuyo plazo ya pasó.
            </p>
            <div className="management-kpis">
              {[
                ['Pendientes', data.followups.pending],
                ['Completados', data.followups.completed],
                ['Cancelados', data.followups.cancelled],
                ['Pendientes vencidos', data.followups.overdue],
              ].map(([label, n]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{n}</strong>
                </div>
              ))}
            </div>
          </section>
          <section className="panel management-panel">
            <h2>Existencias actuales</h2>
            <p className="record-help">
              Esta fotografía del almacén no se filtra por el período elegido.
            </p>
            <div className="management-kpis">
              {[
                ['Productos activos', data.inventory.active],
                ['Stock bajo', data.inventory.low],
                ['Sin existencias', data.inventory.empty],
              ].map(([label, n]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{n}</strong>
                </div>
              ))}
            </div>
            <Link className="text-link" to="/inventario">
              Revisar inventario
            </Link>
          </section>
          <section className="panel management-panel">
            <h2>Conceptos con mayor importe vendido</h2>
            <p className="record-help">
              Hasta 10 productos o servicios de ventas confirmadas en el período.
            </p>
            {data.topItems.length ? (
              <Table headers={['Concepto', 'Tipo', 'Cantidad', 'Importe']}>
                {data.topItems.map((p) => (
                  <tr key={`${p.kind}:${p.itemId}`}>
                    <td>
                      <strong>{p.name}</strong>
                    </td>
                    <td>{p.kind === 'product' ? 'Producto' : 'Servicio'}</td>
                    <td>{units(p.quantity)}</td>
                    <td>{money(p.total)}</td>
                  </tr>
                ))}
              </Table>
            ) : (
              <p className="record-help">No hay conceptos vendidos en este período.</p>
            )}
          </section>
        </>
      ) : null}
    </section>
  );
}
