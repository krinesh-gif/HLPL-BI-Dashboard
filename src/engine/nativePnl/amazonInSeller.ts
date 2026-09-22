import type { AmazonInSellerPnlFacts, PnlLineValues } from '@/data/models'
import type { NativeLineDef, NativeLineValues } from './types'

/**
 * Amazon India Seller Central, built from the settlement report.
 *
 * This channel had revenue and no cost of selling: the All Orders report says
 * what was sold and carries no fee at all, so the statement showed Amazon
 * taking nothing. On the five weeks read here Amazon takes ₹13,426 of fees on
 * ₹59,357 of net sales — 22.6% — which is the difference between a channel
 * that looks healthy and one that has to be managed.
 *
 * Three things decide how the settlement is read.
 *
 *  1. GST IS NOT REVENUE AND FEE GST IS NOT A COST. The tax collected on a
 *     sale is remitted onward, and the tax charged on a fee comes back as
 *     input credit. Both are shown, because the deposit cannot be reconciled
 *     without them, and neither is in a margin.
 *
 *  2. TCS AND TDS ARE WITHHELD, NOT SPENT. Amazon holds them against our own
 *     tax liability and they are recovered when it is filed. They reduce the
 *     deposit and they are not costs, which is exactly the distinction a
 *     settlement report makes easy to lose.
 *
 *  3. AN UNRECOGNISED LINE IS SHOWN, NEVER DROPPED. Amazon adds fee
 *     descriptions without notice. Anything this build has not been taught
 *     still lands on the statement, on a line that says so, so the month keeps
 *     tying to the deposit and the gap is visible rather than silent.
 */

/** Which part of the statement an amount belongs to. */
export type SettlementBucket =
  | 'grossSales' | 'returns' | 'promotions' | 'outputGst' | 'tcs' | 'tds'
  | 'commission' | 'closingFee' | 'fbaFees' | 'shippingFees' | 'feeGst'
  | 'reimbursements' | 'unrecognised'

/**
 * Ordered rules. Order is the whole design: `order.itemtcs.tcs-igst` ends in
 * `-igst` like every fee tax does, and reading it as recoverable input credit
 * would drop tax withheld from us into a line we can claim back.
 */
const RULES: { test: (key: string) => boolean; bucket: SettlementBucket }[] = [
  { test: (k) => k.includes('.itemtcs.'), bucket: 'tcs' },
  { test: (k) => k.includes('.itemtds.'), bucket: 'tds' },
  // Tax on a price or a promotion is output GST; tax on a fee is input credit.
  { test: (k) => /\.itemprice\.(product-tax|shipping-tax)$/.test(k), bucket: 'outputGst' },
  { test: (k) => /\.promotion\..*tax-discount$/.test(k), bucket: 'outputGst' },
  { test: (k) => /(^|[.-])(igst|cgst|sgst)$/.test(k) || k.includes('tax-on-fee') || k.endsWith('igst'), bucket: 'feeGst' },
  { test: (k) => /\.itemprice\.(principal|shipping)$/.test(k) && k.startsWith('refund.'), bucket: 'returns' },
  { test: (k) => /\.itemprice\.(principal|shipping)$/.test(k), bucket: 'grossSales' },
  { test: (k) => k.includes('.promotion.'), bucket: 'promotions' },
  { test: (k) => k.includes('reimbursement'), bucket: 'reimbursements' },
  { test: (k) => /\.itemfees\.commission$/.test(k), bucket: 'commission' },
  { test: (k) => /\.itemfees\.fixed-closing-fee$/.test(k), bucket: 'closingFee' },
  { test: (k) => k.includes('fba-') || k.includes('.fbafees.'), bucket: 'fbaFees' },
  { test: (k) => k.includes('easy-ship') || k.includes('postage') || k.includes('shipping'), bucket: 'shippingFees' },
]

export function settlementBucketOf(key: string): SettlementBucket {
  for (const rule of RULES) if (rule.test(key)) return rule.bucket
  return 'unrecognised'
}

/** Sums a month's amounts into the statement's buckets. Amounts keep the sign
 * Amazon gave them, so a bucket is negative when it is a cost. */
export function amazonInSellerBuckets(facts: AmazonInSellerPnlFacts): Record<SettlementBucket, number> {
  const out = {
    grossSales: 0, returns: 0, promotions: 0, outputGst: 0, tcs: 0, tds: 0,
    commission: 0, closingFee: 0, fbaFees: 0, shippingFees: 0, feeGst: 0,
    reimbursements: 0, unrecognised: 0,
  }
  for (const [key, value] of Object.entries(facts.amounts ?? {})) out[settlementBucketOf(key)] += value
  return out
}

