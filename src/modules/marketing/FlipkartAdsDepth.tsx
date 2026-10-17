import { useDataStore } from '@/store/dataStore'
import { formatCurrencyCompact, formatCurrencyFull, formatNumber, formatPercent } from '@/lib/format'
import type { FlipkartAdsCampaign, FlipkartAdsFacts, FlipkartAdsSku, FlipkartGoogleAdsFacts, FlipkartGoogleAdsProduct } from '@/data/models'

const CARD = 'rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-card)]'
const TH = 'px-3 py-2 text-xs font-semibold text-[var(--ink-3)]'
const TD = 'px-3 py-2 tabular-nums text-[var(--ink-2)]'

/** Spend that returns less than it costs, in the colour of what that means. */
function roasTone(spend: number, revenue: number): string {
  if (spend <= 0) return 'var(--ink-2)'
  if (revenue < spend) return 'var(--negative)'
  // Above this, the campaign is buying revenue the channel does not keep: a
  // contribution margin of roughly 40% means a return under 2.5x costs more
  // than the sale earns.
  if (revenue < spend * 2.5) return 'var(--warning)'
  return 'var(--positive)'
}

function RoasCell({ spend, revenue }: { spend: number; revenue: number }) {
  if (spend <= 0) return <td className={`${TD} text-right`}>—</td>
  return (
    <td className={`${TD} text-right font-medium`} style={{ color: roasTone(spend, revenue) }}>
      {(revenue / spend).toFixed(2)}x
    </td>
  )
}

const unitsOf = (r: { unitsDirect: number; unitsIndirect: number }): number => r.unitsDirect + r.unitsIndirect

/** The product rows worth a screen: enough to act on, not all 158 at once. */
const PRODUCTS_SHOWN = 25

/**
 * What Flipkart's PLA report says, beside the Ads line its P&L already states.
 *
 * Three things the shared ads KPIs cannot hold. The first is the comparison
 * that matters most: Flipkart bills advertising on its P&L report and measures
 * it again here, and the two do not agree — so both are shown rather than one
 * being quietly preferred. The others are the breakdowns no other platform's
 * report carries at this depth: spend per campaign, and spend per product
 * against Flipkart's own SKU codes.
 */
