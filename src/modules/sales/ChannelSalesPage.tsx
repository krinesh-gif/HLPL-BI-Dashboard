import { useMemo, useState } from 'react'
import { PageShell } from '@/components/layout/PageShell'
import { TrendLineChart } from '@/components/charts/TrendLineChart'
import { useDataStore } from '@/store/dataStore'
import { useFilterStore } from '@/store/filterStore'
import { BUSINESS_CHANNELS, type BusinessChannelId } from '@/config/channels'
import { addMonths, formatCurrencyCompact, formatCurrencyFull, formatPercent, monthLabel } from '@/lib/format'
import { growthPct } from '@/engine/sales'
import { netSalesForChannelMonth } from '@/engine/netSales'
import { exportRowsToCsv } from '@/lib/exportCsv'

const MONTH_WINDOW = 12

type Metric = 'netSales' | 'units' | 'orders'

const METRICS: { key: Metric; label: string; format: (v: number) => string }[] = [
  { key: 'netSales', label: 'Net Sales', format: (v) => formatCurrencyFull(v) },
  { key: 'units', label: 'Units', format: (v) => Math.round(v).toLocaleString('en-IN') },
  { key: 'orders', label: 'Orders', format: (v) => Math.round(v).toLocaleString('en-IN') },
]

/**
 * Channel sales as a month-by-channel matrix.
 *
 * The month dimension is the point of this screen. The previous version showed
 * only the single month from the global filter, which made a year of history
 * look like one undated total. Here every month that has data is its own row,
 * and the totals column is the sum of the rows rather than a replacement for
 * them.
 */
