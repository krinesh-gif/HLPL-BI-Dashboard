import { useSearchParams, Link } from 'react-router-dom'
import { channelLabel, type BusinessChannelId } from '@/config/channels'
import { formatCurrencyFull, formatPercent, monthLabel, currencyName } from '@/lib/format'
import { usePnlReport } from './usePnlReport'
import { pnlSnapshotStart } from './pnlSnapshotStart'

export function PnlSnapshotPage() {
  const [params] = useSearchParams()

  const r = usePnlReport(pnlSnapshotStart(params))

  const title = r.view === 'master' ? 'Master Company P&L' : `${channelLabel(r.view as BusinessChannelId)} P&L`
  const takenOn = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  const money = (v: number | null) => (v === null ? '—' : formatCurrencyFull(v, r.displayCurrency))
  const periodLabel =
    r.months.length === 0
      ? '—'
      : r.months.length === 1
        ? monthLabel(r.months[0])
        : `${monthLabel(r.months[0])} – ${monthLabel(r.months[r.months.length - 1])}`

  return (
    <div className="pnl-snapshot mx-auto w-full max-w-[1100px] px-6 py-6 print:max-w-none print:p-0">
      <div className="mb-4 flex flex-wrap items-center gap-3 print:hidden">
        <Link to="/pnl" className="text-sm font-medium text-[var(--accent)] hover:underline">← Back to P&amp;L</Link>
        <button
          type="button"
          onClick={() => window.print()}
          className="ml-auto rounded-[var(--radius-control)] bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-ink)] transition-opacity hover:opacity-90"
        >
          Save as PDF
        </button>
      </div>
      <p className="mb-4 text-xs text-[var(--ink-3)] print:hidden">
        Prints on one landscape page. This is the full statement — costs, margins and all — so it is for accounts,
        finance and founders, not for a marketplace manager.
      </p>

      <div className="rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[var(--shadow-card)] print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line)] pb-3">
          <div>
            <h1 className="text-lg font-bold tracking-[-0.01em] text-[var(--ink)]">{title}</h1>
            <div className="mt-0.5 text-[13px] font-semibold text-[var(--ink-2)]">{periodLabel}</div>
          </div>
          <div className="text-right text-[11px] leading-snug text-[var(--ink-3)]">
            <div className="font-semibold text-[var(--ink-2)]">Aravi Organic</div>
            <div>Hivefy Lifestyle Pvt Ltd</div>
            <div className="mt-1">
              Taken on {takenOn} · {currencyName(r.displayCurrency)}
              {r.view === 'meesho' && ` · ${r.meeshoBasis === 'settlement' ? 'payment' : 'order'} date basis`}
            </div>
          </div>
        </header>

        {r.missingStatementNote && (
          <p className="mt-3 rounded-md border border-[color-mix(in_oklab,var(--warning)_45%,transparent)] bg-[color-mix(in_oklab,var(--warning)_12%,transparent)] px-3 py-2 text-[11px] text-[var(--ink-2)]">
            <span className="font-semibold">Standing in for the real statement.</span> {r.missingStatementNote}
          </p>
        )}

        <table className="mt-3 w-full text-[11px]">
          <thead>
            <tr className="border-b border-[var(--line-2)] text-[10px] font-semibold text-[var(--ink-3)]">
              <th className="py-1.5 text-left uppercase tracking-wide">{r.view === 'master' ? 'Master Company' : channelLabel(r.view as BusinessChannelId)}</th>
              {r.months.map((m) => <th key={m} className="py-1.5 pl-3 text-right">{monthLabel(m)}</th>)}
              <th className="py-1.5 pl-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {r.table.rows.map((row) => {
              const subtotal = row.def.kind === 'subtotal'
              const percent = row.def.kind === 'percent'
              return (
                <tr
                  key={row.def.key}
                  className={`border-b border-[var(--line)] last:border-0 ${subtotal ? 'bg-[var(--surface-2)] font-semibold' : ''}`}
                >
                  <td className={`py-1 ${row.def.indent ? 'pl-4 text-[var(--ink-3)]' : 'text-[var(--ink)]'}`}>
                    {row.def.label}
                  </td>
                  {row.values.map((v, i) => (
                    <td key={i} className={`py-1 pl-3 text-right tabular-nums ${subtotal ? 'text-[var(--ink)]' : 'text-[var(--ink-2)]'}`}>
                      {percent ? (v === null ? '—' : formatPercent(v)) : money(v === null ? null : v * (row.def.sign ?? 1))}
                    </td>
                  ))}
                  <td className={`py-1 pl-3 text-right tabular-nums ${subtotal ? 'text-[var(--ink)]' : 'text-[var(--ink-2)]'}`}>
                    {percent ? (row.total === null ? '—' : formatPercent(row.total)) : money(row.total === null ? null : row.total * (row.def.sign ?? 1))}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {r.channelBreakdown.length > 0 && (
          <section className="mt-4">
            <h2 className="text-[11px] font-semibold text-[var(--ink-2)]">
              Net sales by channel, {monthLabel(r.latestMonth)}
            </h2>
            <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1">
              {r.channelBreakdown.map((c) => (
                <span key={c.channel} className="text-[11px] text-[var(--ink-3)]">
                  {channelLabel(c.channel)}{' '}
                  <span className="font-semibold tabular-nums text-[var(--ink)]">{formatCurrencyFull(c.netSales)}</span>
                </span>
              ))}
            </div>
          </section>
        )}

        <footer className="mt-4 border-t border-[var(--line)] pt-2 text-[10px] leading-snug text-[var(--ink-3)]">
          Every figure is built from the marketplace reports uploaded for these months. Fixed expenses are shared
          across channels by each channel&apos;s share of that month&apos;s sales, so a channel&apos;s EBITDA moves
          when another channel&apos;s month is uploaded.
        </footer>
      </div>
    </div>
  )
}