export function FlipkartAdsDepth({ month }: { month: string }) {
  const { flipkartAdsFacts, flipkartGoogleAdsFacts, flipkartFacts } = useDataStore()
  const facts: FlipkartAdsFacts | undefined = (flipkartAdsFacts ?? []).find((f) => f.month === month)
  const google: FlipkartGoogleAdsFacts | undefined = (flipkartGoogleAdsFacts ?? []).find((f) => f.month === month)
  if (!facts && !google) return null

  const pnl = flipkartFacts.find((f) => f.month === month)
  const billed = pnl ? pnl.flipkartAds : null
  const googleBilled = pnl ? pnl.googleAds : null
  const measured = facts?.spend ?? null
  const gap = billed === null || measured === null ? null : billed - measured
  const googleGap = googleBilled === null || google === undefined ? null : googleBilled - google.cost

  return (
    <div className="flex flex-col gap-4">
      <section className={CARD}>
        <h3 className="border-b border-[var(--line)] px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--ink-3)]">
          What Flipkart bills, against what it measures
        </h3>
        <table className="w-full text-sm">
          <tbody>
            <tr className="border-b border-[var(--line)]">
              <td className="px-4 py-2 text-[var(--ink)]">P&amp;L report — Ads</td>
              <td className={`${TD} text-right font-medium text-[var(--ink)]`}>
                {billed === null ? '—' : formatCurrencyFull(billed)}
              </td>
              <td className="px-4 py-2 text-xs text-[var(--ink-3)]">What the month is charged</td>
            </tr>
            <tr className="border-b border-[var(--line)]">
              <td className="px-4 py-2 text-[var(--ink)]">PLA campaign report</td>
              <td className={`${TD} text-right font-medium text-[var(--ink)]`}>
                {measured === null ? '—' : formatCurrencyFull(measured)}
              </td>
              <td className="px-4 py-2 text-xs text-[var(--ink-3)]">
                {facts
                  ? `${facts.periodStart} to ${facts.periodEnd}, ${formatNumber(facts.rows)} rows`
                  : 'Not uploaded for this month'}
              </td>
            </tr>
            <tr className="border-b border-[var(--line)]">
              <td className="px-4 py-2 text-[var(--ink)]">Difference</td>
              <td
                className={`${TD} text-right font-medium`}
                style={{ color: gap === null || Math.abs(gap) <= 1 ? 'var(--ink-2)' : 'var(--warning)' }}
              >
                {gap === null ? '—' : formatCurrencyFull(gap)}
              </td>
              <td className="px-4 py-2 text-xs text-[var(--ink-3)]">
                {gap === null || measured === null || measured <= 0
                  ? ''
                  : `${formatPercent((gap / measured) * 100)} of measured spend`}
              </td>
            </tr>
            <tr className="border-b border-[var(--line)]">
              <td className="px-4 py-2 text-[var(--ink)]">P&amp;L report — Google Ads</td>
              <td className={`${TD} text-right font-medium text-[var(--ink)]`}>
                {googleBilled === null ? '—' : formatCurrencyFull(googleBilled)}
              </td>
              <td className="px-4 py-2 text-xs text-[var(--ink-3)]">Off-platform, billed separately</td>
            </tr>
            <tr className="border-b border-[var(--line)]">
              <td className="px-4 py-2 text-[var(--ink)]">Google Ads product report</td>
              <td className={`${TD} text-right font-medium text-[var(--ink)]`}>
                {google === undefined ? '—' : formatCurrencyFull(google.cost)}
              </td>
              <td className="px-4 py-2 text-xs text-[var(--ink-3)]">
                {google === undefined
                  ? 'Not uploaded for this month'
                  : `${google.periodStart} to ${google.periodEnd}, ${formatNumber(google.products.length)} listings`}
              </td>
            </tr>
            <tr>
              <td className="px-4 py-2 text-[var(--ink)]">Difference</td>
              <td
                className={`${TD} text-right font-medium`}
                style={{ color: googleGap === null || Math.abs(googleGap) <= 1 ? 'var(--ink-2)' : 'var(--warning)' }}
              >
                {googleGap === null ? '—' : formatCurrencyFull(googleGap)}
              </td>
              <td className="px-4 py-2 text-xs text-[var(--ink-3)]">
                {googleGap === null || google === undefined || google.cost <= 0
                  ? ''
                  : `${formatPercent((googleGap / google.cost) * 100)} of measured cost`}
              </td>
            </tr>
          </tbody>
        </table>
        <p className="border-t border-[var(--line)] px-4 py-2 text-xs text-[var(--ink-3)]">
          The P&amp;L charges Flipkart's own two figures, not these. Each pair measures different things — a report
          is the spend Flipkart served in the period, a P&amp;L line is what it billed — and a gap is normally GST, a
          billing period that does not end with the month, or both. The PLA gap runs near 18%, which is what GST
          would be. The Google Ads gap is far wider than that, so that export is reaching less than the month.
        </p>
      </section>

      {facts && <PlaSections facts={facts} />}
      {google && <GoogleAdsSection facts={google} />}
    </div>
  )
}

