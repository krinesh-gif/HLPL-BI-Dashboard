import { useMemo, useState } from 'react'
import { InfoHint } from '@/components/ui/InfoHint'
import { PageShell } from '@/components/layout/PageShell'
import { Card, CardHeader } from '@/components/ui/Surface'
import { useDataStore } from '@/store/dataStore'
import { fxRateForMonth } from '@/data/fxRates'
import { freightRateForMonth } from '@/data/freightRates'
import { packagingRateForMonth } from '@/data/packagingRates'
import { nykaaDiscountForMonth } from '@/data/nykaaDiscounts'
import { nykaaDiscountPerSalesFile } from '@/engine/nativePnl/nykaa'
import { MEESHO_ASSUMPTIONS, NATIVE_PNL_ASSUMPTIONS } from '@/config/nativePnlAssumptions'
import { addMonths, formatCurrencyFull, monthLabel, toMonthKey } from '@/lib/format'
import { BUSINESS_CHANNELS, channelLabel, type BusinessChannelId } from '@/config/channels'
import type { ChannelChargeEntry, FixedExpenseEntry } from '@/data/models'

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
    fxRates, freightRates, packagingRates, nykaaDiscounts, fixedExpenses, nykaaFacts,
    salesRecords, amazonUsaFacts, flipkartFacts, myntraFacts, meeshoFacts,
    saveFxRate, removeFxRate, saveFreightRate, removeFreightRate, savePackagingRate, removePackagingRate,
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
      save: (m, v) => saveFxRate({ month: m, pair: 'USDINR', rate: v }),
      clear: (m) => removeFxRate(m, 'USDINR'),
    },
    {
      key: 'fxAed', label: 'AED → INR', unit: '₹', step: '0.01',
      // Entered rather than derived from the dollar rate. The dirham is
      // pegged at 3.6725 to the dollar, but what a bank pays on a dirham
      // remittance is not the peg, and the P&L should use what was realised.
      hint: 'Amazon UAE is settled in dirhams; this is the rate its month is brought to rupees at.',
      entered: (m) => (fxRateForMonth(m, fxRates, 'AEDINR').entered ? fxRateForMonth(m, fxRates, 'AEDINR').rate : undefined),
      fallback: () => NATIVE_PNL_ASSUMPTIONS.aedToInrRate,
      save: (m, v) => saveFxRate({ month: m, pair: 'AEDINR', rate: v }),
      clear: (m) => removeFxRate(m, 'AEDINR'),
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
      key: 'packaging', label: 'Packaging per parcel', unit: '₹/shipment', step: '0.01',
      hint: "The month's packaging spend divided by the parcels it covered — mailer, wrap, tape and invoice, ex-GST. Charged per parcel, not per unit.",
      entered: (m) => (packagingRateForMonth(m, packagingRates).entered
        ? packagingRateForMonth(m, packagingRates).perShipmentInr : undefined),
      fallback: () => MEESHO_ASSUMPTIONS.packagingPerShipment,
      save: (m, v) => savePackagingRate({ month: m, perShipmentInr: v }),
      clear: (m) => removePackagingRate(m),
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
    for (const r of packagingRates) set.add(r.month)
    for (const d of nykaaDiscounts) set.add(d.month)
    for (const e of fixedExpenses) set.add(e.month)
    return [...set].filter((m) => /^\d{4}-\d{2}$/.test(m)).sort().reverse()
  }, [thisMonth, extraMonths, salesRecords, amazonUsaFacts, flipkartFacts, myntraFacts, nykaaFacts, meeshoFacts,
    fxRates, freightRates, packagingRates, nykaaDiscounts, fixedExpenses])

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

  const field =
    'w-full rounded border border-[var(--line-2)] bg-[var(--surface)] px-2 py-1 text-right text-sm tabular-nums text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none'

  return (
    <PageShell
      title="Monthly Inputs"
      subtitle="Every figure the marketplace reports cannot tell us — one row per month, editable any time"
      // This page is a table of every month at once, and the figures on it are
      // entered per month and per channel in their own cells. A month, channel
      // or category picker above it filters nothing here, so it can only read
      // as a control that has stopped working.
      showFilters={false}
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
            <thead className="bg-[var(--surface-2)] text-[11px] font-semibold text-[var(--ink-3)]">
              <tr>
                <th className="sticky left-0 z-10 bg-[var(--surface-2)] px-5 py-2.5 text-left">Month</th>
                {COLUMNS.map((c) => (
                  <th key={c.key} className="px-3 py-2.5 text-right">
                    <span className="inline-flex items-center gap-1">
                      {c.label}
                      {c.hint && <InfoHint label={c.label} text={c.hint} />}
                    </span>
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

      <ChannelChargesCard months={months} />
    </PageShell>
  )
}

/**
 * Charges that belong to one channel and never reach its report.
 *
 * Flipkart's NextGen programme is billed on a payment link and paid from the
 * bank, so the SKU P&L export — a statement of what Flipkart deducted from a
 * settlement — cannot carry it, and the channel's EBITDA read better than it
 * was by the whole fee. The same is true of any charge settled off the
 * platform.
 *
 * Three decisions are deliberate and visible on the form:
 *
 *  - The name is typed, not chosen from a list. No list written today
 *    anticipates what a marketplace invents to bill for next, and a charge
 *    filed under "Other" is one nobody can account for a year later. Names
 *    already used are offered back, so the same charge keeps one name across
 *    months instead of becoming three spellings.
 *  - It is charged whole to its channel. That is the difference between this
 *    and the fixed expenses above, which are the company's and are divided
 *    between the channels by what each one sold.
 *  - It belongs to the month it is entered against. A quarterly fee is one
 *    entry in the month it was billed, or three of a third each — which of
 *    those is truer is a judgement about the business, so it is left to the
 *    person making it rather than guessed at here.
 */
function ChannelChargesCard({ months }: { months: string[] }) {
  const { channelCharges, saveChannelCharge, removeChannelCharge } = useDataStore()
  const charges = useMemo(() => channelCharges ?? [], [channelCharges])

  const [month, setMonth] = useState(months[0] ?? '')
  const [channel, setChannel] = useState<BusinessChannelId>(BUSINESS_CHANNELS[0]?.id ?? 'flipkart')
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)

  const knownLabels = useMemo(
    () => [...new Set(charges.map((c) => c.label))].sort((a, b) => a.localeCompare(b)),
    [charges],
  )
  const rows = useMemo(
    () => [...charges].sort((a, b) =>
      b.month.localeCompare(a.month) || a.channel.localeCompare(b.channel) || a.label.localeCompare(b.label)),
    [charges],
  )
  const keyOf = (c: ChannelChargeEntry) => `${c.month}|${c.channel}|${c.label}`

  async function add(): Promise<void> {
    const value = Number(amount)
    if (!/^\d{4}-\d{2}$/.test(month)) return setError('Pick the month the charge belongs to.')
    if (label.trim() === '') {
      return setError('Give the charge a name. It is what the figure on the P&L will be called a year from now.')
    }
    if (amount.trim() === '' || !Number.isFinite(value) || value < 0) {
      return setError('Enter the amount as a positive number — it is a cost, so no minus sign.')
    }
    setBusy(true)
    setError(null)
    try {
      await saveChannelCharge({
        month, channel, label: label.trim(), amount: value, note: note.trim() === '' ? undefined : note.trim(),
      })
      setLabel('')
      setAmount('')
      setNote('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the charge.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(c: ChannelChargeEntry): Promise<void> {
    setRemoving(keyOf(c))
    setError(null)
    try {
      await removeChannelCharge(c.month, c.channel, c.label)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove the charge.')
    } finally {
      setRemoving(null)
    }
  }

  const field =
    'w-full rounded border border-[var(--line-2)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none'

  return (
    <Card padded={false} className="mt-4">
      <div className="px-5 pt-5">
        <CardHeader
          title="Channel charges"
          subtitle="A charge billed to one channel and paid outside its settlement — a programme fee on a payment link, say. Charged whole to that channel, in that month only, and never shared with the others."
        />
      </div>

      <div className="grid gap-3 px-5 pt-4 md:grid-cols-[9rem_11rem_1fr_9rem_auto] md:items-end">
        <label className="block text-xs text-[var(--ink-3)]">
          Month
          <select className={`${field} mt-1`} value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </label>
        <label className="block text-xs text-[var(--ink-3)]">
          Channel
          <select
            className={`${field} mt-1`}
            value={channel}
            onChange={(e) => setChannel(e.target.value as BusinessChannelId)}
          >
            {BUSINESS_CHANNELS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <label className="block text-xs text-[var(--ink-3)]">
          Charge name
          <input
            className={`${field} mt-1`}
            list="channel-charge-names"
            placeholder="NextGen charges"
            maxLength={60}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <datalist id="channel-charge-names">
            {knownLabels.map((l) => <option key={l} value={l} />)}
          </datalist>
        </label>
        <label className="block text-xs text-[var(--ink-3)]">
          Amount (₹)
          <input
            type="number" min="0" step="0.01" inputMode="decimal"
            className={`${field} mt-1 text-right tabular-nums`}
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => void add()}
          className="h-[34px] rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-[var(--accent-ink)] hover:opacity-90 disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Add'}
        </button>
      </div>

      <div className="px-5 pt-3">
        <label className="block text-xs text-[var(--ink-3)]">
          Note (optional)
          <input
            className={`${field} mt-1`}
            placeholder="Invoice number, the quarter it covers, who approved it"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      </div>

      {error && <p className="px-5 pt-3 text-sm text-[var(--critical-ink)]">{error}</p>}

      {rows.length === 0 ? (
        <p className="px-5 pb-5 pt-4 text-sm text-[var(--ink-3)]">
          No channel charges entered. Until one is, every channel&apos;s costs are what its own report states.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--surface-2)] text-[11px] font-semibold text-[var(--ink-3)]">
              <tr>
                <th className="px-5 py-2.5 text-left">Month</th>
                <th className="px-3 py-2.5 text-left">Channel</th>
                <th className="px-3 py-2.5 text-left">Charge</th>
                <th className="px-3 py-2.5 text-right">Amount</th>
                <th className="px-3 py-2.5 text-left">Note</th>
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {rows.map((c) => (
                <tr key={keyOf(c)} className="hover:bg-[var(--surface-hover)]">
                  <td className="whitespace-nowrap px-5 py-2 text-[var(--ink-2)]">{monthLabel(c.month)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-[var(--ink-2)]">{channelLabel(c.channel)}</td>
                  <td className="px-3 py-2 text-[var(--ink)]">{c.label}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-[var(--ink)]">
                    {formatCurrencyFull(c.amount)}
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--ink-3)]">{c.note ?? ''}</td>
                  <td className="whitespace-nowrap px-5 py-2 text-right">
                    <button
                      type="button"
                      disabled={removing === keyOf(c)}
                      onClick={() => void remove(c)}
                      className="text-xs font-medium text-[var(--critical-ink)] hover:opacity-80 disabled:opacity-40"
                    >
                      {removing === keyOf(c) ? 'Removing…' : 'Remove'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="px-5 pb-5 pt-3 text-xs text-[var(--ink-3)]">
        A charge lands on the Channel Charges line in Operating Expenses, below Contribution Profit — so the
        marketplace&apos;s own statement is left exactly as it reports itself, and the charge comes off that
        channel&apos;s EBITDA and the company&apos;s. Entering the same month, channel and name again corrects the
        figure rather than charging it twice.
      </p>
    </Card>
  )
}
