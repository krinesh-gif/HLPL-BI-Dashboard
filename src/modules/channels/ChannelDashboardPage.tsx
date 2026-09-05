import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { PageShell } from '@/components/layout/PageShell'
import { KPICard, KPIGrid } from '@/components/ui/KPICard'
import { TrendLineChart, type SeriesDef } from '@/components/charts/TrendLineChart'
import { SegmentedControl } from '@/components/ui/Surface'
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
  const [trendView, setTrendView] = useState<'both' | 'sales' | 'units'>('both')
  const [source, setSource] = useState<SalesSourceId | 'all'>('all')
  const d = useChannelData(channel, source === 'all' ? undefined : source)

  if (!channelDef) {
    return (
      <PageShell showChannelFilter={false} title="Channel not found">
        <EmptyState title="Unknown channel" description="This channel is not configured." />
      </PageShell>
    )
  }

  const sourcePicker = hasMultipleSources(channel) && (
    <label className="flex items-center gap-2 text-xs font-medium text-[var(--ink-3)]">
      Sales source
      <select
        value={source}
        onChange={(e) => setSource(e.target.value as SalesSourceId | 'all')}
        className="rounded-md border border-[var(--line-2)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
      >
        <option value="all">All</option>
        {sourcesOfChannel(channel).map((s) => (
          <option key={s.id} value={s.id}>{s.label}</option>
        ))}
      </select>
    </label>
  )

  if (d.currentFacts.units === 0 && d.currentFacts.netSales === 0) {
    return (
      <PageShell showChannelFilter={false} title={channelDef.label} subtitle="Channel dashboard">
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
      showChannelFilter={false}
      title={channelDef.label}
      subtitle={source === 'all' ? 'Sales, products, growth and returns' : `Sales source: ${sourcesOfChannel(channel).find((s) => s.id === source)?.label}`}
    >
      {sourcePicker && <div>{sourcePicker}</div>}

      {d.partialSettlementWarning && (
        <div className="rounded-lg border border-[color-mix(in_oklab,var(--warning)_45%,transparent)] bg-[color-mix(in_oklab,var(--warning)_12%,transparent)] p-4">
          <h3 className="text-sm font-semibold text-[var(--ink)]">⚠ This month's settlement report may be incomplete</h3>
          <p className="mt-1 text-xs text-[var(--ink-2)]">{d.partialSettlementWarning}</p>
          <Link to="/pnl" className="mt-2 inline-block text-xs font-semibold text-[var(--ink)] underline">
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
        {/* Amazon USA's report is one row per SKU per month and carries no
            order count. "—" is the honest answer; 35 was its SKU count, and the
            average order value derived from it was nonsense. */}
        <KPICard
          label="Orders"
          value={d.orders === null ? '—' : formatNumber(d.orders)}
          note={d.orders === null ? 'not reported by this channel’s file' : undefined}
        />
        <KPICard
          label="AOV"
          value={d.aov === null ? '—' : formatCurrencyCompact(d.aov)}
          note={d.aov === null ? 'needs an order count' : undefined}
        />
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
        <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3">
          <h3 className="text-sm font-semibold text-[var(--ink-2)]">Sales sources</h3>
          <p className="mt-0.5 text-xs text-[var(--ink-3)]">
            {channelDef.label} is one business channel fed by {d.sourceBreakdown.length} reports. This is how the month splits between
            them.
          </p>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--line)]">
                <th className="py-1.5 text-left text-xs font-semibold text-[var(--ink-3)]">Source</th>
                <th className="py-1.5 text-right text-xs font-semibold text-[var(--ink-3)]">Net Sales</th>
                <th className="py-1.5 text-right text-xs font-semibold text-[var(--ink-3)]">Units</th>
                <th className="py-1.5 text-right text-xs font-semibold text-[var(--ink-3)]">Orders</th>
                <th className="py-1.5 text-right text-xs font-semibold text-[var(--ink-3)]">Share</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {d.sourceBreakdown.map((row) => {
                const total = d.sourceBreakdown.reduce((s, r) => s + r.figure.netSales, 0)
                return (
                  <tr key={row.source} className="border-b border-[var(--line)] last:border-0">
                    <td className="py-1.5 text-[var(--ink)]">{row.label}</td>
                    <td className="py-1.5 text-right tabular-nums text-[var(--ink)]">{formatCurrencyFull(row.figure.netSales)}</td>
                    <td className="py-1.5 text-right tabular-nums text-[var(--ink-2)]">{formatNumber(row.figure.units)}</td>
                    <td className="py-1.5 text-right tabular-nums text-[var(--ink-2)]">{row.figure.hasAggregateRows ? '—' : formatNumber(row.figure.orders)}</td>
                    <td className="py-1.5 text-right tabular-nums text-[var(--ink-3)]">
                      {total > 0 ? formatPercent((row.figure.netSales / total) * 100) : '—'}
                    </td>
                    <td className="py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => setSource(row.source)}
                        className="text-xs font-medium text-[var(--accent)] hover:opacity-80"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-[var(--ink-3)]">
            Source figures come from order reports. The channel total above may come from a settlement report, which covers the
            channel as a whole and cannot be split between sources.
          </p>
        </section>
      )}

      {/* Sales and units on one set of months, so the two can be read against
          each other: units flat while sales climb is a price rise, and the two
          diverging is the thing worth knowing. They keep separate axes because
          ₹36 lakh and 3,000 units share no scale — on one axis the units would
          be a flat line along the bottom. */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ChartCard
            title="Sales & Units (6 Months)"
            action={
              <SegmentedControl
                value={trendView}
                onChange={setTrendView}
                options={[
                  { value: 'both', label: 'Both' },
                  { value: 'sales', label: 'Net Sales' },
                  { value: 'units', label: 'Units' },
                ]}
              />
            }
          >
            <TrendLineChart
              data={d.trend}
              xKey="month"
              height={248}
              // A lone series takes the left axis: a second scale is only
              // worth its width when there are two magnitudes to separate.
              series={
                trendView === 'both'
                  ? TREND_SERIES
                  : TREND_SERIES.filter((s) => s.key === (trendView === 'sales' ? 'netSales' : 'units'))
                      .map((s) => ({ ...s, axis: 'left' as const }))
              }
            />
          </ChartCard>
        </div>
        <ChartCard title="Category Performance">
          <MixDonutChart data={d.categorySales} height={248} valueFormatter={(v) => formatCurrencyCompact(v)} />
        </ChartCard>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--ink-3)]">Top Products</h2>
        <TopProducts channel={channel} source={source === 'all' ? undefined : source} />
      </section>

      <p className="text-xs text-[var(--ink-3)]">
        This channel's P&amp;L is in the <Link to="/pnl" className="font-medium text-[var(--accent)] underline">P&amp;L</Link> section, in the
        same format as every other channel.
      </p>
    </PageShell>
  )
}

/** The two trend lines, each on its own scale and its own colour. */
const TREND_SERIES: SeriesDef[] = [
  { key: 'netSales', label: 'Net Sales', axis: 'left', color: 'var(--series-1)', valueFormatter: (v: number) => formatCurrencyCompact(v) },
  { key: 'units', label: 'Units', axis: 'right', color: 'var(--series-2)', valueFormatter: (v: number) => formatNumber(v) },
]

function ChartCard({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="h-full rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--ink-2)]">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  )
}
