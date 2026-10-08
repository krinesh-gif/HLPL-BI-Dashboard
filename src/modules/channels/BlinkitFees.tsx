import { useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Card, CardHeader } from '@/components/ui/Surface'
import { CopyImageButton } from '@/components/ui/CopyImageButton'
import { TrendLineChart } from '@/components/charts/TrendLineChart'
import { useDataStore } from '@/store/dataStore'
import { blinkitFeeSeries, buildBlinkitFeeSeries, BLINKIT_FEE_LINES } from '@/engine/blinkitFees'
import { formatCurrencyFull, monthLabel } from '@/lib/format'

/**
 * Blinkit's charges, month by month.
 *
 * The statement already says what each one cost. What it cannot say is which
 * of them is getting worse, and on this channel that is the question with an
 * answer worth having: the storage charge is levied per unit per day on stock
 * sitting in a dark store, sold or not. On the owner's August archive it ran
 * to 57% of net revenue against 2.4% of commission — a rate card nobody can
 * move, beside a charge that is entirely a decision about what to send.
 *
 * Charges only, ex-GST. The GST on them is a separate line of the statement
 * and is reclaimed, so folding it in would overstate what each one costs.
 */
export function BlinkitFees() {
  const { blinkitFacts } = useDataStore()
  const [params, setParams] = useSearchParams()
  const detailCard = useRef<HTMLDivElement>(null)

  const months = useMemo(() => [...new Set(blinkitFacts.map((f) => f.month))].sort(), [blinkitFacts])
  const list = useMemo(() => blinkitFeeSeries(months, blinkitFacts), [months, blinkitFacts])

  const requested = params.get('fee')
  const selectedId = list.some((s) => s.def.id === requested) ? requested! : list[0]?.def.id
  const selected = useMemo(() => {
    const def = BLINKIT_FEE_LINES.find((d) => d.id === selectedId)
    return def ? buildBlinkitFeeSeries(def, months, blinkitFacts) : null
  }, [selectedId, months, blinkitFacts])

  if (months.length === 0) {
    return (
      <Card>
        <p className="text-sm text-[var(--ink-3)]">
          No Blinkit months on file yet. Upload a monthly payout zip and every charge it raises will be broken out here.
        </p>
      </Card>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
      {/* ---- The charges, the ones with a lever first ------------------- */}
      <Card padded={false}>
        <div className="px-4 pt-4">
          <CardHeader title="Charges raised" subtitle={`${months.length} month${months.length === 1 ? '' : 's'} on file`} />
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
                  <span className="shrink-0 text-xs tabular-nums text-[var(--ink)]">{formatCurrencyFull(s.total)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </Card>

      {selected && (
        <Card ref={detailCard}>
          <CardHeader
            title={selected.def.label}
            subtitle={`Charged in ${selected.monthsCharged} of ${months.length} month${months.length === 1 ? '' : 's'}`}
            actions={
              <CopyImageButton
                target={detailCard}
                filename={`Blinkit ${selected.def.label} ${months[0]} to ${months[months.length - 1]}`}
              />
            }
          />

          <div className="flex flex-wrap gap-x-8 gap-y-2">
            <Stat label="Total over the period" value={formatCurrencyFull(selected.total)} />
            {/* "₹12,400" against a charge that fell reads as a rise. Direction
                is the whole point of the figure, so it is said in words rather
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

          {/* A charge is drawn as the amount charged, climbing as it gets
              worse. Drawing a cost as a negative sends the line down exactly
              when the news is bad, and everyone reads a falling line as an
              improvement before they read the axis. */}
          <div className="mt-4">
            <TrendLineChart
              data={selected.points.map((p) => ({ month: monthLabel(p.month), amount: p.amount }))}
              xKey="month"
              series={[{ key: 'amount', label: selected.def.label }]}
              valueFormatter={(v) => formatCurrencyFull(v)}
              showValues
            />
          </div>

          <h4 className="mt-6 text-[13px] font-semibold text-[var(--ink)]">Products carrying it</h4>
          <p className="mt-1.5 text-sm text-[var(--ink-3)]">
            Blinkit's archive carries the ageing charge per item, but only each month's totals are stored, so naming the
            products behind a charge would mean splitting it by guesswork.
          </p>
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
