import type { AmazonInVendorFacts, PnlLineValues } from '@/data/models'
import type { NativeLineDef, NativeLineValues } from './types'

/**
 * Amazon India Vendor Central, built from the NPPM file.
 *
 * The other half of Amazon India, and a different kind of business from the
 * one beside it. Seller Central sells to shoppers through Amazon and pays
 * Amazon fees for the privilege. This sells *to* RK World Infocom Pvt Ltd,
 * which resells; there are no referral or fulfilment fees here because
 * nothing of ours is being fulfilled — it is wholesale.
 *
 * Three things follow from that, and they are why this cannot share a
 * waterfall with the marketplace side.
 *
 *  1. THE REVENUE IS AN INVOICE, NOT A SETTLEMENT. RK World realises a retail
 *     value on the goods and keeps a contracted margin of it; what is left is
 *     what they pay us. So the statement starts at their retail value and
 *     takes their margin off, and the result is the month's invoice.
 *
 *  2. THE MARGIN IS A TRADE DISCOUNT, NOT A COMMISSION. It is a price, agreed
 *     in advance on the selling price, and it rolls up into `discounts` —
 *     never into `marketplaceCommission`, which would put a wholesale price
 *     cut beside Flipkart's referral fee and make both unreadable. The same
 *     call this build already makes for Nykaa's B2B margin.
 *
 *  3. THE MARGIN IS NOT ALWAYS ACHIEVED. When RK World drops the price to
 *     match another marketplace, their realised margin falls below the
 *     contract and the shortfall is billed back as contra-COGS. That is a
 *     real cost of the month — ₹7.18 lakh across April to September — and it
 *     is charged here rather than netted into the price, because it arrives
 *     as a separate claim, lands after the invoices, and is negotiable:
 *     September's ₹55,045.91 settled at ₹50,000.
 *
 * Everything above is ex-GST. Established from the files rather than assumed,
 * and recorded on `AmazonInVendorFacts`, so there is no output-GST line to
 * take off the top.
 */

/** COGS for the month, priced from the ASINs the file lists. */
export interface VendorCogs {
  priced: number
  unpriced: number
  /** ASINs with no cost to price them from, which is most of them today. */
  uncostedAsins: number
  uncostedUnits: number
}

export const EMPTY_VENDOR_COGS: VendorCogs = { priced: 0, unpriced: 0, uncostedAsins: 0, uncostedUnits: 0 }

export const AMAZON_IN_VENDOR_LINE_DEFS: NativeLineDef[] = [
  { key: 'netShippedGms', label: 'Retail value realised by RK World', section: 'SALES', kind: 'input', note: 'Ex-GST — the tax is charged on top of this' },
  { key: 'tradeMargin', label: '(−) trade margin to RK World', section: 'SALES', kind: 'input' },
  { key: 'marginAchievedPct', label: 'Margin achieved', section: 'SALES', kind: 'percent', note: 'Of the retail value, which is what the contract is on' },
  { key: 'marginClosedPct', label: 'Margin contracted', section: 'SALES', kind: 'percent', note: 'Renegotiated: 31% to June, 32% from August' },
  { key: 'invoiceValue', label: 'NET REVENUE (ex-GST)', section: 'SALES', kind: 'subtotal', note: 'What RK World pays, and the denominator for every %' },

  { key: 'cogsPriced', label: 'COGS — priced ASINs', section: 'COST OF GOODS SOLD', kind: 'input' },
  { key: 'cogsUnpriced', label: 'COGS — unpriced ASINs (est.)', section: 'COST OF GOODS SOLD', kind: 'input', note: '⚠ estimate — goes to zero once every ASIN is linked to a SKU' },
  { key: 'totalCogs', label: '(−) COGS', section: 'COST OF GOODS SOLD', kind: 'subtotal' },
  { key: 'cm1', label: 'GROSS MARGIN (CM1)', section: 'COST OF GOODS SOLD', kind: 'subtotal' },
  { key: 'cm1Pct', label: 'CM1 %', section: 'COST OF GOODS SOLD', kind: 'percent' },

  { key: 'contraCogs', label: '(−) contra-COGS margin support', section: 'AMAZON CHARGES', kind: 'input', fee: 'otherFees', note: 'The shortfall against the contracted margin, billed back after the invoices' },
  { key: 'ixd', label: '(−) inward cross-dock (IXD)', section: 'AMAZON CHARGES', kind: 'input', fee: 'fulfilment', note: 'A flat rate on every unit unpacked at the warehouse — not on units sold' },
  { key: 'totalCharges', label: 'Total Amazon charges', section: 'AMAZON CHARGES', kind: 'subtotal' },
  { key: 'cm2', label: 'CHANNEL MARGIN (CM2)', section: 'AMAZON CHARGES', kind: 'subtotal', note: 'Is this wholesale relationship worth having?' },
  { key: 'cm2Pct', label: 'CM2 %', section: 'AMAZON CHARGES', kind: 'percent' },

  { key: 'ads', label: '(−) Allocated advertising', section: 'ADVERTISING', kind: 'input', fee: 'advertising', note: 'A share of Amazon India’s spend — one account lifts both halves' },
  { key: 'cm3', label: 'CONTRIBUTION MARGIN (CM3)', section: 'ADVERTISING', kind: 'subtotal', note: '⭐ the number to manage this on' },
  { key: 'cm3Pct', label: 'CM3 %', section: 'ADVERTISING', kind: 'percent' },

  { key: 'otherCosts', label: '(−) Allocated Fixed Expenses', section: 'FIXED EXPENSES', kind: 'input' },
  { key: 'cm4', label: 'NET PROFIT (CM4)', section: 'FIXED EXPENSES', kind: 'subtotal' },
  { key: 'cm4Pct', label: 'Net Profit %', section: 'FIXED EXPENSES', kind: 'percent' },

  { key: 'unitsShipped', label: 'Units shipped', section: 'THE MONTH IN UNITS', kind: 'count' },
  { key: 'unitsUnpacked', label: 'Units unpacked at the warehouse', section: 'THE MONTH IN UNITS', kind: 'count', hideWhenZero: true, note: 'The inbound count the cross-dock charge is on' },
  { key: 'priceMatchShortfall', label: 'Price-match shortfall', section: 'THE MONTH IN UNITS', kind: 'input', hideWhenZero: true, note: 'What the price matching cost against the agreed price — the reason for the contra-COGS above' },
]

