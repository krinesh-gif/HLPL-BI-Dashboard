import type { ReactNode } from 'react'
import { PageShell } from '@/components/layout/PageShell'
import { KPICard, KPIGrid } from '@/components/ui/KPICard'
import { ActionRequiredList } from '@/components/ui/ActionRequiredList'
import { Card, CardHeader } from '@/components/ui/Surface'
import { TrendLineChart } from '@/components/charts/TrendLineChart'
import { formatCurrencyCompact, formatNumber, formatPercent, monthLabel } from '@/lib/format'
import { useOverviewData } from './useOverviewData'

/** One series colour per section, so the page reads as five groups rather than
 * one wall of identical tiles — and so the colour means "which section", not
 * "which number is important". */
const SECTION_ACCENT = {
  Revenue: 1, Profitability: 3, Channels: 7, Products: 2, Marketing: 5, Inventory: 4,
} as const

export function OverviewPage() {
  const d = useOverviewData()

  return (
    <PageShell title="Executive Overview" subtitle="How is my business performing right now?">
      {/* The headline the whole page is about, given room to be the headline —
          with its own trend beside it so the number arrives with its shape. */}
      <Card className="overflow-hidden !p-0">
        <div className="grid gap-6 lg:grid-cols-[minmax(240px,340px)_1fr]">
          <div className="flex flex-col justify-center gap-1 border-b border-[var(--line)] p-6 lg:border-r lg:border-b-0">
            <div className="text-[11px] font-semibold tracking-wide text-[var(--ink-3)] uppercase">
              Net Sales · {monthLabel(d.month)}
            </div>
            <div className="text-[40px] leading-none font-semibold text-[var(--ink)]">
              {formatCurrencyCompact(d.masterCurrent.lines.netSales ?? 0)}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {d.revenueGrowthMoM !== null && (
                <span
                  className={
                    'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ' +
                    (d.revenueGrowthMoM >= 0
                      ? 'bg-[color-mix(in_oklab,var(--good)_14%,transparent)] text-[var(--good-ink)]'
                      : 'bg-[color-mix(in_oklab,var(--critical)_14%,transparent)] text-[var(--critical-ink)]')
                  }
                >
                  {d.revenueGrowthMoM >= 0 ? '↑' : '↓'} {Math.abs(d.revenueGrowthMoM).toFixed(1)}% MoM
                </span>
              )}
              <span className="text-[11px] text-[var(--ink-3)]">
                {formatNumber(d.currentFacts.orders)} orders · {formatNumber(d.currentFacts.units)} units
              </span>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3">
              {[
                ['Gross margin', formatPercent(d.masterCurrent.lines.grossMarginPct ?? 0)],
                ['EBITDA margin', formatPercent(d.masterCurrent.lines.ebitdaMarginPct ?? 0)],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[10px] font-semibold tracking-wide text-[var(--ink-3)] uppercase">{k}</dt>
                  <dd className="mt-0.5 text-[15px] font-semibold text-[var(--ink)]">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="p-5">
            <CardHeader title="Last 6 months" subtitle="Net sales, gross profit and EBITDA from the same engine as the figures above" />
            <TrendLineChart
              data={d.trend.map((t) => ({
                month: monthLabel(t.month),
                'Net sales': t.netSales,
                'Gross profit': t.grossProfit,
                EBITDA: t.ebitda,
              }))}
              xKey="month"
              series={[
                { key: 'Net sales', label: 'Net sales' },
                { key: 'Gross profit', label: 'Gross profit' },
                { key: 'EBITDA', label: 'EBITDA' },
              ]}
              height={220}
              valueFormatter={formatCurrencyCompact}
            />
          </div>
        </div>
      </Card>

      <Section title="Revenue">
        <KPIGrid>
          <KPICard accent={1} label="Current Month Revenue" value={formatCurrencyCompact(d.masterCurrent.lines.netSales ?? 0)} delta={{ pct: d.revenueGrowthMoM, label: 'MoM' }} spark={d.trend.map((t) => t.netSales)} />
          <KPICard accent={1} label="Previous Month Revenue" value={formatCurrencyCompact(d.masterPrevious.lines.netSales ?? 0)} />
          <KPICard accent={1} label="YTD Revenue" value={formatCurrencyCompact(d.ytdNetSales)} delta={{ pct: d.ytdGrowth, label: 'YoY' }} />
          <KPICard accent={1} label="Orders" value={formatNumber(d.currentFacts.orders)} delta={{ pct: d.ordersGrowthMoM, label: 'MoM' }} spark={d.trend.map((t) => t.orders)} />
        </KPIGrid>
      </Section>

      <Section title="Profitability">
        <KPIGrid>
          <KPICard accent={3} label="Gross Profit" value={formatCurrencyCompact(d.masterCurrent.lines.grossProfit ?? 0)} spark={d.trend.map((t) => t.grossProfit)} />
          <KPICard accent={3} label="Gross Margin %" value={formatPercent(d.masterCurrent.lines.grossMarginPct ?? 0)} />
          <KPICard accent={3} label="Contribution Profit" value={formatCurrencyCompact(d.masterCurrent.lines.contributionProfit ?? 0)} />
          <KPICard accent={3} label="Contribution Margin %" value={formatPercent(d.masterCurrent.lines.contributionMarginPct ?? 0)} />
          <KPICard accent={3} label="EBITDA" value={formatCurrencyCompact(d.masterCurrent.lines.ebitda ?? 0)} spark={d.trend.map((t) => t.ebitda)} />
          <KPICard accent={3} label="EBITDA Margin %" value={formatPercent(d.masterCurrent.lines.ebitdaMarginPct ?? 0)} />
          <KPICard accent={3} label="Units Sold" value={formatNumber(d.currentFacts.units)} spark={d.trend.map((t) => t.units)} />
          <KPICard accent={3} label="AOV / ASP" value={`${formatCurrencyCompact(d.aov)} / ${formatCurrencyCompact(d.asp)}`} />
        </KPIGrid>
      </Section>

      <Section title="Channels">
        <KPIGrid>
          <KPICard accent={7} label="Best-Performing Channel" value={d.bestChannel?.label ?? '—'} />
          <KPICard accent={7} label="Fastest-Growing Channel" value={d.fastestGrowing?.label ?? '—'} delta={{ pct: d.fastestGrowing?.growth ?? null }} />
          <KPICard accent={7} label="Most Profitable Channel" value={d.mostProfitable?.label ?? '—'} />
          <KPICard accent={7} label="Weakest Channel" value={d.weakest?.label ?? '—'} delta={{ pct: d.weakest?.growth ?? null }} />
        </KPIGrid>
      </Section>

      <Section title="Products">
        <KPIGrid>
          <KPICard accent={2} label="Top SKU" value={d.topSku?.productName ?? '—'} />
          <KPICard accent={2} label="Fastest-Growing SKU" value={d.fastestGrowingSku?.productName ?? '—'} delta={{ pct: d.fastestGrowingSku?.growth ?? null }} />
          <KPICard accent={2} label="Declining SKU" value={d.decliningSku?.productName ?? '—'} delta={{ pct: d.decliningSku?.growth ?? null }} />
          <KPICard accent={2} label="Stock-Out Risk SKUs" value={String(d.stockOutRiskSkus.length)} tone={d.stockOutRiskSkus.length > 0 ? 'bad' : 'neutral'} />
        </KPIGrid>
      </Section>

      <Section title="Marketing">
        <KPIGrid>
          <KPICard accent={5} label="Ad Spend" value={formatCurrencyCompact(d.totalAdSpend)} />
          <KPICard accent={5} label="ROAS" value={`${d.roas.toFixed(1)}x`} />
          <KPICard accent={5} label="ACOS" value={formatPercent(d.acos)} />
          <KPICard accent={5} label="TACOS" value={formatPercent(d.tacos)} />
        </KPIGrid>
      </Section>

      <Section title="Inventory">
        <KPIGrid>
          <KPICard accent={4} label="Inventory Value" value={formatCurrencyCompact(d.inventoryValue)} />
          <KPICard accent={4} label="Avg Stock Coverage" value={`${Math.round(d.avgCoverageDays)} days`} />
          <KPICard accent={4} label="Stock-Out Risk" value={String(d.stockOutRiskSkus.length)} tone={d.stockOutRiskSkus.length > 0 ? 'bad' : 'neutral'} />
          <KPICard accent={4} label="Excess Inventory" value={String(d.excessInventorySkus.length)} tone={d.excessInventorySkus.length > 0 ? 'bad' : 'neutral'} />
        </KPIGrid>
      </Section>

      <ActionRequiredList insights={d.insights} />
    </PageShell>
  )
}

function Section({ title, children }: { title: keyof typeof SECTION_ACCENT; children: ReactNode }) {
  const accent = SECTION_ACCENT[title]
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-[11px] font-semibold tracking-wide text-[var(--ink-3)] uppercase">
        <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: `var(--series-${accent})` }} />
        {title}
      </h2>
      {children}
    </section>
  )
}
