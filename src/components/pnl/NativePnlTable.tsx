import { Fragment, useState } from 'react'
import clsx from 'clsx'
import type { NativeLineDef, NativeLineValues } from '@/engine/nativePnl/types'
import { formatCurrencyFull, formatPercent } from '@/lib/format'
import { InfoHint } from '@/components/ui/InfoHint'
import { amountTone } from './amountTone'

/** Rows of a collapsible group start hidden: the statement reads at a glance,
 * and the detail is one click away rather than twenty lines of scrolling. */
function useCollapsedGroups() {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  return {
    isOpen: (group: string) => open[group] ?? false,
    toggle: (group: string) => setOpen((o) => ({ ...o, [group]: !(o[group] ?? false) })),
  }
}

export function NativePnlTable({
  lineDefs,
  values,
  currency = 'INR',
  onEditManualEntry,
}: {
  lineDefs: NativeLineDef[]
  values: NativeLineValues
  currency?: 'INR' | 'USD' | 'AED'
  /** Called with the new positive magnitude when a "Manual entry" row is edited. */
  onEditManualEntry?: (key: string, value: number) => void
}) {
  const { isOpen, toggle } = useCollapsedGroups()

  // A breakdown only earns its space when it breaks something down. A
  // component worth nothing says nothing, and a component that alone accounts
  // for its whole parent just prints the same figure twice — which is what
  // March did, where the base fulfilment fee was the only fulfilment fee there
  // was and the two lines read as a double entry.
  const degenerateMemo = (def: NativeLineDef): boolean => {
    if (!def.memoOf) return false
    const value = values[def.key] ?? 0
    if (value === 0) return true
    return Math.abs(value - (values[def.memoOf] ?? 0)) < 0.005
  }

  const visible = lineDefs.filter(
    (def) =>
      (!def.group || def.isGroupHead || isOpen(def.group)) &&
      !(def.hideWhenZero && (values[def.key] ?? 0) === 0) &&
      !degenerateMemo(def),
  )
  // A line that other lines add up to. It is set in the body colour and
  // semibold while its parts sit under it in grey, so the sum reads as the
  // figure and the parts read as the working behind it.
  const labelByKey = new Map(lineDefs.map((d) => [d.key, d.label]))
  const parentKeys = new Set(visible.map((d) => d.memoOf).filter((k): k is string => Boolean(k)))
  const rows = visible.map((def, i) => ({
    def,
    showSectionHeader:
      (i === 0 || def.section !== visible[i - 1].section) &&
      // A section whose first line repeats its own name prints the same words
      // twice and reads as a mistake in the statement. The line carries the
      // figure, so the band is what goes.
      def.section !== def.label,
  }))

  return (
    <div className="overflow-hidden overflow-x-auto rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-card)]">
      <table className="w-full text-sm">
        <tbody>
          {rows.map(({ def, showSectionHeader }) => {
            const value = values[def.key] ?? 0
            const isEditable = onEditManualEntry && def.kind === 'input' && def.note?.startsWith('Manual entry')
            const collapsible = def.isGroupHead && def.group
            const expanded = collapsible ? isOpen(def.group as string) : false
            return (
              <Fragment key={def.key}>
                {showSectionHeader && !collapsible && (
                  <tr className="bg-[var(--surface-2)]">
                    <td colSpan={2} className="px-5 py-2.5 text-[12px] font-semibold text-[var(--ink-2)]">
                      {def.section}
                    </td>
                  </tr>
                )}
                <tr
                  className={clsx(
                    'border-t border-[var(--line)]',
                    def.kind === 'subtotal' && 'bg-[var(--accent-soft)] font-semibold text-[var(--ink)]',
                    parentKeys.has(def.key) && 'font-semibold text-[var(--ink)]',
                    def.memoOf && 'text-[var(--ink-3)]',
                  )}
                >
                  <td
                    className={clsx(
                      'px-5 py-2.5',
                      def.kind === 'input' && 'pl-8 text-[var(--ink-2)]',
                      def.kind === 'percent' && 'pl-8 text-[var(--ink-3)] italic',
                      parentKeys.has(def.key) && 'font-semibold text-[var(--ink)]',
                      // A memo line sits one level deeper than the line that
                      // already contains it, directly beneath it, so the sum
                      // sits on top of its own addends.
                      def.memoOf && 'pl-14 text-[var(--ink-3)]',
                      collapsible && 'pl-2',
                    )}
                  >
                    {collapsible ? (
                      <button
                        type="button"
                        onClick={() => toggle(def.group as string)}
                        aria-expanded={expanded}
                        className="inline-flex items-center gap-2 font-semibold text-[var(--ink)] hover:text-[var(--accent)]"
                      >
                        <span
                          aria-hidden
                          className="inline-flex h-5 w-5 items-center justify-center rounded border border-[var(--line-2)] bg-[var(--surface)] text-sm leading-none text-[var(--ink-2)]"
                        >
                          {expanded ? '−' : '+'}
                        </span>
                        {def.label}
                      </button>
                    ) : (
                      <>
                        {def.memoOf && <span aria-hidden className="mr-1.5 text-[var(--ink-3)]">↳</span>}
                        {/* A fee on the statement leads to its own history and
                            the SKUs behind it. A number you cannot open is a
                            number you cannot act on. */}
                        {def.href ? (
                          <a href={def.href} className="underline decoration-[var(--line-2)] underline-offset-2 hover:text-[var(--accent)] hover:decoration-[var(--accent)]">
                            {def.label}
                          </a>
                        ) : (
                          def.label
                        )}
                        {def.memoOf && (
                          <span className="ml-2 text-xs font-normal italic text-[var(--ink-3)]">
                            part of {labelByKey.get(def.memoOf) ?? 'the line above'} — not added again
                          </span>
                        )}
                        {/* Printed beside the label, these doubled the width
                            of the statement and pushed the figures — which are
                            what the page is for — off to the right. The icon
                            says there is something to know; the click is for
                            when the reader wants to know it. */}
                        {def.note && !def.memoOf && (
                          <InfoHint
                            className="ml-1.5"
                            label={def.label}
                            text={def.note}
                            tone={def.note.startsWith('⚠') ? 'warning' : 'info'}
                          />
                        )}
                      </>
                    )}
                  </td>
                  <td
                    className={clsx(
                      'px-5 py-2.5 text-right tabular-nums',
                      // Green for money in, red for money out. A memo line
                      // keeps its grey: it is already inside the line above,
                      // and colouring it would make it look like it counts.
                      !isEditable && !def.memoOf && amountTone(value),
                    )}
                  >
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
