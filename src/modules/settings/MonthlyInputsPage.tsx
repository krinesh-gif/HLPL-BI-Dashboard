import { useMemo, useState } from 'react'
import { PageShell } from '@/components/layout/PageShell'
import { Card, CardHeader } from '@/components/ui/Surface'
import { DataTable } from '@/components/ui/DataTable'
import { useDataStore } from '@/store/dataStore'
import { BUSINESS_CHANNELS } from '@/config/channels'
import { computeSalesContributionWeights } from '@/engine/allocation'
import { fxRateForMonth } from '@/data/fxRates'
import { freightRateForMonth } from '@/data/freightRates'
import { nykaaDiscountForMonth } from '@/data/nykaaDiscounts'
import { nykaaDiscountPerSalesFile } from '@/engine/nativePnl/nykaa'
import { NATIVE_PNL_ASSUMPTIONS } from '@/config/nativePnlAssumptions'
import { addMonths, formatCurrencyFull, formatPercent, monthLabel, toMonthKey } from '@/lib/format'
import type { FixedExpenseEntry } from '@/data/models'

/**
 * Every figure the marketplaces cannot tell us, on one screen, a month to a row.
 *
 * These were four separate forms — an exchange rate here, a freight rate
 * there, fixed expenses on their own page under the P&L — each asking for one
 * month at a time. Closing a month meant visiting all of them and remembering
 * which had been done. A month is one row now, and what is missing from it is
 * visible without opening anything.
 *
 * Fixed expenses are a single figure rather than nine categories. The split is
 * worked out in a spreadsheet and only the total is worth re-keying; the nine
 * named categories are still read, so a month entered the old way keeps its
 * detail and still adds up the same.
 */

/** One editable figure on a month's row. */
interface Column {
  key: string
  label: string
  unit: string
  hint: string
  /** What the month currently has, or undefined when nothing is entered. */
  entered: (month: string) => number | undefined
  /** Used when nothing is entered, where a standing figure exists. */
  fallback?: (month: string) => number | undefined
  save: (month: string, value: number) => Promise<void>
  clear: (month: string) => Promise<void>
  step: string
}

