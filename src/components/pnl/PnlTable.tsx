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
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <tbody>
          {rowsWithHeaderFlag.map(({ def, showSectionHeader }) => {
            const value = lines[def.key] ?? 0

            return (
              <Fragment key={def.key}>
                {showSectionHeader && (
                  <tr key={`${def.section}-header`} className="bg-slate-50">
                    <td colSpan={2} className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {SECTION_LABELS[def.section as PnlSection]}
                    </td>
                  </tr>
                )}
                <tr
                  className={clsx(
                    'border-t border-slate-100',
                    def.kind === 'subtotal' && 'bg-indigo-50/50 font-semibold text-slate-900',
                  )}
                >
                  <td className={clsx('px-4 py-2', def.kind === 'input' && 'pl-8 text-slate-600', def.kind === 'percent' && 'pl-8 text-slate-500 italic')}>
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
