import { MEESHO_ASSUMPTIONS } from '@/config/nativePnlAssumptions'
import type { MeeshoPnlFacts, PnlLineValues } from '@/data/models'
import type { NativeLineDef, NativeLineValues } from './types'

/**
 * Meesho's P&L, in the structure the business runs on.
 *
 * Three things about this statement matter and were missing from the earlier
 * version, each of which flattered the numbers:
 *
 *  1. GST IS STRIPPED. Meesho bills and settles inclusive of GST, but the
 *     output GST is collected on the government's behalf and remitted — it was
 *     never revenue. Every margin here is measured against NET REVENUE
 *     (ex-GST). Leaving GST in overstates the denominator by around 16% and so
 *     understates every margin percentage.
 *
 *  2. RETURNED STOCK IS NOT ALL RECOVERED. An RTO parcel that comes back
 *     unsaleable, and an opened customer return, are shrinkage. They are
 *     separated from the cost of units actually sold so the loss is visible.
 *
 *  3. OWN FULFILMENT COSTS MONEY. Packaging and the labour to pick, pack and
 *     dispatch are real per-shipment costs that Meesho never bills, so they
 *     appear on no marketplace report. Omitting them makes every shipment look
 *     more profitable than it is.
 *
 * The margin ladder answers "where did the money go", in the order it goes:
 * gross profit, then after the marketplace's charges (CM1), after advertising
 * (CM2), after our own fulfilment (CM3), after platform adjustments (CM4), and
 * finally after allocated overheads (EBITDA).
 */