/** The on-platform half: campaigns and the products inside them. */
function PlaSections({ facts }: { facts: FlipkartAdsFacts }) {
  const underwater = facts.campaigns.filter((c) => c.spend > 0 && c.revenue < c.spend)
  const wasted = underwater.reduce((sum, c) => sum + c.spend, 0)
  const products = facts.skus.slice(0, PRODUCTS_SHOWN)

  return (
    <>
      <section className={CARD}>
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--line)] px-4 py-2.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-3)]">
            Campaigns — {facts.campaigns.length}
          </h3>
          <p className="text-xs text-[var(--ink-3)]">
            {facts.spend > 0 ? `${(facts.revenue / facts.spend).toFixed(2)}x overall` : '—'}
            {facts.revenue > 0 && ` · ACoS ${formatPercent((facts.spend / facts.revenue) * 100)}`}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--surface-2)]">
              <tr>
                <th className={`${TH} text-left`}>Campaign</th>
                <th className={`${TH} text-right`}>Spend</th>
                <th className={`${TH} text-right`}>Views</th>
                <th className={`${TH} text-right`}>Clicks</th>
                <th className={`${TH} text-right`}>CTR</th>
                <th className={`${TH} text-right`}>CPC</th>
                <th className={`${TH} text-right`}>Units</th>
                <th className={`${TH} text-right`}>Direct</th>
                <th className={`${TH} text-right`}>Revenue</th>
                <th className={`${TH} text-right`}>ACoS</th>
                <th className={`${TH} text-right`}>ROAS</th>
              </tr>
            </thead>
            <tbody>
              {facts.campaigns.map((c: FlipkartAdsCampaign) => (
                <tr key={c.campaignId} className="border-t border-[var(--line)]">
                  <td className="px-3 py-2 text-[var(--ink)]">
                    {c.campaignName}
                    <span className="ml-1 text-xs text-[var(--ink-3)]">
                      {c.skus} product{c.skus === 1 ? '' : 's'}
                    </span>
                  </td>
                  <td className={`${TD} text-right font-medium text-[var(--ink)]`}>{formatCurrencyFull(c.spend)}</td>
                  <td className={`${TD} text-right`}>{formatNumber(c.views)}</td>
                  <td className={`${TD} text-right`}>{formatNumber(c.clicks)}</td>
                  <td className={`${TD} text-right`}>{c.views > 0 ? formatPercent((c.clicks / c.views) * 100, 2) : '—'}</td>
                  <td className={`${TD} text-right`}>{c.clicks > 0 ? formatCurrencyFull(c.spend / c.clicks) : '—'}</td>
                  <td className={`${TD} text-right`}>{formatNumber(unitsOf(c))}</td>
                  <td className={`${TD} text-right`}>
                    {unitsOf(c) > 0 ? formatPercent((c.unitsDirect / unitsOf(c)) * 100) : '—'}
                  </td>
                  <td className={`${TD} text-right`}>{formatCurrencyCompact(c.revenue)}</td>
                  <td className={`${TD} text-right`}>{c.revenue > 0 ? formatPercent((c.spend / c.revenue) * 100) : 'no sale'}</td>
                  <RoasCell spend={c.spend} revenue={c.revenue} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-[var(--line)] px-4 py-2 text-xs text-[var(--ink-3)]">
          Direct is the share of units that were the advertised product itself; the rest is anything else of ours the
          shopper bought after the click. A return under 2.5x is amber because contribution margin on this channel
          runs near 40% — below that the campaign costs more than the sale earns.
          {underwater.length > 0 && ` ${underwater.length} campaign${underwater.length === 1 ? '' : 's'} returned less than ${underwater.length === 1 ? 'it' : 'they'} cost, on ${formatCurrencyFull(wasted)} of spend.`}
        </p>
      </section>

      <section className={CARD}>
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--line)] px-4 py-2.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-3)]">
            Products — top {products.length} of {facts.skus.length} by spend
          </h3>
          <p className="text-xs text-[var(--ink-3)]">Flipkart's own SKU codes, as the report writes them</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--surface-2)]">
              <tr>
                <th className={`${TH} text-left`}>SKU</th>
                <th className={`${TH} text-right`}>Spend</th>
                <th className={`${TH} text-right`}>Share</th>
                <th className={`${TH} text-right`}>Clicks</th>
                <th className={`${TH} text-right`}>CPC</th>
                <th className={`${TH} text-right`}>Units</th>
                <th className={`${TH} text-right`}>Revenue</th>
                <th className={`${TH} text-right`}>ACoS</th>
                <th className={`${TH} text-right`}>ROAS</th>
              </tr>
            </thead>
            <tbody>
              {products.map((s: FlipkartAdsSku) => (
                <tr key={s.skuId} className="border-t border-[var(--line)]">
                  <td className="px-3 py-2 text-[var(--ink)]" title={s.productName}>
                    {s.skuId}
                    <span className="ml-1 text-xs text-[var(--ink-3)]">
                      {s.campaigns} campaign{s.campaigns === 1 ? '' : 's'}
                    </span>
                  </td>
                  <td className={`${TD} text-right font-medium text-[var(--ink)]`}>{formatCurrencyFull(s.spend)}</td>
                  <td className={`${TD} text-right`}>{facts.spend > 0 ? formatPercent((s.spend / facts.spend) * 100) : '—'}</td>
                  <td className={`${TD} text-right`}>{formatNumber(s.clicks)}</td>
                  <td className={`${TD} text-right`}>{s.clicks > 0 ? formatCurrencyFull(s.spend / s.clicks) : '—'}</td>
                  <td className={`${TD} text-right`}>{formatNumber(unitsOf(s))}</td>
                  <td className={`${TD} text-right`}>{formatCurrencyCompact(s.revenue)}</td>
                  <td className={`${TD} text-right`}>{s.revenue > 0 ? formatPercent((s.spend / s.revenue) * 100) : 'no sale'}</td>
                  <RoasCell spend={s.spend} revenue={s.revenue} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-[var(--line)] px-4 py-2 text-xs text-[var(--ink-3)]">
          One product can be advertised by several campaigns, so these rows add to the month's spend while the
          campaign rows above add to the same total a different way. The revenue is what Flipkart attributes to the
          ad, not the product's total sales.
        </p>
      </section>
    </>
  )
}

/**
 * The off-platform half: one row per Flipkart listing.
 *
 * Keyed on the listing id, not the title — the same listing is renamed during
 * a month and appears under two names, and its rows are summed against the id.
 * There is no SKU code in this report, so these cannot yet be set against the
 * margin the product earns.
 */
function GoogleAdsSection({ facts }: { facts: FlipkartGoogleAdsFacts }) {
  const shown = facts.products.slice(0, PRODUCTS_SHOWN)
  const noSale = facts.products.filter((p) => p.cost > 0 && p.sales === 0)
  const noSaleCost = noSale.reduce((sum, p) => sum + p.cost, 0)

  return (
    <section className={CARD}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--line)] px-4 py-2.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-3)]">
          Google Ads — top {shown.length} of {facts.products.length} listings by cost
        </h3>
        <p className="text-xs text-[var(--ink-3)]">
          {facts.cost > 0 ? `${(facts.sales / facts.cost).toFixed(2)}x overall` : '—'}
          {facts.sales > 0 && ` · ACoS ${formatPercent((facts.cost / facts.sales) * 100)}`}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-2)]">
            <tr>
              <th className={`${TH} text-left`}>Listing</th>
              <th className={`${TH} text-right`}>Cost</th>
              <th className={`${TH} text-right`}>Share</th>
              <th className={`${TH} text-right`}>Views</th>
              <th className={`${TH} text-right`}>Clicks</th>
              <th className={`${TH} text-right`}>CTR</th>
              <th className={`${TH} text-right`}>CPC</th>
              <th className={`${TH} text-right`}>Units</th>
              <th className={`${TH} text-right`}>Sales</th>
              <th className={`${TH} text-right`}>ACoS</th>
              <th className={`${TH} text-right`}>ROAS</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p: FlipkartGoogleAdsProduct) => (
              <tr key={p.productItemId} className="border-t border-[var(--line)]">
                <td className="px-3 py-2 text-[var(--ink)]" title={p.productItemId}>
                  {p.productTitle.length > 64 ? `${p.productTitle.slice(0, 64)}…` : p.productTitle}
                  {p.otherTitles !== undefined && (
                    <span className="ml-1 text-xs text-[var(--ink-3)]">renamed this month</span>
                  )}
                </td>
                <td className={`${TD} text-right font-medium text-[var(--ink)]`}>{formatCurrencyFull(p.cost)}</td>
                <td className={`${TD} text-right`}>{facts.cost > 0 ? formatPercent((p.cost / facts.cost) * 100) : '—'}</td>
                <td className={`${TD} text-right`}>{formatNumber(p.views)}</td>
                <td className={`${TD} text-right`}>{formatNumber(p.clicks)}</td>
                <td className={`${TD} text-right`}>{p.views > 0 ? formatPercent((p.clicks / p.views) * 100, 2) : '—'}</td>
                <td className={`${TD} text-right`}>{p.clicks > 0 ? formatCurrencyFull(p.cost / p.clicks) : '—'}</td>
                <td className={`${TD} text-right`}>{formatNumber(p.units)}</td>
                <td className={`${TD} text-right`}>{formatCurrencyCompact(p.sales)}</td>
                <td className={`${TD} text-right`}>{p.sales > 0 ? formatPercent((p.cost / p.sales) * 100) : 'no sale'}</td>
                <RoasCell spend={p.cost} revenue={p.sales} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-[var(--line)] px-4 py-2 text-xs text-[var(--ink-3)]">
        Flipkart's off-platform spend, on Google, billed back on the P&amp;L as its own line. The report names
        listings rather than SKUs, so this cannot yet be set against a product's margin.
        {noSale.length > 0 && ` ${noSale.length} listing${noSale.length === 1 ? '' : 's'} returned no attributed sales at all, costing ${formatCurrencyFull(noSaleCost)}.`}
        {facts.renamedListings > 0 && ` ${facts.renamedListings} listing${facts.renamedListings === 1 ? '' : 's'} were renamed during the period; their rows are summed against the listing id.`}
      </p>
    </section>
  )
}
