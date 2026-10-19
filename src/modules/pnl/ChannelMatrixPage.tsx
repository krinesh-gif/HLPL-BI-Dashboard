import { Link } from 'react-router-dom'
import { PageShell } from '@/components/layout/PageShell'
import { channelLabel } from '@/config/channels'
import { formatCurrencyFull, formatPercent, monthLabel } from '@/lib/format'
import { exportRowsToCsv } from '@/lib/exportCsv'
import { amountTone } from '@/components/pnl/amountTone'
import { useChannelMatrix } from './useChannelMatrix'

/**
 * One month's P&L with the channels across and the particulars down.
 *
 * The P&L screen answers "how is this channel doing over time". This answers
 * the question a month-end meeting actually opens with: for this one month,
 * which channel earned what, what each one cost, and which of them made money.
 * Reading it off ten separate channel statements is the same work done ten
 * times, and the cross-channel comparison — the point of the exercise — never
 * appears on any of them.
 */
export function ChannelMatrixPage() {
  const r = useChannelMatrix()

  function handleExport() {
    exportRowsToCsv(
      `HLPL_PnL_AllChannels_${r.month}`,
      r.table.rows.map((row) => {
        const out: Record<string, string | number> = { Particular: row.def.label }
        const sign = row.def.sign ?? 1
        // Signed as the table shows it, so a deduction reads as a deduction in
        // the spreadsheet too.
        const cell = (v: number | null) =>
          v === null ? '' : row.def.kind === 'percent' ? Number(v.toFixed(2)) : Math.round(v * sign)
        r.channels.forEach((c, i) => { out[channelLabel(c)] = cell(row.values[i]) })
        out['Master Company'] = cell(row.total)
        return out
      }),
    )
  }

  return (
    <PageShell
      title="Channel P&L"
      subtitle="One month, every channel side by side"
      showFilters={false}
      headerActions={
        <Link
          to="/pnl"
          className="rounded-[var(--radius-control)] border border-[var(--line-2)] px-3 py-1.5 text-sm font-medium text-[var(--ink-2)] hover:bg-[var(--surface-hover)]"
        >
          Month by month
        </Link>
      }
    >
      {/* ---- Controls ----------------------------------------------------- */}
      <div className="flex flex-wrap items-end gap-4 rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[var(--shadow-card)]">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--ink-3)]">Month</span>
          <select
            value={r.month}
            onChange={(e) => r.setMonth(e.target.value)}
            className="min-w-40 cursor-pointer rounded-full border border-[var(--line-2)] bg-[var(--surface)] px-3.5 py-1.5 text-sm font-medium text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
          >
            {(r.monthsWithData.length > 0 ? r.monthsWithData : [r.month]).map((m) => (
              <option key={m} value={m}>{monthLabel(m)}</option>
            ))}
          </select>
        </label>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--ink-3)]">Meesho basis</span>
          <div className="flex rounded-md border border-[var(--line-2)] bg-[var(--surface)] p-0.5">
            {([
              { key: 'order', label: 'Order date' },
              { key: 'settlement', label: 'Payment date' },
            ] as const).map((b) => (
              <button
                key={b.key}
                type="button"
                onClick={() => r.setMeeshoBasis(b.key)}
                aria-pressed={r.meeshoBasis === b.key}
                className={`rounded px-3 py-1 text-sm font-medium transition ${
                  r.meeshoBasis === b.key ? 'bg-[var(--accent)] text-[var(--accent-ink)]' : 'text-[var(--ink-2)] hover:bg-[var(--surface-hover)]'
                }`}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={handleExport}
          className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-[var(--line-2)] px-3.5 py-1.5 text-sm font-medium text-[var(--ink-2)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>
          Export CSV
        </button>
      </div>

      {/* ---- The report --------------------------------------------------- */}
      {r.channels.length === 0 ? (
        <p className="rounded-[var(--radius-control)] border border-[color-mix(in_oklab,var(--warning)_45%,transparent)] bg-[color-mix(in_oklab,var(--warning)_12%,transparent)] px-3.5 py-2.5 text-sm text-[var(--ink)]">
          <strong>No channel has anything in {monthLabel(r.month)}.</strong> Upload that month's reports on Data ▸ Data Upload and
          this report fills itself.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-card)]">
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className="border-b-2 border-[var(--line-2)] bg-[var(--surface-2)]">
                <th className="sticky left-0 z-20 min-w-44 bg-[var(--surface-2)] px-5 py-3 text-left text-xs font-semibold text-[var(--ink-2)]">
                  {monthLabel(r.month)}
                  <span className="ml-2 rounded-full bg-[var(--surface)] px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal text-[var(--ink-2)]">
                    in ₹ INR
                  </span>
                </th>
                {r.channels.map((c) => (
                  <th key={c} className="min-w-32 px-5 py-3 text-right text-xs font-semibold text-[var(--ink-2)]">
                    {/* Opens that channel's own P&L, which is where the next
                        question after "why is this one down" gets answered. */}
                    <Link to={`/pnl?view=${c}`} className="hover:text-[var(--accent)]">
                      {channelLabel(c)}
                    </Link>
                  </th>
                ))}
                <th className="min-w-36 border-l-2 border-[var(--line-2)] bg-[var(--surface-2)] px-5 py-3 text-right text-xs font-bold text-[var(--ink)]">
                  Master Company
                </th>
              </tr>
            </thead>
            <tbody>
              {r.table.rows.map((row) => {
                const isSubtotal = row.def.kind === 'subtotal'
                const isPercent = row.def.kind === 'percent'
                // Deductions are stored as positive magnitudes and shown
                // negative, so red always means money leaving and the minus
                // sign says so without relying on the colour.
                const signed = (v: number | null) => (v === null ? null : v * (row.def.sign ?? 1))
                // An undefined figure and a zero are different answers; a
                // margin on a channel with no revenue is unmeasurable, not 0%.
                const format = (v: number | null) =>
                  v === null ? '—' : isPercent ? formatPercent(v) : formatCurrencyFull(v)

                return (
                  <tr
                    key={row.def.key}
                    className={`border-b border-[var(--line)] ${isSubtotal ? 'bg-[var(--surface-2)] font-semibold' : ''} ${isPercent ? 'italic text-[var(--ink-2)]' : ''}`}
                  >
                    <th
                      className={`sticky left-0 z-10 px-5 py-2.5 text-left font-normal ${
                        isSubtotal ? 'bg-[var(--surface-2)] font-semibold text-[var(--ink)]' : 'bg-[var(--surface)] text-[var(--ink-2)]'
                      } ${row.def.indent ? 'pl-8 text-[var(--ink-3)]' : ''}`}
                      title={row.def.note}
                    >
                      {row.def.label}
                    </th>
                    {row.values.map((v, i) => {
                      const shown = signed(v)
                      return (
                        <td key={r.channels[i]} className={`px-5 py-2.5 text-right tabular-nums ${amountTone(shown)}`}>
                          {shown === 0 && !isPercent ? '—' : format(shown)}
                        </td>
                      )
                    })}
                    <td
                      className={`border-l-2 border-[var(--line-2)] bg-[var(--surface-2)] px-5 py-2.5 text-right font-semibold tabular-nums ${amountTone(signed(row.total))}`}
                    >
                      {signed(row.total) === 0 && !isPercent ? '—' : format(signed(row.total))}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-[var(--ink-3)]">
        Every column is one channel's own statement, in rupees — Amazon USA and Amazon UAE converted at the month's entered rate, and
        Amazon India as both of its businesses together. The Master Company column is the sum of the channels, which is the Master
        P&amp;L for the month: margins in it are recomputed from the summed figures, because the average of ten channel margins is not
        the company's margin.
      </p>

      {r.absent.length > 0 && (
        <p className="text-xs text-[var(--ink-3)]">
          No column for {r.absent.map(channelLabel).join(', ')} — {r.absent.length === 1 ? 'that channel has' : 'those channels have'}{' '}
          nothing in {monthLabel(r.month)}. A missing column is a missing month, not a closed channel.
        </p>
      )}
    </PageShell>
  )
}
