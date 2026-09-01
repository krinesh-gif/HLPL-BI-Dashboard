import type { Insight } from '@/engine/insight'

const SEVERITY_ICON: Record<Insight['severity'], string> = {
  red: '🔴',
  orange: '🟠',
  green: '🟢',
}

export function ActionRequiredList({ insights, title = 'Action Required' }: { insights: Insight[]; title?: string }) {
  if (insights.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
        <div className="text-sm font-semibold text-[var(--ink)]">{title}</div>
        <div className="mt-2 text-sm text-[var(--ink-3)]">No significant items detected for the current filters.</div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
      <div className="text-sm font-semibold text-[var(--ink)]">{title}</div>
      <ul className="mt-3 space-y-2">
        {insights.map((insight, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-[var(--ink-2)]">
            <span aria-hidden>{SEVERITY_ICON[insight.severity]}</span>
            <span>{insight.message}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
