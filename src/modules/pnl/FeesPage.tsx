import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { PageShell } from '@/components/layout/PageShell'
import { ChannelMark } from '@/components/ui/ChannelMark'
import { EmptyState } from '@/components/ui/EmptyState'
import { amountTone } from '@/components/pnl/amountTone'
import { channelLabel } from '@/config/channels'
import { exportRowsToCsv } from '@/lib/exportCsv'
import { formatCurrencyCompact, formatCurrencyFull, formatPercent, monthLabel } from '@/lib/format'
import {
  FEE_GROUP_LABELS, FEE_GROUPS_IN_ORDER, feeCategory, isCostOfSelling,
  type FeeCategoryId,
} from '@/engine/nativePnl/feeCategories'
import type { ChannelFeesStatement } from '@/engine/feesStatement'
import { useFeesStatement } from './useFeesStatement'

/**
 * What every marketplace charged this month, in one vocabulary.
 *
 * The question this page answers is the one a channel's own statement cannot:
 * each of those is written in its marketplace's words — a "collection fee"
 * here, a "fixed closing fee" there, an "ageing charge" somewhere else — which
 * is right for reading one channel and no use for deciding between eight.
 *
 * Nothing here is recomputed. Every figure is a line already on a verified
 * channel statement, summed by the category it was tagged with, so a statement
 * that ties to a marketplace's remittance ties here too.
 */
