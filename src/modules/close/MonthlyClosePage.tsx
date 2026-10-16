import { Link } from 'react-router-dom'
import { PageShell } from '@/components/layout/PageShell'
import { formatCurrencyFull, formatPercent } from '@/lib/format'
import { SendReportPanel } from './SendReportPanel'
import { useMonthlyClose } from './useMonthlyClose'
import type { CloseItem, RedFlag } from '@/engine/monthlyClose'

const CARD = 'rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-card)]'

function Banner({ ready, blockers, warnings, month }: { ready: boolean; blockers: number; warnings: number; month: string }) {
  const tone = ready ? 'var(--positive)' : 'var(--critical)'
  return (
    <div
      className="mb-6 rounded-[var(--radius-card)] border p-5"
      style={{
        borderColor: `color-mix(in oklab, ${tone} 45%, transparent)`,
        background: `color-mix(in oklab, ${tone} 10%, transparent)`,
      }}
    >
      <h2 className="text-base font-semibold text-[var(--ink)]">
        {ready
          ? `${month} is complete — the report can go out`
          : `${month} is not ready: ${blockers} thing${blockers === 1 ? '' : 's'} must be fixed first`}
      </h2>
      <p className="mt-1 text-sm text-[var(--ink-2)]">
        {ready
          ? 'Every channel that was trading has filed, and every input the month\'s figures depend on is entered.'
          : 'A report sent now would show these gaps as zeroes rather than as gaps. Each one below links to where it is fixed.'}
        {warnings > 0 && ` ${warnings} other thing${warnings === 1 ? '' : 's'} worth knowing ${warnings === 1 ? 'is' : 'are'} listed below.`}
      </p>
    </div>
  )
}

function ItemRow({ item }: { item: CloseItem }) {
  const tone = item.severity === 'blocker' ? 'var(--critical)' : 'var(--warning)'
  return (
    <li className="flex items-start gap-3 border-t border-[var(--line)] px-4 py-3 first:border-t-0">
      <span
        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
        style={{ background: tone }}
        aria-label={item.severity === 'blocker' ? 'Blocker' : 'Warning'}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-[var(--ink)]">{item.title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-[var(--ink-2)]">{item.detail}</p>
      </div>
      <Link
        to={item.path}
        className="shrink-0 rounded border border-[var(--line-2)] px-2.5 py-1 text-xs font-medium text-[var(--ink-2)] hover:border-[var(--accent)] hover:text-[var(--ink)]"
      >
        {item.actionLabel}
      </Link>
    </li>
  )
}

function FlagRow({ flag }: { flag: RedFlag }) {
  return (
    <li className="flex items-start gap-3 border-t border-[var(--line)] px-4 py-3 first:border-t-0">
      <span className="mt-0.5 shrink-0 text-base leading-none" aria-hidden>⚑</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-[var(--ink)]">{flag.title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-[var(--ink-2)]">{flag.detail}</p>
      </div>
      <Link
        to={flag.path}
        className="shrink-0 rounded border border-[var(--line-2)] px-2.5 py-1 text-xs font-medium text-[var(--ink-2)] hover:border-[var(--accent)] hover:text-[var(--ink)]"
      >
        Open
      </Link>
    </li>
  )
}

/**
 * Monthly Close: whether the month is finished, and what is still open.
 *
 * One screen the team can be pointed at on any day of the month. It is the
 * same check the monthly report is gated on, so nothing can be true here and
 * false in the email.
 */
export function MonthlyClosePage() {
  const close = useMonthlyClose()

  return (
    <PageShell
      title="Monthly Close"
      subtitle="What is still missing before this month's report can go out — and what in it needs a decision"
      showChannelFilter={false}
    >
      <Banner ready={close.ready} blockers={close.blockers.length} warnings={close.warnings.length} month={close.month} />

      <SendReportPanel close={close} />

      {close.blockers.length > 0 && (
        <section className={`mb-6 ${CARD}`}>
          <h3 className="border-b border-[var(--line)] px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--ink-3)]">
            Must be fixed before sending ({close.blockers.length})
          </h3>
          <ul>{close.blockers.map((item) => <ItemRow key={item.id} item={item} />)}</ul>
        </section>
      )}

      {close.redFlags.length > 0 && (
        <section className={`mb-6 ${CARD}`}>
          <h3 className="border-b border-[var(--line)] px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--ink-3)]">
            Needs attention this month ({close.redFlags.length})
          </h3>
          <ul>{close.redFlags.map((flag) => <FlagRow key={flag.id} flag={flag} />)}</ul>
        </section>
      )}

      <section className={`mb-6 ${CARD}`}>
        <h3 className="border-b border-[var(--line)] px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--ink-3)]">
          Top 5 selling products — {close.month}
        </h3>
        {close.topProducts.length === 0 ? (
          <p className="px-4 py-3 text-sm text-[var(--ink-2)]">No sales on file for this month yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[var(--surface-2)]">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold text-[var(--ink-3)]">#</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-[var(--ink-3)]">Product</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-[var(--ink-3)]">Units</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-[var(--ink-3)]">Net sales</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-[var(--ink-3)]">Share</th>
              </tr>
            </thead>
            <tbody>
              {close.topProducts.map((p, i) => (
                <tr key={p.productName} className="border-t border-[var(--line)]">
                  <td className="px-4 py-2 text-[var(--ink-3)]">{i + 1}</td>
                  <td className="px-4 py-2 text-[var(--ink)]">{p.productName}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-[var(--ink-2)]">{p.units.toLocaleString('en-IN')}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-medium text-[var(--ink)]">{formatCurrencyFull(p.netSales)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-[var(--ink-2)]">{formatPercent(p.pctOfNetSales)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {close.warnings.length > 0 && (
        <section className={CARD}>
          <h3 className="border-b border-[var(--line)] px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--ink-3)]">
            Worth knowing ({close.warnings.length})
          </h3>
          <ul>{close.warnings.map((item) => <ItemRow key={item.id} item={item} />)}</ul>
        </section>
      )}
    </PageShell>
  )
}