export const MEESHO_LINE_DEFS: NativeLineDef[] = [
  { key: 'grossSales', label: 'Gross Sales (incl. GST)', section: 'REVENUE', kind: 'input' },
  { key: 'salesReturns', label: 'Less: Sales Returns & RTO (incl. GST)', section: 'REVENUE', kind: 'input' },
  { key: 'netSalesInclGst', label: 'Net Sales (incl. GST)', section: 'REVENUE', kind: 'subtotal' },
  { key: 'outputGst', label: 'Less: Output GST on sales', section: 'REVENUE', kind: 'input' },
  { key: 'netRevenue', label: 'NET REVENUE (ex-GST)', section: 'REVENUE', kind: 'subtotal' },

  { key: 'cogsUnitsSold', label: 'COGS — units sold', section: 'COST OF GOODS SOLD', kind: 'input' },
  { key: 'cogsRtoWriteOff', label: 'COGS — RTO write-off (unsaleable)', section: 'COST OF GOODS SOLD', kind: 'input' },
  { key: 'cogsReturnWriteOff', label: 'COGS — customer return write-off (unsaleable)', section: 'COST OF GOODS SOLD', kind: 'input' },
  { key: 'totalCogs', label: 'Total Cost of Goods Sold', section: 'COST OF GOODS SOLD', kind: 'subtotal' },
  { key: 'grossProfit', label: 'GROSS PROFIT', section: 'COST OF GOODS SOLD', kind: 'subtotal' },
  { key: 'grossMarginPct', label: 'Gross Margin %', section: 'COST OF GOODS SOLD', kind: 'percent' },

  { key: 'forwardShipping', label: 'Forward shipping charge', section: 'MEESHO MARKETPLACE CHARGES', kind: 'input' },
  { key: 'returnShipping', label: 'Return shipping charge', section: 'MEESHO MARKETPLACE CHARGES', kind: 'input' },
  { key: 'otherMarketplaceFees', label: 'All other marketplace fees (commission, fixed, warehousing)', section: 'MEESHO MARKETPLACE CHARGES', kind: 'input' },
  { key: 'totalMarketplaceCharges', label: 'Total Marketplace Charges', section: 'MEESHO MARKETPLACE CHARGES', kind: 'subtotal' },
  { key: 'cm1', label: 'CONTRIBUTION MARGIN 1 (after marketplace charges)', section: 'MEESHO MARKETPLACE CHARGES', kind: 'subtotal' },
  { key: 'cm1Pct', label: 'CM1 %', section: 'MEESHO MARKETPLACE CHARGES', kind: 'percent' },

  { key: 'adsSpend', label: 'Meesho Ads — gross spend (ex-GST)', section: 'ADVERTISING', kind: 'input' },
  { key: 'adCredits', label: 'Ad credits / waivers / discounts', section: 'ADVERTISING', kind: 'input' },
  { key: 'totalAdvertising', label: 'Total Advertising', section: 'ADVERTISING', kind: 'subtotal' },
  { key: 'cm2', label: 'CONTRIBUTION MARGIN 2 (after advertising)', section: 'ADVERTISING', kind: 'subtotal' },
  { key: 'cm2Pct', label: 'CM2 %', section: 'ADVERTISING', kind: 'percent' },
  { key: 'acosPct', label: 'ACOS % (ad spend / net revenue)', section: 'ADVERTISING', kind: 'percent' },

  { key: 'packaging', label: 'Packaging material', section: 'OWN FULFILMENT COST', kind: 'input' },
  { key: 'fulfilmentLabour', label: 'Fulfilment / warehouse labour', section: 'OWN FULFILMENT COST', kind: 'input' },
  { key: 'totalOwnFulfilment', label: 'Total Own Fulfilment Cost', section: 'OWN FULFILMENT COST', kind: 'subtotal' },
  { key: 'cm3', label: 'CONTRIBUTION MARGIN 3 (after fulfilment)', section: 'OWN FULFILMENT COST', kind: 'subtotal' },
  { key: 'cm3Pct', label: 'CM3 %', section: 'OWN FULFILMENT COST', kind: 'percent' },

  { key: 'compensation', label: 'Compensation received (order level)', section: 'PLATFORM ADJUSTMENTS', kind: 'input' },
  { key: 'claims', label: 'Claims received', section: 'PLATFORM ADJUSTMENTS', kind: 'input' },
  { key: 'recovery', label: 'Recovery / penalties (order level)', section: 'PLATFORM ADJUSTMENTS', kind: 'input' },
  { key: 'platformRecovery', label: 'Platform recovery — subscriptions & programmes', section: 'PLATFORM ADJUSTMENTS', kind: 'input' },
  { key: 'netPlatformAdjustments', label: 'Net Platform Adjustments', section: 'PLATFORM ADJUSTMENTS', kind: 'subtotal' },
  { key: 'cm4', label: 'CONTRIBUTION MARGIN 4 (after adjustments)', section: 'PLATFORM ADJUSTMENTS', kind: 'subtotal' },
  { key: 'cm4Pct', label: 'CM4 %', section: 'PLATFORM ADJUSTMENTS', kind: 'percent' },

  { key: 'overheads', label: 'Total Operating Overheads', section: 'OPERATING OVERHEADS', kind: 'input' },
  { key: 'ebitda', label: 'CHANNEL EBITDA', section: 'OPERATING OVERHEADS', kind: 'subtotal' },
  { key: 'ebitdaPct', label: 'EBITDA %', section: 'OPERATING OVERHEADS', kind: 'percent' },

  { key: 'tcs', label: 'TCS collected u/s 52 (creditable)', section: 'MEMO — STATUTORY (not charged to P&L)', kind: 'input' },
  { key: 'tds', label: 'TDS deducted u/s 194-O (creditable)', section: 'MEMO — STATUTORY (not charged to P&L)', kind: 'input' },
  { key: 'outputGstMemo', label: 'Output GST on sales (payable)', section: 'MEMO — STATUTORY (not charged to P&L)', kind: 'input' },
  { key: 'gstOnFees', label: 'GST in marketplace charges (ITC recoverable)', section: 'MEMO — STATUTORY (not charged to P&L)', kind: 'input' },
  { key: 'gstOnAds', label: 'GST on advertising (ITC recoverable)', section: 'MEMO — STATUTORY (not charged to P&L)', kind: 'input' },

  { key: 'netSettlementPerFile', label: 'Net settlement per Meesho file', section: 'MEMO — SETTLEMENT BRIDGE', kind: 'input' },
  { key: 'adsDeduction', label: 'Ads deduction (incl. GST)', section: 'MEMO — SETTLEMENT BRIDGE', kind: 'input' },
  { key: 'platformRecoveryMemo', label: 'Platform recovery', section: 'MEMO — SETTLEMENT BRIDGE', kind: 'input' },
  { key: 'expectedBankCredit', label: 'Expected net bank credit', section: 'MEMO — SETTLEMENT BRIDGE', kind: 'subtotal' },

  { key: 'subOrders', label: 'Sub-orders dispatched', section: 'MEMO — VOLUME', kind: 'input' },
  { key: 'unitsDispatched', label: 'Units dispatched', section: 'MEMO — VOLUME', kind: 'input' },
  { key: 'unitsDelivered', label: 'Units delivered / in transit', section: 'MEMO — VOLUME', kind: 'input' },
  { key: 'unitsRto', label: 'Units RTO', section: 'MEMO — VOLUME', kind: 'input' },
  { key: 'unitsReturned', label: 'Units customer-returned', section: 'MEMO — VOLUME', kind: 'input' },
  { key: 'rtoPctOfDispatched', label: 'RTO % of units dispatched', section: 'MEMO — VOLUME', kind: 'percent' },
  { key: 'returnPctOfDispatched', label: 'Customer return % of units dispatched', section: 'MEMO — VOLUME', kind: 'percent' },
  { key: 'netRevenuePerUnitDelivered', label: 'Net revenue per unit delivered', section: 'MEMO — VOLUME', kind: 'input' },
  { key: 'cm3PerUnitDelivered', label: 'CM3 per unit delivered', section: 'MEMO — VOLUME', kind: 'input' },
]