export function FeesPage() {
  const r = useFeesStatement()
  const [unit, setUnit] = useState<'pct' | 'inr'>('pct')
  const [openChannel, setOpenChannel] = useState<string | null>(null)

  const { statement } = r
  const cell = (s: ChannelFeesStatement, category: FeeCategoryId): number | null => {
    const found = s.categories.find((c) => c.category === category)
    if (!found) return null
    return unit === 'pct' ? found.pctOfBasis : found.amount
  }

  function handleExport() {
    // The rows the table is showing, in rupees whichever unit is on screen —
    // a spreadsheet is where the arithmetic gets done, and a percentage of a
    // basis that differs per channel cannot be added up.
    const row = (label: string, value: (s: ChannelFeesStatement) => number | '') => {
      const out: Record<string, string | number> = { Charge: label }
      for (const s of statement.channels) {
        const v = value(s)
        out[channelLabel(s.channel)] = v === '' ? '' : Number(v.toFixed(2))
      }
      return out
    }

    exportRowsToCsv(`HLPL_Marketplace_Fees_${r.month}`, [
      ...statement.categories.map((id) =>
        row(feeCategory(id).label, (s) => s.categories.find((c) => c.category === id)?.amount ?? ''),
      ),
      row('What the channel takes', (s) => s.totalCostOfSelling),
      row('Take rate, % of basis', (s) => s.takeRatePct),
      row('Basis', (s) => s.basis),
    ])
  }

  return (
    <PageShell
      title="Marketplace Fees"
      subtitle="What each channel charged, in one vocabulary, from its own settlement"
      showFilters={false}
      headerActions={
        <div className="flex items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-[var(--ink-3)]">Month</span>
            <select
              value={r.month}
              onChange={(e) => r.setMonth(e.target.value)}
              className="rounded-md border border-[var(--line-2)] bg-[var(--surface)] px-3 py-1.5 text-sm font-medium text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
            >
              {r.monthOptions.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          </label>
          <div className="flex overflow-hidden rounded-[var(--radius-control)] border border-[var(--line-2)]">
            {(['pct', 'inr'] as const).map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => setUnit(u)}
                className={clsx(
                  'px-3 py-1.5 text-sm font-medium transition-colors',
                  unit === u
                    ? 'bg-[var(--accent)] text-white'
                    : 'text-[var(--ink-2)] hover:bg-[var(--surface-hover)]',
                )}
              >
                {u === 'pct' ? '% of sales' : '₹'}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={handleExport}
            className="rounded-[var(--radius-control)] border border-[var(--line-2)] px-3 py-1.5 text-sm font-medium text-[var(--ink-2)] hover:bg-[var(--surface-hover)]"
          >
            Export
          </button>
        </div>
      }
    >
      {statement.channels.length === 0 ? (
        <div className="space-y-3">
          <EmptyState
            title={`No marketplace charges for ${monthLabel(r.month)}`}
            description="A channel appears here once a settlement file, or a month of order rows, has been uploaded for it."
          />
          <p className="text-sm text-[var(--ink-3)]">
            <Link to="/data/upload" className="font-medium text-[var(--accent)] hover:underline">Upload reports</Link>
          </p>
        </div>
      ) : (
        <>
          <Summary statement={statement} />
          <Matrix
            statement={statement}
            unit={unit}
            cell={cell}
            onPick={(c) => setOpenChannel((prev) => (prev === c ? null : c))}
            openChannel={openChannel}
          />
          {statement.channels.map((s) => (
            <ChannelDetail
              key={s.channel}
              s={s}
              open={openChannel === s.channel}
              onToggle={() => setOpenChannel((prev) => (prev === s.channel ? null : s.channel))}
            />
          ))}
        </>
      )}
    </PageShell>
  )
}

/** The three figures worth reading before the table. */
function Summary({ statement }: { statement: ReturnType<typeof useFeesStatement>['statement'] }) {
  /**
   * The charge taking the biggest bite out of the channel it is charged on.
   *
   * Ranked by share of that channel's sales rather than by rupees. The largest
   * charge in rupees is the biggest channel's commission in almost every
   * month, which is true and tells nobody anything; the heaviest charge
   * relative to what the channel sold is the one worth a decision — Blinkit's
   * ageing charge at 57% of net revenue, where its commission was 2%.
   *
   * A floor keeps a quiet channel's small charge from taking the headline on
   * a ratio alone: it has to be worth at least a fiftieth of everything the
   * marketplaces charged this month.
   */
  const floor = Math.abs(statement.totalCostOfSelling) * 0.02
  let worst: { channel: string; category: FeeCategoryId; amount: number; pct: number } | null = null
  for (const s of statement.channels) {
    for (const c of s.categories) {
      if (!isCostOfSelling(c.category)) continue
      if (Math.abs(c.amount) < floor) continue
      if (!worst || c.pctOfBasis > worst.pct) {
        worst = { channel: s.channel, category: c.category, amount: c.amount, pct: c.pctOfBasis }
      }
    }
  }

  const withheld = statement.channels.reduce((sum, s) => sum + s.withheld, 0)

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Figure
        label="Charged by the marketplaces"
        value={formatCurrencyFull(statement.totalCostOfSelling)}
        hint={`On ${formatCurrencyCompact(statement.totalBasis)} of sales`}
        tone={amountTone(statement.totalCostOfSelling)}
      />
      <Figure
        label="Blended take rate"
        value={formatPercent(statement.takeRatePct)}
        hint="Every channel together, advertising excluded"
      />
      <Figure
        label="Advertising they billed"
        value={formatCurrencyFull(statement.channels.reduce((sum, s) => sum + s.advertising, 0))}
        hint="Our choice, so it is not in the take rate"
        tone={amountTone(statement.channels.reduce((sum, s) => sum + s.advertising, 0))}
      />
      <Figure
        label="Withheld, not charged"
        value={formatCurrencyFull(withheld)}
        hint="GST on the charges, TCS and TDS — all creditable"
      />
      {worst && (
        <div className="sm:col-span-2 lg:col-span-4 rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[var(--shadow-card)]">
          <p className="text-sm text-[var(--ink-2)]">
            <span className="font-semibold text-[var(--ink)]">
              {channelLabel(worst.channel as Parameters<typeof channelLabel>[0])}
            </span>
            {' — '}
            {feeCategory(worst.category).label.toLowerCase()} is the heaviest charge of the month relative to what the channel sold:{' '}
            <span className={clsx('font-semibold tabular-nums', amountTone(worst.amount))}>
              {formatCurrencyFull(worst.amount)}
            </span>
            {', '}
            <span className="font-semibold">{formatPercent(worst.pct)}</span> of that channel's sales.{' '}
            <span className="text-[var(--ink-3)]">{feeCategory(worst.category).hint}</span>
          </p>
        </div>
      )}
    </div>
  )
}

