import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { PageShell } from '@/components/layout/PageShell'
import { KPICard, KPIGrid } from '@/components/ui/KPICard'
import { TrendLineChart } from '@/components/charts/TrendLineChart'
import { MixDonutChart } from '@/components/charts/MixDonutChart'
import { EmptyState } from '@/components/ui/EmptyState'
import {
  BUSINESS_CHANNEL_MAP,
  hasMultipleSources,
  sourcesOfChannel,
  type BusinessChannelId,
  type SalesSourceId,
} from '@/config/channels'
import { formatCurrencyCompact, formatCurrencyFull, formatNumber, formatPercent } from '@/lib/format'
import { useChannelData } from './useChannelData'
import { TopProducts } from './TopProducts'

/**
 * One business channel's operating analytics.
 *
 * There is deliberately no P&L here. A channel's P&L lives in the central P&L
 * section alongside every other channel's, in one format, so the same numbers
 * cannot be produced two ways. This page answers operating questions: what
 * sold, to how many people, how much came back.
 */
export function ChannelDashboardPage() {
  const { channelId } = useParams<{ channelId: string }>()
  const channel = channelId as BusinessChannelId
  const channelDef = BUSINESS_CHANNEL_MAP[channel]

  // Amazon India is fed by two reports. Management sees the consolidated
  // channel by default and can narrow to either source when they want to know
  // which side of the business moved.
  const [source, setSource] = useState<SalesSourceId | 'all'>('all')
  const d = useChannelData(channel, source === 'all' ? undefined : source)

  if (!channelDef) {
    return (
      <PageShell title="Channel not found">
        <EmptyState title="Unknown channel" description="This channel is not configured." />
      </PageShell>
    )
  }

  const sourcePicker = hasMultipleSources(channel) && (
    <label className="flex items-center gap-2 text-xs font-medium text-slate-500">
      Sales source
      <select
        value={source}
        onChange={(e) => setSource(e.target.value as SalesSourceId | 'all')}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none"
      >
        <option value="all">All</option>
        {sourcesOfChannel(channel).map((s) => (
          <option key={s.id} value={s.id}>{s.label}</option>
        ))}
      </select>
    </label>
  )

  if (d.currentFacts.orders === 0 && d.currentFacts.netSales === 0) {
    return (
      <PageShell title={channelDef.label} subtitle="Channel dashboard">
        {sourcePicker && <div className="mb-4">{sourcePicker}</div>}
        <EmptyState
          title={`No ${channelDef.label} data available for this month.`}
          description="Upload this channel's order report to activate the dashboard."
        />
      </PageShell>
    )
  }

  return (
    <PageShell
      title={channelDef.label}
      subtitle={source === 'all' ? 'Sales, products, growth and returns' : `Sales source: ${sourcesOfChannel(channel).find((s) => s.id === source)?.label}`}
    >
      {sourcePicker && <div>{sourcePicker}</div>}

      {d.partialSettlementWarning && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <h3 className="text-sm font-semibold text-amber-900">⚠ This month's settlement report may be incomplete</h3>
          <p className="mt-1 text-xs text-amber-800">{d.partialSettlementWarning}</p>
          <Link to="/pnl" className="mt-2 inline-block text-xs font-semibold text-amber-900 underline">
            See the full reconciliation
          </Link>
        </div>
      )}

      <KPIGrid>
        <KPICard
          label="Net Sales"
          value={formatCurrencyCompact(d.currentFacts.netSales)}
          delta={{ pct: d.growth, label: 'MoM' }}
          note={d.sourceLabel}
        />
        <KPICard label="Units" value={formatNumber(d.currentFacts.units)} />
        <KPICard label="Orders" value={formatNumber(d.currentFacts.orders)} />
        <KPICard label="AOV" value={formatCurrencyCompact(d.aov)} />
        <KPICard label="ASP" value={formatCurrencyCompact(d.asp)} />
        <KPICard label="RTO %" value={formatPercent(d.rtoRate)} tone={d.rtoRate > 5 ? 'bad' : 'neutral'} />
        <KPICard label="Returns %" value={formatPercent(d.returnRate)} />
        <KPICard
          label="Growth"
          value={d.growth === null ? '—' : `${d.growth >= 0 ? '+' : ''}${formatPercent(d.growth)}`}
          tone={d.growth === null ? 'neutral' : d.growth >= 0 ? 'good' : 'bad'}
        />
      </KPIGrid>

      {source === 'all' && d.sourceBreakdown.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-700">Sales sources</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {channelDef.label} is one business channel fed by {d.sourceBreakdown.length} reports. This is how the month splits between
            them.
          </p>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="py-1.5 text-left text-xs font-semibold text-slate-500">Source</th>
                <th className="py-1.5 text-right text-xs font-semibold text-slate-500">Net Sales</th>
                <th className="py-1.5 text-right text-xs font-semibold text-slate-500">Units</th>
                <th className="py-1.5 text-right text-xs font-semibold text-slate-500">Orders</th>
                <th className="py-1.5 text-right text-xs font-semibold text-slate-500">Share</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {d.sourceBreakdown.map((row) => {
                const total = d.sourceBreakdown.reduce((s, r) => s + r.figure.netSales, 0)
                return (
                  <tr key={row.source} className="border-b border-slate-100 last:border-0">
                    <td className="py-1.5 text-slate-800">{row.label}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-800">{formatCurrencyFull(row.figure.netSales)}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-600">{formatNumber(row.figure.units)}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-600">{formatNumber(row.figure.orders)}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-500">
                      {total > 0 ? formatPercent((row.figure.netSales / total) * 100) : '—'}
                    </td>
                    <td className="py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => setSource(row.source)}
                        className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-400">
            Source figures come from order reports. The channel total above may come from a settlement report, which covers the
            channel as a whole and cannot be split between sources.
          </p>
        </section>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Sales Trend (6 Months)">
          <TrendLineChart data={d.trend} xKey="month" series={[{ key: 'netSales', label: 'Net Sales' }]} valueFormatter={(v) => formatCurrencyCompact(v)} />
        </ChartCard>
        <ChartCard title="Units Trend (6 Months)">
          <TrendLineChart data={d.trend} xKey="month" series={[{ key: 'units', label: 'Units' }]} />
        </ChartCard>
        <ChartCard title="Category Performance">
          <MixDonutChart data={d.categorySales} valueFormatter={(v) => formatCurrencyCompact(v)} />
        </ChartCard>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Top Products</h2>
        <TopProducts channel={channel} source={source === 'all' ? undefined : source} />
      </section>

      <p className="text-xs text-slate-500">
        This channel's P&amp;L is in the <Link to="/pnl" className="font-medium text-indigo-600 underline">P&amp;L</Link> section, in the
        same format as every other channel.
      </p>
    </PageShell>
  )
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="mb-2 text-sm font-semibold text-slate-700">{title}</h3>
      {children}
    </div>
  )
}
