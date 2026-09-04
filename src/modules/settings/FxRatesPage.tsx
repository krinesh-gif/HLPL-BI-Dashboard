import { useMemo, useState } from 'react'
import { PageShell } from '@/components/layout/PageShell'
import { Card, CardHeader, Badge } from '@/components/ui/Surface'
import { useDataStore } from '@/store/dataStore'
import { NATIVE_PNL_ASSUMPTIONS } from '@/config/nativePnlAssumptions'
import { fxRateForMonth } from '@/data/fxRates'
import { monthLabel, toMonthKey } from '@/lib/format'

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
      title="Exchange Rates"
      subtitle="USD → INR, per month. Amazon USA is priced in dollars, so this scales the whole channel."
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
    </PageShell>
  )
}