/**
 * What the month actually costs, in rupees, from the claim and whatever it
 * settled at.
 *
 * The claim is what the file bills; the final amount is what was agreed after
 * deductions. Where the file records a settlement, that is what was paid and
 * the claim is history.
 */
export function vendorContraCogs(facts: AmazonInVendorFacts): number {
  return facts.ccogsFinal ?? facts.ccogsClaimed
}

/**
 * A deduction, shown negative.
 *
 * Negating zero gives -0, which is equal to 0 everywhere it is compared and
 * prints as "0" everywhere it is formatted — but it is a different value to
 * `Object.is`, and a statement that stores one has a line that says minus
 * nothing. Charges that are genuinely absent in a month, like the cross-dock
 * before its file arrives, are exactly where it would appear.
 */
const less = (v: number): number => (v === 0 ? 0 : -v)

export function computeAmazonInVendorPnl(
  facts: AmazonInVendorFacts,
  cogs: VendorCogs = EMPTY_VENDOR_COGS,
  ads = 0,
): NativeLineValues {
  // Net revenue is the invoice, because that is what was billed. Contra-COGS
  // and the cross-dock sit below it as charges: both arrive separately from
  // the invoice and one of them is negotiated after the fact. Keeping them
  // there rather than in the price is also what makes this statement's CM1
  // the same figure as the gross profit the Master P&L rolls up.
  const contraCogs = vendorContraCogs(facts)
  const netRevenue = facts.invoiceValue
  const totalCogs = cogs.priced + cogs.unpriced
  const cm1 = netRevenue - totalCogs
  const ixd = facts.ixd?.charge ?? 0
  const totalCharges = contraCogs + ixd
  const cm2 = cm1 - totalCharges
  const cm3 = cm2 - ads
  const pct = (v: number): number => (netRevenue !== 0 ? (v / netRevenue) * 100 : 0)

  return {
    netShippedGms: facts.netShippedGms,
    tradeMargin: less(facts.netPpm),
    marginAchievedPct: facts.marginAchievedPct * 100,
    marginClosedPct: facts.marginClosedPct * 100,
    invoiceValue: facts.invoiceValue,
    netRevenue,

    cogsPriced: less(cogs.priced),
    cogsUnpriced: less(cogs.unpriced),
    totalCogs: less(totalCogs),
    cm1,
    cm1Pct: pct(cm1),

    contraCogs: less(contraCogs),
    ixd: less(ixd),
    totalCharges: less(totalCharges),
    cm2,
    cm2Pct: pct(cm2),

    ads: less(ads),
    cm3,
    cm3Pct: pct(cm3),

    otherCosts: 0, // filled in by applyAmazonInVendorOtherCosts
    cm4: cm3,
    cm4Pct: pct(cm3),

    unitsShipped: facts.unitsShipped,
    unitsUnpacked: facts.ixd?.unitsUnpacked ?? 0,
    priceMatchShortfall: facts.priceMatchShortfall ?? 0,
  }
}

export function applyAmazonInVendorOtherCosts(computed: NativeLineValues, otherCosts: number): NativeLineValues {
  const cm4 = computed.cm3 - otherCosts
  const netRevenue = computed.netRevenue
  return { ...computed, otherCosts: less(otherCosts), cm4, cm4Pct: netRevenue !== 0 ? (cm4 / netRevenue) * 100 : 0 }
}

/**
 * The same month in the buckets the Master P&L rolls up.
 *
 * Gross Sales is the retail value and the trade margin is a discount off it,
 * so net sales comes to the invoice — which is the figure that ties to what
 * was billed. Contra-COGS and the cross-dock charge are charges rather than
 * price, because both arrive separately from the invoice and one of them is
 * negotiated after the fact.
 */
export function amazonInVendorToCanonicalBuckets(
  facts: AmazonInVendorFacts,
  cogs: VendorCogs = EMPTY_VENDOR_COGS,
  ads = 0,
): PnlLineValues {
  return {
    grossSales: facts.netShippedGms,
    discounts: facts.netPpm,
    returns: 0,
    // Already ex-GST, so there is nothing to take off the top here.
    otherRevenueAdj: 0,
    cogs: cogs.priced + cogs.unpriced,
    // No commission: a wholesale price cut is not a marketplace fee, however
    // similar the arithmetic looks.
    marketplaceCommission: 0,
    fulfilment: facts.ixd?.charge ?? 0,
    shipping: 0,
    collectionFees: 0,
    rtoCharges: 0,
    returnCharges: 0,
    otherMarketplaceCharges: vendorContraCogs(facts),
    ads,
    performanceMarketing: 0,
    otherMarketing: 0,
  }
}