export function ChannelSalesPage() {
  const { salesRecords, flipkartFacts, amazonUsaFacts, meeshoFacts } = useDataStore()
  const { month } = useFilterStore()
  const [metric, setMetric] = useState<Metric>('netSales')
  const [monthsShown, setMonthsShown] = useState(MONTH_WINDOW)

  const { months, activeChannels, matrix, monthTotals, channelTotals, grandTotal } = useMemo(() => {
    const facts = { flipkartFacts, amazonUsaFacts, meeshoFacts }
    const months = Array.from({ length: monthsShown }, (_, i) => addMonths(month, i - (monthsShown - 1)))

    const matrix = new Map<string, Map<BusinessChannelId, { netSales: number; units: number; orders: number }>>()
    for (const m of months) {
      const row = new Map<BusinessChannelId, { netSales: number; units: number; orders: number }>()
      for (const c of BUSINESS_CHANNELS) {
        const figure = netSalesForChannelMonth({ records: salesRecords, channel: c.id, month: m, facts })
        row.set(c.id, { netSales: figure.netSales, units: figure.units, orders: figure.orders })
      }
      matrix.set(m, row)
    }

    // A channel with nothing in the whole window is a column of zeros; hiding
    // it keeps the table readable without hiding any month.
    const activeChannels = BUSINESS_CHANNELS.filter((c) =>
      months.some((m) => {
        const cell = matrix.get(m)?.get(c.id)
        return cell !== undefined && (cell.netSales !== 0 || cell.units !== 0 || cell.orders !== 0)
      }),
    )

    const monthTotals = new Map(
      months.map((m) => [
        m,
        activeChannels.reduce((sum, c) => sum + (matrix.get(m)?.get(c.id)?.[metric] ?? 0), 0),
      ]),
    )
    const channelTotals = new Map(
      activeChannels.map((c) => [
        c.id,
        months.reduce((sum, m) => sum + (matrix.get(m)?.get(c.id)?.[metric] ?? 0), 0),
      ]),
    )
    const grandTotal = [...monthTotals.values()].reduce((a, b) => a + b, 0)

    return { months, activeChannels, matrix, monthTotals, channelTotals, grandTotal }
  }, [salesRecords, flipkartFacts, amazonUsaFacts, meeshoFacts, month, monthsShown, metric])

  const format = METRICS.find((m) => m.key === metric)!.format

  const chartData = months.map((m) => {
    const point: Record<string, string | number> = { month: monthLabel(m) }
    for (const c of activeChannels) point[c.label] = matrix.get(m)?.get(c.id)?.[metric] ?? 0
    return point
  })

  function exportMatrix() {
    exportRowsToCsv(
      'HLPL_ChannelSales_ByMonth',
      months.map((m) => {
        const row: Record<string, string | number> = { Month: monthLabel(m) }
        for (const c of activeChannels) row[c.label] = matrix.get(m)?.get(c.id)?.[metric] ?? 0
        row.Total = monthTotals.get(m) ?? 0
        return row
      }),
    )
  }

  if (activeChannels.length === 0) {
    return (
      <PageShell title="Channel Sales" subtitle="Month-by-month revenue across every marketplace" showFilters={false}>
        <p className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
          No sales in the {monthsShown} months ending {monthLabel(month)}. Upload a report, or move the month filter.
        </p>
      </PageShell>
    )
  }

  return (
    <PageShell title="Channel Sales" subtitle="Month-by-month revenue across every marketplace" showFilters={false}>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs font-medium text-slate-500">
          Metric
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value as Metric)}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none"
          >
            {METRICS.map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-xs font-medium text-slate-500">
          Months
          <select
            value={monthsShown}
            onChange={(e) => setMonthsShown(Number(e.target.value))}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none"
          >
            {[3, 6, 12, 18, 24].map((n) => (
              <option key={n} value={n}>Last {n}</option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={exportMatrix}
          className="ml-auto rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Export CSV
        </button>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-700">{METRICS.find((m) => m.key === metric)!.label} by month</h3>
        <TrendLineChart
          data={chartData}
          xKey="month"
          series={activeChannels.map((c) => ({ key: c.label, label: c.label }))}
          valueFormatter={(v) => (metric === 'netSales' ? formatCurrencyCompact(v) : Math.round(v).toLocaleString('en-IN'))}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left text-xs font-semibold text-slate-500">Month</th>
              {activeChannels.map((c) => (
                <th key={c.id} className="px-3 py-2 text-right text-xs font-semibold text-slate-500">{c.label}</th>
              ))}
              <th className="px-3 py-2 text-right text-xs font-semibold text-slate-700">Total</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">MoM</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m, i) => {
              const total = monthTotals.get(m) ?? 0
              const previous = i > 0 ? (monthTotals.get(months[i - 1]) ?? 0) : null
              const mom = previous === null ? null : growthPct(total, previous)
              return (
                <tr key={m} className="border-t border-slate-100">
                  <th className="sticky left-0 z-10 bg-white px-3 py-2 text-left font-medium text-slate-700">{monthLabel(m)}</th>
                  {activeChannels.map((c) => {
                    const value = matrix.get(m)?.get(c.id)?.[metric] ?? 0
                    return (
                      <td key={c.id} className={`px-3 py-2 text-right tabular-nums ${value === 0 ? 'text-slate-300' : 'text-slate-700'}`}>
                        {value === 0 ? '—' : format(value)}
                      </td>
                    )
                  })}
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">{total === 0 ? '—' : format(total)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${mom === null ? 'text-slate-400' : mom >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {mom === null ? '—' : `${mom >= 0 ? '▲' : '▼'} ${formatPercent(Math.abs(mom))}`}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-300 bg-slate-50">
              <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left text-slate-700">Total</th>
              {activeChannels.map((c) => (
                <td key={c.id} className="px-3 py-2 text-right font-semibold tabular-nums text-slate-800">
                  {format(channelTotals.get(c.id) ?? 0)}
                </td>
              ))}
              <td className="px-3 py-2 text-right font-bold tabular-nums text-slate-900">{format(grandTotal)}</td>
              <td />
            </tr>
            <tr className="bg-slate-50 text-xs text-slate-500">
              <th className="sticky left-0 z-10 bg-slate-50 px-3 py-1 text-left font-normal">Share of total</th>
              {activeChannels.map((c) => (
                <td key={c.id} className="px-3 py-1 text-right tabular-nums">
                  {grandTotal > 0 ? formatPercent(((channelTotals.get(c.id) ?? 0) / grandTotal) * 100) : '—'}
                </td>
              ))}
              <td className="px-3 py-1 text-right tabular-nums">100.0%</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </PageShell>
  )
}
