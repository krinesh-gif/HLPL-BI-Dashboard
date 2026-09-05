import { useMemo, useState } from 'react'
import { PageShell } from '@/components/layout/PageShell'
import { DataTable } from '@/components/ui/DataTable'
import { useDataStore } from '@/store/dataStore'
import { useFilterStore } from '@/store/filterStore'
import { BUSINESS_CHANNELS } from '@/config/channels'
import { computeSalesContributionWeights } from '@/engine/allocation'
import { addMonths, formatCurrencyFull, formatPercent, monthLabel } from '@/lib/format'
import type { FixedExpenseEntry } from '@/data/models'

type Category = FixedExpenseEntry['category']

/**
 * The nine OPEX lines, in the order the P&L prints them. The list is fixed
 * because the statement has exactly these rows: a tenth category could be
 * stored but would have nowhere to appear.
 */
const CATEGORIES: { key: Category; label: string; hint: string }[] = [
  { key: 'salaries', label: 'Salaries', hint: 'Payroll, PF, ESI, contractor fees' },
  { key: 'rent', label: 'Rent', hint: 'Office and warehouse rent' },
  { key: 'software', label: 'Software', hint: 'Unicommerce, Shopify, tools, subscriptions' },
  { key: 'warehouse', label: 'Warehouse', hint: 'Packing material, labour, 3PL storage' },
  { key: 'logistics', label: 'Logistics', hint: 'Freight not charged by a marketplace' },
  { key: 'professionalFees', label: 'Professional Fees', hint: 'CA, legal, consultants' },
  { key: 'officeExpenses', label: 'Office Expenses', hint: 'Electricity, internet, supplies' },
  { key: 'generalExpenses', label: 'General Expenses', hint: 'Travel, bank charges, everything routine' },
  { key: 'otherOpex', label: 'Other OPEX', hint: 'Anything that fits nowhere above' },
]

/**
 * A month's fixed costs, entered here and nowhere else.
 *
 * These are the costs no marketplace report can tell us about — salaries,
 * rent, software — so the only way in is a person typing them. Until this
 * form existed there was no way at all, which meant Net Profit and EBITDA were
 * Contribution Profit under another name on every screen that showed them.
 *
 * Entry is per month on purpose. Fixed costs are only fixed in the sense that
 * they do not move with sales; rent changes, headcount changes, and a P&L that
 * carried one number forever would be wrong in a way nobody could see. "Copy
 * from <last month>" is there because most months do repeat, and retyping nine
 * numbers is how a month gets skipped.
 */
