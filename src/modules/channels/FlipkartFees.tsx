import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Card, CardHeader } from '@/components/ui/Surface'
import { TrendLineChart } from '@/components/charts/TrendLineChart'
import { useDataStore } from '@/store/dataStore'
import { buildFlipkartFeeSeries, flipkartFeeSeries, FLIPKART_FEE_LINES } from '@/engine/flipkartFees'
import { formatCurrencyFull, monthLabel } from '@/lib/format'

/**
 * Flipkart's fees, month by month.
 *
 * The statement answers "what did this cost". It cannot answer "is it getting
 * worse", and that is the question that leads to doing something: a storage
 * fee that has tripled since April is ageing stock, which is a decision about
 * what to send and what to pull back.
 *
 * There is no per-SKU table here, unlike Amazon USA. Flipkart's export does
 * carry these fees per row, but only each month's total is stored, so naming
 * the products behind a fee would mean splitting it by guesswork.
 */
export function FlipkartFees() {
  const { flipkartFacts } = useDataStore()
  const [params, setParams] = useSearchParams()

  const months = useMemo(
    () => [...new Set(flipkartFacts.map((f) => f.month))].sort(),
    [flipkartFacts],
  )
  const list = useMemo(() => flipkartFeeSeries(months, flipkartFacts), [months, flipkartFacts])

  const requested = params.get('fee')
  const selectedId = list.some((s) => s.def.id === requested) ? requested! : list[0]?.def.id
  const selected = useMemo(() => {
    const def = FLIPKART_FEE_LINES.find((d) => d.id === selectedId)
    return def ? buildFlipkartFeeSeries(def, months, flipkartFacts) : null
  }, [selectedId, months, flipkartFacts])

  if (months.length === 0) {
    return (
      <Card>
        <p className="text-sm text-[var(--ink-3)]">
          No Flipkart months on file yet. Upload a SKU-level P&amp;L export and every fee it charges will be broken out
          here.
        </p>
      </Card>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
      {/* ---- The fees, the ones with a lever first --------------------- */}
      <Card padded={false}>
        <div className="px-4 pt-4">
          <CardHeader title="Fees charged" subtitle={`${months.length} month${months.length === 1 ? '' : 's'} on file`} />
        </div>
        <ul className="mt-2 divide-y divide-[var(--line)]">
          {list.map((s) => {
            const active = s.def.id === selectedId
            return (
              <li key={s.def.id}>
                <button
                  type="button"
                  onClick={() => setParams({ fee: String(s.def.id) }, { replace: true })}
                  aria-current={active ? 'true' : undefined}
                  className={`flex w-full items-start gap-2 px-4 py-2.5 text-left transition-colors ${
                    active ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--surface-hover)]'
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-xs ${active ? 'font-semibold text-[var(--ink)]' : 'text-[var(--ink-2)]'}`}>
                      {s.def.label}
                    </span>
                    {s.def.lever && (
                      <span className="mt-0.5 block text-[10px] font-medium text-[var(--good-ink)]">Actionable</span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-[var(--ink)]">
                    {formatCurrencyFull(s.def.isCredit ? s.total : -s.total)}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </Card>

      {selected && (
        <Card>
          <CardHeader
            title={selected.def.label}
            subtitle={`Charged in ${selected.monthsCharged} of ${months.length} month${months.length === 1 ? '' : 's'}`}
          />

          <div className="flex flex-wrap gap-x-8 gap-y-2">
            <Stat
              label="Total over the period"
              value={formatCurrencyFull(selected.def.isCredit ? selected.total : -selected.total)}
            />
            {/* "₹12,400" against a cost that fell reads as a rise. Direction is
                the whole point of the figure, so it is said in words rather
                than left to a colour to carry. */}
            <Stat
              label="Versus the month before"
              value={
                selected.changeLastMonth === null
                  ? '—'
                  : selected.changeLastMonth === 0
                    ? 'no change'
                    : `${formatCurrencyFull(Math.abs(selected.changeLastMonth))} ${selected.changeLastMonth > 0 ? 'higher' : 'lower'}`
              }
              tone={
                selected.changeLastMonth === null || selected.changeLastMonth === 0
                  ? 'flat'
                  : (selected.changeLastMonth > 0) === Boolean(selected.def.isCredit)
                    ? 'good'
                    : 'bad'
              }
            />
            <Stat
              label="Latest month vs the average before it"
              value={selected.vsAveragePct === null ? '—' : `${selected.vsAveragePct > 0 ? '+' : ''}${selected.vsAveragePct.toFixed(1)}%`}
              hint={selected.vsAveragePct === null ? 'no earlier month to compare' : undefined}
            />
          </div>

          {selected.def.lever && (
            <p className="mt-3 rounded-[var(--radius-control)] border border-[color-mix(in_oklab,var(--good)_35%,transparent)] bg-[color-mix(in_oklab,var(--good)_8%,transparent)] px-3 py-2 text-sm text-[var(--ink-2)]">
              {selected.def.lever}
            </p>
          )}

          <div className="mt-4">
            <TrendLineChart
              data={selected.points.map((p) => ({
                month: monthLabel(p.month),
                amount: selected.def.isCredit ? p.amount : -p.amount,
              }))}
              xKey="month"
              series={[{ key: 'amount', label: selected.def.label }]}
            />
          </div>
        </Card>
      )}
    </div>
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
