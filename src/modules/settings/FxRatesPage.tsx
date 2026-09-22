import { useMemo, useState } from 'react'
import { PageShell } from '@/components/layout/PageShell'
import { Card, CardHeader, Badge } from '@/components/ui/Surface'
import { useDataStore } from '@/store/dataStore'
import { NATIVE_PNL_ASSUMPTIONS } from '@/config/nativePnlAssumptions'
import { fxRateForMonth } from '@/data/fxRates'
import { freightRateForMonth, type FreightLane } from '@/data/freightRates'
import { nykaaDiscountPerSalesFile } from '@/engine/nativePnl/nykaa'
import { monthLabel, toMonthKey, formatCurrencyFull } from '@/lib/format'

/**
 * The USD→INR rate, entered per month.
 *
 * Amazon USA is denominated in dollars, so this single number scales the whole
 * channel — revenue and cost alike — wherever it rolls into the rupee P&L. It
 * used to be a constant in the code, which meant every closed month was
 * restated the moment anyone changed it. Entered per month, a month keeps the
 * rate it was closed on, exactly like an effective-dated cost.
 *
 * Enter the rate actually realised on the remittance, not a mid-market quote:
 * the P&L should reflect the rupees that reached the bank.
 */
export function FxRatesPage() {
  const { fxRates, amazonUsaFacts, salesRecords, saveFxRate, removeFxRate } = useDataStore()
  const [month, setMonth] = useState(() => toMonthKey(new Date().toISOString().slice(0, 10)))
  const [rate, setRate] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Months that actually have Amazon USA activity — the only ones where a
   * missing rate changes a number. */
  const monthsNeedingRate = useMemo(() => {
    const set = new Set<string>()
    for (const f of amazonUsaFacts) set.add(f.month)
    for (const r of salesRecords) if (r.channel === 'amazon_us') set.add(toMonthKey(r.orderDate))
    return [...set].sort().reverse()
  }, [amazonUsaFacts, salesRecords])

  const missing = monthsNeedingRate.filter((m) => !fxRateForMonth(m, fxRates).entered)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const value = Number(rate)
    if (!Number.isFinite(value) || value <= 0) {
      setError('Enter a rate greater than zero — it is divided by downstream.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await saveFxRate({ month, rate: value, note: note.trim() || undefined })
      setRate('')
      setNote('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const sorted = [...fxRates].sort((a, b) => b.month.localeCompare(a.month))

  return (
    <PageShell
      title="Rates"
      subtitle="The two figures Amazon USA is costed on that no report supplies: the exchange rate, and what it costs to fly a unit there."
      showFilters={false}
    >
      <Card>
        <CardHeader
          title="Add or correct a month"
          subtitle="Correcting one month leaves every other month exactly as it was."
        />
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold tracking-wide text-[var(--ink-3)] uppercase">Month</span>
            <input
              type="month" value={month} onChange={(e) => setMonth(e.target.value)} required
              className="rounded-[var(--radius-control)] border border-[var(--line-2)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold tracking-wide text-[var(--ink-3)] uppercase">INR per 1 USD</span>
            <input
              type="number" step="0.0001" min="0.0001" inputMode="decimal" required
              value={rate} onChange={(e) => setRate(e.target.value)} placeholder="88.10"
              className="w-36 rounded-[var(--radius-control)] border border-[var(--line-2)] bg-[var(--surface)] px-3 py-2 text-sm tabular-nums text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
            />
          </label>
          <label className="flex min-w-[220px] flex-1 flex-col gap-1">
            <span className="text-[11px] font-semibold tracking-wide text-[var(--ink-3)] uppercase">Source (optional)</span>
            <input
              type="text" value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. HDFC remittance advice, 12 Aug"
              className="rounded-[var(--radius-control)] border border-[var(--line-2)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
            />
          </label>
          <button
            type="submit" disabled={busy}
            className="rounded-[var(--radius-control)] bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-ink)] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save rate'}
          </button>
        </form>
        {error && <p className="mt-3 text-xs text-[var(--critical-ink)]">{error}</p>}
        <p className="mt-3 text-xs text-[var(--ink-3)]">
          Use the rate you actually realised on the remittance rather than a mid-market quote — the P&L should reflect the
          rupees that reached the bank.
        </p>
      </Card>

      {missing.length > 0 && (
        <Card className="border-[color-mix(in_oklab,var(--warning)_45%,transparent)] bg-[color-mix(in_oklab,var(--warning)_10%,transparent)]">
          <h3 className="text-sm font-semibold text-[var(--ink)]">
            {missing.length} Amazon USA month{missing.length === 1 ? '' : 's'} without a rate
          </h3>
          <p className="mt-1 text-xs text-[var(--ink-2)]">
            These fall back to the default of ₹{NATIVE_PNL_ASSUMPTIONS.usdToInrRate.toFixed(2)}, which is an assumption
            rather than a rate anyone was paid. Every figure for those months is scaled by it.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {missing.map((m) => (
              <button
                key={m} type="button" onClick={() => setMonth(m)}
                className="rounded-full border border-[var(--line-2)] bg-[var(--surface)] px-2.5 py-1 text-xs font-medium text-[var(--ink-2)] hover:text-[var(--ink)]"
              >
                {monthLabel(m)}
              </button>
            ))}
          </div>
        </Card>
      )}

      <Card padded={false}>
        <div className="px-5 pt-5">
          <CardHeader title="Rates on file" subtitle={`${sorted.length} month${sorted.length === 1 ? '' : 's'}`} />
        </div>
        {sorted.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-[var(--ink-3)]">
            No rates entered yet — every Amazon USA month is using the default.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--surface-2)] text-[11px] tracking-wide text-[var(--ink-3)] uppercase">
                <tr>
                  <th className="px-5 py-2.5 text-left">Month</th>
                  <th className="px-5 py-2.5 text-right">INR per USD</th>
                  <th className="px-5 py-2.5 text-left">Source</th>
                  <th className="px-5 py-2.5 text-right">Updated</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {sorted.map((r) => (
                  <tr key={r.month} className="hover:bg-[var(--surface-hover)]">
                    <td className="px-5 py-2.5 font-medium text-[var(--ink)]">{monthLabel(r.month)}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-[var(--ink)]">{r.rate.toFixed(4)}</td>
                    <td className="px-5 py-2.5 text-[var(--ink-3)]">{r.note ?? '—'}</td>
                    <td className="px-5 py-2.5 text-right text-xs text-[var(--ink-3)]">
                      {r.updatedAt ? new Date(r.updatedAt).toLocaleDateString('en-IN') : '—'}
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => void removeFxRate(r.month)}
                        className="text-xs font-medium text-[var(--ink-3)] hover:text-[var(--critical-ink)]"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="px-5 py-4 text-xs text-[var(--ink-3)]">
          Removing a month does not delete a rate so much as return that month to the default{' '}
          <Badge tone="neutral">₹{NATIVE_PNL_ASSUMPTIONS.usdToInrRate.toFixed(2)}</Badge> — which is the right way to undo a
          mistaken entry.
        </p>
      </Card>

      <NykaaDiscountSection />
      <FreightSection lane="india_usa" />
      <FreightSection lane="nykaa_inbound" />
    </PageShell>
  )
}

/**
 * India → USA inbound freight, entered per month as rupees per unit shipped.
 *
 * There is no formula behind this and no report supplies it: Amazon's exports
 * say what sold and what Amazon charged, and know nothing about the airway
 * bill. The figure is the month's total inbound freight divided by the units
 * it carried, which is a business input, so it is entered rather than derived.
 *
 * It was a constant compiled into the build, multiplied by units at import and
 * frozen into the month. Nobody could change it without a deploy, and because
 * it was frozen, correcting it would not have restated the months already
 * loaded. Dated by month and applied when the statement is read, it behaves
 * like the exchange rate and the cost sheet: a closed month keeps what it was
 * closed on, and a correction reaches every month that should see it.
 */
/**
 * Each lane's copy. They are genuinely different costs: one is an airway bill
 * with a standing figure behind it, the other a carrier rate card of a rupee
 * or two a unit, and only the first has a default worth falling back to.
 */
const LANE_COPY: Record<FreightLane, {
  title: string
  subtitle: string
  placeholder: string
  sourceHint: string
  /** What an unentered month costs. Undefined means nothing is charged. */
  fallback?: number
  emptyState: string
}> = {
  india_usa: {
    title: 'India → USA freight',
    subtitle: "Rupees per unit shipped. Take the month's total inbound freight and divide by the units it carried.",
    placeholder: NATIVE_PNL_ASSUMPTIONS.indiaUsaFreightPerUnitInr.toFixed(2),
    sourceHint: 'Forwarder invoice, airway bill, quarter average…',
    fallback: NATIVE_PNL_ASSUMPTIONS.indiaUsaFreightPerUnitInr,
    emptyState: 'Nothing entered yet — every Amazon USA month is freighted at the default.',
  },
  nykaa_inbound: {
    title: 'HLPL warehouse → Nykaa warehouse',
    subtitle:
      'Rupees per unit, from the carrier rate card. Charged on the units Nykaa sold in the month, so it moves with volume.',
    placeholder: '1.50',
    sourceHint: 'Rate card, carrier invoice, negotiated slab…',
    emptyState: 'Nothing entered yet — Nykaa months carry no delivery cost until a rate is entered.',
  },
}

function FreightSection({ lane }: { lane: FreightLane }) {
  const copy = LANE_COPY[lane]
  const { freightRates, amazonUsaFacts, nykaaFacts, saveFreightRate, removeFreightRate } = useDataStore()
  const [month, setMonth] = useState(() => toMonthKey(new Date().toISOString().slice(0, 10)))
  const [perUnit, setPerUnit] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The months worth prompting about are the ones this lane's channel
  // actually traded in. Listing every month would make the prompt noise.
  const tradedMonths = useMemo(() => {
    const facts = lane === 'india_usa' ? amazonUsaFacts : nykaaFacts
    return [...new Set(facts.map((f) => f.month))].sort().reverse()
  }, [lane, amazonUsaFacts, nykaaFacts])
  const missing = tradedMonths.filter((m) => !freightRateForMonth(m, freightRates, lane).entered)
  const sorted = freightRates
    .filter((r) => (r.lane ?? 'india_usa') === lane)
    .sort((a, b) => b.month.localeCompare(a.month))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const value = Number(perUnit)
    if (!Number.isFinite(value) || value < 0) {
      setError('Enter rupees per unit — zero is allowed for a month with no inbound shipment, negative is not.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await saveFreightRate({ month, lane, perUnitInr: value, note: note.trim() || undefined })
      setPerUnit('')
      setNote('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Card>
        <CardHeader title={copy.title} subtitle={copy.subtitle} />
        <form onSubmit={submit} className="mt-4 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-[var(--ink-3)]">Month</span>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="rounded-md border border-[var(--line-2)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-[var(--ink-3)]">₹ per unit</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={perUnit}
              onChange={(e) => setPerUnit(e.target.value)}
              placeholder={copy.placeholder}
              className="w-32 rounded-md border border-[var(--line-2)] bg-[var(--surface)] px-3 py-1.5 text-sm tabular-nums text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-xs font-medium text-[var(--ink-3)]">Source</span>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={copy.sourceHint}
              className="w-full rounded-md border border-[var(--line-2)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-[var(--accent-ink)] hover:opacity-90 disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-[var(--critical-ink)]">{error}</p>}
        {missing.length > 0 && (
          <p className="mt-3 text-xs text-[var(--ink-3)]">
            No rate entered for {missing.map(monthLabel).join(', ')} —{' '}
            {copy.fallback === undefined ? (
              <>those months carry <Badge tone="warn">no freight cost at all</Badge>, so their margin is overstated.</>
            ) : (
              <>those months are using the default <Badge tone="neutral">₹{copy.fallback.toFixed(2)}</Badge> per unit.</>
            )}
          </p>
        )}
      </Card>

      <Card padded={false}>
        <div className="px-5 pt-5">
          <CardHeader
            title={`${copy.title} — on file`}
            subtitle={`${sorted.length} month${sorted.length === 1 ? '' : 's'}`}
          />
        </div>
        {sorted.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-[var(--ink-3)]">
            {copy.emptyState}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--surface-2)] text-[11px] tracking-wide text-[var(--ink-3)] uppercase">
                <tr>
                  <th className="px-5 py-2.5 text-left">Month</th>
                  <th className="px-5 py-2.5 text-right">₹ per unit</th>
                  <th className="px-5 py-2.5 text-left">Source</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {sorted.map((r) => (
                  <tr key={r.month} className="hover:bg-[var(--surface-hover)]">
                    <td className="px-5 py-2.5 font-medium text-[var(--ink)]">{monthLabel(r.month)}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-[var(--ink)]">{r.perUnitInr.toFixed(2)}</td>
                    <td className="px-5 py-2.5 text-[var(--ink-3)]">{r.note ?? '—'}</td>
                    <td className="px-5 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => void removeFreightRate(r.month, lane)}
                        className="text-xs font-medium text-[var(--ink-3)] hover:text-[var(--critical-ink)]"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}

/**
 * The customer discount Nykaa confirms, as against the one its sales file
 * implies.
 *
 * The file arrives on time but is provisional; what Nykaa actually bills is
 * settled by email a month or two later, and the two routinely differ. A month
 * cannot wait for the email, so it opens on the file's figure and this screen
 * replaces it once the real one is known. Both stay on the statement, because
 * the gap between them is the thing worth arguing with Nykaa about.
 */
function NykaaDiscountSection() {
  const { nykaaDiscounts, nykaaFacts, saveNykaaDiscount, removeNykaaDiscount } = useDataStore()
  const [month, setMonth] = useState(() => toMonthKey(new Date().toISOString().slice(0, 10)))
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sorted = [...nykaaDiscounts].sort((a, b) => b.month.localeCompare(a.month))
  // What the chosen month's own files say, so the person typing can see what
  // they are replacing before they replace it.
  const factsForMonth = nykaaFacts.find((f) => f.month === month)
  const perSalesFile = factsForMonth ? nykaaDiscountPerSalesFile(factsForMonth) : undefined
  const typed = Number(amount)
  const variance = perSalesFile !== undefined && amount.trim() !== '' && Number.isFinite(typed)
    ? typed - perSalesFile
    : undefined

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!Number.isFinite(typed) || typed < 0) {
      setError('Enter the confirmed amount in rupees — zero is allowed, negative is not.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await saveNykaaDiscount({ month, amountInr: typed, note: note.trim() || undefined })
      setAmount('')
      setNote('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const field =
    'rounded-md border border-[var(--line-2)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none'

  return (
    <>
      <Card>
        <CardHeader
          title="Nykaa customer discount — confirmed figure"
          subtitle="What Nykaa confirms it is charging back, once the email settles it. This replaces the figure the sales file implied; both stay on the statement."
        />
        <form onSubmit={submit} className="mt-4 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-[var(--ink-3)]">Month the discount was given</span>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={field} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-[var(--ink-3)]">₹ confirmed</span>
            <input
              type="number" step="0.01" min="0" value={amount} inputMode="decimal"
              onChange={(e) => setAmount(e.target.value)}
              placeholder={perSalesFile !== undefined ? perSalesFile.toFixed(0) : '0.00'}
              className={`${field} w-40 text-right tabular-nums`}
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-xs font-medium text-[var(--ink-3)]">Source</span>
            <input
              type="text" value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="Email of 12 Nov, debit note 1100005020, confirmed by…"
              className={`${field} w-full`}
            />
          </label>
          <button
            type="submit" disabled={busy}
            className="rounded-md bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-[var(--accent-ink)] hover:opacity-90 disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-[var(--critical-ink)]">{error}</p>}
        <p className="mt-3 text-xs text-[var(--ink-3)]">
          {perSalesFile === undefined ? (
            <>No Nykaa sales file is on file for {monthLabel(month)}, so there is nothing to compare against yet.</>
          ) : (
            <>
              {monthLabel(month)}&apos;s sales file implies{' '}
              <Badge tone="neutral">{formatCurrencyFull(perSalesFile)}</Badge>
              {variance !== undefined && Math.abs(variance) > 1 && (
                <>
                  {' '}— what you have typed is{' '}
                  <Badge tone={variance > 0 ? 'bad' : 'good'}>
                    {formatCurrencyFull(Math.abs(variance))} {variance > 0 ? 'more' : 'less'}
                  </Badge>
                </>
              )}
              .
            </>
          )}
        </p>
      </Card>

      <Card padded={false}>
        <div className="px-5 pt-5">
          <CardHeader
            title="Confirmed discounts on file"
            subtitle={`${sorted.length} month${sorted.length === 1 ? '' : 's'}`}
          />
        </div>
        {sorted.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-[var(--ink-3)]">
            Nothing confirmed yet — every Nykaa month is using the figure its own sales file implies.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--surface-2)] text-[11px] tracking-wide text-[var(--ink-3)] uppercase">
                <tr>
                  <th className="px-5 py-2.5 text-left">Month</th>
                  <th className="px-5 py-2.5 text-right">Confirmed</th>
                  <th className="px-5 py-2.5 text-right">Sales file</th>
                  <th className="px-5 py-2.5 text-left">Source</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {sorted.map((d) => {
                  const facts = nykaaFacts.find((f) => f.month === d.month)
                  const implied = facts ? nykaaDiscountPerSalesFile(facts) : undefined
                  return (
                    <tr key={d.month} className="hover:bg-[var(--surface-hover)]">
                      <td className="px-5 py-2.5 font-medium text-[var(--ink)]">{monthLabel(d.month)}</td>
                      <td className="px-5 py-2.5 text-right tabular-nums text-[var(--ink)]">
                        {formatCurrencyFull(d.amountInr)}
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums text-[var(--ink-3)]">
                        {implied === undefined ? '—' : formatCurrencyFull(implied)}
                      </td>
                      <td className="px-5 py-2.5 text-[var(--ink-3)]">{d.note ?? '—'}</td>
                      <td className="px-5 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => void removeNykaaDiscount(d.month)}
                          title="Put this month back on what its sales file implies"
                          className="text-xs font-medium text-[var(--ink-3)] hover:text-[var(--critical-ink)]"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}
