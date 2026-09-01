import { Fragment } from 'react'
import clsx from 'clsx'
import { PNL_STRUCTURE, SECTION_LABELS, type PnlSection } from '@/config/pnlStructure'
import type { PnlLineValues } from '@/data/models'
import { formatCurrencyFull, formatPercent } from '@/lib/format'

export function PnlTable({ lines, currency = 'INR' }: { lines: PnlLineValues; currency?: 'INR' | 'USD' }) {
  const rowsWithHeaderFlag = PNL_STRUCTURE.map((def, i) => ({
    def,
    showSectionHeader: i === 0 || def.section !== PNL_STRUCTURE[i - 1].section,
  }))

  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--surface)]">
      <table className="w-full text-sm">
        <tbody>
          {rowsWithHeaderFlag.map(({ def, showSectionHeader }) => {
            const value = lines[def.key] ?? 0

            return (
              <Fragment key={def.key}>
                {showSectionHeader && (
                  <tr key={`${def.section}-header`} className="bg-[var(--surface-2)]">
                    <td colSpan={2} className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--ink-3)]">
                      {SECTION_LABELS[def.section as PnlSection]}
                    </td>
                  </tr>
                )}
                <tr
                  className={clsx(
                    'border-t border-[var(--line)]',
                    def.kind === 'subtotal' && 'bg-[var(--accent-soft)]/50 font-semibold text-[var(--ink)]',
                  )}
                >
                  <td className={clsx('px-4 py-2', def.kind === 'input' && 'pl-8 text-[var(--ink-2)]', def.kind === 'percent' && 'pl-8 text-[var(--ink-3)] italic')}>
                    {def.label}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {def.kind === 'percent' ? formatPercent(value) : formatCurrencyFull(value, currency)}
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
