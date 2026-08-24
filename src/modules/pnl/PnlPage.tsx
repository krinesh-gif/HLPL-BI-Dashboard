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
      `HLPL_PnL_${r.view}_${r.months[0]}_to_${r.months[r.months.length - 1]}`,
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
      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-slate-200 bg-white p-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">View</span>
          <select
            value={r.view}
            onChange={(e) => r.setView(e.target.value as PnlView)}
            className="min-w-48 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 focus:border-indigo-500 focus:outline-none"
          >
            <option value="master">Master Company</option>
            {BUSINESS_CHANNELS.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </label>

        {r.view === 'meesho' && (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-500">Basis</span>
            <div className="flex rounded-md border border-slate-300 bg-white p-0.5">
              {([
                { key: 'order', label: 'Order date' },
                { key: 'settlement', label: 'Payment date' },
              ] as const).map((b) => (
                <button
                  key={b.key}
                  type="button"
                  onClick={() => r.setMeeshoBasis(b.key)}
                  className={`rounded px-3 py-1 text-sm font-medium transition ${
                    r.meeshoBasis === b.key ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">Quick select</span>
          <div className="flex flex-wrap gap-1">
            {QUICK_PERIODS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => r.setPeriod({ ...r.period, mode: 'quick', quick: p.key as QuickPeriod })}
                className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${
                  r.period.mode === 'quick' && r.period.quick === p.key
                    ? 'border-indigo-600 bg-indigo-600 text-white'
                    : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">From</span>
          <select
            value={r.period.mode === 'custom' ? r.period.from : r.months[0]}
            onChange={(e) => r.setPeriod({ ...r.period, mode: 'custom', from: e.target.value, to: r.period.mode === 'custom' ? r.period.to : r.months[r.months.length - 1] })}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none"
          >
            {monthOptions.map((m) => (
              <option key={m} value={m}>{monthLabel(m)}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">To</span>
          <select
            value={r.period.mode === 'custom' ? r.period.to : r.months[r.months.length - 1]}
            onChange={(e) => r.setPeriod({ ...r.period, mode: 'custom', to: e.target.value, from: r.period.mode === 'custom' ? r.period.from : r.months[0] })}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none"
          >
            {monthOptions.map((m) => (
              <option key={m} value={m}>{monthLabel(m)}</option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={handleExport}
          className="ml-auto rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Export CSV
        </button>
      </div>

      {/* ---- The report -------------------------------------------------- */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b-2 border-slate-300 bg-slate-50">
              <th className="sticky left-0 z-20 min-w-56 bg-slate-50 px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                {r.view === 'master' ? 'Master Company' : channelLabel(r.view)}
              </th>
              {r.months.map((m) => (
                <th key={m} className="min-w-28 px-4 py-2.5 text-right text-xs font-semibold text-slate-600">
                  {monthLabel(m)}
                </th>
              ))}
              <th className="min-w-32 border-l-2 border-slate-300 bg-slate-100 px-4 py-2.5 text-right text-xs font-bold uppercase tracking-wide text-slate-700">
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
                v === null ? '—' : isPercent ? formatPercent(v) : formatCurrencyFull(v)

              return (
                <tr
                  key={row.def.key}
                  className={`border-b border-slate-100 ${isSubtotal ? 'bg-slate-50 font-semibold' : ''} ${isPercent ? 'italic text-slate-600' : ''}`}
                >
                  <th
                    className={`sticky left-0 z-10 px-4 py-2 text-left font-normal ${
                      isSubtotal ? 'bg-slate-50 font-semibold text-slate-900' : 'bg-white text-slate-700'
                    } ${row.def.indent ? 'pl-8 text-slate-500' : ''}`}
                  >
                    {row.def.label}
                  </th>
                  {row.values.map((v, i) => (
                    <td
                      key={r.months[i]}
                      className={`px-4 py-2 text-right tabular-nums ${
                        v !== null && v < 0 ? 'text-rose-600' : ''
                      }`}
                    >
                      {v === 0 && !isPercent ? '—' : format(v)}
                    </td>
                  ))}
                  <td
                    className={`border-l-2 border-slate-300 bg-slate-50 px-4 py-2 text-right font-semibold tabular-nums ${
                      row.total !== null && row.total < 0 ? 'text-rose-600' : 'text-slate-900'
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

      <p className="text-xs text-slate-500">
        Percentages in the Total column are recomputed from the period's totals, not averaged across months — the average of monthly
        margins is not the margin of the period.
      </p>

      {r.view === 'meesho' && (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
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
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <strong>No Meesho statement stored for this period yet</strong>, so the figures above come from order rows alone and the
          Order date / Payment date toggle has nothing to switch between. Upload the aggregated payment workbook (Payments ▸ Order
          Payments) on Upload Reports — one upload produces both statements.
        </p>
      )}

      {r.native && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            {channelLabel(r.view as Exclude<PnlView, 'master'>)} — full statement, {monthLabel(r.nativeMonth)}
          </h2>
          {r.nativeNotes.map((note) => (
            <p key={note} className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {note}
            </p>
          ))}
          <NativePnlTable lineDefs={r.native.lineDefs} values={r.native.values} currency={r.native.currency} />
        </section>
      )}

      {/* ---- Channel drill-down ------------------------------------------ */}
      {r.channelBreakdown.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-700">Net Sales by channel — {monthLabel(r.latestMonth)}</h3>
          <table className="mt-3 w-full text-sm">
            <tbody>
              {r.channelBreakdown.map((c) => (
                <tr key={c.channel} className="border-b border-slate-100 last:border-0">
                  <td className="py-1.5 text-slate-700">{channelLabel(c.channel)}</td>
                  <td className="py-1.5 text-right tabular-nums text-slate-800">{formatCurrencyFull(c.netSales)}</td>
                  <td className="w-24 py-1.5 text-right">
                    <button
                      type="button"
                      onClick={() => r.setView(c.channel)}
                      className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
                    >
                      View P&amp;L
                    </button>
                  </td>
                  <td className="w-20 py-1.5 text-right">
                    <Link to={`/channels/${c.channel}`} className="text-xs font-medium text-slate-500 hover:text-slate-700">
                      Channel
                    </Link>
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-300 font-semibold">
                <td className="py-1.5 text-slate-900">Total</td>
                <td className="py-1.5 text-right tabular-nums text-slate-900">
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
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-700">
            {monthLabel(r.comparison.laterMonth)} vs {monthLabel(r.comparison.earlierMonth)}
          </h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="py-1.5 text-left text-xs font-semibold text-slate-500">Particular</th>
                  <th className="py-1.5 text-right text-xs font-semibold text-slate-500">{monthLabel(r.comparison.earlierMonth)}</th>
                  <th className="py-1.5 text-right text-xs font-semibold text-slate-500">{monthLabel(r.comparison.laterMonth)}</th>
                  <th className="py-1.5 text-right text-xs font-semibold text-slate-500">Change</th>
                  <th className="py-1.5 text-right text-xs font-semibold text-slate-500">Growth</th>
                </tr>
              </thead>
              <tbody>
                {r.comparison.rows
                  .filter((row) => row.def.kind !== 'input' || row.def.key === 'grossSales')
                  .map((row) => {
                    const pct = row.def.kind === 'percent'
                    const fmt = (v: number | null) => (v === null ? '—' : pct ? formatPercent(v) : formatCurrencyFull(v))
                    return (
                      <tr key={row.def.key} className="border-b border-slate-100 last:border-0">
                        <td className="py-1.5 text-slate-700">{row.def.label}</td>
                        <td className="py-1.5 text-right tabular-nums text-slate-500">{fmt(row.earlier)}</td>
                        <td className="py-1.5 text-right tabular-nums font-medium text-slate-900">{fmt(row.later)}</td>
                        <td className={`py-1.5 text-right tabular-nums ${row.change === null ? 'text-slate-400' : row.change >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {row.change === null
                            ? '—'
                            : `${row.change >= 0 ? '+' : ''}${pct ? `${row.change.toFixed(1)} pp` : formatCurrencyFull(row.change)}`}
                        </td>
                        <td className={`py-1.5 text-right tabular-nums ${row.growthPct === null ? 'text-slate-400' : row.growthPct >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {row.growthPct === null ? '—' : `${row.growthPct >= 0 ? '+' : ''}${formatPercent(row.growthPct)}`}
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-500">
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
              valueFormatter={(v) => formatCurrencyCompact(v)}
            />
          </ChartCard>
          <ChartCard title="Gross Profit Trend">
            <TrendLineChart
              data={r.trend.map((t) => ({ month: monthLabel(t.month), grossProfit: t.grossProfit }))}
              xKey="month" series={[{ key: 'grossProfit', label: 'Gross Profit' }]}
              valueFormatter={(v) => formatCurrencyCompact(v)}
            />
          </ChartCard>
          <ChartCard title="Contribution Trend">
            <TrendLineChart
              data={r.trend.map((t) => ({ month: monthLabel(t.month), contribution: t.contribution }))}
              xKey="month" series={[{ key: 'contribution', label: 'Contribution' }]}
              valueFormatter={(v) => formatCurrencyCompact(v)}
            />
          </ChartCard>
          <ChartCard title="EBITDA Trend">
            <TrendLineChart
              data={r.trend.map((t) => ({ month: monthLabel(t.month), ebitda: t.ebitda }))}
              xKey="month" series={[{ key: 'ebitda', label: 'EBITDA' }]}
              valueFormatter={(v) => formatCurrencyCompact(v)}
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
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="mb-2 text-sm font-semibold text-slate-700">{title}</h3>
      {children}
    </div>
  )
}
