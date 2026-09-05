import clsx from 'clsx'
import type { ReactNode } from 'react'

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
  /** Which series colour the sparkline and accent rail take. */
  accent?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
}

/** A sparkline with no axes, ticks or labels — deliberately. It is a shape
 * beside a number, not a chart, so it carries no scale of its own. */
function Sparkline({ points, color }: { points: number[]; color: string }) {
  if (points.length < 2) return null
  const w = 88
  const h = 28
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
      <path d={area} fill={color} opacity={0.12} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {/* The current value gets a ring in the surface colour so it stays
          readable where the line doubles back over itself. */}
      <circle cx={lastX} cy={lastY} r={3} fill={color} stroke="var(--surface)" strokeWidth={2} />
    </svg>
  )
}

export function KPICard({ label, value, delta, tone = 'neutral', note, spark, accent = 1 }: KPICardProps) {
  const deltaTone = delta && delta.pct !== null ? (delta.pct >= 0 ? 'good' : 'bad') : 'neutral'
  const color = `var(--series-${accent})`

  return (
    <div
      className={clsx(
        'group relative overflow-hidden rounded-[var(--radius-card)] border border-[var(--line)]',
        'bg-[var(--surface)] p-3 shadow-[var(--shadow-card)]',
        'transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)]',
      )}
    >
      {/* A hairline of the series colour, so a row of cards is scannable by
          hue without any of them shouting. */}
      <span aria-hidden className="absolute inset-x-0 top-0 h-0.5" style={{ background: color }} />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[11px] font-semibold tracking-wide text-[var(--ink-3)] uppercase">{label}</div>
          <div
            className={clsx(
              'mt-1.5 text-[22px] leading-none font-semibold',
              tone === 'good' && 'text-[var(--good-ink)]',
              tone === 'bad' && 'text-[var(--critical-ink)]',
              tone === 'neutral' && 'text-[var(--ink)]',
            )}
          >
            {value}
          </div>
        </div>
        {spark && spark.length > 1 && (
          <div className="shrink-0 pt-1">
            <Sparkline points={spark} color={color} />
          </div>
        )}
      </div>

      {delta && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
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
          {delta.label && <span className="text-[11px] text-[var(--ink-3)]">{delta.label}</span>}
        </div>
      )}

      {note && <div className="mt-1.5 text-[11px] leading-tight text-[var(--ink-3)]">{note}</div>}
    </div>
  )
}

export function KPIGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">{children}</div>
}
