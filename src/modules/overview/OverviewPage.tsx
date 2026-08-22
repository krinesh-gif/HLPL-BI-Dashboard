import type { ReactNode } from 'react'
import { PageShell } from '@/components/layout/PageShell'
import { KPICard, KPIGrid } from '@/components/ui/KPICard'
import { ActionRequiredList } from '@/components/ui/ActionRequiredList'
import { formatCurrencyCompact, formatNumber, formatPercent } from '@/lib/format'
import { useOverviewData } from './useOverviewData'

export function OverviewPage() {
  const d = useOverviewData()

  return (
    <PageShell title="Executive Overview" subtitle="How is my business performing right now?">
      <Section title="Revenue">
        <KPIGrid>
          <KPICard label="Current Month Revenue" value={formatCurrencyCompact(d.masterCurrent.lines.netSales ?? 0)} delta={{ pct: d.revenueGrowthMoM, label: 'MoM' }} />
          <KPICard label="Previous Month Revenue" value={formatCurrencyCompact(d.masterPrevious.lines.netSales ?? 0)} />
          <KPICard label="YTD Revenue" value={formatCurrencyCompact(d.ytdNetSales)} delta={{ pct: d.ytdGrowth, label: 'YoY' }} />
          <KPICard label="Orders" value={formatNumber(d.currentFacts.orders)} delta={{ pct: d.ordersGrowthMoM, label: 'MoM' }} />
        </KPIGrid>
      </Section>

      <Section title="Profitability">
        <KPIGrid>
          <KPICard label="Gross Profit" value={formatCurrencyCompact(d.masterCurrent.lines.grossProfit ?? 0)} />
          <KPICard label="Gross Margin %" value={formatPercent(d.masterCurrent.lines.grossMarginPct ?? 0)} />
          <KPICard label="Contribution Profit" value={formatCurrencyCompact(d.masterCurrent.lines.contributionProfit ?? 0)} />
          <KPICard label="Contribution Margin %" value={formatPercent(d.masterCurrent.lines.contributionMarginPct ?? 0)} />
          <KPICard label="EBITDA" value={formatCurrencyCompact(d.masterCurrent.lines.ebitda ?? 0)} />
          <KPICard label="EBITDA Margin %" value={formatPercent(d.masterCurrent.lines.ebitdaMarginPct ?? 0)} />
          <KPICard label="Units Sold" value={formatNumber(d.currentFacts.quantity)} />
          <KPICard label="AOV / ASP" value={`${formatCurrencyCompact(d.aov)} / ${formatCurrencyCompact(d.asp)}`} />
        </KPIGrid>
      </Section>

      <Section title="Channels">
        <KPIGrid>
          <KPICard label="Best-Performing Channel" value={d.bestChannel?.label ?? '—'} />
          <KPICard label="Fastest-Growing Channel" value={d.fastestGrowing?.label ?? '—'} delta={{ pct: d.fastestGrowing?.growth ?? null }} />
          <KPICard label="Most Profitable Channel" value={d.mostProfitable?.label ?? '—'} />
          <KPICard label="Weakest Channel" value={d.weakest?.label ?? '—'} delta={{ pct: d.weakest?.growth ?? null }} />
        </KPIGrid>
      </Section>

      <Section title="Products">
        <KPIGrid>
          <KPICard label="Top SKU" value={d.topSku?.productName ?? '—'} />
          <KPICard label="Fastest-Growing SKU" value={d.fastestGrowingSku?.productName ?? '—'} delta={{ pct: d.fastestGrowingSku?.growth ?? null }} />
          <KPICard label="Declining SKU" value={d.decliningSku?.productName ?? '—'} delta={{ pct: d.decliningSku?.growth ?? null }} />
          <KPICard label="Stock-Out Risk SKUs" value={String(d.stockOutRiskSkus.length)} tone={d.stockOutRiskSkus.length > 0 ? 'bad' : 'neutral'} />
        </KPIGrid>
      </Section>

      <Section title="Marketing">
        <KPIGrid>
          <KPICard label="Ad Spend" value={formatCurrencyCompact(d.totalAdSpend)} />
          <KPICard label="ROAS" value={`${d.roas.toFixed(1)}x`} />
          <KPICard label="ACOS" value={formatPercent(d.acos)} />
          <KPICard label="TACOS" value={formatPercent(d.tacos)} />
        </KPIGrid>
      </Section>

      <Section title="Inventory">
        <KPIGrid>
          <KPICard label="Inventory Value" value={formatCurrencyCompact(d.inventoryValue)} />
          <KPICard label="Avg Stock Coverage" value={`${Math.round(d.avgCoverageDays)} days`} />
          <KPICard label="Stock-Out Risk" value={String(d.stockOutRiskSkus.length)} tone={d.stockOutRiskSkus.length > 0 ? 'bad' : 'neutral'} />
          <KPICard label="Excess Inventory" value={String(d.excessInventorySkus.length)} tone={d.excessInventorySkus.length > 0 ? 'bad' : 'neutral'} />
        </KPIGrid>
      </Section>

      <ActionRequiredList insights={d.insights} />
    </PageShell>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {children}
    </section>
  )
}
