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
  /** Which series colour the sparkline takes, so a group of tiles reading the
   * same family of figures shares one hue. It tints the line only: nothing on
   * the tile is coloured unless the colour is saying something. */
  accent?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
}

/** A sparkline with no axes, ticks or labels — deliberately. It is a shape
 * beside a number, not a chart, so it carries no scale of its own. */
function Sparkline({ points, color }: { points: number[]; color: string }) {
  if (points.length < 2) return null
  const w = 52
  const h = 20
  // The line stops short of the box so the ring around the last point has
  // somewhere to go. Letting it overflow instead put it in the tile's padding.
  const plot = w - 4
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const step = plot / (points.length - 1)
  const coords = points.map((p, i) => [i * step, h - ((p - min) / span) * (h - 4) - 2] as const)
  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `${line} L${plot},${h} L0,${h} Z`
  const [lastX, lastY] = coords[coords.length - 1]

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <path d={area} fill={color} opacity={0.14} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
      {/* The current value gets a ring in the surface colour so it stays
          readable where the line doubles back over itself. */}
      <circle cx={lastX} cy={lastY} r={2.25} fill={color} stroke="var(--surface)" strokeWidth={2} />
    </svg>
  )
}

export function KPICard({ label, value, delta, tone = 'neutral', note, spark, accent = 1 }: KPICardProps) {
  const deltaTone = delta && delta.pct !== null ? (delta.pct >= 0 ? 'good' : 'bad') : 'neutral'
  const color = `var(--series-${accent})`
  const tail = delta || (spark && spark.length > 1) || note

  return (
    // Two anchors, not one. The label and the figure sit hard against the top
    // of every tile in the row, because a row of figures is read across and
    // that only works if they are on a line; anything optional — the change,
    // the shape, the note on where the number came from — drops to the bottom.
    // The tile used to space its contents evenly instead, which put "Net
    // Sales" near the top and "Units" near the middle of the same row.
    //
    // It sizes itself to the width it is given rather than to the grid, so
    // eight across and four across are the same component. Two thresholds, not
    // one: the sparkline fits in a tile long before the figure has room to
    // grow, and tying them together cost one or the other. At eight across the
    // type stays at the smaller size — "₹1.5K / ₹1.3K" is cut off at the larger
    // one — while the sparkline is drawn.
    //
    // Both are content-box widths, because that is what a container query
    // measures: a 185px tile in a row of eight is 159px inside its padding and
    // border. The old 190px threshold was written as though it were the outer
    // width, so it never fired on a full row and the sparkline was never drawn
    // there at all.
    <div
      className={clsx(
        '@container flex flex-col overflow-hidden rounded-[var(--radius-card)] px-3 py-2.5 @[220px]:px-4 @[220px]:py-3',
        'border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-card)]',
        'transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)]',
      )}
    >
      <div className="min-w-0">
        <div className="truncate text-[11.5px] font-medium text-[var(--ink-3)] @[220px]:text-[12.5px]" title={label}>
          {label}
        </div>
        <div
          className={clsx(
            'mt-0.5 truncate text-[19px] leading-tight font-bold tracking-[-0.02em] @[220px]:text-[23px]',
            tone === 'good' && 'text-[var(--good-ink)]',
            tone === 'bad' && 'text-[var(--critical-ink)]',
            tone === 'neutral' && 'text-[var(--ink)]',
          )}
          title={value}
        >
          {value}
        </div>
      </div>

      {tail && (
        <div className="mt-2 @[220px]:mt-2.5">
          {(delta || (spark && spark.length > 1)) && (
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                {delta && (
                  <span
                    className={clsx(
                      'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold',
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
                {delta?.label && <span className="truncate text-[10.5px] text-[var(--ink-3)]">{delta.label}</span>}
              </div>
              {spark && spark.length > 1 && (
                // The shape goes before the figure does. In a narrow tile it is
                // the first thing that can be spared, because the number above
                // it carries the magnitude and the delta beside it carries the
                // direction; the sparkline only says how it got there.
                <div className="hidden shrink-0 @[155px]:block">
                  <Sparkline points={spark} color={color} />
                </div>
              )}
            </div>
          )}
          {note && (
            // Held to two lines with the rest on hover. A provenance note is
            // worth the room it takes, but not worth a tile twice the height
            // of the seven beside it.
            <div className="mt-1.5 line-clamp-2 text-[10.5px] leading-snug text-[var(--ink-3)]" title={note}>
              {note}
            </div>
          )}
        </div>
      )}
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
    <div className={clsx('grid grid-cols-2 gap-2.5 sm:grid-cols-4', wide[Math.min(count, 8)] ?? 'lg:grid-cols-8')}>
      {children}
    </div>
  )
}
