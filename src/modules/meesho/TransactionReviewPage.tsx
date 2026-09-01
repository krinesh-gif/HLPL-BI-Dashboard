import { useState } from 'react'
import { PageShell } from '@/components/layout/PageShell'
import { useFilterStore } from '@/store/filterStore'
import { formatCurrencyFull, monthLabel } from '@/lib/format'
import { MEESHO_REVENUE_POLICY } from '@/data/meesho/policy'
import type { MeeshoEventType } from '@/data/meesho/events'
import type { PnlBasis } from '@/data/models'
import { useMeeshoTransactions } from './useMeeshoTransactions'

/**
 * The rows the importer would not decide on its own.
 *
 * Unclassified and visible beats wrongly classified and hidden: a row here has
 * been kept out of revenue, volume and cost until someone confirms what it is.
 * That is the opposite of the failure this replaced, where a zero-sale
 * affiliate charge was silently counted as a delivered sale.
 */

const EVENT_LABELS: Record<MeeshoEventType, string> = {
  sale: 'Sale',
  return: 'Customer return',
  rto: 'RTO',
  cancellation: 'Cancellation',
  exchange: 'Exchange',
  affiliate_fee: 'Affiliate / referral fee',
  recovery: 'Recovery',
  compensation: 'Compensation',
  claim: 'Claim',
  settlement_adjustment: 'Settlement adjustment',
  unclassified: 'Unclassified',
}

const CONFIDENCE_STYLE: Record<string, string> = {
  certain: 'bg-[var(--surface-2)] text-[var(--ink-2)]',
  probable: 'bg-[color-mix(in_oklab,var(--warning)_20%,transparent)] text-[var(--ink-2)]',
  needs_review: 'bg-[color-mix(in_oklab,var(--critical)_16%,transparent)] text-[var(--critical-ink)]',
}

