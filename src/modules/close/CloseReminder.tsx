import { Link } from 'react-router-dom'
import { monthLabel } from '@/lib/format'
import { useMonthlyClose } from './useMonthlyClose'

/**
 * The standing reminder of what the month is still missing.
 *
 * On the Overview, where the day starts, because a gap nobody is reminded of
 * is found on the send date. It says the count and nothing else: the list
 * belongs on Monthly Close, and a strip that tries to be the list stops
 * being read.
 */
export function CloseReminder() {
  const close = useMonthlyClose()
  const { blockers, warnings, redFlags, ready, month } = close

  const tone = blockers.length > 0 ? 'var(--critical)' : redFlags.length > 0 ? 'var(--warning)' : 'var(--positive)'
  const counts = [
    blockers.length > 0 ? `${blockers.length} blocking the report` : null,
    redFlags.length > 0 ? `${redFlags.length} needing attention` : null,
    warnings.length > 0 ? `${warnings.length} worth knowing` : null,
  ].filter(Boolean)

  return (
    <div
      className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border px-4 py-2.5"
      style={{
        borderColor: `color-mix(in oklab, ${tone} 40%, transparent)`,
        background: `color-mix(in oklab, ${tone} 8%, transparent)`,
      }}
    >
      <p className="text-sm text-[var(--ink)]">
        <span className="font-semibold">{monthLabel(month)} close:</span>{' '}
        {ready && counts.length === 0
          ? 'everything is in. The report can go out.'
          : counts.join(' · ')}
      </p>
      <Link
        to="/close"
        className="shrink-0 rounded border border-[var(--line-2)] bg-[var(--surface)] px-2.5 py-1 text-xs font-medium text-[var(--ink-2)] hover:border-[var(--accent)] hover:text-[var(--ink)]"
      >
        Open Monthly Close
      </Link>
    </div>
  )
}
