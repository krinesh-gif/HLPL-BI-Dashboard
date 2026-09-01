import { Fragment } from 'react'
import clsx from 'clsx'
import type { NativeLineDef, NativeLineValues } from '@/engine/nativePnl/types'
import { formatCurrencyFull, formatPercent } from '@/lib/format'

export function NativePnlTable({
  lineDefs,
  values,
  currency = 'INR',
  onEditManualEntry,
}: {
  lineDefs: NativeLineDef[]
  values: NativeLineValues
  currency?: 'INR' | 'USD'
  /** Called with the new positive magnitude when a "Manual entry" row is edited. */
  onEditManualEntry?: (key: string, value: number) => void
}) {
  const rows = lineDefs.map((def, i) => ({ def, showSectionHeader: i === 0 || def.section !== lineDefs[i - 1].section }))

  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--surface)]">
      <table className="w-full text-sm">
        <tbody>
          {rows.map(({ def, showSectionHeader }) => {
            const value = values[def.key] ?? 0
            const isEditable = onEditManualEntry && def.kind === 'input' && def.note?.startsWith('Manual entry')
            return (
              <Fragment key={def.key}>
                {showSectionHeader && (
                  <tr className="bg-[var(--surface-2)]">
                    <td colSpan={2} className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--ink-3)]">
                      {def.section}
                    </td>
                  </tr>
                )}
                <tr className={clsx('border-t border-[var(--line)]', def.kind === 'subtotal' && 'bg-[var(--accent-soft)]/50 font-semibold text-[var(--ink)]')}>
                  <td className={clsx('px-4 py-2', def.kind === 'input' && 'pl-8 text-[var(--ink-2)]', def.kind === 'percent' && 'pl-8 text-[var(--ink-3)] italic')}>
                    {def.label}
                    {def.note && <span className="ml-2 text-xs font-normal text-[var(--ink-3)]">{def.note}</span>}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {isEditable ? (
                      <input
                        type="number"
                        defaultValue={Math.abs(value)}
                        onBlur={(e) => {
                          const n = Number(e.target.value)
                          if (Number.isFinite(n)) onEditManualEntry(def.key, n)
                        }}
                        className="w-32 rounded border border-transparent bg-transparent px-2 py-0.5 text-right tabular-nums hover:border-[var(--line-2)] focus:border-[var(--accent)] focus:bg-[var(--surface)] focus:outline-none"
                      />
                    ) : def.kind === 'percent' ? (
                      formatPercent(value)
                    ) : (
                      formatCurrencyFull(value, currency)
                    )}
                  </td>
                </tr>
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
