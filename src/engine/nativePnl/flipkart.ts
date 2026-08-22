import type { FlipkartPnlFacts, PnlLineValues } from '@/data/models'
import type { NativeLineDef, NativeLineValues } from './types'

/**
 * Matches the real Flipkart P&L model's waterfall (Aravi_Live_PnL_Model_v3.xlsx,
 * DASHBOARD sheet): COGS is deducted before marketplace fees, and CM1-CM4 are
 * defined in that order. Facts come from normalizing the Flipkart "SKU-level
 * P&L" export (commission/fees/COGS) plus a small monthly manual entry for
 * figures that report doesn't carry (seller-funded discount, customer add-ons,
 * output GST, Google Ads).
 *
 * Sign convention: every fact field is a positive magnitude (the raw ₹ amount
 * of that deduction or addback); the waterfall below does the subtracting.
 * `computeFlipkartPnl`'s returned values negate deduction lines for display only.
 */
export const FLIPKART_LINE_DEFS: NativeLineDef[] = [
  { key: 'grossSales', label: 'Gross Sales', section: 'SALES', kind: 'input' },
  { key: 'returnsCancellations', label: 'Less: Returns & Cancellations', section: 'SALES', kind: 'input' },
  { key: 'estimatedNetSales', label: 'Estimated Net Sales', section: 'SALES', kind: 'subtotal' },
  { key: 'sellerFundedDiscount', label: 'Less: Seller-Funded Discount', section: 'SALES', kind: 'input', note: 'Manual entry — your share only' },
  { key: 'customerAddOns', label: 'Add: Customer Add-Ons', section: 'SALES', kind: 'input', note: 'Manual entry' },
  { key: 'accountedNetSales', label: 'Accounted Net Sales (incl GST)', section: 'SALES', kind: 'subtotal' },
  { key: 'outputGst', label: 'Less: Output GST', section: 'SALES', kind: 'input', note: 'Manual entry — from GST Sales Report' },
  { key: 'netRevenueExGst', label: 'NET REVENUE (ex-GST)', section: 'SALES', kind: 'subtotal', note: '⭐ denominator for every %' },

  { key: 'cogsPriced', label: 'Less: COGS — priced SKUs', section: 'COGS', kind: 'input' },
  { key: 'cogsUnpriced', label: 'Less: COGS — unpriced SKUs (est.)', section: 'COGS', kind: 'input', note: '⚠ estimate — goes to zero once every SKU is priced' },
  { key: 'totalCogs', label: 'Total COGS', section: 'COGS', kind: 'subtotal' },
  { key: 'cm1', label: 'GROSS MARGIN (CM1)', section: 'COGS', kind: 'subtotal' },
  { key: 'cm1Pct', label: 'CM1 %', section: 'COGS', kind: 'percent' },

  { key: 'commissionFee', label: 'Less: Commission Fee', section: 'MARKETPLACE FEES', kind: 'input' },
  { key: 'fixedFee', label: 'Less: Fixed Fee', section: 'MARKETPLACE FEES', kind: 'input' },
  { key: 'collectionFee', label: 'Less: Collection Fee', section: 'MARKETPLACE FEES', kind: 'input' },
  { key: 'pickPackFee', label: 'Less: Pick & Pack Fee', section: 'MARKETPLACE FEES', kind: 'input' },
  { key: 'forwardShippingFee', label: 'Less: Forward Shipping Fee', section: 'MARKETPLACE FEES', kind: 'input' },
  { key: 'reverseShippingFee', label: 'Less: Reverse Shipping Fee', section: 'MARKETPLACE FEES', kind: 'input' },
  { key: 'storageFee', label: 'Less: Storage Fee', section: 'MARKETPLACE FEES', kind: 'input' },
  { key: 'recallFee', label: 'Less: Recall Fee', section: 'MARKETPLACE FEES', kind: 'input' },
  { key: 'otherMarketplaceFees', label: 'Less: Other Marketplace Fees', section: 'MARKETPLACE FEES', kind: 'input' },
  { key: 'totalMarketplaceFees', label: 'Total Marketplace Fees', section: 'MARKETPLACE FEES', kind: 'subtotal' },
  { key: 'rewardsSpf', label: 'Add/(Less): Rewards & SPF', section: 'MARKETPLACE FEES', kind: 'input' },
  { key: 'cm2', label: 'CHANNEL MARGIN (CM2)', section: 'MARKETPLACE FEES', kind: 'subtotal', note: 'Is this marketplace worth being on?' },
  { key: 'cm2Pct', label: 'CM2 %', section: 'MARKETPLACE FEES', kind: 'percent' },

  { key: 'flipkartAds', label: 'Less: Flipkart Ads', section: 'ADVERTISING', kind: 'input' },
  { key: 'googleAds', label: 'Less: Google Ads', section: 'ADVERTISING', kind: 'input', note: 'Manual entry' },
  { key: 'totalAdvertising', label: 'Total Advertising', section: 'ADVERTISING', kind: 'subtotal' },
  { key: 'cm3', label: 'CONTRIBUTION MARGIN (CM3)', section: 'ADVERTISING', kind: 'subtotal', note: '⭐ the number to manage the business on' },
  { key: 'cm3Pct', label: 'CM3 %', section: 'ADVERTISING', kind: 'percent' },

  { key: 'otherCosts', label: 'Less: Other Costs (allocated fixed expenses)', section: 'YOUR OTHER COSTS', kind: 'input' },
  { key: 'cm4', label: 'NET PROFIT (CM4)', section: 'YOUR OTHER COSTS', kind: 'subtotal' },
  { key: 'cm4Pct', label: 'Net Profit %', section: 'YOUR OTHER COSTS', kind: 'percent' },
]

