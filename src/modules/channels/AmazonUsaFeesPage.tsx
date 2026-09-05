import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageShell } from '@/components/layout/PageShell'
import { Card, CardHeader } from '@/components/ui/Surface'
import { TrendLineChart } from '@/components/charts/TrendLineChart'
import { useDataStore } from '@/store/dataStore'
import { amazonUsaFeeSeries, buildSeries } from '@/engine/amazonUsaFees'
import { AMAZON_USA_FEE_COLUMNS } from '@/data/amazonUsa/feeColumns'
import { formatCurrencyFull, formatPercent, monthLabel } from '@/lib/format'

/**
 * Amazon's fees, month by month and traced to the products carrying them.
 *
 * The P&L answers "what did this cost". It cannot answer "is it getting worse"
 * or "which SKUs are causing it", and those are the two questions that lead to
 * doing something. A low-inventory-level fee sitting in four products is a
 * restocking decision that can be made this afternoon; the same total spread
 * across ninety is a different problem entirely, and the only way to tell them
 * apart is to look.
 *
 * Fees you can act on are listed first, ahead of larger ones you cannot — a
 * referral fee is a percentage of the sale price, and putting it at the top of
 * a list meant to be worked through just makes the list start with a number
 * nobody can move.
 */
export function AmazonUsaFeesPage() {
  const { amazonUsaFacts } = useDataStore()
  const [params, setParams] = useSearchParams()

  const months = useMemo(
    () => [...new Set(amazonUsaFacts.map((f) => f.month))].sort(),
    [amazonUsaFacts],
  )
  const list = useMemo(() => amazonUsaFeeSeries(months, amazonUsaFacts), [months, amazonUsaFacts])

  const requested = params.get('fee')
  const selectedId = list.some((s) => s.column.id === requested) ? requested! : list[0]?.column.id
  const selected = useMemo(() => {
    const column = AMAZON_USA_FEE_COLUMNS.find((c) => c.id === selectedId)
    return column ? buildSeries(column, months, amazonUsaFacts) : null
  }, [selectedId, months, amazonUsaFacts])

  const [showAllSkus, setShowAllSkus] = useState(false)

  if (months.length === 0) {
    return (
      <PageShell title="Amazon USA — Fees" subtitle="Where the fees go, month by month" showFilters={false}>
        <Card>
          <p className="text-sm text-[var(--ink-3)]">
            No Amazon USA months on file yet. Upload a Product Profitability export and every fee it charges will be
            broken out here.
          </p>
        </Card>
      </PageShell>
    )
  }

  const skuRows = selected ? (showAllSkus ? selected.skus : selected.skus.slice(0, 15)) : []
  const noSkuDetail = Boolean(selected && selected.total !== 0 && selected.skus.length === 0)

  return (
    <PageShell
      title="Amazon USA — Fees"
      subtitle="Every fee Amazon charges, month by month and by the products carrying it."
      showFilters={false}
    >
      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        {/* ---- The fees, worst actionable first ------------------------- */}
        <Card padded={false}>
          <div className="px-4 pt-4">
            <CardHeader title="Fees charged" subtitle={`${months.length} month${months.length === 1 ? '' : 's'} on file`} />
          </div>
          <ul className="mt-2 divide-y divide-[var(--line)]">
            {list.map((s) => {
              const active = s.column.id === selectedId
              return (
                <li key={s.column.id}>
                  <button
                    type="button"
                    onClick={() => setParams({ fee: s.column.id }, { replace: true })}
                    aria-current={active ? 'true' : undefined}
                    className={`flex w-full items-start gap-2 px-4 py-2.5 text-left transition-colors ${
                      active ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--surface-hover)]'
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-xs ${active ? 'font-semibold text-[var(--ink)]' : 'text-[var(--ink-2)]'}`}>
                        {s.column.header.replace(/ total$/, '')}
                      </span>
                      {s.column.lever && (
                        <span className="mt-0.5 block text-[10px] font-medium uppercase tracking-wide text-[var(--good-ink)]">
                          Actionable
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-[var(--ink)]">
                      {formatCurrencyFull(-s.total, 'USD')}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </Card>

        {selected && (
          <div className="space-y-4">
            <Card>
              <CardHeader
                title={selected.column.header.replace(/ total$/, '')}
                subtitle={`Charged in ${selected.monthsCharged} of ${months.length} month${months.length === 1 ? '' : 's'}`}
              />
              <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
                <Stat label="Total over the period" value={formatCurrencyFull(-selected.total, 'USD')} />
                {/* "$2,388.36" against a cost that fell reads as a rise. The
                    direction is the whole point of the number, so it is said in
                    words rather than left to a colour. */}
                <Stat
                  label="Versus the month before"
                  value={
                    selected.changeLastMonth === null
                      ? '—'
                      : selected.changeLastMonth === 0
                        ? 'no change'
                        : `${formatCurrencyFull(Math.abs(selected.changeLastMonth), 'USD')} ${selected.changeLastMonth > 0 ? 'higher' : 'lower'}`
                  }
                  tone={selected.changeLastMonth === null || selected.changeLastMonth === 0 ? 'flat' : selected.changeLastMonth > 0 ? 'bad' : 'good'}
                />
                {selected.skus.length > 0 && (
                  <Stat
                    label="In the worst 3 SKUs"
                    value={formatPercent(selected.topThreeSharePct)}
                    hint={selected.topThreeSharePct >= 60 ? 'concentrated — a shortlist' : 'spread across the range'}
                  />
                )}
              </div>
              {selected.column.lever ? (
                <p className="mt-3 rounded-md border border-[color-mix(in_oklab,var(--good)_35%,transparent)] bg-[color-mix(in_oklab,var(--good)_8%,transparent)] px-3 py-2 text-sm text-[var(--ink-2)]">
                  <span className="font-semibold text-[var(--good-ink)]">What moves this:</span> {selected.column.lever}
                </p>
              ) : (
                <p className="mt-3 text-sm text-[var(--ink-3)]">
                  This one is not a lever — it is charged as a proportion of what you sell, so it moves with sales
                  rather than with anything you can decide.
                </p>
              )}
            </Card>

            <Card>
              <CardHeader title="Month by month" subtitle="Charges shown as costs, so a rising line is a worsening one." />
              <div className="mt-2">
                <TrendLineChart
                  data={selected.points.map((p) => ({ month: monthLabel(p.month), amount: -p.amount }))}
                  xKey="month"
                  series={[{ key: 'amount', label: selected.column.header.replace(/ total$/, '') }]}
                  valueFormatter={(v) => formatCurrencyFull(v, 'USD')}
                />
              </div>
            </Card>

            <Card padded={false}>
              <div className="px-5 pt-5">
                <CardHeader
                  title="Which products carry it"
                  subtitle={
                    noSkuDetail
                      ? 'No per-SKU detail stored for these months yet'
                      : `${selected.skus.length} SKU${selected.skus.length === 1 ? '' : 's'} charged`
                  }
                />
              </div>
              {noSkuDetail ? (
                <p className="px-5 pb-5 text-sm text-[var(--ink-3)]">
                  These months were imported before the per-SKU split was kept, so only the monthly total above is
                  available for them. Re-upload the Product Profitability export for the months you want broken down.
                </p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-[var(--surface-2)] text-[11px] uppercase tracking-wide text-[var(--ink-3)]">
                        <tr>
                          <th className="px-5 py-2.5 text-left">SKU</th>
                          {months.map((m) => (
                            <th key={m} className="px-3 py-2.5 text-right">{monthLabel(m)}</th>
                          ))}
                          <th className="px-5 py-2.5 text-right">Total</th>
                          <th className="px-5 py-2.5 text-right">Share</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--line)]">
                        {skuRows.map((row) => (
                          <tr key={row.sku} className="hover:bg-[var(--surface-hover)]">
                            <td className="px-5 py-2 font-mono text-xs text-[var(--ink-2)]">{row.sku}</td>
                            {row.byMonth.map((v, i) => (
                              <td key={i} className="px-3 py-2 text-right tabular-nums text-[var(--ink-3)]">
                                {v === 0 ? '—' : formatCurrencyFull(-v, 'USD')}
                              </td>
                            ))}
                            <td className="px-5 py-2 text-right font-medium tabular-nums text-[var(--ink)]">
                              {formatCurrencyFull(-row.total, 'USD')}
                            </td>
                            <td className="px-5 py-2 text-right tabular-nums text-[var(--ink-3)]">
                              {formatPercent(row.sharePct)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {selected.skus.length > 15 && (
                    <button
                      type="button"
                      onClick={() => setShowAllSkus((v) => !v)}
                      className="px-5 py-3 text-xs font-medium text-[var(--accent)] hover:underline"
                    >
                      {showAllSkus ? 'Show the worst 15 only' : `Show all ${selected.skus.length} SKUs`}
                    </button>
                  )}
                </>
              )}
            </Card>
          </div>
        )}
      </div>
    </PageShell>
  )
}

function Stat({ label, value, hint, tone = 'flat' }: { label: string; value: string; hint?: string; tone?: 'good' | 'bad' | 'flat' }) {
  const colour =
    tone === 'bad' ? 'text-[var(--critical-ink)]' : tone === 'good' ? 'text-[var(--good-ink)]' : 'text-[var(--ink)]'
  return (
    <div>
      <div className="text-xs text-[var(--ink-3)]">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${colour}`}>{value}</div>
      {hint && <div className="text-xs text-[var(--ink-3)]">{hint}</div>}
    </div>
  )
}
