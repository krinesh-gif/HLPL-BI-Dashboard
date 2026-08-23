import { useState } from 'react'
import { useDataStore } from '@/store/dataStore'
import type { AdsChannelDef, AdsChannelId } from '@/config/adsChannels'
import { addMonths, formatCurrencyFull, formatDate, monthLabel } from '@/lib/format'
import type { AdsSpendFigure } from '@/engine/adsSpend'

/**
 * Records a month's advertising figure for a platform that bills by invoice.
 *
 * Nykaa's marketing-investment value arrives as an invoice, not a campaign
 * report. The amount is what matters and is what feeds the P&L; the invoice
 * file name and a note are kept alongside it so the figure can be traced back
 * to its source months later.
 *
 * The invoice itself is not uploaded. Storing the document would mean a file
 * store and a retention policy for what is a finance record, and the figure
 * plus its reference already answers the question this dashboard is asked.
 */
export function ManualAdSpendForm({
  channel,
  def,
  month,
  current,
}: {
  channel: AdsChannelId
  def: AdsChannelDef
  month: string
  current: AdsSpendFigure
}) {
  const { manualAdSpend, saveManualAdSpend, removeManualAdSpend } = useDataStore()

  const [entryMonth, setEntryMonth] = useState(month)
  const [amount, setAmount] = useState('')
  const [fileName, setFileName] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const history = manualAdSpend
    .filter((e) => e.channel === channel)
    .sort((a, b) => b.month.localeCompare(a.month))

  const monthOptions = Array.from({ length: 25 }, (_, i) => addMonths(month, 12 - i))

  async function submit() {
    const value = Number(amount.replace(/[₹,\s]/g, ''))
    if (!Number.isFinite(value) || value < 0) {
      setError('Enter the amount as a number, for example 125000.')
      return
    }
    setBusy(true)
    setError(null)
    setSaved(null)
    try {
      await saveManualAdSpend({
        channel,
        month: entryMonth,
        amount: value,
        fileName: fileName.trim() || undefined,
        note: note.trim() || undefined,
      })
      setSaved(`Saved ${formatCurrencyFull(value)} for ${monthLabel(entryMonth)}.`)
      setAmount('')
      setFileName('')
      setNote('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that figure.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-800">{def.label} {def.invoiceLabel ?? 'monthly value'}</h3>
      <p className="mt-1 text-sm text-slate-600">
        {def.label} bills by monthly invoice rather than publishing a campaign report, so the figure is entered here. It counts as
        advertising spend in the P&amp;L and in total ad investment, and is labelled as manually entered wherever it appears.
      </p>

      {current.source === 'report' && (
        <p className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          An uploaded report already covers {monthLabel(month)}, and a report takes priority over a manual figure. Anything entered
          here for that month will be stored but not used until the report is removed.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
          Month
          <select
            value={entryMonth}
            onChange={(e) => setEntryMonth(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none"
          >
            {monthOptions.map((m) => (
              <option key={m} value={m}>{monthLabel(m)}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
          {def.invoiceLabel ?? 'Amount'}
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit() }}
            placeholder="125000"
            inputMode="decimal"
            className="w-40 rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
          Invoice reference
          <input
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            placeholder="NYK-MI-Aug-2026.pdf"
            className="w-56 rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
          Note
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional"
            className="w-56 rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
          />
        </label>

        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !amount.trim()}
          className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>

      {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
      {saved && <p className="mt-2 text-xs text-emerald-700">{saved}</p>}

      {history.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-md border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Month</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Amount</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Invoice</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Note</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Entered</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {history.map((e) => (
                <tr key={e.month} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-slate-700">{monthLabel(e.month)}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums text-slate-900">{formatCurrencyFull(e.amount)}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{e.fileName ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{e.note ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-slate-400">{formatDate(e.enteredAt)}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => void removeManualAdSpend(channel, e.month)}
                      className="text-xs font-medium text-rose-600 hover:text-rose-800"
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
    </section>
  )
}
