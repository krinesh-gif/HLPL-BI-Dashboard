import type { BusinessChannelId } from '@/config/channels'
import type { PnlLineValues } from '@/data/models'
import { DEFAULT_FX_INR, type FxRatesInr } from '@/data/fxRates'
import { computeSubtotals } from './subtotals'
import { amazonAeToCanonicalBuckets } from './nativePnl/amazonAe'
import { amazonInSellerToCanonicalBuckets } from './nativePnl/amazonInSeller'
import { amazonInSellerExportToCanonicalBuckets } from './nativePnl/amazonInSellerExport'
import { amazonInVendorToCanonicalBuckets } from './nativePnl/amazonInVendor'
import { amazonUsaToCanonicalBuckets } from './nativePnl/amazonUsa'
import { blinkitToCanonicalBuckets } from './nativePnl/blinkit'
import { flipkartToCanonicalBuckets } from './nativePnl/flipkart'
import { meeshoToCanonicalBuckets } from './nativePnl/meesho'
import { myntraToCanonicalBuckets } from './nativePnl/myntra'
import { nykaaToCanonicalBuckets } from './nativePnl/nykaa'
import { purplleToCanonicalBuckets } from './nativePnl/purplle'
import { swiggyInstamartToCanonicalBuckets } from './nativePnl/swiggyInstamart'
import type { ChannelFactsStore } from './channelFactsStore'

/**
 * What a channel sold in a month, from the channel's own statement.
 *
 * One job, and it exists because of what the lack of it cost: the month's
 * fixed expenses are shared out by each channel's contribution to sales, and
 * that share was measured from uploaded order rows. A channel whose figures
 * come from a statement rather than from order rows therefore counted as
 * having sold nothing — and Amazon India, the largest channel in the company,
 * carried ₹0 of rent, salaries and software while Flipkart, Myntra and Meesho
 * carried its share between them.
 *
 * Every channel's statement is read through the same `*ToCanonicalBuckets`
 * function its P&L is built from, so this figure is the one on the P&L rather
 * than a second opinion about the month. Net sales is the subtotal every P&L
 * here shares: gross less discounts, returns and revenue adjustments.
 *
 * Returns null where the channel has no statement for the month, which is the
 * signal to fall back to its order rows. Costs are irrelevant to the figure,
 * so nothing here needs COGS, advertising or an allocation — which is also
 * what keeps this out of the cycle those inputs would create.
 */
export function statementNetSales(
  channel: BusinessChannelId,
  month: string,
  facts: ChannelFactsStore,
  fxRate: FxRatesInr = DEFAULT_FX_INR,
): number | null {
  return statementRevenue(channel, month, facts, fxRate)?.netSales ?? null
}

/** The revenue lines of a channel's statement, in rupees. */
export interface StatementRevenue {
  grossSales: number
  discounts: number
  returnsValue: number
  netSales: number
}

export function statementRevenue(
  channel: BusinessChannelId,
  month: string,
  facts: ChannelFactsStore,
  fxRate: FxRatesInr = DEFAULT_FX_INR,
): StatementRevenue | null {
  const buckets = statementBuckets(channel, month, facts, fxRate)
  if (!buckets) return null
  const lines = computeSubtotals(buckets)
  return {
    grossSales: lines.grossSales ?? 0,
    discounts: lines.discounts ?? 0,
    // The revenue adjustment is output GST on the channels that state it:
    // money collected on a sale and owed onward, which was never revenue. It
    // belongs with returns rather than on a line of its own here, so that
    // gross − discounts − returns is net on this figure as it is everywhere.
    returnsValue: (lines.returns ?? 0) + (lines.otherRevenueAdj ?? 0),
    netSales: lines.netSales ?? 0,
  }
}

/**
 * How each channel's month is read, one entry per channel.
 *
 * A `Record` over every `BusinessChannelId` rather than a switch, and that is
 * the point: a channel added to the registry will not compile until somebody
 * has said how its statement is read here. The fixed-expense allocation
 * divides the month by these figures, so a channel missing from this file does
 * not merely lack a feature — it carries none of the company's rent, and the
 * channels that are here pay its share. That is what happened to Amazon India,
 * and it is the kind of silence a type can prevent.
 *
 * A channel with no statement of its own returns null and is measured from its
 * order rows instead, which is stated explicitly rather than left to a default
 * branch.
 */
interface StatementScope {
  month: string
  facts: ChannelFactsStore
  fxRate: FxRatesInr
}

const forMonth = <T extends { month: string }>(list: T[] | undefined, month: string): T | undefined =>
  list?.find((f) => f.month === month)

