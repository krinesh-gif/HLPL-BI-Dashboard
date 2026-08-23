import { useMemo, useState } from 'react'
import { PageShell } from '@/components/layout/PageShell'
import { useDataStore } from '@/store/dataStore'
import { useFilterStore } from '@/store/filterStore'
import { BUSINESS_CHANNELS } from '@/config/channels'
import { formatCurrencyFull, formatPercent, monthLabel } from '@/lib/format'
import { reconcileAllChannels, type ChannelReconciliation, type ReconciliationCause } from '@/engine/reconciliation'

/**
 * Why the dashboard and the P&L can show different Net Sales for the same
 * channel and month — with the size of each candidate cause.
 *
 * This screen exists because the two figures used to be produced by unrelated
 * code paths and nobody could tell which was right. They now come from one
 * engine; this page shows what that engine had to choose between.
 */
export function NetSalesReconciliationPage() {
  const { salesRecords, flipkartFacts, amazonUsaFacts, meeshoFacts } = useDataStore()
  const { month } = useFilterStore()
  const [expanded, setExpanded] = useState<string | null>(null)

  const rows = useMemo(
    () =>
      reconcileAllChannels(
        salesRecords,
        BUSINESS_CHANNELS.map((c) => c.id),
        month,
        { flipkartFacts, amazonUsaFacts, meeshoFacts },
      ),
    [salesRecords, flipkartFacts, amazonUsaFacts, meeshoFacts, month],
  )

  const comparable = rows.filter((r) => r.settlementBasis !== null)
  const orderOnly = rows.filter((r) => r.settlementBasis === null && r.orderBasis.orders > 0)

  return (
    <PageShell
      title="Net Sales Reconciliation"
      subtitle={`Order reports against settlement reports — ${monthLabel(month)}`}
    >
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-800">How Net Sales is calculated</h3>
        <p className="mt-1 text-sm text-slate-600">
          Every screen in this dashboard — Overview, channel pages, P&amp;L, Investor MIS, Business Insight — now reads Net Sales from one
          engine. The definition it applies is:
        </p>
        <p className="mt-2 rounded-md bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">
          Net Sales = Gross Sales − Discounts − Returns − Other revenue adjustments
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
          <li>Cancelled orders are excluded — they never shipped and are never settled.</li>
          <li>Amazon USA rows are converted from USD to INR before being added to any consolidated figure.</li>
          <li>
            Where a marketplace has published a settlement report for the month, that report is the source. Order rows are the source
            everywhere else, and are always the source for per-SKU, per-day and per-category breakdowns.
          </li>
        </ul>
      </section>

      {comparable.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
          No channel has both an order report and a settlement report for {monthLabel(month)}, so there is nothing to reconcile.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Channel</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">From order rows</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">From settlement</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Difference</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {comparable.map((r) => (
                <ReconciliationRow
                  key={r.channel}
                  row={r}
                  open={expanded === r.channel}
                  onToggle={() => setExpanded(expanded === r.channel ? null : r.channel)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {orderOnly.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-800">Order reports only</h3>
          <p className="mt-1 text-sm text-slate-600">
            These channels have no settlement report for {monthLabel(month)}, so their Net Sales comes from order rows and there is
            nothing to compare it against.
          </p>
          <ul className="mt-2 space-y-1 text-sm text-slate-700">
            {orderOnly.map((r) => (
              <li key={r.channel} className="flex justify-between border-b border-slate-100 py-1 last:border-0">
                <span>{BUSINESS_CHANNELS.find((c) => c.id === r.channel)?.label ?? r.channel}</span>
                <span className="tabular-nums">{formatCurrencyFull(r.orderBasis.netSales)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageShell>
  )
}

const STATUS_STYLE: Record<ChannelReconciliation['status'], { label: string; className: string }> = {
  reconciled: { label: 'Reconciled', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  gap: { label: 'Gap to review', className: 'bg-amber-50 text-amber-800 border-amber-200' },
  'no-order-report': { label: 'Order report missing', className: 'bg-rose-50 text-rose-700 border-rose-200' },
  'no-settlement-report': { label: 'No settlement report', className: 'bg-slate-50 text-slate-600 border-slate-200' },
}

function ReconciliationRow({ row, open, onToggle }: { row: ChannelReconciliation; open: boolean; onToggle: () => void }) {
  const label = BUSINESS_CHANNELS.find((c) => c.id === row.channel)?.label ?? row.channel
  const status = STATUS_STYLE[row.status]
  const definitive = row.causes.filter((c) => c.definitive)
  const candidates = row.causes.filter((c) => !c.definitive && c.measurable)
  const structural = row.causes.filter((c) => !c.measurable)

  return (
    <>
      <tr className="border-t border-slate-100">
        <td className="px-3 py-2 font-medium text-slate-800">{label}</td>
        <td className="px-3 py-2 text-right tabular-nums text-slate-700">{formatCurrencyFull(row.orderBasis.netSales)}</td>
        <td className="px-3 py-2 text-right tabular-nums text-slate-700">
          {row.settlementBasis ? formatCurrencyFull(row.settlementBasis.netSales) : '—'}
        </td>
        <td
          className={`px-3 py-2 text-right font-semibold tabular-nums ${
            Math.abs(row.differencePct ?? 0) <= 0.5 ? 'text-slate-500' : 'text-amber-700'
          }`}
        >
          {formatCurrencyFull(row.difference)}
          {row.differencePct !== null && (
            <span className="ml-1 text-xs font-normal text-slate-400">({formatPercent(row.differencePct)})</span>
          )}
        </td>
        <td className="px-3 py-2">
          <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${status.className}`}>{status.label}</span>
        </td>
        <td className="px-3 py-2 text-right">
          <button type="button" onClick={onToggle} className="text-xs font-medium text-indigo-600 hover:text-indigo-800">
            {open ? 'Hide' : 'Why?'}
          </button>
        </td>
      </tr>

      {row.partialSettlementWarning && (
        <tr className="border-t border-amber-200 bg-amber-50">
          <td colSpan={6} className="px-4 py-2 text-xs text-amber-900">
            <strong>⚠ Settlement report may be incomplete.</strong> {row.partialSettlementWarning}
          </td>
        </tr>
      )}

      {open && (
        <tr className="border-t border-slate-100 bg-slate-50/60">
          <td colSpan={6} className="px-4 py-3">
            <p className="text-xs text-slate-600">
              Settlement is <strong>{formatCurrencyFull(row.settlementBasis?.netSales ?? 0)}</strong> against{' '}
              <strong>{formatCurrencyFull(row.orderBasis.netSales)}</strong> of orders — a difference of{' '}
              <strong>{formatCurrencyFull(row.difference)}</strong>.
            </p>

            {definitive.length > 0 && (
              <CauseList title="Accounts for the difference" causes={definitive} />
            )}
            {candidates.length > 0 && (
              <CauseList
                title={`Candidate causes — ${formatCurrencyFull(row.residual)} still to account for`}
                note="These overlap each other, so their sizes cannot simply be added up. Each one is where to look, not a settled answer."
                causes={candidates}
              />
            )}
            {structural.length > 0 && <CauseList title="Known but not measurable here" causes={structural} />}
          </td>
        </tr>
      )}
    </>
  )
}

function CauseList({ title, note, causes }: { title: string; note?: string; causes: ReconciliationCause[] }) {
  return (
    <div className="mt-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h4>
      {note && <p className="mt-0.5 text-xs text-slate-500">{note}</p>}
      <ul className="mt-1.5 space-y-1.5">
        {causes.map((c) => (
          <li key={c.key} className="rounded-md border border-slate-200 bg-white px-3 py-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs font-medium text-slate-800">{c.label}</span>
              {c.measurable && c.amount !== 0 && (
                <span className={`shrink-0 text-xs font-semibold tabular-nums ${c.amount < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                  {c.amount > 0 ? '+' : ''}
                  {formatCurrencyFull(c.amount)}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{c.explanation}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}
