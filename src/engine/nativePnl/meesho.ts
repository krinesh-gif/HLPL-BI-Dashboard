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
 *  3. OWN FULFILMENT COSTS MONEY. Packaging is a real per-shipment cost that
 *     Meesho never bills, so it appears on no marketplace report. Omitting it
 *     makes every shipment look more profitable than it is. The rate comes
 *     from Monthly Inputs, dated by month, because what a mailer costs is a
 *     business figure and not something any report can tell us.
 *
 *     A warehouse-labour line sat beside it at a flat ₹2 a parcel. It was
 *     taken out rather than made editable: picking and packing is paid for in
 *     salaries, which are already in the month's fixed expenses and allocated
 *     to this channel by its share of sales, so charging it again here put the
 *     same wage in the statement twice.
 *
 * The margin ladder answers "where did the money go", in the order it goes:
 * gross profit, then after the marketplace's charges (CM1), after advertising
 * (CM2), after our own fulfilment (CM3), after platform adjustments (CM4), and
 * finally after allocated overheads (EBITDA).
 */
export const MEESHO_LINE_DEFS: NativeLineDef[] = [
  { key: 'grossSales', label: 'Gross Sales (incl. GST)', section: 'REVENUE', kind: 'input' },
  {
    // Its own line rather than folded into returns: a cancellation happens
    // before the parcel moves, so it is a different problem from one that comes
    // back, and burying it in the return rate would hide the cancellation rate.
    key: 'cancellations', label: '(−) Cancellations (incl. GST)', section: 'REVENUE', kind: 'input',
    note: 'Billed in gross by the file, which writes no return against them',
  },
  { key: 'salesReturns', label: '(−) Sales Returns & RTO (incl. GST)', section: 'REVENUE', kind: 'input' },
  { key: 'netSalesInclGst', label: 'Net Sales (incl. GST)', section: 'REVENUE', kind: 'subtotal' },
  { key: 'outputGst', label: '(−) Output GST on sales', section: 'REVENUE', kind: 'input' },
  { key: 'netRevenue', label: 'NET REVENUE (ex-GST)', section: 'REVENUE', kind: 'subtotal' },
  { key: 'totalCogs', label: 'Total COGS', section: 'COST OF GOODS SOLD', kind: 'subtotal', group: 'cogs', isGroupHead: true },

  { key: 'cogsUnitsSold', label: 'COGS — units sold', section: 'COST OF GOODS SOLD', kind: 'input', group: 'cogs' },
  { key: 'cogsRtoWriteOff', label: 'COGS — RTO write-off (unsaleable)', section: 'COST OF GOODS SOLD', kind: 'input', group: 'cogs' },
  { key: 'cogsReturnWriteOff', label: 'COGS — customer return write-off (unsaleable)', section: 'COST OF GOODS SOLD', kind: 'input', group: 'cogs' },
  { key: 'cm1', label: 'GROSS MARGIN (CM1)', section: 'COST OF GOODS SOLD', kind: 'subtotal' },
  { key: 'cm1Pct', label: 'CM1 %', section: 'COST OF GOODS SOLD', kind: 'percent' },
  { key: 'totalMarketplaceCharges', label: 'Total Marketplace Charges', section: 'MEESHO MARKETPLACE CHARGES', kind: 'subtotal', group: 'charges', isGroupHead: true },

  { key: 'forwardShipping', label: 'Forward shipping charge', section: 'MEESHO MARKETPLACE CHARGES', kind: 'input', fee: 'shipping', group: 'charges' },
  { key: 'returnShipping', label: 'Return shipping charge', section: 'MEESHO MARKETPLACE CHARGES', kind: 'input', fee: 'returnsLogistics', group: 'charges' },
  { key: 'otherMarketplaceFees', label: 'All other marketplace fees (commission, fixed, warehousing)', section: 'MEESHO MARKETPLACE CHARGES', kind: 'input', fee: 'otherFees', group: 'charges' },

  // No "Total Own Fulfilment Cost" row: with labour gone it would restate the
  // single line above it. The value is still computed, so a caller that wants
  // the section's total has it without the statement printing it twice.
  { key: 'packaging', label: 'Packaging material', section: 'OWN FULFILMENT COST', kind: 'input' },

  { key: 'netPlatformAdjustments', label: 'Net Platform Adjustments', section: 'PLATFORM ADJUSTMENTS', kind: 'subtotal', group: 'adjustments', isGroupHead: true },
  { key: 'compensation', label: 'Compensation received (order level)', section: 'PLATFORM ADJUSTMENTS', kind: 'input', fee: 'otherFees', group: 'adjustments' },
  { key: 'claims', label: 'Claims received', section: 'PLATFORM ADJUSTMENTS', kind: 'input', fee: 'otherFees', group: 'adjustments' },
  { key: 'recovery', label: 'Recovery / penalties (order level)', section: 'PLATFORM ADJUSTMENTS', kind: 'input', fee: 'penalty', group: 'adjustments' },
  { key: 'platformRecovery', label: 'Platform recovery — subscriptions & programmes', section: 'PLATFORM ADJUSTMENTS', kind: 'input', fee: 'otherFees', group: 'adjustments' },

  // One rung for everything between the goods and advertising: Meesho's
  // charges, the packaging this company buys to ship for it, and the
  // adjustments it settles afterwards. Three blocks, in Meesho's own
  // vocabulary, and one CM2 — the same CM2 every other channel strikes, and
  // the same deduction the P&L makes.
  { key: 'cm2', label: 'CHANNEL MARGIN (CM2)', section: 'PLATFORM ADJUSTMENTS', kind: 'subtotal', note: 'Is this marketplace worth being on? — after the marketplace charges, the packaging and the adjustments above' },
  { key: 'cm2Pct', label: 'CM2 %', section: 'PLATFORM ADJUSTMENTS', kind: 'percent' },

  { key: 'totalAdvertising', label: 'Total Advertising', section: 'ADVERTISING', kind: 'subtotal', group: 'ads', isGroupHead: true },
  { key: 'adsSpend', label: 'Meesho Ads — spend (ex-GST)', section: 'ADVERTISING', kind: 'input', fee: 'advertising', group: 'ads' },
  { key: 'adCredits', label: 'Ad credits / waivers / discounts', section: 'ADVERTISING', kind: 'input', fee: 'advertising', group: 'ads' },
  { key: 'adsGst', label: 'GST on Meesho Ads', section: 'ADVERTISING', kind: 'input', group: 'ads' },
  { key: 'affiliateFee', label: 'Affiliate / referral commission', section: 'ADVERTISING', kind: 'input', fee: 'advertising', group: 'ads' },
  { key: 'cm3', label: 'CONTRIBUTION MARGIN (CM3)', section: 'ADVERTISING', kind: 'subtotal', note: '⭐ the number to manage the channel on' },
  { key: 'cm3Pct', label: 'CM3 %', section: 'ADVERTISING', kind: 'percent' },
  { key: 'acosPct', label: 'ACOS % (ad spend / net revenue)', section: 'ADVERTISING', kind: 'percent' },

  { key: 'overheads', label: '(−) Allocated Fixed Expenses', section: 'FIXED EXPENSES', kind: 'input' },
  { key: 'cm4', label: 'NET PROFIT (CM4)', section: 'FIXED EXPENSES', kind: 'subtotal' },
  { key: 'cm4Pct', label: 'Net Profit %', section: 'FIXED EXPENSES', kind: 'percent' },

  { key: 'tcs', label: 'TCS collected u/s 52 (creditable)', section: 'MEMO — STATUTORY (not charged to P&L)', kind: 'input', fee: 'withholding' },
  { key: 'tds', label: 'TDS deducted u/s 194-O (creditable)', section: 'MEMO — STATUTORY (not charged to P&L)', kind: 'input', fee: 'withholding', feeSign: 'amount' },
  { key: 'outputGstMemo', label: 'Output GST on sales (payable)', section: 'MEMO — STATUTORY (not charged to P&L)', kind: 'input' },
  { key: 'gstOnFees', label: 'GST in marketplace charges (ITC recoverable)', section: 'MEMO — STATUTORY (not charged to P&L)', kind: 'input', fee: 'feeTax', feeSign: 'amount' },
  { key: 'gstOnAds', label: 'GST on advertising (ITC recoverable)', section: 'MEMO — STATUTORY (not charged to P&L)', kind: 'input', fee: 'feeTax', feeSign: 'amount' },

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

export function computeMeeshoPnl(
  facts: MeeshoPnlFacts,
  overheads = 0,
  /** Rupees to pack one parcel in this month, from Monthly Inputs. Defaults to
   * the company model's standing figure when the month has no rate entered. */
  packagingPerShipment: number = MEESHO_ASSUMPTIONS.packagingPerShipment,
): NativeLineValues {
  const netSalesInclGst =
    facts.grossSalesInclGst - facts.cancellationsInclGst - facts.salesReturnsInclGst
  const netRevenue = netSalesInclGst - facts.outputGstOnSales

  const totalCogs = facts.cogsUnitsSold + facts.cogsRtoWriteOff + facts.cogsReturnWriteOff
  const cm1 = netRevenue - totalCogs

  const totalMarketplaceCharges = facts.forwardShipping + facts.returnShipping + facts.otherMarketplaceFees

  // Charged per shipment, not per unit: one parcel takes one mailer whatever
  // is in it.
  const packaging = facts.subOrdersDispatched * packagingPerShipment
  const totalOwnFulfilment = packaging

  const netPlatformAdjustments =
    facts.compensation + facts.claims - facts.recovery - facts.platformRecoverySubscriptions

  // Everything between the goods and advertising, struck once. The four rungs
  // this statement used to carry were numbered CM1 to CM4 and meant something
  // different at every number from what the same names meant on Flipkart, so
  // two channels could not be read side by side. One ladder now: the goods,
  // the marketplace, advertising, the fixed expenses. Nothing is deducted
  // that was not deducted before, and net profit is unchanged.
  const cm2 = cm1 - totalMarketplaceCharges - totalOwnFulfilment + netPlatformAdjustments

  // Affiliate commission sits here rather than among marketplace fees: it is
  // paid to acquire a customer, so hiding it in fees understates what demand
  // costs and overstates the margin above.
  //
  // Advertising is carried including GST, which is the Total Ads Cost column
  // the business reconciles the month against. Spend and tax are shown on
  // their own lines above so the split stays visible.
  const totalAdvertising = facts.adsSpendExGst - facts.adCredits + facts.gstOnAds + facts.affiliateFee
  const cm3 = cm2 - totalAdvertising

  const cm4 = cm3 - overheads

  // The tax is read from the file rather than re-derived at an assumed rate.
  const adsInclGst = facts.adsSpendExGst - facts.adCredits + facts.gstOnAds
  const expectedBankCredit =
    facts.netSettlementPerFile - adsInclGst - facts.platformRecoverySubscriptions

  return {
    grossSales: facts.grossSalesInclGst,
    cancellations: -facts.cancellationsInclGst,
    salesReturns: -facts.salesReturnsInclGst,
    netSalesInclGst,
    outputGst: -facts.outputGstOnSales,
    netRevenue,

    cogsUnitsSold: -facts.cogsUnitsSold,
    cogsRtoWriteOff: -facts.cogsRtoWriteOff,
    cogsReturnWriteOff: -facts.cogsReturnWriteOff,
    totalCogs: -totalCogs,
    cm1,
    cm1Pct: pct(cm1, netRevenue),

    forwardShipping: -facts.forwardShipping,
    returnShipping: -facts.returnShipping,
    otherMarketplaceFees: -facts.otherMarketplaceFees,
    totalMarketplaceCharges: -totalMarketplaceCharges,

    packaging: -packaging,
    totalOwnFulfilment: -totalOwnFulfilment,

    compensation: facts.compensation,
    claims: facts.claims,
    recovery: -facts.recovery,
    platformRecovery: -facts.platformRecoverySubscriptions,
    netPlatformAdjustments,
    cm2,
    cm2Pct: pct(cm2, netRevenue),

    adsSpend: -facts.adsSpendExGst,
    adCredits: facts.adCredits,
    adsGst: -facts.gstOnAds,
    affiliateFee: -facts.affiliateFee,
    totalAdvertising: -totalAdvertising,
    cm3,
    cm3Pct: pct(cm3, netRevenue),
    acosPct: pct(totalAdvertising, netRevenue),

    overheads: -overheads,
    cm4,
    cm4Pct: pct(cm4, netRevenue),

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
  const cm4 = computed.cm3 - otherCosts
  return {
    ...computed,
    overheads: -otherCosts,
    cm4,
    cm4Pct: pct(cm4, computed.netRevenue),
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
export function meeshoToCanonicalBuckets(
  facts: MeeshoPnlFacts,
  packagingPerShipment: number = MEESHO_ASSUMPTIONS.packagingPerShipment,
): PnlLineValues {
  const packaging = facts.subOrdersDispatched * packagingPerShipment

  return {
    grossSales: facts.grossSalesInclGst,
    discounts: 0,
    // Cancellations ride with returns in the canonical shape, which has no
    // bucket of its own for them. They are a deduction from gross either way,
    // so Net Sales agrees with the statement; only the native view splits them
    // out, which is where the split is worth seeing.
    returns: facts.salesReturnsInclGst + facts.cancellationsInclGst,
    // Output GST was never revenue; removing it here is what makes the
    // canonical Net Sales equal the native NET REVENUE line.
    otherRevenueAdj: facts.outputGstOnSales,
    cogs: facts.cogsUnitsSold + facts.cogsRtoWriteOff + facts.cogsReturnWriteOff,
    marketplaceCommission: facts.otherMarketplaceFees,
    fulfilment: packaging,
    shipping: facts.forwardShipping + facts.returnShipping,
    collectionFees: 0,
    rtoCharges: 0,
    returnCharges: 0,
    otherMarketplaceCharges:
      facts.recovery + facts.platformRecoverySubscriptions - facts.compensation - facts.claims,
    ads: facts.adsSpendExGst - facts.adCredits + facts.gstOnAds + facts.affiliateFee,
    performanceMarketing: 0,
    otherMarketing: 0,
  }
}