/** Percentage of a base, or 0 when the base is zero — a margin on no revenue
 * is not a number worth printing, and the table renders 0 as a dash. */
const pct = (value: number, base: number): number => (base !== 0 ? (value / base) * 100 : 0)

export function computeMeeshoPnl(facts: MeeshoPnlFacts, overheads = 0): NativeLineValues {
  const netSalesInclGst = facts.grossSalesInclGst - facts.salesReturnsInclGst
  const netRevenue = netSalesInclGst - facts.outputGstOnSales

  const totalCogs = facts.cogsUnitsSold + facts.cogsRtoWriteOff + facts.cogsReturnWriteOff
  const grossProfit = netRevenue - totalCogs

  const totalMarketplaceCharges = facts.forwardShipping + facts.returnShipping + facts.otherMarketplaceFees
  const cm1 = grossProfit - totalMarketplaceCharges

  const totalAdvertising = facts.adsSpendExGst - facts.adCredits
  const cm2 = cm1 - totalAdvertising

  // Charged per shipment, not per unit: one parcel takes one mailer and one
  // pick regardless of how many items are in it.
  const packaging = facts.subOrdersDispatched * MEESHO_ASSUMPTIONS.packagingPerShipment
  const fulfilmentLabour = facts.subOrdersDispatched * MEESHO_ASSUMPTIONS.fulfilmentLabourPerShipment
  const totalOwnFulfilment = packaging + fulfilmentLabour
  const cm3 = cm2 - totalOwnFulfilment

  const netPlatformAdjustments =
    facts.compensation + facts.claims - facts.recovery - facts.platformRecoverySubscriptions
  const cm4 = cm3 + netPlatformAdjustments

  const ebitda = cm4 - overheads

  const adsInclGst = facts.adsSpendExGst * (1 + MEESHO_ASSUMPTIONS.gstOnAdvertisingPct)
  const expectedBankCredit =
    facts.netSettlementPerFile - adsInclGst - facts.platformRecoverySubscriptions

  return {
    grossSales: facts.grossSalesInclGst,
    salesReturns: -facts.salesReturnsInclGst,
    netSalesInclGst,
    outputGst: -facts.outputGstOnSales,
    netRevenue,

    cogsUnitsSold: -facts.cogsUnitsSold,
    cogsRtoWriteOff: -facts.cogsRtoWriteOff,
    cogsReturnWriteOff: -facts.cogsReturnWriteOff,
    totalCogs: -totalCogs,
    grossProfit,
    grossMarginPct: pct(grossProfit, netRevenue),

    forwardShipping: -facts.forwardShipping,
    returnShipping: -facts.returnShipping,
    otherMarketplaceFees: -facts.otherMarketplaceFees,
    totalMarketplaceCharges: -totalMarketplaceCharges,
    cm1,
    cm1Pct: pct(cm1, netRevenue),

    adsSpend: -facts.adsSpendExGst,
    adCredits: facts.adCredits,
    totalAdvertising: -totalAdvertising,
    cm2,
    cm2Pct: pct(cm2, netRevenue),
    acosPct: pct(totalAdvertising, netRevenue),

    packaging: -packaging,
    fulfilmentLabour: -fulfilmentLabour,
    totalOwnFulfilment: -totalOwnFulfilment,
    cm3,
    cm3Pct: pct(cm3, netRevenue),

    compensation: facts.compensation,
    claims: facts.claims,
    recovery: -facts.recovery,
    platformRecovery: -facts.platformRecoverySubscriptions,
    netPlatformAdjustments,
    cm4,
    cm4Pct: pct(cm4, netRevenue),

    overheads: -overheads,
    ebitda,
    ebitdaPct: pct(ebitda, netRevenue),

    tcs: -facts.tcs,
    tds: facts.tds,
    outputGstMemo: facts.outputGstOnSales,
    gstOnFees: facts.gstOnMarketplaceFees,
    gstOnAds: facts.gstOnAds,

    netSettlementPerFile: facts.netSettlementPerFile,
    adsDeduction: -adsInclGst,
    platformRecoveryMemo: -facts.platformRecoverySubscriptions,
    expectedBankCredit,

    subOrders: facts.subOrdersDispatched,
    unitsDispatched: facts.unitsDispatched,
    unitsDelivered: facts.unitsDelivered,
    unitsRto: facts.unitsRto,
    unitsReturned: facts.unitsReturned,
    rtoPctOfDispatched: pct(facts.unitsRto, facts.unitsDispatched),
    returnPctOfDispatched: pct(facts.unitsReturned, facts.unitsDispatched),
    netRevenuePerUnitDelivered: facts.unitsDelivered > 0 ? netRevenue / facts.unitsDelivered : 0,
    cm3PerUnitDelivered: facts.unitsDelivered > 0 ? cm3 / facts.unitsDelivered : 0,
  }
}

