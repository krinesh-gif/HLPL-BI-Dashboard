import clsx from 'clsx'
import { Children, type ReactNode } from 'react'

export interface KPICardProps {
  label: string
  value: string
  delta?: { pct: number | null; label?: string }
  tone?: 'neutral' | 'good' | 'bad'
  /** Where the figure came from, e.g. which report. Shown small beneath it, so
   * a number can never be read without knowing what produced it. */
  note?: string
  /** Recent values, oldest first. Drawn as a bare sparkline — shape only, no
   * axis: it answers "which way is this going" at a glance, and the number
   * above it carries the magnitude. */
  spark?: number[]
  /** Which series colour the chip and sparkline take. */
  accent?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
}

/** A sparkline with no axes, ticks or labels — deliberately. It is a shape
 * beside a number, not a chart, so it carries no scale of its own. */
function Sparkline({ points, color }: { points: number[]; color: string }) {
  if (points.length < 2) return null
  const w = 72
  const h = 24
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const step = w / (points.length - 1)
  const coords = points.map((p, i) => [i * step, h - ((p - min) / span) * (h - 4) - 2] as const)
  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `${line} L${w},${h} L0,${h} Z`
  const [lastX, lastY] = coords[coords.length - 1]

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="overflow-visible">
      <path d={area} fill={color} opacity={0.14} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {/* The current value gets a ring in the surface colour so it stays
          readable where the line doubles back over itself. */}
      <circle cx={lastX} cy={lastY} r={2.5} fill={color} stroke="var(--surface)" strokeWidth={2} />
    </svg>
  )
}

export function KPICard({ label, value, delta, tone = 'neutral', note, spark, accent = 1 }: KPICardProps) {
  const deltaTone = delta && delta.pct !== null ? (delta.pct >= 0 ? 'good' : 'bad') : 'neutral'
  const color = `var(--series-${accent})`

  return (
    // The tile sizes itself to the width it is given rather than to the grid,
    // so eight across and four across are the same component. A row of eight
    // leaves each about 150px: at that width the chip shrinks, the sparkline
    // goes, and the figure steps down a size — all of which is better than
    // eight figures too small to read, which is what a fixed size would give.
    <div
      className={clsx(
        '@container group relative flex flex-col justify-between overflow-hidden rounded-[var(--radius-card)] p-3 @[190px]:p-4',
        'border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-card)]',
        'transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)]',
      )}
    >
      {/* A tinted chip rather than a rule along the edge: it gives the tile a
          fixed point for the eye to land on, and carries the series hue at a
          size that reads without competing with the figure. */}
      <span
        aria-hidden
        className="flex h-7 w-7 items-center justify-center rounded-[10px] @[190px]:h-9 @[190px]:w-9 @[190px]:rounded-[var(--radius-chip)]"
        style={{ background: `color-mix(in oklab, ${color} 14%, transparent)` }}
      >
        <span className="h-2.5 w-2.5 rounded-[4px] @[190px]:h-3 @[190px]:w-3 @[190px]:rounded-[5px]" style={{ background: color }} />
      </span>

      <div className="mt-2.5 min-w-0 @[190px]:mt-3.5">
        <div className="truncate text-[12px] font-medium text-[var(--ink-3)] @[190px]:text-[13px]" title={label}>{label}</div>
        <div
          className={clsx(
            'mt-1 text-[18px] leading-none font-bold tracking-[-0.02em] @[190px]:mt-1.5 @[190px]:text-[24px]',
            tone === 'good' && 'text-[var(--good-ink)]',
            tone === 'bad' && 'text-[var(--critical-ink)]',
            tone === 'neutral' && 'text-[var(--ink)]',
          )}
        >
          {value}
        </div>
      </div>

      {(delta || (spark && spark.length > 1)) && (
        <div className="mt-2.5 flex items-end justify-between gap-2 @[190px]:mt-3">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {delta && (
              <span
                className={clsx(
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
                  deltaTone === 'good' && 'bg-[color-mix(in_oklab,var(--good)_14%,transparent)] text-[var(--good-ink)]',
                  deltaTone === 'bad' && 'bg-[color-mix(in_oklab,var(--critical)_14%,transparent)] text-[var(--critical-ink)]',
                  deltaTone === 'neutral' && 'bg-[var(--surface-2)] text-[var(--ink-3)]',
                )}
              >
                {/* An arrow as well as a colour, so direction survives a
                    colour-blind reader and a black-and-white print. */}
                {delta.pct === null ? '—' : `${delta.pct >= 0 ? '↑' : '↓'} ${Math.abs(delta.pct).toFixed(1)}%`}
              </span>
            )}
            {delta?.label && <span className="truncate text-[11px] text-[var(--ink-3)]">{delta.label}</span>}
          </div>
          {spark && spark.length > 1 && (
            // The shape goes before the figure does. In a narrow tile it is
            // the first thing that can be spared, because the number above it
            // carries the magnitude and the delta beside it carries the
            // direction; the sparkline only says how it got there.
            <div className="hidden shrink-0 @[190px]:block">
              <Sparkline points={spark} color={color} />
            </div>
          )}
        </div>
      )}

      {note && <div className="mt-2 text-[11px] leading-tight text-[var(--ink-3)]">{note}</div>}
    </div>
  )
}

/**
 * One row, however many tiles there are.
 *
 * The column count follows the number of tiles rather than being fixed, so a
 * page with eight gets eight across and a page with four gets four — neither
 * wraps onto a second row, and neither leaves half a row empty. The tiles
 * themselves adapt to the width that leaves them.
 */
export function KPIGrid({ children }: { children: ReactNode }) {
  const count = Children.count(children)
  const wide: Record<number, string> = {
    1: 'lg:grid-cols-1', 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4',
    5: 'lg:grid-cols-5', 6: 'lg:grid-cols-6', 7: 'lg:grid-cols-7', 8: 'lg:grid-cols-8',
  }
  return (
    // Spelled out rather than built as `lg:grid-cols-${n}`, because Tailwind
    // reads the source for class names and never sees an interpolated one.
    <div className={clsx('grid grid-cols-2 gap-3 sm:grid-cols-4', wide[Math.min(count, 8)] ?? 'lg:grid-cols-8')}>
      {children}
    </div>
  )
}
