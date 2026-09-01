import { monthLabel } from '@/lib/format'
import type { MetricLevel } from '@/engine/momMetrics'

const LEVELS: { key: MetricLevel; label: string }[] = [
  { key: 'master', label: 'Master' },
  { key: 'channel', label: 'Channel' },
  { key: 'category', label: 'Category' },
  { key: 'sku', label: 'SKU' },
]

/** The level and comparison-month pickers, shared by the ASP and RTO screens. */
export function MomControls({
  level,
  setLevel,
  compareMonth,
  setCompareMonth,
  month,
  monthOptions,
  children,
}: {
  level: MetricLevel
  setLevel: (level: MetricLevel) => void
  compareMonth: string
  setCompareMonth: (month: string) => void
  month: string
  monthOptions: string[]
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-[var(--ink-3)]">Level</span>
      <div className="flex rounded-md border border-[var(--line-2)] bg-[var(--surface)] p-0.5">
        {LEVELS.map((l) => (
          <button
            key={l.key}
            type="button"
            onClick={() => setLevel(l.key)}
            className={`rounded px-3 py-1 text-sm font-medium transition ${
              level === l.key ? 'bg-[var(--accent)] text-[var(--accent-ink)]' : 'text-[var(--ink-2)] hover:bg-[var(--surface-hover)]'
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>

      <label className="ml-2 flex items-center gap-2 text-xs font-medium text-[var(--ink-3)]">
        Compare {monthLabel(month)} with
        <select
          value={compareMonth}
          onChange={(e) => setCompareMonth(e.target.value)}
          className="rounded-md border border-[var(--line-2)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
        >
          {monthOptions
            .filter((m) => m !== month)
            .map((m) => (
              <option key={m} value={m}>{monthLabel(m)}</option>
            ))}
        </select>
      </label>

      {children}
    </div>
  )
}
