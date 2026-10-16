import { useDataStore } from '@/store/dataStore'
import { formatCurrencyCompact, formatCurrencyFull, formatNumber, formatPercent } from '@/lib/format'
import type { MyntraAdsCampaign, MyntraAdsFacts } from '@/data/models'

const CARD = 'rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-card)]'
const TH = 'px-3 py-2 text-xs font-semibold text-[var(--ink-3)]'
const TD = 'px-3 py-2 tabular-nums text-[var(--ink-2)]'

const DAYPART_LABEL: Record<string, string> = {
  base: 'Base',
  peak: 'Peak hours',
  nonPeak: 'Off-peak',
}

/** A campaign state, in the colour of what it means for the money. */
function StatusPill({ status }: { status: string }) {
  const tone = status === 'LIVE'
    ? 'var(--positive)'
    : status === 'DAILY_BUDGET_MET'
      ? 'var(--warning)'
      : 'var(--ink-3)'
  return (
    <span
      className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{ background: `color-mix(in oklab, ${tone} 16%, transparent)`, color: 'var(--ink)' }}
    >
      {status.replace(/_/g, ' ').toLowerCase()}
    </span>
  )
}

const revenueOf = (c: MyntraAdsCampaign): number => c.revenueDirect + c.revenueIndirect
const unitsOf = (c: MyntraAdsCampaign): number => c.unitsDirect + c.unitsIndirect

/**
 * What Myntra's PLA report says beyond the spend.
 *
 * Three questions the generic ads page cannot answer, because no other
 * platform's report carries them: which campaigns are earning their budget,
 * how much of the attributed revenue is the advertised product itself, and
 * which part of the day the money goes into.
 */
export function MyntraAdsDepth({ month }: { month: string }) {
  const { myntraAdsFacts } = useDataStore()
  const facts: MyntraAdsFacts | undefined = (myntraAdsFacts ?? []).find((f) => f.month === month)
  if (!facts) return null

  const revenue = facts.revenueDirect + facts.revenueIndirect
  const directShare = revenue > 0 ? (facts.revenueDirect / revenue) * 100 : 0
  const budgetMet = facts.statusCounts['DAILY_BUDGET_MET'] ?? 0
  const daypartSpend = facts.dayparts.reduce((sum, d) => sum + d.spend, 0)

  return (
    <div className="flex flex-col gap-4">
      <section className={CARD}>
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--line)] px-4 py-2.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-3)]">
            Campaigns — {facts.campaigns.length} across {facts.days} day{facts.days === 1 ? '' : 's'}
          </h3>
          <p className="text-xs text-[var(--ink-3)]">
            {formatPercent(directShare)} of attributed revenue is the advertised product itself
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--surface-2)]">
              <tr>
                <th className={`${TH} text-left`}>Campaign</th>
                <th className={`${TH} text-left`}>State</th>
                <th className={`${TH} text-right`}>Spend</th>
                <th className={`${TH} text-right`}>Impressions</th>
                <th className={`${TH} text-right`}>Clicks</th>
                <th className={`${TH} text-right`}>CTR</th>
                <th className={`${TH} text-right`}>CPC</th>
                <th className={`${TH} text-right`}>Units</th>
                <th className={`${TH} text-right`}>Revenue</th>
                <th className={`${TH} text-right`}>Direct</th>
                <th className={`${TH} text-right`}>ROAS</th>
              </tr>
            </thead>
            <tbody>
              {facts.campaigns.map((c) => {
                const rev = revenueOf(c)
                const roas = c.spend > 0 ? rev / c.spend : null
                return (
                  <tr key={c.campaignId} className="border-t border-[var(--line)]">
                    <td className="px-3 py-2 text-[var(--ink)]">{c.campaignName}</td>
                    <td className="px-3 py-2"><StatusPill status={c.lastStatus} /></td>
                    <td className={`${TD} text-right font-medium text-[var(--ink)]`}>{formatCurrencyFull(c.spend)}</td>
                    <td className={`${TD} text-right`}>{formatNumber(c.impressions)}</td>
                    <td className={`${TD} text-right`}>{formatNumber(c.clicks)}</td>
                    <td className={`${TD} text-right`}>{c.impressions > 0 ? formatPercent((c.clicks / c.impressions) * 100, 2) : '—'}</td>
                    <td className={`${TD} text-right`}>{c.clicks > 0 ? formatCurrencyFull(c.spend / c.clicks) : '—'}</td>
                    <td className={`${TD} text-right`}>{formatNumber(unitsOf(c))}</td>
                    <td className={`${TD} text-right`}>{formatCurrencyCompact(rev)}</td>
                    <td className={`${TD} text-right`}>{rev > 0 ? formatPercent((c.revenueDirect / rev) * 100) : '—'}</td>
                    <td className={`${TD} text-right font-medium text-[var(--ink)]`}>{roas === null ? '—' : `${roas.toFixed(2)}x`}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="border-t border-[var(--line)] px-4 py-2 text-xs text-[var(--ink-3)]">
          Direct is revenue from the advertised product itself; the rest is anything else of ours the shopper bought
          after the click. Myntra attributes both to the campaign, and only the first is a product decision.
          {budgetMet > 0 && ` ${budgetMet} campaign-day${budgetMet === 1 ? '' : 's'} stopped on the daily budget — those are days a campaign wanted more money than it was given.`}
        </p>
      </section>

      <section className={CARD}>
        <h3 className="border-b border-[var(--line)] px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--ink-3)]">
          Where the money goes in the day
        </h3>
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-2)]">
            <tr>
              <th className={`${TH} text-left`}>Part of day</th>
              <th className={`${TH} text-right`}>Spend</th>
              <th className={`${TH} text-right`}>Share</th>
              <th className={`${TH} text-right`}>Impressions</th>
              <th className={`${TH} text-right`}>Clicks</th>
              <th className={`${TH} text-right`}>Units</th>
              <th className={`${TH} text-right`}>Revenue</th>
              <th className={`${TH} text-right`}>ROAS</th>
            </tr>
          </thead>
          <tbody>
            {facts.dayparts.map((d) => (
              <tr key={d.part} className="border-t border-[var(--line)]">
                <td className="px-3 py-2 text-[var(--ink)]">{DAYPART_LABEL[d.part] ?? d.part}</td>
                <td className={`${TD} text-right font-medium text-[var(--ink)]`}>{formatCurrencyFull(d.spend)}</td>
                <td className={`${TD} text-right`}>{daypartSpend > 0 ? formatPercent((d.spend / daypartSpend) * 100) : '—'}</td>
                <td className={`${TD} text-right`}>{formatNumber(d.impressions)}</td>
                <td className={`${TD} text-right`}>{formatNumber(d.clicks)}</td>
                <td className={`${TD} text-right`}>{formatNumber(d.units)}</td>
                <td className={`${TD} text-right`}>{formatCurrencyCompact(d.revenue)}</td>
                <td className={`${TD} text-right font-medium text-[var(--ink)]`}>{d.spend > 0 ? `${(d.revenue / d.spend).toFixed(2)}x` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t border-[var(--line)] px-4 py-2 text-xs text-[var(--ink-3)]">
          These three are a split of the month, not extra spend: they add to {formatCurrencyFull(daypartSpend)}, the
          same as the ad spend above. A part of the day earning a worse return than the others is a bid to change,
          not a campaign to stop.
        </p>
      </section>
    </div>
  )
}
