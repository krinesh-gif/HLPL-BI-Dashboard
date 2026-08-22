import type { Insight } from '@/engine/insight'

const SEVERITY_ICON: Record<Insight['severity'], string> = {
  red: '🔴',
  orange: '🟠',
  green: '🟢',
}

export function ActionRequiredList({ insights, title = 'Action Required' }: { insights: Insight[]; title?: string }) {
  if (insights.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="text-sm font-semibold text-slate-800">{title}</div>
        <div className="mt-2 text-sm text-slate-500">No significant items detected for the current filters.</div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-sm font-semibold text-slate-800">{title}</div>
      <ul className="mt-3 space-y-2">
        {insights.map((insight, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
            <span aria-hidden>{SEVERITY_ICON[insight.severity]}</span>
            <span>{insight.message}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
