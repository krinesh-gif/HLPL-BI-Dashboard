import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PageShell } from '@/components/layout/PageShell'
import { HeaderIconAction, DownloadIcon, SnapshotIcon } from '@/components/ui/HeaderIconAction'
import { TrendLineChart } from '@/components/charts/TrendLineChart'
import { ComparisonBarChart } from '@/components/charts/ComparisonBarChart'
import { BUSINESS_CHANNELS, channelLabel, type BusinessChannelId } from '@/config/channels'
import { formatCurrencyCompact, formatCurrencyFull, formatPercent, monthLabel, currencyName } from '@/lib/format'
import { exportRowsToCsv } from '@/lib/exportCsv'
import { QUICK_PERIODS } from '@/engine/multiMonthPnl'
import { NativePnlTable } from '@/components/pnl/NativePnlTable'
import { amountTone } from '@/components/pnl/amountTone'
import { pnlSnapshotStart } from './pnlSnapshotStart'
import { usePnlReport, type PnlView } from './usePnlReport'

/**
 * The company's P&L, in one place, in one format.
 *
 * It lives here and nowhere else. A channel's P&L is this same report with the
 * view switched — not a second report inside the channel dashboard that could
 * be built differently and disagree.
 */
export function PnlPage() {
  // What is on screen lives in the address bar, for one reason: the Snapshot
  // opens a page of its own, and coming back from it used to land on the
  // Master P&L however the reader got there — the channel they were reading
  // was held in this component's state, and the component had been unmounted.
  // Read once, on mount: after that the controls own the selection and the
  // URL follows them.
  const [params, setParams] = useSearchParams()
  const [start] = useState(() => pnlSnapshotStart(params))
  const r = usePnlReport(start)

  const search = new URLSearchParams({
    view: r.view,
    ...(r.period.mode === 'quick' ? { period: r.period.quick } : {}),
    from: r.months[0] ?? r.latestMonth,
    to: r.months[r.months.length - 1] ?? r.latestMonth,
    half: r.amazonInHalf,
    cur: r.displayCurrency,
  }).toString()

  // Replaced rather than pushed: every change of a dropdown would otherwise
  // be a history entry, and Back would walk through them one at a time
  // instead of leaving the page.
  useEffect(() => {
    if (search !== params.toString()) setParams(search, { replace: true })
  }, [search, params, setParams])

  const monthOptions = r.monthsWithData.length > 0 ? r.monthsWithData : [r.latestMonth]

  function handleExport() {
    // The export is built from the same rows the table renders, so what comes
    // out is what was on screen — the selected months and nothing else.
    exportRowsToCsv(
      `HLPL_PnL_${r.view}_${r.displayCurrency}_${r.months[0]}_to_${r.months[r.months.length - 1]}`,
      r.table.rows.map((row) => {
        const out: Record<string, string | number> = { Particular: row.def.label }
        // Signed the same way the table shows it, so a deduction reads as a
        // deduction in the spreadsheet too.
        const sign = row.def.sign ?? 1
        const cell = (v: number | null) =>
          v === null ? '' : row.def.kind === 'percent' ? Number(v.toFixed(2)) : Math.round(v * sign)
        r.months.forEach((m, i) => { out[monthLabel(m)] = cell(row.values[i]) })
        out.Total = cell(row.total)
        return out
      }),
    )
  }

  return (
    <PageShell
      title="P&L"
      subtitle="Management accounts by month, for the company and each channel"
      showFilters={false}
      // Carries whatever is on screen into the snapshot, so the link reports
      // the same view, period, basis and currency the reader was looking at.
      headerActions={
        <div className="flex items-center gap-2">
          <HeaderIconAction label="Export CSV" icon={DownloadIcon} onClick={handleExport} />
          <HeaderIconAction label="Snapshot" icon={SnapshotIcon} to={{ pathname: '/pnl/snapshot', search }} />
        </div>
      }
    >
      {/* ---- Header controls ------------------------------------------- */}
      <div className="flex flex-wrap items-end gap-3 rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[var(--shadow-card)]">
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

        {/* Offered on any channel not paid in rupees, labelled from the
            registry — Amazon USA reads $ USD, Amazon UAE AED. */}
        {r.isForeign && (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-[var(--ink-3)]">Currency</span>
            <div className="flex rounded-full border border-[var(--line)] bg-[var(--surface-2)] p-0.5">
              {([
                { key: 'native', label: r.nativeCurrency === 'USD' ? '$ USD' : r.nativeCurrency },
                { key: 'INR', label: '₹ INR' },
              ] as const).map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => r.setCurrencyView(c.key)}
                  aria-pressed={r.currencyView === c.key}
                  className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                    r.currencyView === c.key
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

        {/* Amazon India is two businesses: we sell wholesale to RK World and
            we sell on the marketplace. Both is the channel every other screen
            reports; each half is its own waterfall, on its own revenue basis,
            because no single statement can be both. Each is labelled with
            what it is of the channel over the period on screen, so switching
            to a half says how much of Amazon India is being left out. */}
        {r.showAmazonInHalves && (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-[var(--ink-3)]">Business</span>
            <div className="flex rounded-md border border-[var(--line-2)] bg-[var(--surface)] p-0.5">
              {([
                { key: 'both', short: 'Both', full: 'Amazon India, both businesses', net: null, pct: null },
                { key: 'vendor', short: 'VC', full: 'Vendor Central — wholesale to RK World', net: r.amazonInSplit.vendorNet, pct: r.amazonInSplit.vendorPct },
                { key: 'seller', short: 'SC', full: 'Seller Central — the marketplace', net: r.amazonInSplit.sellerNet, pct: r.amazonInSplit.sellerPct },
              ] as const).map((h) => (
                <button
                  key={h.key}
                  type="button"
                  onClick={() => r.setAmazonInHalf(h.key)}
                  aria-pressed={r.amazonInHalf === h.key}
                  title={h.pct === null
                    ? h.full
                    : `${h.full} — ${formatCurrencyFull(h.net ?? 0)} of net sales, ${formatPercent(h.pct)} of Amazon India`}
                  className={`rounded px-3 py-1 text-sm font-medium transition ${
                    r.amazonInHalf === h.key ? 'bg-[var(--accent)] text-[var(--accent-ink)]' : 'text-[var(--ink-2)] hover:bg-[var(--surface-hover)]'
                  }`}
                >
                  {h.pct === null ? h.short : `${h.short} (${h.pct.toFixed(0)}%)`}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* A row of buttons, not a menu: a reader switches period constantly
            and a menu hides six of the seven behind a click. Each is two or
            three characters with the full name on hover. Picking From/To puts
            the period into custom mode, where none of them is pressed. */}
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--ink-3)]">Period</span>
          <div className="flex rounded-full border border-[var(--line)] bg-[var(--surface-2)] p-0.5">
            {QUICK_PERIODS.map((p) => {
              const on = r.period.mode === 'quick' && r.period.quick === p.key
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => r.setPeriod({ ...r.period, mode: 'quick', quick: p.key })}
                  aria-pressed={on}
                  title={p.label}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium tabular-nums transition-colors ${
                    on
                      ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                      : 'text-[var(--ink-3)] hover:text-[var(--ink)]'
                  }`}
                >
                  {p.code}
                </button>
              )
            })}
          </div>
        </div>

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

      </div>

      {/* ---- The report -------------------------------------------------- */}
      <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-card)]">
        <table className="w-full min-w-max text-[13px]">
          <thead>
            <tr className="border-b-2 border-[var(--line-2)] bg-[var(--surface-2)]">
              <th className="sticky left-0 z-20 min-w-44 bg-[var(--surface-2)] px-4 py-2 text-left text-xs font-semibold text-[var(--ink-2)]">
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
                <th key={m} className="min-w-28 px-4 py-2 text-right text-xs font-semibold text-[var(--ink-2)]">
                  {monthLabel(m)}
                </th>
              ))}
              <th className="min-w-32 border-l-2 border-[var(--line-2)] bg-[var(--surface-2)] px-4 py-2 text-right text-xs font-bold text-[var(--ink)]">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {r.table.rows.map((row) => {
              const isSubtotal = row.def.kind === 'subtotal'
              const isPercent = row.def.kind === 'percent'
              // Deductions are stored as positive magnitudes and shown
              // negative, so red always means money leaving and the minus sign
              // says so without relying on the colour.
              const signed = (v: number | null) => (v === null ? null : v * (row.def.sign ?? 1))
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
                    className={`sticky left-0 z-10 px-4 py-1 text-left font-normal ${
                      isSubtotal ? 'bg-[var(--surface-2)] font-semibold text-[var(--ink)]' : 'bg-[var(--surface)] text-[var(--ink-2)]'
                    } ${row.def.indent ? 'pl-8 text-[var(--ink-3)]' : ''}`}
                    // Where a label was shortened to keep this column narrow,
                    // hovering it gives the name in full.
                    title={row.def.note}
                  >
                    {row.def.label}
                  </th>
                  {row.values.map((v, i) => {
                    const shown = signed(v)
                    return (
                      <td
                        key={r.months[i]}
                        className={`px-4 py-1 text-right tabular-nums ${amountTone(shown)}`}
                      >
                        {shown === 0 && !isPercent ? '—' : format(shown)}
                      </td>
                    )
                  })}
                  <td
                    className={`border-l-2 border-[var(--line-2)] bg-[var(--surface-2)] px-4 py-1 text-right font-semibold tabular-nums ${amountTone(signed(row.total))}`}
                  >
                    {signed(row.total) === 0 && !isPercent ? '—' : format(signed(row.total))}
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

      {r.isForeign && (
        <p className="rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--ink-2)]">
          {r.currencyView === 'native' ? (
            <><strong>Shown in {currencyName(r.nativeCurrency)}</strong>, the currency the
            marketplace actually charges and pays in — so no exchange rate stands between the report and this
            statement.</>
          ) : (
            <><strong>Shown in rupees</strong>, converted at {r.fxRateLabel}. Margin percentages are ratios and read the
            same in either currency.</>
          )}{' '}
          {r.fxRateEntered
            ? 'That is the rate entered for this month.'
            : 'No rate has been entered for this month, so the default assumption is being used — set it on Settings ▸ Monthly Inputs.'}
          {' '}The Master P&L is always in rupees, whichever view is selected here.
        </p>
      )}

      {r.view === 'meesho' && (
        <p className="rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--ink-2)]">
          <strong>Order-date basis.</strong> Every order counted in the month the customer placed it — what a month's trading
          earned, which is how every other channel here is read. Meesho's file also states the month it paid for each order;
          those rows are kept as the record of the file and are not what this statement reports.
        </p>
      )}

      {r.view === 'meesho' && !r.native && (
        <p className="rounded-md border border-[color-mix(in_oklab,var(--warning)_45%,transparent)] bg-[color-mix(in_oklab,var(--warning)_12%,transparent)] px-3 py-2 text-xs text-[var(--ink)]">
          <strong>No Meesho statement stored for this period yet</strong>, so the figures above come from order rows alone. Upload
          the aggregated payment workbook (Payments ▸ Order Payments) on Upload Reports, and the statement replaces them.
        </p>
      )}

      {r.missingStatementNote && (
        <p className="rounded-[var(--radius-control)] border border-[color-mix(in_oklab,var(--warning)_45%,transparent)] bg-[color-mix(in_oklab,var(--warning)_12%,transparent)] px-3.5 py-2.5 text-sm text-[var(--ink)]">
          {r.missingStatementNote}
        </p>
      )}

      {r.native && (
        <section>
          <h2 className="mb-2 text-[15px] font-semibold tracking-[-0.01em] text-[var(--ink)]">
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
        <section className="rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[var(--shadow-card)]">
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
        <section className="rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[var(--shadow-card)]">
          <h3 className="text-sm font-semibold text-[var(--ink-2)]">
            {monthLabel(r.comparison.laterMonth)} vs {monthLabel(r.comparison.earlierMonth)}
          </h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-[13px]">
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
        <div className="grid gap-3 lg:grid-cols-2">
          <ChartCard title="Revenue Trend">
            <TrendLineChart
              height={200}
              data={r.trend.map((t) => ({ month: monthLabel(t.month), netSales: t.netSales }))}
              xKey="month" series={[{ key: 'netSales', label: 'Net Sales' }]}
              valueFormatter={(v) => formatCurrencyCompact(v, r.displayCurrency)}
            />
          </ChartCard>
          <ChartCard title="Gross Profit Trend">
            <TrendLineChart
              height={200}
              data={r.trend.map((t) => ({ month: monthLabel(t.month), grossProfit: t.grossProfit }))}
              xKey="month" series={[{ key: 'grossProfit', label: 'Gross Profit' }]}
              valueFormatter={(v) => formatCurrencyCompact(v, r.displayCurrency)}
            />
          </ChartCard>
          <ChartCard title="Contribution Trend">
            <TrendLineChart
              height={200}
              data={r.trend.map((t) => ({ month: monthLabel(t.month), contribution: t.contribution }))}
              xKey="month" series={[{ key: 'contribution', label: 'Contribution' }]}
              valueFormatter={(v) => formatCurrencyCompact(v, r.displayCurrency)}
            />
          </ChartCard>
          <ChartCard title="EBITDA Trend">
            <TrendLineChart
              height={200}
              data={r.trend.map((t) => ({ month: monthLabel(t.month), ebitda: t.ebitda }))}
              xKey="month" series={[{ key: 'ebitda', label: 'EBITDA' }]}
              valueFormatter={(v) => formatCurrencyCompact(v, r.displayCurrency)}
            />
          </ChartCard>
          <ChartCard title="Margin Trend">
            <TrendLineChart
              height={200}
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
                tooltipFormatter={(v) => formatCurrencyFull(v)}
                valueLabel="Net revenue"
              />
            </ChartCard>
          )}
          {/* The same month read for profit instead of size, best channel at
              the top. Revenue says which channel is biggest; this one says
              which is worth having. */}
          {r.ebitdaBreakdown.length > 0 && (
            <ChartCard title={`Channel EBITDA — ${monthLabel(r.latestMonth)}`}>
              <ComparisonBarChart
                data={r.ebitdaBreakdown.map((c) => ({ name: channelLabel(c.channel), value: c.ebitda }))}
                xKey="name" yKey="value" horizontal signed
                valueFormatter={(v) => formatCurrencyCompact(v)}
                tooltipFormatter={(v) => formatCurrencyFull(v)}
                valueLabel="EBITDA"
              />
              <EbitdaBreakdownNote rows={r.ebitdaBreakdown} />
            </ChartCard>
          )}
        </div>
      )}
    </PageShell>
  )
}

/**
 * What the bars below zero are, in words.
 *
 * The colour is not allowed to be the only thing that says a channel lost
 * money, so the names are written out. It also says what a channel's EBITDA
 * includes, because the figure is not the channel's own trading result: the
 * month's rent, salaries and software are shared across the channels by their
 * contribution to sales, so a channel can trade profitably and still sit
 * below the line.
 */
function EbitdaBreakdownNote({ rows }: { rows: { channel: BusinessChannelId; ebitda: number }[] }) {
  const losses = rows.filter((c) => c.ebitda < 0)
  const lost = losses.reduce((sum, c) => sum + c.ebitda, 0)
  return (
    <p className="mt-2 text-xs text-[var(--ink-3)]">
      {losses.length > 0
        ? `Below the line: ${losses.map((c) => channelLabel(c.channel)).join(', ')} — ${formatCurrencyFull(lost)} between them. `
        : 'Every channel is above the line this month. '}
      Each channel carries its share of the month&rsquo;s fixed expenses, allocated by its contribution to sales,
      so these bars add to the company&rsquo;s EBITDA.
    </p>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] p-3.5 shadow-[var(--shadow-card)]">
      <h3 className="mb-1.5 text-sm font-semibold text-[var(--ink-2)]">{title}</h3>
      {children}
    </div>
  )
}