/** Overheads arrive from the company-wide fixed-expense allocation, which is
 * computed outside this module, so EBITDA is applied as a second pass. */
export function applyMeeshoOtherCosts(computed: NativeLineValues, otherCosts: number): NativeLineValues {
  const cm4 = computed.cm4
  const ebitda = cm4 - otherCosts
  return {
    ...computed,
    overheads: -otherCosts,
    ebitda,
    ebitdaPct: pct(ebitda, computed.netRevenue),
  }
}

/**
 * Meesho's figures in the generic bucket structure the Master P&L rolls up.
 *
 * Net Sales here is NET REVENUE (ex-GST), because that is what Meesho's
 * revenue actually is. Note that the other channels do not yet strip GST, so
 * a consolidated total currently mixes an ex-GST Meesho with GST-inclusive
 * channels. That inconsistency resolves when the same structure is rolled out
 * to them; until then Meesho at least agrees with itself, which is the more
 * important of the two.
 */
export function meeshoToCanonicalBuckets(facts: MeeshoPnlFacts): PnlLineValues {
  const packagingAndLabour =
    facts.subOrdersDispatched *
    (MEESHO_ASSUMPTIONS.packagingPerShipment + MEESHO_ASSUMPTIONS.fulfilmentLabourPerShipment)

  return {
    grossSales: facts.grossSalesInclGst,
    discounts: 0,
    returns: facts.salesReturnsInclGst,
    // Output GST was never revenue; removing it here is what makes the
    // canonical Net Sales equal the native NET REVENUE line.
    otherRevenueAdj: facts.outputGstOnSales,
    cogs: facts.cogsUnitsSold + facts.cogsRtoWriteOff + facts.cogsReturnWriteOff,
    marketplaceCommission: facts.otherMarketplaceFees,
    fulfilment: packagingAndLabour,
    shipping: facts.forwardShipping + facts.returnShipping,
    collectionFees: 0,
    rtoCharges: 0,
    returnCharges: 0,
    otherMarketplaceCharges:
      facts.recovery + facts.platformRecoverySubscriptions - facts.compensation - facts.claims,
    ads: facts.adsSpendExGst - facts.adCredits,
    performanceMarketing: 0,
    otherMarketing: 0,
  }
}