const STATEMENT_READERS: Record<BusinessChannelId, (scope: StatementScope) => PnlLineValues | null> = {
  flipkart: ({ facts, month }) => {
    const f = forMonth(facts.flipkartFacts, month)
    return f ? flipkartToCanonicalBuckets(f) : null
  },
  myntra: ({ facts, month }) => {
    const f = forMonth(facts.myntraFacts, month)
    return f ? myntraToCanonicalBuckets(f) : null
  },
  nykaa: ({ facts, month }) => {
    const f = forMonth(facts.nykaaFacts, month)
    return f ? nykaaToCanonicalBuckets(f) : null
  },
  // Meesho's report is stored on both of the calendars it can be cut on, and
  // the company reads the order basis: the month a sale was made is the month
  // it is judged in, here as on every other channel. The payment-basis rows
  // stay in the table as the record of the file, unread.
  meesho: ({ facts, month }) => {
    const f = facts.meeshoFacts.find(
      (x) => x.month === month && x.basis === 'order' && x.schemaVersion === 3,
    )
    return f ? meeshoToCanonicalBuckets(f) : null
  },
  blinkit: ({ facts, month }) => {
    const f = forMonth(facts.blinkitFacts, month)
    return f ? blinkitToCanonicalBuckets(f) : null
  },
  purplle: ({ facts, month }) => {
    const f = forMonth(facts.purplleFacts, month)
    return f ? purplleToCanonicalBuckets(f) : null
  },
  swiggy_instamart: ({ facts, month }) => {
    const f = forMonth(facts.swiggyInstamartFacts, month)
    return f ? swiggyInstamartToCanonicalBuckets(f) : null
  },
  // The five channels that arrived in August send a sales report and nothing
  // else: no settlement, no payout, no fee file. Their months are measured
  // from their own order rows, which is what the null says, and they start
  // carrying their share of the company's fixed expenses the moment those
  // rows exist. A payout statement from any of them turns this into a reader
  // like the ones above and nothing else has to change.
  snapdeal: () => null,
  pharmeasy: () => null,
  tata_1mg: () => null,
  firstcry: () => null,
  walmart_us: () => null,
  // The website's month is its Unicommerce order rows: money and delivery
  // outcome in one file, which is more than a settlement would give it.
  d2c_website: () => null,
  jiomart: () => null,
  // Smytten's own sales report states the commission on every line, so its
  // month is measured from those rows and not from a separate statement.
  smytten: () => null,
  amazon_us: ({ facts, month, fxRate }) => {
    const f = forMonth(facts.amazonUsaFacts, month)
    return f ? amazonUsaToCanonicalBuckets(f, fxRate.USD) : null
  },
  amazon_ae: ({ facts, month, fxRate }) => {
    const f = forMonth(facts.amazonAeFacts, month)
    return f ? amazonAeToCanonicalBuckets(f, fxRate.AED, 0) : null
  },
  // Amazon India is one channel over two businesses, and the fixed expenses
  // are allocated to the channel — so both halves count towards its share,
  // added the way the P&L adds them. The marketplace half is the export where
  // there is one and the settlement otherwise, never both: they are two
  // readings of the same trading.
  amazon_in: ({ facts, month }) => {
    const vendor = forMonth(facts.amazonInVendorFacts, month)
    const exported = forMonth(facts.amazonInSkuFeeFacts, month)
    const settlement = forMonth(facts.amazonInSellerFacts, month)
    const marketplace: PnlLineValues | null = exported
      ? amazonInSellerExportToCanonicalBuckets(exported)
      : settlement
        ? amazonInSellerToCanonicalBuckets(settlement)
        : null
    const wholesale = vendor ? amazonInVendorToCanonicalBuckets(vendor) : null
    if (!wholesale) return marketplace
    if (!marketplace) return wholesale
    return addBuckets(wholesale, marketplace)
  },
}

/** The channels this module can read a statement for — every one of them. */
export const STATEMENT_CHANNELS = Object.keys(STATEMENT_READERS) as BusinessChannelId[]

/** The month in canonical buckets, from whichever statement the channel has. */
function statementBuckets(
  channel: BusinessChannelId,
  month: string,
  facts: ChannelFactsStore,
  fxRate: FxRatesInr,
): PnlLineValues | null {
  return STATEMENT_READERS[channel]({ month, facts, fxRate })
}

/**
 * What the channel's own statement charges for advertising this month, in
 * rupees — or null where the statement does not state any.
 *
 * Some marketplaces bill advertising inside the statement they settle on:
 * Flipkart's workbook has a Flipkart Ads line and a Google Ads line, Amazon
 * USA's export has a Sponsored Products charge per SKU. That is the figure
 * the P&L charges, because it is the money the platform actually took. The
 * campaign report is a different thing — the platform's measurement of what
 * the campaigns did — and it is cut on campaign dates rather than on the
 * billing cycle, so the two disagree by a month's worth either way while
 * agreeing over a period.
 *
 * Read through the same canonical buckets the P&L is built from, so a channel
 * that starts carrying advertising in its statement is picked up here without
 * this module learning its name. Every marketing bucket counts: Flipkart's
 * Google Ads is performance marketing rather than marketplace advertising,
 * and the two are one line on the P&L.
 *
 * Zero reads as "this statement does not carry advertising" and returns null.
 * Most statements have no such column at all, and a zero that outranked a real
 * campaign report would wipe out the spend on every one of them.
 */
export function statementAdSpend(
  channel: BusinessChannelId,
  month: string,
  facts: ChannelFactsStore,
  fxRate: FxRatesInr = DEFAULT_FX_INR,
): number | null {
  const buckets = statementBuckets(channel, month, facts, fxRate)
  if (!buckets) return null
  const total =
    (buckets.ads ?? 0) + (buckets.performanceMarketing ?? 0) + (buckets.otherMarketing ?? 0)
  return total === 0 ? null : total
}

function addBuckets(a: PnlLineValues, b: PnlLineValues): PnlLineValues {
  const out: PnlLineValues = { ...a }
  for (const [key, value] of Object.entries(b) as [keyof PnlLineValues, number | undefined][]) {
    if (typeof value !== 'number') continue
    out[key] = (out[key] ?? 0) + value
  }
  return out
}