export const AMAZON_IN_SELLER_LINE_DEFS: NativeLineDef[] = [
  { key: 'grossSales', label: 'Gross Sales (ex-GST)', section: 'SALES', kind: 'input', note: 'Principal and shipping charged, as settled' },
  { key: 'returns', label: 'Less: Returns and refunds', section: 'SALES', kind: 'input' },
  { key: 'promotions', label: 'Less: Seller-funded promotions', section: 'SALES', kind: 'input', note: 'Coupons, rebates and the shipping we absorb' },
  { key: 'netSales', label: 'NET SALES (ex-GST)', section: 'SALES', kind: 'subtotal', note: '⭐ denominator for every %' },

  { key: 'commission', label: 'Less: Commission', section: 'AMAZON FEES', kind: 'input' },
  { key: 'closingFee', label: 'Less: Fixed closing fee', section: 'AMAZON FEES', kind: 'input' },
  { key: 'fbaFees', label: 'Less: FBA pick, pack, weight and storage', section: 'AMAZON FEES', kind: 'input', hideWhenZero: true },
  { key: 'shippingFees', label: 'Less: Easy Ship postage', section: 'AMAZON FEES', kind: 'input', hideWhenZero: true, note: 'Net of the reversals Amazon credits back' },
  { key: 'unrecognised', label: 'Less: Charges this build does not recognise', section: 'AMAZON FEES', kind: 'input', hideWhenZero: true, note: '⚠ a new Amazon description — counted so the month still ties, but not yet named' },
  { key: 'totalFees', label: 'Total Amazon fees', section: 'AMAZON FEES', kind: 'subtotal' },
  { key: 'feesPctOfSales', label: 'Fees, % of net sales', section: 'AMAZON FEES', kind: 'percent' },

  { key: 'reimbursements', label: 'Add: Reimbursements', section: 'OTHER SETTLEMENT ITEMS', kind: 'input', hideWhenZero: true, note: 'Lost and damaged stock Amazon pays for' },
  { key: 'contributionBeforeCogs', label: 'SETTLED REVENUE AFTER FEES', section: 'OTHER SETTLEMENT ITEMS', kind: 'subtotal' },

  { key: 'cogsPriced', label: 'Less: COGS — priced SKUs', section: 'COST OF GOODS SOLD', kind: 'input' },
  { key: 'cogsUnpriced', label: 'Less: COGS — unpriced SKUs (est.)', section: 'COST OF GOODS SOLD', kind: 'input', hideWhenZero: true, note: '⚠ estimate — goes to zero once every SKU is mapped and priced' },
  { key: 'totalCogs', label: 'Total COGS', section: 'COST OF GOODS SOLD', kind: 'subtotal' },
  { key: 'cm1', label: 'GROSS MARGIN (CM1)', section: 'COST OF GOODS SOLD', kind: 'subtotal' },
  { key: 'cm1Pct', label: 'CM1 %', section: 'COST OF GOODS SOLD', kind: 'percent' },

  { key: 'ads', label: 'Less: Advertising', section: 'ADVERTISING', kind: 'input', note: 'Sponsored Products — billed separately, not in the settlement' },
  { key: 'cm2', label: 'CONTRIBUTION MARGIN (CM2)', section: 'ADVERTISING', kind: 'subtotal', note: '⭐ the number to manage the channel on' },
  { key: 'cm2Pct', label: 'CM2 %', section: 'ADVERTISING', kind: 'percent' },

  { key: 'otherCosts', label: 'Less: Other Costs (allocated fixed expenses)', section: 'YOUR OTHER COSTS', kind: 'input' },
  { key: 'cm3', label: 'NET PROFIT (CM3)', section: 'YOUR OTHER COSTS', kind: 'subtotal' },
  { key: 'cm3Pct', label: 'Net Profit %', section: 'YOUR OTHER COSTS', kind: 'percent' },

  { key: 'outputGst', label: 'GST collected on sales', section: 'MONEY HELD, NOT EARNED OR SPENT', kind: 'input', note: 'Collected from the shopper and paid onward — never revenue' },
  { key: 'feeGst', label: 'GST charged on Amazon fees', section: 'MONEY HELD, NOT EARNED OR SPENT', kind: 'input', note: 'Input tax credit — recoverable, so it is not in any margin above' },
  { key: 'tcs', label: 'TCS withheld by Amazon', section: 'MONEY HELD, NOT EARNED OR SPENT', kind: 'input', note: 'Set against our GST liability when it is filed' },
  { key: 'tds', label: 'TDS withheld (Section 194-O)', section: 'MONEY HELD, NOT EARNED OR SPENT', kind: 'input', note: 'Set against our income tax' },
  { key: 'settlementTotal', label: 'AMOUNT DEPOSITED BY AMAZON', section: 'MONEY HELD, NOT EARNED OR SPENT', kind: 'subtotal', note: 'Every line of the settlement, including the four above' },
  { key: 'settlementCheck', label: 'Deposit less the statement above', section: 'MONEY HELD, NOT EARNED OR SPENT', kind: 'input', hideWhenZero: true, note: '⚠ must be zero — anything else means a line was read twice or not at all' },
]

