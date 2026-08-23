import { useState } from 'react'
import { PageShell } from '@/components/layout/PageShell'
import { KPICard, KPIGrid } from '@/components/ui/KPICard'
import { TrendLineChart } from '@/components/charts/TrendLineChart'
import { CHANNEL_MAP } from '@/config/channels'
import type { ChannelId } from '@/config/channels'
import { formatCurrencyCompact, formatCurrencyFull, formatDate, formatNumber, formatPercent } from '@/lib/format'
import { exportRowsToCsv } from '@/lib/exportCsv'
import { useDailySales, type DailyLevel } from './useDailySales'

type Metric = 'revenue' | 'units' | 'orders' | 'asp' | 'rtoPct'

const METRICS: { key: Metric; label: string; format: (v: number) => string }[] = [
  { key: 'revenue', label: 'Daily Revenue', format: (v) => formatCurrencyFull(v) },
  { key: 'units', label: 'Daily Units', format: (v) => formatNumber(v) },
  { key: 'orders', label: 'Daily Orders', format: (v) => formatNumber(v) },
  { key: 'asp', label: 'Daily ASP', format: (v) => formatCurrencyFull(v) },
  { key: 'rtoPct', label: 'Daily RTO %', format: (v) => formatPercent(v) },
]

const LEVELS: { key: DailyLevel; label: string }[] = [
  { key: 'company', label: 'Company' },
  { key: 'channel', label: 'Channel' },
  { key: 'sku', label: 'SKU' },
]

