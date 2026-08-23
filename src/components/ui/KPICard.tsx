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
}

export function KPICard({ label, value, delta, tone = 'neutral', note }: KPICardProps) {
  const deltaTone = delta && delta.pct !== null ? (delta.pct >= 0 ? 'good' : 'bad') : 'neutral'

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div
        className={clsx(
          'mt-1.5 text-2xl font-semibold tabular-nums',
          tone === 'good' && 'text-emerald-600',
          tone === 'bad' && 'text-rose-600',
          tone === 'neutral' && 'text-slate-900',
        )}
      >
        {value}
      </div>
      {delta && (
        <div
          className={clsx(
            'mt-1 text-xs font-medium',
            deltaTone === 'good' && 'text-emerald-600',
            deltaTone === 'bad' && 'text-rose-600',
            deltaTone === 'neutral' && 'text-slate-400',
          )}
        >
          {delta.pct === null ? '—' : `${delta.pct >= 0 ? '▲' : '▼'} ${Math.abs(delta.pct).toFixed(1)}%`}
          {delta.label && <span className="ml-1 font-normal text-slate-400">{delta.label}</span>}
        </div>
      )}
      {note && <div className="mt-1 text-[11px] leading-tight text-slate-400">{note}</div>}
    </div>
  )
}

export function KPIGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">{children}</div>
}