function Figure({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] px-4 py-3 shadow-[var(--shadow-card)]">
      <p className="text-xs font-medium text-[var(--ink-3)]">{label}</p>
      <p className={clsx('mt-1 text-xl font-semibold tabular-nums', tone ?? 'text-[var(--ink)]')}>{value}</p>
      <p className="mt-0.5 text-xs text-[var(--ink-3)]">{hint}</p>
    </div>
  )
}

/** Every charge against every channel — the comparison the page exists for. */
function Matrix({
  statement, unit, cell, onPick, openChannel,
}: {
  statement: ReturnType<typeof useFeesStatement>['statement']
  unit: 'pct' | 'inr'
  cell: (s: ChannelFeesStatement, category: FeeCategoryId) => number | null
  onPick: (channel: string) => void
  openChannel: string | null
}) {
  const groups = FEE_GROUPS_IN_ORDER.filter((g) =>
    statement.categories.some((id) => feeCategory(id).group === g))
  // The total goes under the last group that is a cost of selling, whichever
  // that turns out to be. Hanging it off one named group lost it in a month
  // where no channel happened to charge anything in that group.
  const lastCostGroup = [...groups].reverse().find((g) =>
    statement.categories.some((id) => feeCategory(id).group === g && isCostOfSelling(id)))

  const show = (v: number | null, category: FeeCategoryId) => {
    if (v === null) return <span className="text-[var(--ink-4)]">—</span>
    const group = feeCategory(category).group
    // The withheld group is an amount, not a deduction, so it is not coloured
    // as money going out — it comes back when we file.
    const tone = group === 'withheld' ? 'text-[var(--ink-2)]' : amountTone(unit === 'pct' ? -v : v)
    return (
      <span className={clsx('tabular-nums', tone)}>
        {unit === 'pct' ? formatPercent(v) : formatCurrencyFull(v)}
      </span>
    )
  }

  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-card)]">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-[var(--line)]">
            <th className="sticky left-0 z-10 bg-[var(--surface)] px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[var(--ink-3)]">
              Charge
            </th>
            {statement.channels.map((s) => (
              <th key={s.channel} className="px-4 py-3 text-right">
                <button
                  type="button"
                  onClick={() => onPick(s.channel)}
                  className={clsx(
                    'inline-flex flex-col items-end gap-0.5 rounded px-1 py-0.5 hover:bg-[var(--surface-hover)]',
                    openChannel === s.channel && 'bg-[var(--surface-hover)]',
                  )}
                  title={`What ${channelLabel(s.channel)} charged, line by line`}
                >
                  <ChannelMark channel={s.channel} className="h-5 max-w-[84px] object-contain text-sm font-semibold text-[var(--ink)]" />
                  {/* Nykaa's charges are a share of MRP, not of what is left
                      after them, so the basis is named rather than assumed. */}
                  <span className="text-[10px] font-normal text-[var(--ink-3)]">{s.basisLabel}</span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const ids = statement.categories.filter((id) => feeCategory(id).group === group)
            return (
              <Fragment key={group}>
                <tr className="bg-[var(--surface-2)]">
                  <td
                    colSpan={statement.channels.length + 1}
                    className="sticky left-0 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-3)]"
                  >
                    {FEE_GROUP_LABELS[group]}
                  </td>
                </tr>
                {ids.map((id) => (
                  <tr key={id} className="border-b border-[var(--line)] last:border-0 hover:bg-[var(--surface-hover)]">
                    <td
                      className="sticky left-0 z-10 bg-[var(--surface)] px-4 py-2 font-medium text-[var(--ink-2)]"
                      title={feeCategory(id).hint}
                    >
                      {feeCategory(id).label}
                    </td>
                    {statement.channels.map((s) => (
                      <td key={s.channel} className="px-4 py-2 text-right">{show(cell(s, id), id)}</td>
                    ))}
                  </tr>
                ))}
                {group === lastCostGroup && (
                  <tr key="take" className="border-y-2 border-[var(--line-2)] bg-[var(--surface-2)]">
                    <td className="sticky left-0 z-10 bg-[var(--surface-2)] px-4 py-2.5 font-semibold text-[var(--ink)]">
                      What the channel takes
                    </td>
                    {statement.channels.map((s) => (
                      <td key={s.channel} className="px-4 py-2.5 text-right font-semibold tabular-nums">
                        <span className={amountTone(-s.takeRatePct)}>
                          {unit === 'pct' ? formatPercent(s.takeRatePct) : formatCurrencyFull(s.totalCostOfSelling)}
                        </span>
                      </td>
                    ))}
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** One channel's charges, line by line, in the marketplace's own words. */
function ChannelDetail({ s, open, onToggle }: { s: ChannelFeesStatement; open: boolean; onToggle: () => void }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-card)]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 px-5 py-3 text-left"
      >
        <span className="flex items-center gap-3">
          <ChannelMark channel={s.channel} className="h-6 max-w-[96px] object-contain text-base font-semibold text-[var(--ink)]" />
          <span className="text-sm text-[var(--ink-3)]">
            {s.fromOrderRows ? 'from the order rows' : 'from its own settlement'}
          </span>
        </span>
        <span className="flex items-center gap-4">
          <span className={clsx('text-sm font-semibold tabular-nums', amountTone(s.totalCostOfSelling))}>
            {formatCurrencyFull(s.totalCostOfSelling)}
          </span>
          <span className="text-sm font-semibold tabular-nums text-[var(--ink-2)]">
            {formatPercent(s.takeRatePct)}
          </span>
          <span className="text-[var(--ink-3)]">{open ? '−' : '+'}</span>
        </span>
      </button>

      {open && (
        <div className="border-t border-[var(--line)] px-5 py-4">
          {s.notes.length > 0 && (
            <ul className="mb-4 space-y-1">
              {s.notes.map((n) => (
                <li key={n} className="text-xs text-[var(--ink-3)]">⚠ {n}</li>
              ))}
            </ul>
          )}
          <table className="w-full text-sm">
            <tbody>
              {s.categories.map((c) => (
                <Fragment key={c.category}>
                  <tr className="border-b border-[var(--line)]">
                    <td className="py-2 pr-4 font-semibold text-[var(--ink)]">
                      {feeCategory(c.category).label}
                    </td>
                    <td className={clsx(
                      'py-2 pr-4 text-right font-semibold tabular-nums',
                      feeCategory(c.category).group === 'withheld' ? 'text-[var(--ink-2)]' : amountTone(c.amount),
                    )}>
                      {formatCurrencyFull(c.amount)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-[var(--ink-3)]">
                      {feeCategory(c.category).group === 'withheld' ? '' : formatPercent(c.pctOfBasis)}
                    </td>
                  </tr>
                  {/* The marketplace's own line names, so a figure here can be
                      found in the file it came from. A category with one line
                      says the same thing twice — Blinkit charges one storage
                      charge and calls it that — so only the lever is kept. */}
                  {c.lines.length === 1
                    ? c.lines[0].lever && (
                        <tr className="border-b border-[var(--line)] last:border-0">
                          <td colSpan={3} className="py-1.5 pl-5 pr-4 text-xs text-[var(--ink-3)]">
                            → {c.lines[0].lever}
                          </td>
                        </tr>
                      )
                    : c.lines.map((l) => (
                        <tr key={`${c.category}-${l.key}`} className="border-b border-[var(--line)] last:border-0">
                          <td className="py-1.5 pl-5 pr-4 text-[var(--ink-2)]">
                            {l.href ? (
                              <a href={l.href} className="hover:text-[var(--accent)] hover:underline">{l.label}</a>
                            ) : l.label}
                            {l.lever && (
                              <span className="mt-0.5 block text-xs text-[var(--ink-3)]">→ {l.lever}</span>
                            )}
                          </td>
                          <td className="py-1.5 pr-4 text-right tabular-nums text-[var(--ink-2)]">
                            {/* Shown the way its category is, so a block does
                                not print ₹5 above ₹−5 for the same money. */}
                            {formatCurrencyFull(
                              feeCategory(c.category).group === 'withheld' ? Math.abs(l.amount) : l.amount,
                            )}
                          </td>
                          <td />
                        </tr>
                      ))}
                </Fragment>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-[var(--ink-3)]">
            Percentages are of {s.basisLabel} — {formatCurrencyFull(s.basis)} this month.
            {' '}Advertising and the withheld taxes are shown but not counted in what the channel takes:
            one is a choice, the other comes back when we file.
          </p>
        </div>
      )}
    </div>
  )
}