export function TransactionReviewPage() {
  const { month } = useFilterStore()
  const [basis, setBasis] = useState<PnlBasis>('order')
  const [filter, setFilter] = useState<'flagged' | 'needs_review' | 'all'>('flagged')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { rows, total, loading, error } = useMeeshoTransactions({
    month, basis, limit: 200,
    flaggedOnly: filter === 'flagged',
    confidence: filter === 'needs_review' ? 'needs_review' : undefined,
  })

  return (
    <PageShell
      title="Meesho — Transaction Review"
      subtitle={`Rows the importer could not place on its own — ${monthLabel(month)}, ${basis === 'order' ? 'order date' : 'payment date'}`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md border border-[var(--line)] bg-[var(--surface)] p-0.5 text-xs font-medium">
          {([['order', 'Order date'], ['settlement', 'Payment date']] as const).map(([key, label]) => (
            <button
              key={key} type="button" onClick={() => setBasis(key)}
              className={`rounded px-3 py-1.5 ${basis === key ? 'bg-[var(--accent)] text-[var(--accent-ink)]' : 'text-[var(--ink-2)] hover:bg-[var(--surface-hover)]'}`}
            >{label}</button>
          ))}
        </div>
        <select
          value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}
          className="rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--ink-2)]"
        >
          <option value="flagged">Needs a look</option>
          <option value="needs_review">Could not be classified</option>
          <option value="all">Every row this month</option>
        </select>
        <span className="text-xs text-[var(--ink-3)]">
          {loading ? 'Loading…' : `${total.toLocaleString('en-IN')} row(s)`}
        </span>
      </div>

      {error && (
        <p className="rounded-md border border-[color-mix(in_oklab,var(--critical)_45%,transparent)] bg-[color-mix(in_oklab,var(--critical)_10%,transparent)] px-3 py-2 text-xs text-[var(--critical-ink)]">
          Could not load transactions: {error}
        </p>
      )}

      {!loading && !error && rows.length === 0 && (
        <p className="rounded-md border border-[color-mix(in_oklab,var(--good)_45%,transparent)] bg-[color-mix(in_oklab,var(--good)_10%,transparent)] px-3 py-2 text-xs text-[var(--good-ink)]">
          Nothing needs review for this month. Every row the file carried was classified with confidence, so no money is
          sitting outside the figures.
        </p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--surface)]">
          <table className="w-full min-w-[64rem] text-sm">
            <thead className="bg-[var(--surface-2)] text-xs uppercase tracking-wide text-[var(--ink-3)]">
              <tr>
                <th className="px-3 py-2 text-left">Sub-order</th>
                <th className="px-3 py-2 text-left">Order date</th>
                <th className="px-3 py-2 text-left">Payment date</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Detected event</th>
                <th className="px-3 py-2 text-left">Confidence</th>
                <th className="px-3 py-2 text-right">Sale</th>
                <th className="px-3 py-2 text-right">Settlement</th>
                <th className="px-3 py-2 text-right">Recovery</th>
                <th className="px-3 py-2 text-right">Row</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {rows.map((t) => {
                const open = expanded === t.transactionId
                const policy = MEESHO_REVENUE_POLICY[t.eventType]
                return (
                  <>
                    <tr
                      key={t.transactionId}
                      onClick={() => setExpanded(open ? null : t.transactionId)}
                      className="cursor-pointer hover:bg-[var(--surface-hover)]"
                    >
                      <td className="px-3 py-2 font-mono text-xs text-[var(--ink-2)]">{t.subOrderId}</td>
                      <td className="px-3 py-2 text-xs text-[var(--ink-2)]">{t.orderDate}</td>
                      <td className="px-3 py-2 text-xs text-[var(--ink-2)]">{t.paymentDate || '—'}</td>
                      <td className="px-3 py-2 text-xs text-[var(--ink-2)]">{t.orderStatus || <em className="text-[var(--ink-3)]">blank</em>}</td>
                      <td className="px-3 py-2 text-xs text-[var(--ink-2)]">{EVENT_LABELS[t.eventType] ?? t.eventType}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${CONFIDENCE_STYLE[t.confidence] ?? ''}`}>
                          {t.confidence.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatCurrencyFull(t.totalSaleAmount)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatCurrencyFull(t.settlementAmount)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatCurrencyFull(t.recovery)}</td>
                      <td className="px-3 py-2 text-right text-xs text-[var(--ink-3)]">{t.sourceRowNumber}</td>
                    </tr>
                    {open && (
                      <tr key={`${t.transactionId}-detail`} className="bg-[var(--surface-2)]">
                        <td colSpan={10} className="px-4 py-3">
                          <p className="text-xs text-[var(--ink-2)]"><strong>Why this was flagged:</strong> {t.classificationReason}</p>
                          {policy && <p className="mt-1 text-xs text-[var(--ink-2)]"><strong>How it is treated:</strong> {policy.note}</p>}
                          <p className="mt-1 text-xs text-[var(--ink-3)]">
                            Source: {t.sourceFile || 'unknown file'} ▸ {t.sourceSheet} ▸ row {t.sourceRowNumber}
                          </p>
                          <details className="mt-2">
                            <summary className="cursor-pointer text-xs text-[var(--accent)]">Original row, exactly as uploaded</summary>
                            <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-[11px] md:grid-cols-3">
                              {Object.entries(t.raw ?? {}).filter(([, v]) => v !== '' && v !== '0').map(([k, v]) => (
                                <div key={k} className="flex justify-between gap-2 border-b border-[var(--line)] py-0.5">
                                  <dt className="text-[var(--ink-3)]">{k}</dt>
                                  <dd className="font-mono text-[var(--ink)]">{v}</dd>
                                </div>
                              ))}
                            </dl>
                          </details>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-[var(--ink-3)]">
        A row listed here is held out of Net Sales, volume and cost of goods until its event is confirmed. Correcting one
        means fixing it at source — in the Meesho file or the Product Master — and re-uploading; the figures then move.
      </p>
    </PageShell>
  )
}
