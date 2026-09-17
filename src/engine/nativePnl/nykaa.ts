import { NYKAA_ASSUMPTIONS } from '@/config/nativePnlAssumptions'
import type { NykaaPnlFacts, PnlLineValues } from '@/data/models'
import type { NativeLineDef, NativeLineValues } from './types'

/**
 * Nykaa's P&L — a B2B statement, not a marketplace one.
 *
 * Every other channel in this dashboard sells *through* the platform: the
 * shopper's money is our revenue and the platform's fee is our cost. Nykaa is
 * the other shape. Nykaa buys the goods and resells them, and its margin is a
 * flat percentage of MRP. Two consequences run through this whole statement:
 *
 *  1. REVENUE IS BUILT FROM MRP, NOT FROM THE SALE PRICE. What Nykaa owes us
 *     is MRP less its margin. Whether Nykaa then sells at full price or
 *     discounts hard is Nykaa's decision, funded by Nykaa, and does not change
 *     the invoice. Building revenue off the sale price would have made our
 *     turnover swing with somebody else's promotion calendar — August's
 *     shoppers paid 19.0 lakh against an MRP of 26.9 lakh, so the error would
 *     have been nearly a third of the month.
 *
 *  2. THE DISCOUNTS IN THE FILES ARE MEMOS. The platform discount inside the
 *     sale price and the coupon value in the Cart Rule file are both Nykaa's
 *     spend. They are shown, because knowing how hard the channel is being
 *     discounted matters, and they are in no total.
 *
 * MRP is a tax-inclusive price by law, so the realisation is tax-inclusive
 * too; output GST comes off once to state revenue, the same way it does for
 * Meesho and Myntra.
 */
export const NYKAA_LINE_DEFS: NativeLineDef[] = [
  { key: 'grossSalesMrp', label: 'Gross Sales (at MRP)', section: 'SALES — AT MRP', kind: 'input' },
  { key: 'returnsMrp', label: 'Less: Returns (at MRP)', section: 'SALES — AT MRP', kind: 'input' },
  { key: 'netSalesMrp', label: 'NET SALES AT MRP', section: 'SALES — AT MRP', kind: 'subtotal', note: 'what Nykaa owes against, before its margin' },

  { key: 'commissionPct', label: "Nykaa's margin, % of MRP", section: "NYKAA'S MARGIN", kind: 'percent' },
  { key: 'commission', label: "Less: Nykaa commission on MRP", section: "NYKAA'S MARGIN", kind: 'input' },
  { key: 'netRealisationInclGst', label: 'NET REALISATION (incl. GST)', section: "NYKAA'S MARGIN", kind: 'subtotal', note: 'what Nykaa pays us' },

  { key: 'outputGst', label: 'Less: Output GST', section: 'REVENUE', kind: 'input', note: 'MRP is tax-inclusive, so the realisation is too' },
  { key: 'netRevenueExGst', label: 'NET REVENUE (ex-GST)', section: 'REVENUE', kind: 'subtotal', note: '⭐ denominator for every %' },
  {
    key: 'realisationPctOfMrp', label: 'Realisation, % of MRP (ex-GST)', section: 'REVENUE', kind: 'percent',
    note: "52.54% at 38% margin and 18% GST — the 'Cost to Nykaa' line of the agreement's margin table",
  },

  { key: 'cogsPriced', label: 'Less: COGS — priced SKUs', section: 'COST OF GOODS SOLD', kind: 'input' },
  { key: 'cogsUnpriced', label: 'Less: COGS — unpriced SKUs (est.)', section: 'COST OF GOODS SOLD', kind: 'input', note: '⚠ estimate — goes to zero once every SKU is mapped and priced' },
  { key: 'totalCogs', label: 'Total COGS', section: 'COST OF GOODS SOLD', kind: 'subtotal' },
  { key: 'cm1', label: 'GROSS MARGIN (CM1)', section: 'COST OF GOODS SOLD', kind: 'subtotal' },
  { key: 'cm1Pct', label: 'CM1 %', section: 'COST OF GOODS SOLD', kind: 'percent' },

  { key: 'nykaaAds', label: 'Less: Nykaa Ads / MI', section: 'ADVERTISING', kind: 'input', note: 'Manual entry — billed by invoice, not reported' },
  { key: 'cm2', label: 'CONTRIBUTION MARGIN (CM2)', section: 'ADVERTISING', kind: 'subtotal', note: '⭐ the number to manage the channel on' },
  { key: 'cm2Pct', label: 'CM2 %', section: 'ADVERTISING', kind: 'percent' },

  { key: 'otherCosts', label: 'Less: Other Costs (allocated fixed expenses)', section: 'YOUR OTHER COSTS', kind: 'input' },
  { key: 'cm3', label: 'NET PROFIT (CM3)', section: 'YOUR OTHER COSTS', kind: 'subtotal' },
  { key: 'cm3Pct', label: 'Net Profit %', section: 'YOUR OTHER COSTS', kind: 'percent' },

  {
    key: 'customerPaidValue', label: 'Value shoppers actually paid', section: 'MEMO — NYKAA\'S PRICING, NOT OUR REVENUE',
    kind: 'input', note: 'Σ final_sp — below MRP because Nykaa discounts; does not change what Nykaa owes us',
  },
  {
    key: 'platformDiscount', label: 'Platform discount inside that price', section: 'MEMO — NYKAA\'S PRICING, NOT OUR REVENUE',
    kind: 'input', hideWhenZero: true, note: 'Σ row_discount — funded by Nykaa',
  },
  {
    key: 'nykaaFundedCoupon', label: 'Coupon discount (Cart Rule file)', section: 'MEMO — NYKAA\'S PRICING, NOT OUR REVENUE',
    kind: 'input', hideWhenZero: true, note: 'COUPON_NYKAA_FUNDED — Nykaa\'s cost, never charged to us',
  },
]