export function computeAmazonInSellerPnl(facts: AmazonInSellerPnlFacts): NativeLineValues {
  const b = amazonInSellerBuckets(facts)
  const netSales = b.grossSales + b.returns + b.promotions
  const totalFees = b.commission + b.closingFee + b.fbaFees + b.shippingFees + b.unrecognised
  const contributionBeforeCogs = netSales + totalFees + b.reimbursements
  const cogsPriced = facts.cogsPriced ?? 0
  const cogsUnpriced = facts.cogsUnpriced ?? 0
  const totalCogs = cogsPriced + cogsUnpriced
  const cm1 = contributionBeforeCogs - totalCogs
  const ads = facts.ads ?? 0
  const cm2 = cm1 - ads
  const pct = (v: number): number => (netSales !== 0 ? (v / netSales) * 100 : 0)

  // Every bucket adds back to the deposit. If this is not zero the statement
  // has lost a line, which is the one failure that cannot be allowed to be
  // quiet on a report built from a bank credit.
  const reconstructed = netSales + totalFees + b.reimbursements + b.outputGst + b.feeGst + b.tcs + b.tds

  return {
    grossSales: b.grossSales,
    returns: b.returns,
    promotions: b.promotions,
    netSales,

    commission: b.commission,
    closingFee: b.closingFee,
    fbaFees: b.fbaFees,
    shippingFees: b.shippingFees,
    unrecognised: b.unrecognised,
    totalFees,
    feesPctOfSales: pct(-totalFees),

    reimbursements: b.reimbursements,
    contributionBeforeCogs,

    cogsPriced: -cogsPriced,
    cogsUnpriced: -cogsUnpriced,
    totalCogs: -totalCogs,
    cm1,
    cm1Pct: pct(cm1),

    ads: -ads,
    cm2,
    cm2Pct: pct(cm2),

    otherCosts: 0, // filled in by applyAmazonInSellerOtherCosts
    cm3: cm2,
    cm3Pct: pct(cm2),

    outputGst: b.outputGst,
    feeGst: b.feeGst,
    tcs: b.tcs,
    tds: b.tds,
    settlementTotal: facts.settlementTotal,
    settlementCheck: facts.settlementTotal - reconstructed,
  }
}

export function applyAmazonInSellerOtherCosts(computed: NativeLineValues, otherCosts: number): NativeLineValues {
  const cm3 = computed.cm2 - otherCosts
  const netSales = computed.netSales
  return { ...computed, otherCosts: -otherCosts, cm3, cm3Pct: netSales !== 0 ? (cm3 / netSales) * 100 : 0 }
}

/**
 * The same month in the buckets the Master P&L rolls up.
 *
 * Gross Sales is ex-GST here, as the settlement states it, so this channel
 * sits on the same footing as every other one. The tax lines appear nowhere:
 * GST collected was never ours, and the GST on fees comes back, so putting
 * either in a bucket would inflate both the top and the bottom of the report.
 */
export function amazonInSellerToCanonicalBuckets(facts: AmazonInSellerPnlFacts): PnlLineValues {
  const b = amazonInSellerBuckets(facts)
  return {
    grossSales: b.grossSales,
    discounts: -b.promotions,
    returns: -b.returns,
    otherRevenueAdj: 0,
    cogs: (facts.cogsPriced ?? 0) + (facts.cogsUnpriced ?? 0),
    marketplaceCommission: -b.commission,
    fulfilment: -b.fbaFees,
    shipping: -b.shippingFees,
    collectionFees: -b.closingFee,
    rtoCharges: 0,
    returnCharges: 0,
    // Reimbursements are money in, so they reduce the month's other charges
    // rather than being a negative cost of their own.
    otherMarketplaceCharges: -b.unrecognised - b.reimbursements,
    ads: facts.ads ?? 0,
    performanceMarketing: 0,
    otherMarketing: 0,
  }
}
