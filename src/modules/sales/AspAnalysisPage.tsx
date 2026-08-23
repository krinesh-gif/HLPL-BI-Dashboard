import { PageShell } from '@/components/layout/PageShell'
import { KPICard, KPIGrid } from '@/components/ui/KPICard'
import { TrendLineChart } from '@/components/charts/TrendLineChart'
import { formatCurrencyFull, formatNumber, formatPercent, monthLabel } from '@/lib/format'
import { exportRowsToCsv } from '@/lib/exportCsv'
import { useMomMetrics } from './useMomMetrics'
import { MomControls } from './MomControls'

/**
 * Month-on-month ASP.
 *
 *   ASP = Net Sales / Units
 *
 * Net Sales comes from the central engine, so this screen cannot disagree with
 * the P&L about what a month's revenue was.
 */
export function AspAnalysisPage() {
  const m = useMomMetrics()

  const chartData = m.trend.map((p) => ({
    month: monthLabel(p.month),
    asp: p.asp,
    units: p.units,
  }))

  function exportRows() {
    exportRowsToCsv(
      `HLPL_ASP_${m.level}_${m.month}`,
      m.rows.map((r) => ({
        [m.level === 'sku' ? 'SKU' : 'Name']: r.label,
        [`Net Sales ${m.month}`]: Math.round(r.current.netSales),
        [`Units ${m.month}`]: r.current.units,
        [`ASP ${m.month}`]: r.currentAsp === null ? '' : Math.round(r.currentAsp * 100) / 100,
        [`ASP ${m.compareMonth}`]: r.previousAsp === null ? '' : Math.round(r.previousAsp * 100) / 100,
        'ASP Change': r.aspChange === null ? '' : Math.round(r.aspChange * 100) / 100,
        'ASP Growth %': r.aspGrowthPct === null ? '' : Math.round(r.aspGrowthPct * 100) / 100,
      })),
    )
  }

  return (
    <PageShell title="ASP Analysis" subtitle={`Average Selling Price — Net Sales per unit, ${monthLabel(m.month)} against ${monthLabel(m.compareMonth)}`}>
      <KPIGrid>
        <KPICard
          label={`ASP — ${monthLabel(m.month)}`}
          value={m.master.currentAsp === null ? '—' : formatCurrencyFull(m.master.currentAsp)}
          delta={{ pct: m.master.aspGrowthPct, label: 'vs ' + monthLabel(m.compareMonth) }}
        />
        <KPICard
          label={`ASP — ${monthLabel(m.compareMonth)}`}
          value={m.master.previousAsp === null ? '—' : formatCurrencyFull(m.master.previousAsp)}
        />
        <KPICard
          label="ASP Change"
          value={m.master.aspChange === null ? '—' : `${m.master.aspChange >= 0 ? '+' : ''}${formatCurrencyFull(m.master.aspChange)}`}
          tone={m.master.aspChange === null ? 'neutral' : m.master.aspChange >= 0 ? 'good' : 'bad'}
        />
        <KPICard label={`Units — ${monthLabel(m.month)}`} value={formatNumber(m.master.current.units)} />
      </KPIGrid>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-700">ASP trend</h3>
        <TrendLineChart
          data={chartData}
          xKey="month"
          series={[{ key: 'asp', label: 'ASP' }]}
          valueFormatter={(v) => formatCurrencyFull(v)}
        />
      </div>

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
          No sales in {monthLabel(m.month)} or {monthLabel(m.compareMonth)} at this level.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">
                  {m.level === 'channel' ? 'Channel' : m.level === 'category' ? 'Category' : m.level === 'sku' ? 'SKU' : 'Scope'}
                </th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Net Sales</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Units</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">ASP {monthLabel(m.compareMonth)}</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-700">ASP {monthLabel(m.month)}</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Change</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Growth %</th>
              </tr>
            </thead>
            <tbody>
              {m.rows.map((r) => (
                <tr key={r.key} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <div className="text-slate-800">{r.label}</div>
                    {m.level === 'sku' && r.label !== r.key && <div className="font-mono text-xs text-slate-400">{r.key}</div>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">{formatCurrencyFull(r.current.netSales)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{formatNumber(r.current.units)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                    {r.previousAsp === null ? '—' : formatCurrencyFull(r.previousAsp)}
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums text-slate-900">
                    {r.currentAsp === null ? '—' : formatCurrencyFull(r.currentAsp)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${
                      r.aspChange === null ? 'text-slate-400' : r.aspChange >= 0 ? 'text-emerald-600' : 'text-rose-600'
                    }`}
                  >
                    {r.aspChange === null ? '—' : `${r.aspChange >= 0 ? '+' : ''}${formatCurrencyFull(r.aspChange)}`}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${
                      r.aspGrowthPct === null ? 'text-slate-400' : r.aspGrowthPct >= 0 ? 'text-emerald-600' : 'text-rose-600'
                    }`}
                  >
                    {r.aspGrowthPct === null ? '—' : `${r.aspGrowthPct >= 0 ? '▲' : '▼'} ${formatPercent(Math.abs(r.aspGrowthPct))}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-500">
        A dash means there were no units in that month, which is a different answer from an ASP of zero.
      </p>
    </PageShell>
  )
}
