import { PageShell } from '@/components/layout/PageShell'
import { KPICard, KPIGrid } from '@/components/ui/KPICard'
import { TrendLineChart } from '@/components/charts/TrendLineChart'
import { formatNumber, formatPercent, monthLabel } from '@/lib/format'
import { exportRowsToCsv } from '@/lib/exportCsv'
import { useMomMetrics } from './useMomMetrics'
import { MomControls } from './MomControls'

/**
 * Month-on-month RTO.
 *
 *   RTO % = RTO Units / Shipped Units
 *
 * Two different quantities are reported side by side and never merged:
 *
 *  - the change in the RATE, in percentage points (8.2% to 6.7% is -1.5 points)
 *  - the growth in the NUMBER of RTO units
 *
 * They can point opposite ways. If volume doubles while the rate improves,
 * fewer parcels come back per hundred shipped but more come back in total, and
 * a screen showing only one of those tells the reader the opposite of what is
 * happening in the warehouse.
 */
export function RtoAnalysisPage() {
  const m = useMomMetrics()

  const chartData = m.trend.map((p) => ({
    month: monthLabel(p.month),
    rtoPct: p.rtoPct,
    rtoUnits: p.rtoUnits,
  }))

  const deteriorating = m.rows.filter((r) => r.rtoDeteriorated)

  function exportRows() {
    exportRowsToCsv(
      `HLPL_RTO_${m.level}_${m.month}`,
      m.rows.map((r) => ({
        [m.level === 'sku' ? 'SKU' : 'Name']: r.label,
        'Shipped Units': r.current.shippedUnits,
        'RTO Units': r.current.rtoUnits,
        [`RTO % ${m.month}`]: r.currentRtoPct === null ? '' : Math.round(r.currentRtoPct * 100) / 100,
        [`RTO % ${m.compareMonth}`]: r.previousRtoPct === null ? '' : Math.round(r.previousRtoPct * 100) / 100,
        'Change (percentage points)': r.rtoPointChange === null ? '' : Math.round(r.rtoPointChange * 100) / 100,
        'RTO Unit Growth %': r.rtoUnitGrowthPct === null ? '' : Math.round(r.rtoUnitGrowthPct * 100) / 100,
      })),
    )
  }

  const pointChange = m.master.rtoPointChange

  return (
    <PageShell title="RTO Analysis" subtitle={`Return to origin — ${monthLabel(m.month)} against ${monthLabel(m.compareMonth)}`}>
      <KPIGrid>
        <KPICard
          label={`RTO % — ${monthLabel(m.month)}`}
          value={m.master.currentRtoPct === null ? '—' : formatPercent(m.master.currentRtoPct)}
          tone={m.master.currentRtoPct !== null && m.master.currentRtoPct > 5 ? 'bad' : 'neutral'}
        />
        <KPICard
          label={`RTO % — ${monthLabel(m.compareMonth)}`}
          value={m.master.previousRtoPct === null ? '—' : formatPercent(m.master.previousRtoPct)}
        />
        <KPICard
          label="Change (percentage points)"
          value={pointChange === null ? '—' : `${pointChange >= 0 ? '+' : ''}${pointChange.toFixed(1)} pp`}
          tone={pointChange === null ? 'neutral' : pointChange > 0 ? 'bad' : 'good'}
        />
        <KPICard
          label="RTO Unit Growth %"
          value={m.master.rtoUnitGrowthPct === null ? '—' : formatPercent(m.master.rtoUnitGrowthPct)}
          tone={m.master.rtoUnitGrowthPct === null ? 'neutral' : m.master.rtoUnitGrowthPct > 0 ? 'bad' : 'good'}
        />
        <KPICard label="RTO Units" value={formatNumber(m.master.current.rtoUnits)} />
        <KPICard label="Shipped Units" value={formatNumber(m.master.current.shippedUnits)} />
      </KPIGrid>

      <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <strong>Change in percentage points</strong> and <strong>RTO unit growth</strong> answer different questions and can point
        opposite ways. If volume grows while the rate improves, fewer parcels come back per hundred shipped but more come back in
        total.
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">RTO % trend</h3>
          <TrendLineChart data={chartData} xKey="month" series={[{ key: 'rtoPct', label: 'RTO %' }]} valueFormatter={(v) => formatPercent(v)} />
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">RTO units trend</h3>
          <TrendLineChart data={chartData} xKey="month" series={[{ key: 'rtoUnits', label: 'RTO Units' }]} valueFormatter={(v) => formatNumber(v)} />
        </div>
      </div>

      {deteriorating.length > 0 && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4">
          <h3 className="text-sm font-semibold text-rose-900">
            ⚠ RTO worsened in {deteriorating.length} {m.level === 'channel' ? 'channel' : m.level === 'category' ? 'category' : 'SKU'}
            {deteriorating.length === 1 ? '' : 's'}
          </h3>
          <ul className="mt-2 space-y-1 text-xs text-rose-800">
            {deteriorating
              .slice()
              .sort((a, b) => (b.rtoPointChange ?? 0) - (a.rtoPointChange ?? 0))
              .slice(0, 8)
              .map((r) => (
                <li key={r.key}>
                  <strong>{r.label}</strong> — {formatPercent(r.previousRtoPct ?? 0)} → {formatPercent(r.currentRtoPct ?? 0)} (
                  {(r.rtoPointChange ?? 0) >= 0 ? '+' : ''}
                  {(r.rtoPointChange ?? 0).toFixed(1)} pp, {formatNumber(r.current.rtoUnits)} units)
                </li>
              ))}
          </ul>
        </div>
      )}

      <MomControls {...m}>
        <button
          type="button"
          onClick={exportRows}
          className="ml-auto rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Export CSV
        </button>
      </MomControls>

      {m.rows.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
          No shipments in {monthLabel(m.month)} or {monthLabel(m.compareMonth)} at this level.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">
                  {m.level === 'channel' ? 'Channel' : m.level === 'category' ? 'Category' : m.level === 'sku' ? 'SKU' : 'Scope'}
                </th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Shipped</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">RTO Units</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">RTO % {monthLabel(m.compareMonth)}</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-700">RTO % {monthLabel(m.month)}</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Change (pp)</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Unit Growth %</th>
              </tr>
            </thead>
            <tbody>
              {m.rows.map((r) => (
                <tr key={r.key} className={`border-t border-slate-100 ${r.rtoDeteriorated ? 'bg-rose-50/50' : ''}`}>
                  <td className="px-3 py-2">
                    <div className="text-slate-800">{r.label}</div>
                    {m.level === 'sku' && r.label !== r.key && <div className="font-mono text-xs text-slate-400">{r.key}</div>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{formatNumber(r.current.shippedUnits)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">{formatNumber(r.current.rtoUnits)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                    {r.previousRtoPct === null ? '—' : formatPercent(r.previousRtoPct)}
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums text-slate-900">
                    {r.currentRtoPct === null ? '—' : formatPercent(r.currentRtoPct)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${
                      r.rtoPointChange === null ? 'text-slate-400' : r.rtoPointChange > 0 ? 'font-semibold text-rose-600' : 'text-emerald-600'
                    }`}
                  >
                    {r.rtoPointChange === null ? '—' : `${r.rtoPointChange >= 0 ? '+' : ''}${r.rtoPointChange.toFixed(1)}`}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${
                      r.rtoUnitGrowthPct === null ? 'text-slate-400' : r.rtoUnitGrowthPct > 0 ? 'text-rose-600' : 'text-emerald-600'
                    }`}
                  >
                    {r.rtoUnitGrowthPct === null ? '—' : `${r.rtoUnitGrowthPct >= 0 ? '+' : ''}${formatPercent(r.rtoUnitGrowthPct)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-500">
        RTO % is measured against units that actually shipped. Cancelled orders never shipped and are excluded from both sides, so
        cancellations cannot flatter the rate. A dash means there was nothing shipped in that month to measure.
      </p>
    </PageShell>
  )
}