export function MonthlyInputsPage() {
  const {
    fxRates, freightRates, nykaaDiscounts, fixedExpenses, nykaaFacts,
    salesRecords, amazonUsaFacts, flipkartFacts, myntraFacts, meeshoFacts,
    saveFxRate, removeFxRate, saveFreightRate, removeFreightRate,
    saveNykaaDiscount, removeNykaaDiscount, saveFixedExpenses, removeFixedExpense,
  } = useDataStore()

  const [draft, setDraft] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [extraMonths, setExtraMonths] = useState<string[]>([])

  const thisMonth = toMonthKey(new Date().toISOString().slice(0, 10))

  /** Fixed expenses for a month, however they were entered: the single total
   * plus any of the nine older categories, which add up to the same thing. */
  const fixedTotalFor = (month: string): number | undefined => {
    const rows = fixedExpenses.filter((e) => e.month === month)
    return rows.length === 0 ? undefined : rows.reduce((sum, e) => sum + e.amount, 0)
  }
  const hasLegacyCategories = (month: string): boolean =>
    fixedExpenses.some((e) => e.month === month && e.category !== 'fixedExpensesTotal')

  const COLUMNS: Column[] = [
    {
      key: 'fx', label: 'USD → INR', unit: '₹', step: '0.01',
      hint: 'Amazon USA is settled in dollars; this is the rate its month is brought to rupees at.',
      entered: (m) => (fxRateForMonth(m, fxRates).entered ? fxRateForMonth(m, fxRates).rate : undefined),
      fallback: () => NATIVE_PNL_ASSUMPTIONS.usdToInrRate,
      save: (m, v) => saveFxRate({ month: m, rate: v }),
      clear: (m) => removeFxRate(m),
    },
    {
      key: 'usaFreight', label: 'India → USA freight', unit: '₹/unit', step: '0.01',
      hint: "The month's inbound air freight divided by the units it carried.",
      entered: (m) => (freightRateForMonth(m, freightRates, 'india_usa').entered
        ? freightRateForMonth(m, freightRates, 'india_usa').perUnitInr : undefined),
      fallback: () => NATIVE_PNL_ASSUMPTIONS.indiaUsaFreightPerUnitInr,
      save: (m, v) => saveFreightRate({ month: m, lane: 'india_usa', perUnitInr: v }),
      clear: (m) => removeFreightRate(m, 'india_usa'),
    },
    {
      key: 'nykaaFreight', label: 'HLPL → Nykaa freight', unit: '₹/unit', step: '0.01',
      hint: 'From the carrier rate card. Charged on the units Nykaa sold in the month.',
      entered: (m) => (freightRateForMonth(m, freightRates, 'nykaa_inbound').entered
        ? freightRateForMonth(m, freightRates, 'nykaa_inbound').perUnitInr : undefined),
      save: (m, v) => saveFreightRate({ month: m, lane: 'nykaa_inbound', perUnitInr: v }),
      clear: (m) => removeFreightRate(m, 'nykaa_inbound'),
    },
    {
      key: 'nykaaDiscount', label: 'Nykaa discount (confirmed)', unit: '₹', step: '0.01',
      hint: 'What Nykaa confirms by email that it is charging back. Replaces the figure its sales file implies.',
      entered: (m) => nykaaDiscountForMonth(m, nykaaDiscounts)?.amountInr,
      fallback: (m) => {
        const facts = nykaaFacts.find((f) => f.month === m)
        return facts ? nykaaDiscountPerSalesFile(facts) : undefined
      },
      save: (m, v) => saveNykaaDiscount({ month: m, amountInr: v }),
      clear: (m) => removeNykaaDiscount(m),
    },
    {
      key: 'fixed', label: 'Fixed expenses', unit: '₹', step: '0.01',
      hint: "The month's whole fixed cost as one figure — salaries, rent, software, everything.",
      entered: fixedTotalFor,
      save: async (m, v) => {
        // Entering a total replaces whatever was there, including a month
        // split across the old nine categories: leaving those behind would
        // add the same cost to the month twice.
        for (const e of fixedExpenses.filter((x) => x.month === m && x.category !== 'fixedExpensesTotal')) {
          await removeFixedExpense(m, e.category)
        }
        const entry: FixedExpenseEntry = { month: m, category: 'fixedExpensesTotal', amount: v }
        await saveFixedExpenses([entry])
      },
      clear: async (m) => {
        for (const e of fixedExpenses.filter((x) => x.month === m)) await removeFixedExpense(m, e.category)
      },
    },
  ]

  /**
   * The months worth showing: everything that has traded or been entered, the
   * current month, and anything added by hand. A month with no trading and no
   * figures is noise.
   */
  const months = useMemo(() => {
    const set = new Set<string>([thisMonth, ...extraMonths])
    for (const r of salesRecords) set.add(toMonthKey(r.orderDate))
    for (const f of [...amazonUsaFacts, ...flipkartFacts, ...myntraFacts, ...nykaaFacts, ...meeshoFacts]) set.add(f.month)
    for (const r of fxRates) set.add(r.month)
    for (const r of freightRates) set.add(r.month)
    for (const d of nykaaDiscounts) set.add(d.month)
    for (const e of fixedExpenses) set.add(e.month)
    return [...set].filter((m) => /^\d{4}-\d{2}$/.test(m)).sort().reverse()
  }, [thisMonth, extraMonths, salesRecords, amazonUsaFacts, flipkartFacts, myntraFacts, nykaaFacts, meeshoFacts,
    fxRates, freightRates, nykaaDiscounts, fixedExpenses])

  const cellId = (month: string, key: string): string => `${month}:${key}`
  const shown = (month: string, col: Column): string => {
    const id = cellId(month, col.key)
    if (id in draft) return draft[id]
    const value = col.entered(month)
    return value === undefined ? '' : String(value)
  }
  const dirtyRow = (month: string): boolean => COLUMNS.some((c) => cellId(month, c.key) in draft)

  async function saveRow(month: string): Promise<void> {
    setBusy(month)
    setError(null)
    setSaved(null)
    try {
      for (const col of COLUMNS) {
        const id = cellId(month, col.key)
        if (!(id in draft)) continue
        const raw = draft[id].trim()
        // Blank means "take this figure out", which is not the same as zero:
        // a zero is a month someone checked and found nil.
        if (raw === '') { await col.clear(month); continue }
        const value = Number(raw)
        if (!Number.isFinite(value) || value < 0) {
          throw new Error(`${col.label} for ${monthLabel(month)} must be a number, and not a negative one.`)
        }
        await col.save(month, value)
      }
      setDraft((d) => {
        const next = { ...d }
        for (const col of COLUMNS) delete next[cellId(month, col.key)]
        return next
      })
      setSaved(month)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const weights = useMemo(
    () => computeSalesContributionWeights(salesRecords, months[0] ?? thisMonth),
    [salesRecords, months, thisMonth],
  )
  const latestFixed = fixedTotalFor(months[0] ?? thisMonth) ?? 0
  const allocationRows = BUSINESS_CHANNELS.map((c) => ({
    channel: c.label,
    weight: weights[c.id] ?? 0,
    allocated: latestFixed * (weights[c.id] ?? 0),
  }))

  const field =
    'w-full rounded border border-[var(--line-2)] bg-[var(--surface)] px-2 py-1 text-right text-sm tabular-nums text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none'

  return (
    <PageShell
      title="Monthly Inputs"
      subtitle="Every figure the marketplace reports cannot tell us — one row per month, editable any time"
    >
      <Card padded={false}>
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
          <CardHeader
            title="Rates and costs by month"
            subtitle="A blank cell is not entered; a zero is a month checked and found nil. Applied when a statement is read, so correcting one restates the months it should."
          />
          <button
            type="button"
            onClick={() => setExtraMonths((m) => [...m, addMonths(months[months.length - 1] ?? thisMonth, -1)])}
            className="shrink-0 rounded-md border border-[var(--line-2)] px-3 py-1.5 text-sm text-[var(--ink-2)] hover:bg-[var(--surface-2)]"
          >
            Add an earlier month
          </button>
        </div>

        {error && <p className="px-5 pt-3 text-sm text-[var(--critical-ink)]">{error}</p>}

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--surface-2)] text-[11px] uppercase tracking-wide text-[var(--ink-3)]">
              <tr>
                <th className="sticky left-0 z-10 bg-[var(--surface-2)] px-5 py-2.5 text-left">Month</th>
                {COLUMNS.map((c) => (
                  <th key={c.key} className="px-3 py-2.5 text-right" title={c.hint}>
                    {c.label}
                    <span className="block font-normal normal-case text-[var(--ink-3)]">{c.unit}</span>
                  </th>
                ))}
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {months.map((month) => (
                <tr key={month} className="hover:bg-[var(--surface-hover)]">
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-[var(--surface)] px-5 py-2 font-medium text-[var(--ink)]">
                    {monthLabel(month)}
                    {hasLegacyCategories(month) && (
                      <span className="block text-[10px] font-normal text-[var(--ink-3)]">
                        entered by category — saving here replaces it
                      </span>
                    )}
                  </td>
                  {COLUMNS.map((col) => {
                    const fallback = col.entered(month) === undefined ? col.fallback?.(month) : undefined
                    return (
                      <td key={col.key} className="w-36 px-3 py-2">
                        <input
                          type="number" min="0" step={col.step} inputMode="decimal"
                          className={field}
                          value={shown(month, col)}
                          placeholder={fallback === undefined ? '—' : String(Number(fallback.toFixed(2)))}
                          aria-label={`${col.label}, ${monthLabel(month)}`}
                          onChange={(e) => {
                            setSaved(null)
                            setDraft((d) => ({ ...d, [cellId(month, col.key)]: e.target.value }))
                          }}
                        />
                      </td>
                    )
                  })}
                  <td className="whitespace-nowrap px-5 py-2 text-right">
                    <button
                      type="button"
                      disabled={!dirtyRow(month) || busy === month}
                      onClick={() => void saveRow(month)}
                      className="rounded-md bg-[var(--accent)] px-3 py-1 text-xs font-medium text-[var(--accent-ink)] hover:opacity-90 disabled:opacity-30"
                    >
                      {busy === month ? 'Saving…' : 'Save'}
                    </button>
                    {saved === month && !dirtyRow(month) && (
                      <span className="ml-2 text-xs text-[var(--good-ink)]">Saved</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-5 pb-5 pt-3 text-xs text-[var(--ink-3)]">
          A greyed figure is what the month falls back to when nothing is entered. Where there is no fallback the
          cost is simply not charged, and the channel&apos;s own statement says so.
        </p>
      </Card>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--ink-3)]">
          Fixed expenses for {monthLabel(months[0] ?? thisMonth)}, by channel — {formatCurrencyFull(latestFixed)}
        </h2>
        <p className="mb-3 text-xs text-[var(--ink-2)]">
          Each channel carries the share that matches its share of the month&apos;s net sales. This is what turns a
          channel&apos;s contribution margin into its net profit.
        </p>
        <DataTable
          columns={[
            { key: 'channel', header: 'Channel', accessor: (r) => r.channel },
            { key: 'weight', header: 'Sales Share', accessor: (r) => r.weight * 100, align: 'right', render: (r) => formatPercent(r.weight * 100) },
            { key: 'allocated', header: 'Allocated Amount', accessor: (r) => r.allocated, align: 'right', render: (r) => formatCurrencyFull(r.allocated) },
          ]}
          rows={allocationRows}
          searchable={false}
          exportFileName={`HLPL_FixedExpenseAllocation_${months[0] ?? thisMonth}`}
        />
      </section>
    </PageShell>
  )
}
