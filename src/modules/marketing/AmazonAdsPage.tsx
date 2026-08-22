import { PageShell } from '@/components/layout/PageShell'
import { KPICard, KPIGrid } from '@/components/ui/KPICard'
import { DataTable } from '@/components/ui/DataTable'
import { TrendLineChart } from '@/components/charts/TrendLineChart'
import { CorrelationScatterChart } from '@/components/charts/CorrelationScatterChart'
import { EmptyState } from '@/components/ui/EmptyState'
import { formatCurrencyCompact, formatCurrencyFull, formatPercent, monthLabel } from '@/lib/format'
import { useFilterStore } from '@/store/filterStore'
import { useAdsData } from './useAdsData'
import type { AdsActionType } from '@/engine/adsAction'

const ACTION_STYLE: Record<AdsActionType, string> = {
  SCALE: 'bg-emerald-100 text-emerald-700',
  PROTECT: 'bg-sky-100 text-sky-700',
  REDUCE_BID: 'bg-amber-100 text-amber-700',
  NEGATIVE_KEYWORD: 'bg-rose-100 text-rose-700',
  PAUSE: 'bg-slate-200 text-slate-700',
  INVESTIGATE: 'bg-violet-100 text-violet-700',
}

export function AmazonAdsPage() {
  const { month } = useFilterStore()
  const d = useAdsData()

  if (d.campaignRows.length === 0) {
    return (
      <PageShell title="Amazon Ads Analytics">
        <EmptyState title={`No Amazon Ads data available for ${monthLabel(month)}.`} description="Upload the Amazon Ads report to activate this dashboard." />
      </PageShell>
    )
  }

  return (
    <PageShell title="Amazon Ads Analytics" subtitle={monthLabel(month)}>
      <KPIGrid>
        <KPICard label="Ad Spend" value={formatCurrencyCompact(d.totalSpend)} />
        <KPICard label="Ad Sales" value={formatCurrencyCompact(d.totalAdSales)} />
        <KPICard label="ROAS" value={`${d.roas.toFixed(1)}x`} />
        <KPICard label="ACOS" value={formatPercent(d.acos)} />
      </KPIGrid>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">ROAS Trend (6 Months)</h3>
          <TrendLineChart data={d.trend} xKey="month" series={[{ key: 'roas', label: 'ROAS' }]} />
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">Ad Spend vs Ad Sales (by Campaign)</h3>
          <CorrelationScatterChart
            data={d.campaignRows.map((c) => ({ x: c.spend, y: c.adSales, label: c.campaign }))}
            xLabel="Spend"
            yLabel="Ad Sales"
          />
        </div>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Campaign Performance & Recommended Actions</h2>
        <DataTable
          exportFileName={`HLPL_AmazonAds_${month}`}
          columns={[
            { key: 'campaign', header: 'Campaign', accessor: (r) => r.campaign },
            { key: 'spend', header: 'Spend', accessor: (r) => r.spend, align: 'right', render: (r) => formatCurrencyFull(r.spend) },
            { key: 'adSales', header: 'Ad Sales', accessor: (r) => r.adSales, align: 'right', render: (r) => formatCurrencyFull(r.adSales) },
            { key: 'roas', header: 'ROAS', accessor: (r) => r.roas, align: 'right', render: (r) => `${r.roas.toFixed(2)}x` },
            { key: 'acos', header: 'ACOS', accessor: (r) => r.acos, align: 'right', render: (r) => formatPercent(r.acos) },
            { key: 'ctr', header: 'CTR', accessor: (r) => r.ctr, align: 'right', render: (r) => formatPercent(r.ctr, 2) },
            { key: 'cpc', header: 'CPC', accessor: (r) => r.cpc, align: 'right', render: (r) => formatCurrencyFull(r.cpc) },
            {
              key: 'action',
              header: 'Recommended Action',
              accessor: (r) => r.recommendation.action,
              render: (r) => (
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ACTION_STYLE[r.recommendation.action]}`} title={r.recommendation.reason}>
                  {r.recommendation.action.replace('_', ' ')}
                </span>
              ),
            },
          ]}
          rows={d.campaignRows}
        />
      </section>
    </PageShell>
  )
}
