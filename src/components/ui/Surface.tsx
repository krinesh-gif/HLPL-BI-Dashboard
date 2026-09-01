import clsx from 'clsx'
import type { ReactNode } from 'react'

/**
 * The card every panel in the app is built on.
 *
 * One component rather than a repeated string of utility classes, so the
 * elevation, radius and border of the whole product move together — and so a
 * page cannot quietly invent its own card.
 */
export function Card({
  children,
  className,
  padded = true,
  interactive = false,
}: {
  children: ReactNode
  className?: string
  padded?: boolean
  /** Lifts slightly on hover. For cards that lead somewhere. */
  interactive?: boolean
}) {
  return (
    <div
      className={clsx(
        'rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)]',
        'shadow-[var(--shadow-card)]',
        padded && 'p-5',
        interactive && 'transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)]',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** A card's heading row: title on the left, controls on the right. */
export function CardHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={clsx('mb-4 flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <h3 className="text-[13px] font-semibold tracking-wide text-[var(--ink)] uppercase">{title}</h3>
        {subtitle && <p className="mt-1 text-xs text-[var(--ink-3)]">{subtitle}</p>}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  )
}

/** Small status/among-text label. Colour never carries the meaning alone —
 * the word inside it does. */
export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode
  tone?: 'neutral' | 'good' | 'bad' | 'warn' | 'accent'
  className?: string
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
        tone === 'neutral' && 'bg-[var(--surface-2)] text-[var(--ink-2)] ring-1 ring-[var(--line)]',
        tone === 'good' && 'bg-[color-mix(in_oklab,var(--good)_14%,transparent)] text-[var(--good-ink)]',
        tone === 'bad' && 'bg-[color-mix(in_oklab,var(--critical)_14%,transparent)] text-[var(--critical-ink)]',
        tone === 'warn' && 'bg-[color-mix(in_oklab,var(--warning)_20%,transparent)] text-[var(--ink)]',
        tone === 'accent' && 'bg-[var(--accent-soft)] text-[var(--accent)]',
        className,
      )}
    >
      {children}
    </span>
  )
}

/** A segmented pill control — the app's standard for 2–4 exclusive options. */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
}: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (value: T) => void
  size?: 'sm' | 'md'
}) {
  return (
    <div className="inline-flex rounded-full border border-[var(--line)] bg-[var(--surface-2)] p-0.5">
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={clsx(
              'rounded-full font-medium transition-colors',
              size === 'sm' ? 'px-2.5 py-1 text-[11px]' : 'px-3.5 py-1.5 text-xs',
              active
                ? 'bg-[var(--surface)] text-[var(--ink)] shadow-[var(--shadow-card)]'
                : 'text-[var(--ink-3)] hover:text-[var(--ink-2)]',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