/** All facts are positive magnitudes; `otherCosts` (allocated fixed expenses) is
 * applied separately via `applyFlipkartOtherCosts` once the allocation is known. */
export function computeFlipkartPnl(facts: FlipkartPnlFacts): NativeLineValues {
  const returnsCancellations = facts.grossSales - facts.estimatedNetSales
  const accountedNetSales = facts.estimatedNetSales - facts.sellerFundedDiscount + facts.customerAddOns
  const netRevenueExGst = accountedNetSales - facts.outputGst

  const totalCogs = facts.cogsPriced + facts.cogsUnpriced
  const cm1 = netRevenueExGst - totalCogs

  const totalMarketplaceFees =
    facts.commissionFee + facts.fixedFee + facts.collectionFee + facts.pickPackFee +
    facts.forwardShippingFee + facts.reverseShippingFee + facts.storageFee + facts.recallFee +
    facts.otherMarketplaceFees
  const cm2 = cm1 - totalMarketplaceFees + facts.rewardsSpf

  const totalAdvertising = facts.flipkartAds + facts.googleAds
  const cm3 = cm2 - totalAdvertising

  return {
    grossSales: facts.grossSales,
    returnsCancellations: -returnsCancellations,
    estimatedNetSales: facts.estimatedNetSales,
    sellerFundedDiscount: -facts.sellerFundedDiscount,
    customerAddOns: facts.customerAddOns,
    accountedNetSales,
    outputGst: -facts.outputGst,
    netRevenueExGst,
    cogsPriced: -facts.cogsPriced,
    cogsUnpriced: -facts.cogsUnpriced,
    totalCogs: -totalCogs,
    cm1,
    cm1Pct: netRevenueExGst !== 0 ? (cm1 / netRevenueExGst) * 100 : 0,
    commissionFee: -facts.commissionFee,
    fixedFee: -facts.fixedFee,
    collectionFee: -facts.collectionFee,
    pickPackFee: -facts.pickPackFee,
    forwardShippingFee: -facts.forwardShippingFee,
    reverseShippingFee: -facts.reverseShippingFee,
    storageFee: -facts.storageFee,
    recallFee: -facts.recallFee,
    otherMarketplaceFees: -facts.otherMarketplaceFees,
    totalMarketplaceFees: -totalMarketplaceFees,
    rewardsSpf: facts.rewardsSpf,
    cm2,
    cm2Pct: netRevenueExGst !== 0 ? (cm2 / netRevenueExGst) * 100 : 0,
    flipkartAds: -facts.flipkartAds,
    googleAds: -facts.googleAds,
    totalAdvertising: -totalAdvertising,
    cm3,
    cm3Pct: netRevenueExGst !== 0 ? (cm3 / netRevenueExGst) * 100 : 0,
    otherCosts: 0, // filled in by applyFlipkartOtherCosts once fixed-expense allocation is known
    cm4: cm3,
    cm4Pct: netRevenueExGst !== 0 ? (cm3 / netRevenueExGst) * 100 : 0,
  }
}

/** Applies this month's allocated fixed-expense share (from the app's existing
 * sales-contribution allocation engine) to get CM4 / Net Profit. */
export function applyFlipkartOtherCosts(computed: NativeLineValues, otherCosts: number): NativeLineValues {
  const cm4 = computed.cm3 - otherCosts
  const netRevenueExGst = computed.netRevenueExGst
  return { ...computed, otherCosts: -otherCosts, cm4, cm4Pct: netRevenueExGst !== 0 ? (cm4 / netRevenueExGst) * 100 : 0 }
}

/** Re-buckets Flipkart's native facts into the app's generic canonical P&L
 * structure (all positive magnitudes, matching engine/pnl.ts's convention),
 * so this channel still rolls up correctly into the Master P&L. */
export function flipkartToCanonicalBuckets(facts: FlipkartPnlFacts): PnlLineValues {
  return {
    grossSales: facts.grossSales,
    discounts: facts.sellerFundedDiscount,
    returns: facts.grossSales - facts.estimatedNetSales,
    otherRevenueAdj: facts.outputGst - facts.customerAddOns,
    cogs: facts.cogsPriced + facts.cogsUnpriced,
    marketplaceCommission: facts.commissionFee,
    fulfilment: facts.pickPackFee,
    shipping: facts.forwardShippingFee + facts.reverseShippingFee,
    collectionFees: facts.collectionFee,
    rtoCharges: 0,
    returnCharges: 0,
    otherMarketplaceCharges: facts.storageFee + facts.recallFee + facts.otherMarketplaceFees - facts.rewardsSpf,
    ads: facts.flipkartAds,
    performanceMarketing: facts.googleAds,
    otherMarketing: 0,
  }
}
