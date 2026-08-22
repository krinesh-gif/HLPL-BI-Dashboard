import { PageShell } from '@/components/layout/PageShell'
import { useOverviewData } from '@/modules/overview/useOverviewData'
import type { Insight } from '@/engine/insight'

const CATEGORY_LABEL: Record<Insight['category'], string> = {
  revenue: 'Revenue',
  margin: 'Margin',
  channel: 'Channel',
  sku: 'SKU / Product',
  ads: 'Marketing',
  inventory: 'Inventory',
}

const SEVERITY_ICON: Record<Insight['severity'], string> = { red: '🔴', orange: '🟠', green: '🟢' }

export function InsightPage() {
  const d = useOverviewData()

  const byCategory = d.insights.reduce<Record<string, Insight[]>>((acc, insight) => {
    acc[insight.category] = acc[insight.category] ?? []
    acc[insight.category].push(insight)
    return acc
  }, {})

  return (
    <PageShell title="Business Insight" subtitle="What happened, why, and what to do about it">
      {Object.keys(byCategory).length === 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">
          No significant movements detected for the current filters. Insights only appear when data crosses a
          configured threshold — this keeps every statement traceable back to a number.
        </div>
      )}
      {Object.entries(byCategory).map(([category, insights]) => (
        <section key={category}>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            {CATEGORY_LABEL[category as Insight['category']]}
          </h2>
          <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
            {insights.map((insight, i) => (
              <div key={i} className="flex items-start gap-2 text-sm text-slate-700">
                <span aria-hidden>{SEVERITY_ICON[insight.severity]}</span>
                <span>{insight.message}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </PageShell>
  )
}