export function DailySalesPage() {
  const d = useDailySales()
  const [level, setLevel] = useState<DailyLevel>('company')
  const [metric, setMetric] = useState<Metric>('revenue')

  const format = METRICS.find((m) => m.key === metric)!.format

  // At channel level the chart draws one line per marketplace; otherwise one
  // line for the selected metric, with a 7-day average alongside revenue.
  const chartData = d.rows.map((r) => {
    const point: Record<string, string | number | null> = { date: formatDate(r.date).replace(/, \d{4}$/, '') }
    if (level === 'channel') {
      for (const c of d.activeChannels) point[c.label] = r.byChannel.get(c.id as ChannelId) ?? 0
    } else {
      point[metric] = r[metric]
      if (metric === 'revenue') point.movingAvg7 = r.movingAvg7
    }
    return point
  })

  const series =
    level === 'channel'
      ? d.activeChannels.map((c) => ({ key: c.label, label: c.label }))
      : [
          { key: metric, label: METRICS.find((m) => m.key === metric)!.label },
          ...(metric === 'revenue' ? [{ key: 'movingAvg7', label: '7-day average' }] : []),
        ]

  function exportRows() {
    exportRowsToCsv(
      `HLPL_DailySales_${d.filters.from}_to_${d.filters.to}`,
      d.rows.map((r) => {
        const row: Record<string, string | number> = {
          Date: r.date,
          Revenue: Math.round(r.revenue),
          Units: r.units,
          Orders: r.orders,
          ASP: r.asp === null ? '' : Math.round(r.asp * 100) / 100,
          'RTO Units': r.rtoUnits,
          'RTO %': r.rtoPct === null ? '' : Math.round(r.rtoPct * 100) / 100,
        }
        if (level === 'channel') {
          for (const c of d.activeChannels) row[c.label] = Math.round(r.byChannel.get(c.id as ChannelId) ?? 0)
        }
        return row
      }),
    )
  }

  return (
    <PageShell title="Daily Sales" subtitle="Day-level revenue, units, orders, ASP and RTO" showFilters={false}>
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <Field label="Level">
          <div className="flex rounded-md border border-slate-300 bg-white p-0.5">
            {LEVELS.map((l) => (
              <button
                key={l.key}
                type="button"
                onClick={() => setLevel(l.key)}
                className={`rounded px-3 py-1 text-sm font-medium transition ${
                  level === l.key ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="From">
          <input
            type="date"
            value={d.filters.from}
            max={d.filters.to}
            onChange={(e) => d.setFilters({ ...d.filters, from: e.target.value })}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
          />
        </Field>
        <Field label="To">
          <input
            type="date"
            value={d.filters.to}
            min={d.filters.from}
            onChange={(e) => d.setFilters({ ...d.filters, to: e.target.value })}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
          />
        </Field>

        <Field label="Channel">
          <select
            value={d.filters.channel}
            onChange={(e) => d.setFilters({ ...d.filters, channel: e.target.value as ChannelId | 'all' })}
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
          >
            <option value="all">All channels</option>
            {Object.values(CHANNEL_MAP).map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </Field>

        <Field label="Category">
          <select
            value={d.filters.category}
            onChange={(e) => d.setFilters({ ...d.filters, category: e.target.value })}
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
          >
            <option value="all">All categories</option>
            {d.options.categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </Field>

        <Field label="SKU">
          <select
            value={d.filters.sku}
            onChange={(e) => d.setFilters({ ...d.filters, sku: e.target.value })}
            className="w-56 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
          >
            <option value="all">All SKUs</option>
            {d.options.skus.map((s) => (
              <option key={s.sku} value={s.sku}>{s.label}</option>
            ))}
          </select>
        </Field>

        {level !== 'channel' && (
          <Field label="Metric">
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value as Metric)}
              className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
            >
              {METRICS.map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
          </Field>
        )}

        <button
          type="button"
          onClick={() => d.setFilters({ from: '', to: '', channel: 'all', category: 'all', sku: 'all' })}
          className="ml-auto rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={exportRows}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Export CSV
        </button>
      </div>

      {d.rows.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
          No sales between {formatDate(d.filters.from)} and {formatDate(d.filters.to)} for this selection.
        </p>
      ) : (
        <>
          <KPIGrid>
            <KPICard label="Revenue in range" value={formatCurrencyCompact(d.total.netSales)} />
            <KPICard label="Units in range" value={formatNumber(d.total.units)} />
            <KPICard label="Avg / day" value={formatCurrencyCompact(d.avgDailyRevenue)} />
            <KPICard label="Days with sales" value={String(d.rows.length)} />
            <KPICard
              label="Best day"
              value={d.bestDay ? formatCurrencyCompact(d.bestDay.revenue) : '—'}
              delta={undefined}
            />
            <KPICard label="ASP in range" value={d.total.units > 0 ? formatCurrencyFull(d.total.netSales / d.total.units) : '—'} />
          </KPIGrid>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="mb-2 text-sm font-semibold text-slate-700">
              {level === 'channel' ? 'Daily revenue by channel' : METRICS.find((m) => m.key === metric)!.label}
            </h3>
            <TrendLineChart
              data={chartData}
              xKey="date"
              series={series}
              valueFormatter={(v) => (level === 'channel' ? formatCurrencyCompact(v) : format(v))}
            />
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Date</th>
                  {level === 'channel' &&
                    d.activeChannels.map((c) => (
                      <th key={c.id} className="px-3 py-2 text-right text-xs font-semibold text-slate-500">{c.label}</th>
                    ))}
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-700">Revenue</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Units</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Orders</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">ASP</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">RTO %</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">DoD</th>
                </tr>
              </thead>
              <tbody>
                {[...d.rows].reverse().map((r) => (
                  <tr key={r.date} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-slate-700">{formatDate(r.date)}</td>
                    {level === 'channel' &&
                      d.activeChannels.map((c) => {
                        const value = r.byChannel.get(c.id as ChannelId) ?? 0
                        return (
                          <td key={c.id} className={`px-3 py-2 text-right tabular-nums ${value === 0 ? 'text-slate-300' : 'text-slate-600'}`}>
                            {value === 0 ? '—' : formatCurrencyFull(value)}
                          </td>
                        )
                      })}
                    <td className="px-3 py-2 text-right font-medium tabular-nums text-slate-900">{formatCurrencyFull(r.revenue)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{formatNumber(r.units)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{formatNumber(r.orders)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{r.asp === null ? '—' : formatCurrencyFull(r.asp)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{r.rtoPct === null ? '—' : formatPercent(r.rtoPct)}</td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${
                        r.dodGrowthPct === null ? 'text-slate-400' : r.dodGrowthPct >= 0 ? 'text-emerald-600' : 'text-rose-600'
                      }`}
                    >
                      {r.dodGrowthPct === null ? '—' : `${r.dodGrowthPct >= 0 ? '▲' : '▼'} ${formatPercent(Math.abs(r.dodGrowthPct))}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-slate-500">
            Daily figures are summed from order-level rows, because settlement reports are monthly totals and cannot be split by day.
            For a channel whose month is settled, these daily figures will therefore not add up exactly to that month's P&amp;L — see
            Net Sales Reconciliation for why.
          </p>
        </>
      )}
    </PageShell>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  )
}
