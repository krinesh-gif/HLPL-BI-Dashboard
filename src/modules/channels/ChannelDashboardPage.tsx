import type { ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { PageShell } from '@/components/layout/PageShell'
import { KPICard, KPIGrid } from '@/components/ui/KPICard'
import { TrendLineChart } from '@/components/charts/TrendLineChart'
import { ComparisonBarChart } from '@/components/charts/ComparisonBarChart'
import { MixDonutChart } from '@/components/charts/MixDonutChart'
import { PnlTable } from '@/components/pnl/PnlTable'
import { NativePnlTable } from '@/components/pnl/NativePnlTable'
import { EmptyState } from '@/components/ui/EmptyState'
import { CHANNEL_MAP, type ChannelId } from '@/config/channels'
import { formatCurrencyCompact, formatNumber, formatPercent } from '@/lib/format'
import { useChannelData } from './useChannelData'

export function ChannelDashboardPage() {
  const { channelId } = useParams<{ channelId: string }>()
  const channel = channelId as ChannelId
  const channelDef = CHANNEL_MAP[channel]
  const d = useChannelData(channel)

  if (!channelDef) {
    return (
      <PageShell title="Channel not found">
        <EmptyState title="Unknown channel" description="This channel is not configured." />
      </PageShell>
    )
  }

  if (d.currentFacts.orders === 0) {
    return (
      <PageShell title={channelDef.label} subtitle="Channel dashboard">
        <EmptyState
          title={`No ${channelDef.label} data available for this month.`}
          description="Upload this channel's order report to activate the dashboard."
        />
      </PageShell>
    )
  }

  return (
    <PageShell title={channelDef.label} subtitle="KPIs, trends, and standardized P&L for this channel">
      <KPIGrid>
        <KPICard label="Net Sales" value={formatCurrencyCompact(d.currentFacts.netSales)} delta={{ pct: d.growth, label: 'MoM' }} />
        <KPICard label="Units" value={formatNumber(d.currentFacts.units)} />
        <KPICard label="Orders" value={formatNumber(d.currentFacts.orders)} />
        <KPICard label="AOV" value={formatCurrencyCompact(d.aov)} />
        <KPICard label="ASP" value={formatCurrencyCompact(d.asp)} />
        <KPICard label="RTO Rate" value={formatPercent(d.rtoRate)} tone={d.rtoRate > 5 ? 'bad' : 'neutral'} />
        <KPICard label="Return Rate" value={formatPercent(d.returnRate)} />
        <KPICard label="Contribution Margin %" value={formatPercent(d.pnl.lines.contributionMarginPct ?? 0)} />
      </KPIGrid>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Sales Trend (6 Months)">
          <TrendLineChart data={d.trend} xKey="month" series={[{ key: 'netSales', label: 'Net Sales' }]} valueFormatter={(v) => formatCurrencyCompact(v)} />
        </ChartCard>
        <ChartCard title="Units Trend (6 Months)">
          <TrendLineChart data={d.trend} xKey="month" series={[{ key: 'units', label: 'Units' }]} />
        </ChartCard>
        <ChartCard title="Category Sales Mix">
          <MixDonutChart data={d.categorySales} valueFormatter={(v) => formatCurrencyCompact(v)} />
        </ChartCard>
        <ChartCard title="Top SKUs">
          <ComparisonBarChart data={d.topSkus.map((s) => ({ name: s.productName, value: s.netSales }))} xKey="name" yKey="value" horizontal valueFormatter={(v) => formatCurrencyCompact(v)} />
        </ChartCard>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Channel P&L {d.native && '— native structure (real data)'}
        </h2>
        {d.native ? (
          <NativePnlTable lineDefs={d.native.lineDefs} values={d.native.values} currency={d.native.currency} />
        ) : (
          <PnlTable lines={d.pnl.lines} currency={channelDef.currency} />
        )}
      </section>
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
