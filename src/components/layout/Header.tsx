import type { ReactNode } from 'react'
import { useDataStore } from '@/store/dataStore'

export function Header({
  title,
  subtitle,
  actions,
}: {
  /** A node, not a string, so a channel can lead with its logo. */
  title: ReactNode
  subtitle?: string
  /** Sits on the title's own line. The filters go here: they belong to the
   * page, and giving them a strip of their own pushed the first figure down
   * the screen for a control that is three words wide. */
  actions?: ReactNode
}) {
  const isEmpty = useDataStore((s) => s.isEmpty)

  return (
    // No rule under the title: the cards below sit on the plane as their own
    // shapes, and a full-width border above them would cut the page in two
    // where nothing actually divides.
    <header className="sticky top-0 z-20 bg-[color-mix(in_oklab,var(--plane)_85%,transparent)] px-6 pt-6 pb-4 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
        <div className="min-w-0">
          <h1 className="flex min-w-0 items-center gap-3 text-[26px] leading-tight font-bold tracking-[-0.02em] text-[var(--ink)]">
            {title}
          </h1>
          {subtitle && <p className="mt-1 truncate text-[13px] text-[var(--ink-3)]">{subtitle}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {isEmpty && (
            <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-[color-mix(in_oklab,var(--warning)_20%,transparent)] px-3 py-1.5 text-[11px] font-semibold text-[var(--ink)]">
              {/* The icon carries the warning as well as the colour. */}
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" aria-hidden><path d="M12 5v8m0 4h.01" /></svg>
              No data yet — upload a report
            </span>
          )}
          {actions}
        </div>
      </div>
    </header>
  )
}