/** Nykaa's margin for a month: the month's own rate where it has one, else the
 * standing assumption, so correcting that restates every month at once. */
export function nykaaCommissionPct(facts: NykaaPnlFacts): number {
  return facts.commissionPctOfMrp ?? NYKAA_ASSUMPTIONS.commissionPctOfMrp
}

export function nykaaOutputGstPct(facts: NykaaPnlFacts): number {
  return facts.outputGstPct ?? NYKAA_ASSUMPTIONS.outputGstPct
}

/** What Nykaa pays us, and what is left of it after tax. Both are needed in
 * two places, so they are derived once here. */
export function nykaaRevenue(facts: NykaaPnlFacts): {
  commission: number
  realisationInclGst: number
  outputGst: number
  netRevenueExGst: number
} {
  const commission = facts.netSalesMrp * (nykaaCommissionPct(facts) / 100)
  const realisationInclGst = facts.netSalesMrp - commission
  const gstPct = nykaaOutputGstPct(facts)
  // The realisation carries the tax inside it, so the tax is the inclusive
  // fraction — 18/118, not 18/100. Taking 18% of a tax-inclusive figure would
  // over-deduct by about 2.7% of revenue every month.
  const outputGst = gstPct > 0 ? realisationInclGst * (gstPct / (100 + gstPct)) : 0
  return { commission, realisationInclGst, outputGst, netRevenueExGst: realisationInclGst - outputGst }
}

export function computeNykaaPnl(facts: NykaaPnlFacts): NativeLineValues {
  const { commission, realisationInclGst, outputGst, netRevenueExGst } = nykaaRevenue(facts)
  const totalCogs = facts.cogsPriced + facts.cogsUnpriced
  const cm1 = netRevenueExGst - totalCogs
  const cm2 = cm1 - facts.nykaaAds
  const pct = (v: number): number => (netRevenueExGst !== 0 ? (v / netRevenueExGst) * 100 : 0)
  // Every month's own check against the contract: at 38% margin and 18% GST
  // this must read 52.54%, which is the agreement's "Cost to Nykaa" line.
  const realisationPctOfMrp = facts.netSalesMrp !== 0 ? (netRevenueExGst / facts.netSalesMrp) * 100 : 0

  return {
    grossSalesMrp: facts.grossSalesMrp,
    returnsMrp: -facts.returnsMrp,
    netSalesMrp: facts.netSalesMrp,

    commissionPct: nykaaCommissionPct(facts),
    commission: -commission,
    netRealisationInclGst: realisationInclGst,

    outputGst: -outputGst,
    netRevenueExGst,
    realisationPctOfMrp,

    cogsPriced: -facts.cogsPriced,
    cogsUnpriced: -facts.cogsUnpriced,
    totalCogs: -totalCogs,
    cm1,
    cm1Pct: pct(cm1),

    nykaaAds: -facts.nykaaAds,
    cm2,
    cm2Pct: pct(cm2),

    otherCosts: 0, // filled in by applyNykaaOtherCosts once the allocation is known
    cm3: cm2,
    cm3Pct: pct(cm2),

    customerPaidValue: facts.customerPaidValue,
    platformDiscount: facts.platformDiscount,
    nykaaFundedCoupon: facts.nykaaFundedCoupon,
  }
}

/** Applies this month's allocated share of fixed expenses to reach Net Profit. */
export function applyNykaaOtherCosts(computed: NativeLineValues, otherCosts: number): NativeLineValues {
  const cm3 = computed.cm2 - otherCosts
  const netRevenueExGst = computed.netRevenueExGst
  return { ...computed, otherCosts: -otherCosts, cm3, cm3Pct: netRevenueExGst !== 0 ? (cm3 / netRevenueExGst) * 100 : 0 }
}

/**
 * The same month in the generic buckets the Master P&L rolls up.
 *
 * Gross Sales is MRP, because that is the price the channel trades on and the
 * scale it should be read at. Nykaa's margin sits in `discounts`, which is
 * what a wholesale margin actually is: a trade discount off MRP. That is not a
 * presentational choice — it is what makes the two views of this month agree.
 *
 * Booking the margin as a marketplace fee instead left it *below* the revenue
 * line, so Net Sales came out at 24.35 lakh against the statement's 14.13
 * lakh, and the same August reported a gross margin of 72.4% on the Master
 * P&L and a CM1 of 52.4% on Nykaa's own page. A trade margin is not a cost of
 * selling that could be negotiated per order; it is the price. It belongs
 * above the line, and once it is there both reports read 52.4%.
 *
 * The memo figures appear nowhere: the shopper's price and the discounts
 * funding it are Nykaa's, and putting either in a bucket would put somebody
 * else's promotion into our accounts.
 */
export function nykaaToCanonicalBuckets(facts: NykaaPnlFacts): PnlLineValues {
  const { commission, outputGst } = nykaaRevenue(facts)
  return {
    grossSales: facts.grossSalesMrp,
    discounts: commission,
    returns: facts.returnsMrp,
    // GST was collected inside the realisation and is paid onward, so it was
    // never revenue — removed here to put Nykaa on the same ex-GST footing as
    // every other channel in the Master P&L.
    otherRevenueAdj: outputGst,
    cogs: facts.cogsPriced + facts.cogsUnpriced,
    marketplaceCommission: 0,
    fulfilment: 0,
    shipping: 0,
    collectionFees: 0,
    rtoCharges: 0,
    returnCharges: 0,
    otherMarketplaceCharges: 0,
    ads: facts.nykaaAds,
    performanceMarketing: 0,
    otherMarketing: 0,
  }
}