export function FixedExpensesPage() {
  const { fixedExpenses, salesRecords, saveFixedExpenses, removeFixedExpense } = useDataStore()
  const { month } = useFilterStore()

  const [draft, setDraft] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const previousMonth = addMonths(month, -1)
  const byMonth = useMemo(() => {
    const index = new Map<string, Map<Category, FixedExpenseEntry>>()
    for (const e of fixedExpenses) {
      const forMonth = index.get(e.month) ?? new Map<Category, FixedExpenseEntry>()
      forMonth.set(e.category, e)
      index.set(e.month, forMonth)
    }
    return index
  }, [fixedExpenses])

  const empty = useMemo(() => new Map<Category, FixedExpenseEntry>(), [])
  const stored = byMonth.get(month) ?? empty
  const previous = byMonth.get(previousMonth) ?? empty

  // What is on screen: the edit in progress if there is one, else what is
  // stored for the month. Keying the draft by month means switching months in
  // the global filter does not carry a half-typed figure across.
  const shownAmount = (c: Category): string => {
    const key = `${month}:${c}`
    if (key in draft) return draft[key]
    const value = stored.get(c)?.amount
    return value === undefined ? '' : String(value)
  }
  const shownNote = (c: Category): string => {
    const key = `${month}:${c}`
    if (key in notes) return notes[key]
    return stored.get(c)?.note ?? ''
  }

  const entered = CATEGORIES.map((c) => ({ ...c, amount: Number(shownAmount(c.key)) || 0, note: shownNote(c.key) }))
  const total = entered.reduce((sum, e) => sum + e.amount, 0)
  const storedTotal = [...stored.values()].reduce((sum, e) => sum + e.amount, 0)
  const dirty = CATEGORIES.some((c) => `${month}:${c.key}` in draft || `${month}:${c.key}` in notes)

  const weights = useMemo(() => computeSalesContributionWeights(salesRecords, month), [salesRecords, month])
  const allocationRows = BUSINESS_CHANNELS.map((c) => ({
    channel: c.label,
    weight: weights[c.id] ?? 0,
    allocated: storedTotal * (weights[c.id] ?? 0),
  }))

  function set(map: 'amount' | 'note', category: Category, value: string): void {
    const key = `${month}:${category}`
    setSaved(false)
    if (map === 'amount') setDraft((d) => ({ ...d, [key]: value }))
    else setNotes((n) => ({ ...n, [key]: value }))
  }

  async function save(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      // Only categories with a figure are written. A blank row that was never
      // filled in should not become a stored zero, which would read as "this
      // cost is nil this month" rather than "nobody has entered it yet".
      const toSave = entered
        .filter((e) => shownAmount(e.key).trim() !== '')
        .map((e): FixedExpenseEntry => ({ month, category: e.key, amount: e.amount, note: e.note.trim() || undefined }))

      // A category cleared back to blank is removed rather than saved as zero.
      const cleared = CATEGORIES.filter((c) => stored.has(c.key) && shownAmount(c.key).trim() === '')

      if (toSave.length > 0) await saveFixedExpenses(toSave)
      for (const c of cleared) await removeFixedExpense(month, c.key)

      setDraft({})
      setNotes({})
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save these expenses.')
    } finally {
      setBusy(false)
    }
  }

  function copyPreviousMonth(): void {
    const next: Record<string, string> = { ...draft }
    const nextNotes: Record<string, string> = { ...notes }
    for (const c of CATEGORIES) {
      const from = previous.get(c.key)
      if (!from) continue
      next[`${month}:${c.key}`] = String(from.amount)
      nextNotes[`${month}:${c.key}`] = from.note ?? ''
    }
    setDraft(next)
    setNotes(nextNotes)
    setSaved(false)
  }

  const field =
    'w-full rounded border border-[var(--line-2)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none'

  return (
    <PageShell title="Fixed Expenses" subtitle={`Monthly fixed cost entry and sales-contribution allocation — ${monthLabel(month)}`}>
      <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--ink)]">Enter {monthLabel(month)}&apos;s fixed costs</h2>
            <p className="mt-1 text-xs text-[var(--ink-2)]">
              No marketplace report carries these, so they only exist once someone types them. Until a month has
              them, its Net Profit and EBITDA are the same figure as Contribution Profit. Leave a category blank if
              it does not apply — a blank is &ldquo;not entered&rdquo;, a zero is &ldquo;nil this month&rdquo;.
            </p>
          </div>
          {previous.size > 0 && (
            <button
              type="button"
              onClick={copyPreviousMonth}
              className="shrink-0 rounded-md border border-[var(--line-2)] px-3 py-1.5 text-sm text-[var(--ink-2)] hover:bg-[var(--surface-2)]"
            >
              Copy from {monthLabel(previousMonth)}
            </button>
          )}
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="px-2 py-1.5 text-left text-xs font-semibold text-[var(--ink-3)]">Category</th>
                <th className="px-2 py-1.5 text-right text-xs font-semibold text-[var(--ink-3)]">Amount ₹</th>
                <th className="px-2 py-1.5 text-left text-xs font-semibold text-[var(--ink-3)]">Note (optional)</th>
                <th className="px-2 py-1.5 text-right text-xs font-semibold text-[var(--ink-3)]">{monthLabel(previousMonth)}</th>
              </tr>
            </thead>
            <tbody>
              {CATEGORIES.map((c) => {
                const last = previous.get(c.key)?.amount
                return (
                  <tr key={c.key} className="border-t border-[var(--line)]">
                    <td className="px-2 py-1.5">
                      <label htmlFor={`fx-${c.key}`} className="block text-[var(--ink)]">{c.label}</label>
                      <span className="text-xs text-[var(--ink-3)]">{c.hint}</span>
                    </td>
                    <td className="w-40 px-2 py-1.5">
                      <input
                        id={`fx-${c.key}`} type="number" min="0" step="0.01" inputMode="decimal"
                        className={`${field} text-right tabular-nums`}
                        value={shownAmount(c.key)}
                        onChange={(e) => set('amount', c.key, e.target.value)}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        className={field} value={shownNote(c.key)} autoComplete="off"
                        onChange={(e) => set('note', c.key, e.target.value)}
                      />
                    </td>
                    <td className="w-32 px-2 py-1.5 text-right tabular-nums text-[var(--ink-3)]">
                      {last === undefined ? '—' : formatCurrencyFull(last)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[var(--line-2)]">
                <td className="px-2 py-2 font-semibold text-[var(--ink)]">Total</td>
                <td className="px-2 py-2 text-right font-semibold tabular-nums text-[var(--ink)]">{formatCurrencyFull(total)}</td>
                <td />
                <td className="px-2 py-2 text-right tabular-nums text-[var(--ink-3)]">
                  {previous.size === 0 ? '—' : formatCurrencyFull([...previous.values()].reduce((s, e) => s + e.amount, 0))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {error && <p className="mt-3 text-xs text-[var(--critical-ink)]">{error}</p>}

        <div className="mt-3 flex items-center gap-3">
          <button
            type="button" disabled={busy || !dirty} onClick={save}
            className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-ink)] hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Saving…' : `Save ${monthLabel(month)}`}
          </button>
          {dirty && !busy && <span className="text-xs text-[var(--ink-3)]">Unsaved changes.</span>}
          {saved && !dirty && (
            <span className="text-xs text-[var(--good-ink)]">
              Saved. Every P&amp;L for {monthLabel(month)} now carries these costs.
            </span>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--ink-3)]">
          Allocation — Sales Contribution Method (Total: {formatCurrencyFull(storedTotal)})
        </h2>
        <p className="mb-3 text-xs text-[var(--ink-2)]">
          Each channel carries the share of the month&apos;s fixed costs that matches its share of the month&apos;s net
          sales. This is what turns each channel&apos;s CM3 into its Net Profit.
        </p>
        <DataTable
          columns={[
            { key: 'channel', header: 'Channel', accessor: (r) => r.channel },
            { key: 'weight', header: 'Sales Share', accessor: (r) => r.weight * 100, align: 'right', render: (r) => formatPercent(r.weight * 100) },
            { key: 'allocated', header: 'Allocated Amount', accessor: (r) => r.allocated, align: 'right', render: (r) => formatCurrencyFull(r.allocated) },
          ]}
          rows={allocationRows}
          searchable={false}
          exportFileName={`HLPL_FixedExpenseAllocation_${month}`}
        />
      </section>
    </PageShell>
  )
}
