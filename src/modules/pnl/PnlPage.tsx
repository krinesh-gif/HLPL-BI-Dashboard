import { Link } from 'react-router-dom'
import { PageShell } from '@/components/layout/PageShell'
import { TrendLineChart } from '@/components/charts/TrendLineChart'
import { ComparisonBarChart } from '@/components/charts/ComparisonBarChart'
import { BUSINESS_CHANNELS, channelLabel } from '@/config/channels'
import { formatCurrencyCompact, formatCurrencyFull, formatPercent, monthLabel } from '@/lib/format'
import { exportRowsToCsv } from '@/lib/exportCsv'
import { QUICK_PERIODS, type QuickPeriod } from '@/engine/multiMonthPnl'
import { NativePnlTable } from '@/components/pnl/NativePnlTable'
import { usePnlReport, type PnlView } from './usePnlReport'

/**
 * The company's P&L, in one place, in one format.
 *
 * It lives here and nowhere else. A channel's P&L is this same report with the
 * view switched — not a second report inside the channel dashboard that could
 * be built differently and disagree.
 */
export function PnlPage() {
  const r = usePnlReport()

  const monthOptions = r.monthsWithData.length > 0 ? r.monthsWithData : [r.latestMonth]

  function handleExport() {
    // The export is built from the same rows the table renders, so what comes
    // out is what was on screen — the selected months and nothing else.
    exportRowsToCsv(
      `HLPL_PnL_${r.view}_${r.displayCurrency}_${r.months[0]}_to_${r.months[r.months.length - 1]}`,
      r.table.rows.map((row) => {
        const out: Record<string, string | number> = { Particular: row.def.label }
        const cell = (v: number | null) =>
          v === null ? '' : row.def.kind === 'percent' ? Number(v.toFixed(2)) : Math.round(v)
        r.months.forEach((m, i) => { out[monthLabel(m)] = cell(row.values[i]) })
        out.Total = cell(row.total)
        return out
      }),
    )
  }

  return (
    <PageShell title="P&L" subtitle="Management accounts by month, for the company and each channel" showFilters={false}>
      {/* ---- Header controls ------------------------------------------- */}
      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--ink-3)]">View</span>
          <select
            value={r.view}
            onChange={(e) => r.setView(e.target.value as PnlView)}
            className="min-w-48 rounded-md border border-[var(--line-2)] bg-[var(--surface)] px-3 py-1.5 text-sm font-medium text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
          >
            <option value="master">Master Company</option>
            {BUSINESS_CHANNELS.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </label>

        {r.view === 'amazon_us' && (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-[var(--ink-3)]">Currency</span>
            <div className="flex rounded-full border border-[var(--line)] bg-[var(--surface-2)] p-0.5">
              {([
                { key: 'USD', label: '$ USD' },
                { key: 'INR', label: '₹ INR' },
              ] as const).map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => r.setAmazonUsaCurrency(c.key)}
                  aria-pressed={r.amazonUsaCurrency === c.key}
                  className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                    r.amazonUsaCurrency === c.key
                      ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                      : 'text-[var(--ink-3)] hover:text-[var(--ink)]'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {r.view === 'meesho' && (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-[var(--ink-3)]">Basis</span>
            <div className="flex rounded-md border border-[var(--line-2)] bg-[var(--surface)] p-0.5">
              {([
                { key: 'order', label: 'Order date' },
                { key: 'settlement', label: 'Payment date' },
              ] as const).map((b) => (
                <button
                  key={b.key}
                  type="button"
                  onClick={() => r.setMeeshoBasis(b.key)}
                  className={`rounded px-3 py-1 text-sm font-medium transition ${
                    r.meeshoBasis === b.key ? 'bg-[var(--accent)] text-[var(--accent-ink)]' : 'text-[var(--ink-2)] hover:bg-[var(--surface-hover)]'
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--ink-3)]">Quick select</span>
          <select
            value={r.period.mode === 'quick' ? r.period.quick : 'custom'}
            onChange={(e) => {
              const v = e.target.value
              if (v === 'custom') r.setPeriod({ ...r.period, mode: 'custom' })
              else r.setPeriod({ ...r.period, mode: 'quick', quick: v as QuickPeriod })
            }}
            className="cursor-pointer rounded-full border border-[var(--line-2)] bg-[var(--surface)] px-3.5 py-1.5 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
          >
            {QUICK_PERIODS.map((p) => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
            {/* Picking From/To directly puts the period into custom mode; the
                option is here so the control still shows what is selected. */}
            <option value="custom">Custom range</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--ink-3)]">From</span>
          <select
            value={r.period.mode === 'custom' ? r.period.from : r.months[0]}
            onChange={(e) => r.setPeriod({ ...r.period, mode: 'custom', from: e.target.value, to: r.period.mode === 'custom' ? r.period.to : r.months[r.months.length - 1] })}
            className="cursor-pointer rounded-full border border-[var(--line-2)] bg-[var(--surface)] px-3.5 py-1.5 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
          >
            {monthOptions.map((m) => (
              <option key={m} value={m}>{monthLabel(m)}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--ink-3)]">To</span>
          <select
            value={r.period.mode === 'custom' ? r.period.to : r.months[r.months.length - 1]}
            onChange={(e) => r.setPeriod({ ...r.period, mode: 'custom', to: e.target.value, from: r.period.mode === 'custom' ? r.period.from : r.months[0] })}
            className="cursor-pointer rounded-full border border-[var(--line-2)] bg-[var(--surface)] px-3.5 py-1.5 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
          >
            {monthOptions.map((m) => (
              <option key={m} value={m}>{monthLabel(m)}</option>
            ))}
          </select>
        </label>

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

      {/* ---- The report -------------------------------------------------- */}
      <div className="overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--surface)]">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b-2 border-[var(--line-2)] bg-[var(--surface-2)]">
              <th className="sticky left-0 z-20 min-w-56 bg-[var(--surface-2)] px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-[var(--ink-3)]">
                {r.view === 'master' ? 'Master Company' : channelLabel(r.view)}
                {/* The figures below change currency, so the table says which
                    one it is in rather than leaving it to the symbol. */}
                {r.view === 'amazon_us' && (
                  <span className="ml-2 rounded-full bg-[var(--surface)] px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal text-[var(--ink-2)]">
                    in {r.displayCurrency} · {r.fxRateLabel}
                  </span>
                )}
              </th>
              {r.months.map((m) => (
                <th key={m} className="min-w-28 px-4 py-2.5 text-right text-xs font-semibold text-[var(--ink-2)]">
                  {monthLabel(m)}
                </th>
              ))}
              <th className="min-w-32 border-l-2 border-[var(--line-2)] bg-[var(--surface-2)] px-4 py-2.5 text-right text-xs font-bold uppercase tracking-wide text-[var(--ink-2)]">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {r.table.rows.map((row) => {
              const isSubtotal = row.def.kind === 'subtotal'
              const isPercent = row.def.kind === 'percent'
              // An undefined figure and a zero are different answers; a margin
              // in a month with no revenue is unmeasurable, not 0%.
              const format = (v: number | null) =>
                v === null ? '—' : isPercent ? formatPercent(v) : formatCurrencyFull(v, r.displayCurrency)

              return (
                <tr
                  key={row.def.key}
                  className={`border-b border-[var(--line)] ${isSubtotal ? 'bg-[var(--surface-2)] font-semibold' : ''} ${isPercent ? 'italic text-[var(--ink-2)]' : ''}`}
                >
                  <th
                    className={`sticky left-0 z-10 px-4 py-2 text-left font-normal ${
                      isSubtotal ? 'bg-[var(--surface-2)] font-semibold text-[var(--ink)]' : 'bg-[var(--surface)] text-[var(--ink-2)]'
                    } ${row.def.indent ? 'pl-8 text-[var(--ink-3)]' : ''}`}
                  >
                    {row.def.label}
                  </th>
                  {row.values.map((v, i) => (
                    <td
                      key={r.months[i]}
                      className={`px-4 py-2 text-right tabular-nums ${
                        v !== null && v < 0 ? 'text-[var(--critical-ink)]' : ''
                      }`}
                    >
                      {v === 0 && !isPercent ? '—' : format(v)}
                    </td>
                  ))}
                  <td
                    className={`border-l-2 border-[var(--line-2)] bg-[var(--surface-2)] px-4 py-2 text-right font-semibold tabular-nums ${
                      row.total !== null && row.total < 0 ? 'text-[var(--critical-ink)]' : 'text-[var(--ink)]'
                    }`}
                  >
                    {row.total === 0 && !isPercent ? '—' : format(row.total)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-[var(--ink-3)]">
        Percentages in the Total column are recomputed from the period's totals, not averaged across months — the average of monthly
        margins is not the margin of the period.
      </p>

      {r.view === 'amazon_us' && (
        <p className="rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--ink-2)]">
          {r.amazonUsaCurrency === 'USD' ? (
            <><strong>Shown in US dollars</strong>, the currency Amazon actually charges and pays in — so no exchange rate
            stands between the report and this statement.</>
          ) : (
            <><strong>Shown in rupees</strong>, converted at {r.fxRateLabel}. Margin percentages are ratios and read the
            same in either currency.</>
          )}{' '}
          {r.fxRateEntered
            ? 'That is the rate entered for this month.'
            : 'No rate has been entered for this month, so the default assumption is being used — set it on Settings ▸ Exchange Rates.'}
          {' '}The Master P&L is always in rupees, whichever view is selected here.
        </p>
      )}

      {r.view === 'meesho' && (
        <p className="rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--ink-2)]">
          {r.meeshoBasis === 'order' ? (
            <>
              <strong>Order-date basis.</strong> Every order counted in the month the customer placed it — what a month's trading
              earned. Use this for trading, marketing and SKU decisions.
            </>
          ) : (
            <>
              <strong>Payment-date basis.</strong> Every order counted in the month Meesho paid for it — what the bank saw. Use this
              for cash and reconciliation.
            </>
          )}{' '}
          The same orders sit behind both; they differ because a payment run settles a great deal of the previous month's trading.
          Neither is more correct than the other.
        </p>
      )}

      {r.view === 'meesho' && !r.native && (
        <p className="rounded-md border border-[color-mix(in_oklab,var(--warning)_45%,transparent)] bg-[color-mix(in_oklab,var(--warning)_12%,transparent)] px-3 py-2 text-xs text-[var(--ink)]">
          <strong>No Meesho statement stored for this period yet</strong>, so the figures above come from order rows alone and the
          Order date / Payment date toggle has nothing to switch between. Upload the aggregated payment workbook (Payments ▸ Order
          Payments) on Upload Reports — one upload produces both statements.
        </p>
      )}

      {r.native && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--ink-3)]">
            {channelLabel(r.view as Exclude<PnlView, 'master'>)} — full statement, {monthLabel(r.nativeMonth)}
          </h2>
          {r.nativeNotes.map((note) => (
            <p key={note} className="mb-3 rounded-md border border-[color-mix(in_oklab,var(--warning)_45%,transparent)] bg-[color-mix(in_oklab,var(--warning)_12%,transparent)] px-3 py-2 text-xs text-[var(--ink)]">
              {note}
            </p>
          ))}
          <NativePnlTable lineDefs={r.native.lineDefs} values={r.native.values} currency={r.native.currency} />
        </section>
      )}

      {/* ---- Channel drill-down ------------------------------------------ */}
      {r.channelBreakdown.length > 0 && (
        <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
          <h3 className="text-sm font-semibold text-[var(--ink-2)]">Net Sales by channel — {monthLabel(r.latestMonth)}</h3>
          <table className="mt-3 w-full text-sm">
            <tbody>
              {r.channelBreakdown.map((c) => (
                <tr key={c.channel} className="border-b border-[var(--line)] last:border-0">
                  <td className="py-1.5 text-[var(--ink-2)]">{channelLabel(c.channel)}</td>
                  <td className="py-1.5 text-right tabular-nums text-[var(--ink)]">{formatCurrencyFull(c.netSales)}</td>
                  <td className="w-24 py-1.5 text-right">
                    <button
                      type="button"
                      onClick={() => r.setView(c.channel)}
                      className="text-xs font-medium text-[var(--accent)] hover:opacity-80"
                    >
                      View P&amp;L
                    </button>
                  </td>
                  <td className="w-20 py-1.5 text-right">
                    <Link to={`/channels/${c.channel}`} className="text-xs font-medium text-[var(--ink-3)] hover:text-[var(--ink-2)]">
                      Channel
                    </Link>
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-[var(--line-2)] font-semibold">
                <td className="py-1.5 text-[var(--ink)]">Total</td>
                <td className="py-1.5 text-right tabular-nums text-[var(--ink)]">
                  {formatCurrencyFull(r.channelBreakdown.reduce((s, c) => s + c.netSales, 0))}
                </td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>
        </section>
      )}

      {/* ---- Comparison --------------------------------------------------- */}
      {r.comparison && (
        <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
          <h3 className="text-sm font-semibold text-[var(--ink-2)]">
            {monthLabel(r.comparison.laterMonth)} vs {monthLabel(r.comparison.earlierMonth)}
          </h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--line)]">
                  <th className="py-1.5 text-left text-xs font-semibold text-[var(--ink-3)]">Particular</th>
                  <th className="py-1.5 text-right text-xs font-semibold text-[var(--ink-3)]">{monthLabel(r.comparison.earlierMonth)}</th>
                  <th className="py-1.5 text-right text-xs font-semibold text-[var(--ink-3)]">{monthLabel(r.comparison.laterMonth)}</th>
                  <th className="py-1.5 text-right text-xs font-semibold text-[var(--ink-3)]">Change</th>
                  <th className="py-1.5 text-right text-xs font-semibold text-[var(--ink-3)]">Growth</th>
                </tr>
              </thead>
              <tbody>
                {r.comparison.rows
                  .filter((row) => row.def.kind !== 'input' || row.def.key === 'grossSales')
                  .map((row) => {
                    const pct = row.def.kind === 'percent'
                    const fmt = (v: number | null) =>
                      v === null ? '—' : pct ? formatPercent(v) : formatCurrencyFull(v, r.displayCurrency)
                    return (
                      <tr key={row.def.key} className="border-b border-[var(--line)] last:border-0">
                        <td className="py-1.5 text-[var(--ink-2)]">{row.def.label}</td>
                        <td className="py-1.5 text-right tabular-nums text-[var(--ink-3)]">{fmt(row.earlier)}</td>
                        <td className="py-1.5 text-right tabular-nums font-medium text-[var(--ink)]">{fmt(row.later)}</td>
                        <td className={`py-1.5 text-right tabular-nums ${row.change === null ? 'text-[var(--ink-3)]' : row.change >= 0 ? 'text-[var(--good-ink)]' : 'text-[var(--critical-ink)]'}`}>
                          {row.change === null
                            ? '—'
                            : `${row.change >= 0 ? '+' : ''}${pct ? `${row.change.toFixed(1)} pp` : formatCurrencyFull(row.change, r.displayCurrency)}`}
                        </td>
                        <td className={`py-1.5 text-right tabular-nums ${row.growthPct === null ? 'text-[var(--ink-3)]' : row.growthPct >= 0 ? 'text-[var(--good-ink)]' : 'text-[var(--critical-ink)]'}`}>
                          {row.growthPct === null ? '—' : `${row.growthPct >= 0 ? '+' : ''}${formatPercent(row.growthPct)}`}
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-[var(--ink-3)]">
            Margin rows change in percentage points (pp), which is not the same quantity as growth and is shown separately for that
            reason.
          </p>
        </section>
      )}

      {/* ---- Supporting charts -------------------------------------------- */}
      {r.months.length > 1 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Revenue Trend">
            <TrendLineChart
              data={r.trend.map((t) => ({ month: monthLabel(t.month), netSales: t.netSales }))}
              xKey="month" series={[{ key: 'netSales', label: 'Net Sales' }]}
              valueFormatter={(v) => formatCurrencyCompact(v, r.displayCurrency)}
            />
          </ChartCard>
          <ChartCard title="Gross Profit Trend">
            <TrendLineChart
              data={r.trend.map((t) => ({ month: monthLabel(t.month), grossProfit: t.grossProfit }))}
              xKey="month" series={[{ key: 'grossProfit', label: 'Gross Profit' }]}
              valueFormatter={(v) => formatCurrencyCompact(v, r.displayCurrency)}
            />
          </ChartCard>
          <ChartCard title="Contribution Trend">
            <TrendLineChart
              data={r.trend.map((t) => ({ month: monthLabel(t.month), contribution: t.contribution }))}
              xKey="month" series={[{ key: 'contribution', label: 'Contribution' }]}
              valueFormatter={(v) => formatCurrencyCompact(v, r.displayCurrency)}
            />
          </ChartCard>
          <ChartCard title="EBITDA Trend">
            <TrendLineChart
              data={r.trend.map((t) => ({ month: monthLabel(t.month), ebitda: t.ebitda }))}
              xKey="month" series={[{ key: 'ebitda', label: 'EBITDA' }]}
              valueFormatter={(v) => formatCurrencyCompact(v, r.displayCurrency)}
            />
          </ChartCard>
          <ChartCard title="Margin Trend">
            <TrendLineChart
              data={r.trend.map((t) => ({
                month: monthLabel(t.month),
                'Gross %': t.grossMarginPct,
                'Contribution %': t.contributionMarginPct,
                'EBITDA %': t.ebitdaMarginPct,
              }))}
              xKey="month"
              series={[
                { key: 'Gross %', label: 'Gross %' },
                { key: 'Contribution %', label: 'Contribution %' },
                { key: 'EBITDA %', label: 'EBITDA %' },
              ]}
              valueFormatter={(v) => formatPercent(v)}
            />
          </ChartCard>
          {r.channelBreakdown.length > 0 && (
            <ChartCard title={`Channel Revenue — ${monthLabel(r.latestMonth)}`}>
              <ComparisonBarChart
                data={r.channelBreakdown.map((c) => ({ name: channelLabel(c.channel), value: c.netSales }))}
                xKey="name" yKey="value" horizontal
                valueFormatter={(v) => formatCurrencyCompact(v)}
              />
            </ChartCard>
          )}
        </div>
      )}
    </PageShell>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
      <h3 className="mb-2 text-sm font-semibold text-[var(--ink-2)]">{title}</h3>
      {children}
    </div>
  )
}
