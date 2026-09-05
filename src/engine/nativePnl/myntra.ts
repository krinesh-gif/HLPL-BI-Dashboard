import type { MyntraPnlFacts, PnlLineValues } from '@/data/models'
import type { NativeLineDef, NativeLineValues } from './types'

/**
 * Myntra's own Profit & Loss report, reproduced line for line.
 *
 * The statement is in two halves. Everything down to "Net Margin" is Myntra's
 * sheet, in Myntra's order, with Myntra's wording — every figure is the number
 * printed in `PnL_Summary`, not a number derived from it, so the dashboard and
 * the sheet can be read side by side and agree. The section below that is the
 * company's own: what the goods cost and what is left, which Myntra has no way
 * of knowing.
 *
 * Two lines on Myntra's sheet are memos and must never be treated as
 * deductions or additions:
 *
 *  - Commission Discount is already inside the Commission Fee. Myntra prints it
 *    under "Rewards & Other Benefits" beside the SJIT incentive, but only the
 *    incentive reaches the bank: Bank Settlement (Projected) is exactly
 *    Estimated Net Sales After Expenses plus SJIT, to the paisa. Adding the
 *    discount as well would count 10,641 rupees of one July twice.
 *  - Product GST is collected on the sale and owed onward. It is shown where
 *    Myntra shows it and left out of the settlement arithmetic, then deducted
 *    once in the company's own section to state revenue ex-GST.
 */
export const MYNTRA_LINE_DEFS: NativeLineDef[] = [
  { key: 'grossSales', label: 'Gross Sales', section: 'SALES', kind: 'input' },
  { key: 'returnsCancellations', label: 'Returns and Cancellations', section: 'SALES', kind: 'input' },
  { key: 'estimatedNetSales', label: 'Estimated Net Sales', section: 'SALES', kind: 'subtotal' },

  {
    key: 'totalExpenses', label: 'Total Expenses (Forward − Reverse)', section: 'EXPENSES',
    kind: 'subtotal', group: 'expenses', isGroupHead: true,
  },
  { key: 'forwardExpense', label: '• Forward Expense', section: 'EXPENSES', kind: 'subtotal', group: 'expenses' },
  { key: 'fwdCommissionFee', label: '◦ Commission Fee', section: 'EXPENSES', kind: 'input', group: 'expenses' },
  { key: 'fwdTaxesTcs', label: '◦ Taxes (TCS)', section: 'EXPENSES', kind: 'input', group: 'expenses' },
  { key: 'fwdTaxesTds', label: '◦ Taxes (TDS)', section: 'EXPENSES', kind: 'input', group: 'expenses' },
  { key: 'fwdLogisticCharge', label: '◦ Logistic Charge', section: 'EXPENSES', kind: 'input', group: 'expenses' },
  { key: 'fwdAdditionalCharges', label: '◦ Additional Charges', section: 'EXPENSES', kind: 'input', group: 'expenses' },
  { key: 'reverseExpense', label: '• Reverse Expense', section: 'EXPENSES', kind: 'subtotal', group: 'expenses' },
  { key: 'revCommissionRecovery', label: '◦ Commission Recovery', section: 'EXPENSES', kind: 'input', group: 'expenses' },
  { key: 'revTcsRecovery', label: '◦ TCS Recovery', section: 'EXPENSES', kind: 'input', group: 'expenses' },
  { key: 'revTdsRecovery', label: '◦ TDS Recovery', section: 'EXPENSES', kind: 'input', group: 'expenses' },
  { key: 'revLogisticCharge', label: '◦ Reverse Logistic Charge', section: 'EXPENSES', kind: 'input', group: 'expenses' },
  { key: 'revAdditionalRecovery', label: '◦ Additional Recovery', section: 'EXPENSES', kind: 'input', group: 'expenses' },

  { key: 'estimatedNetSalesAfterExpenses', label: 'Estimated Net Sales After Expenses', section: 'EXPENSES', kind: 'subtotal' },
  {
    key: 'productGst', label: '• Product GST', section: 'EXPENSES', kind: 'input', memoOf: 'estimatedNetSalesAfterExpenses',
    note: 'Collected on the sale and owed onward — Myntra does not deduct it from the settlement',
  },

  { key: 'nodPaid', label: 'NOD Paid', section: 'SETTLEMENT', kind: 'input', hideWhenZero: true },
  { key: 'nodDeducted', label: 'NOD Deducted', section: 'SETTLEMENT', kind: 'input', hideWhenZero: true },
  {
    key: 'rewardsAndBenefits', label: 'Rewards & Other Benefits', section: 'SETTLEMENT',
    kind: 'subtotal', group: 'rewards', isGroupHead: true,
  },
  { key: 'sjitIncentive', label: '• SJIT Incentive', section: 'SETTLEMENT', kind: 'input', group: 'rewards' },
  {
    key: 'commissionDiscount', label: '• Commission Discount', section: 'SETTLEMENT', kind: 'input',
    group: 'rewards', memoOf: 'rewardsAndBenefits',
    note: 'Already inside the Commission Fee — shown for reference, not added again',
  },
  { key: 'orderSpf', label: '• Order SPF', section: 'SETTLEMENT', kind: 'input', hideWhenZero: true },

  { key: 'bankSettlementProjected', label: 'Bank Settlement (Projected)', section: 'SETTLEMENT', kind: 'subtotal' },
  { key: 'bankSettlementSettled', label: 'Bank Settlement (Settled)', section: 'SETTLEMENT', kind: 'input' },
  { key: 'bankSettlementUnsettled', label: 'Bank Settlement (Unsettled)', section: 'SETTLEMENT', kind: 'input' },
  {
    key: 'inputTaxCredits', label: 'Input Tax Credits', section: 'SETTLEMENT',
    kind: 'subtotal', group: 'itc', isGroupHead: true,
  },
  { key: 'inputTaxCreditsGstTcs', label: '• GST + TCS', section: 'SETTLEMENT', kind: 'input', group: 'itc' },
  { key: 'inputTaxCreditsTds', label: '• TDS', section: 'SETTLEMENT', kind: 'input', group: 'itc' },
  { key: 'earningsOnPlatform', label: 'Earnings on Platform', section: 'SETTLEMENT', kind: 'subtotal' },
  { key: 'netMarginPct', label: 'Net Margin (% of Net Sales)', section: 'SETTLEMENT', kind: 'percent' },

  { key: 'netRevenueExGst', label: 'NET REVENUE (ex-GST)', section: 'YOUR MARGIN', kind: 'subtotal', note: '⭐ denominator for every %' },
  { key: 'cogsPriced', label: 'Less: COGS — priced SKUs', section: 'YOUR MARGIN', kind: 'input' },
  { key: 'cogsUnpriced', label: 'Less: COGS — unpriced SKUs (est.)', section: 'YOUR MARGIN', kind: 'input', note: '⚠ estimate — goes to zero once every SKU is priced' },
  { key: 'totalCogs', label: 'Total COGS', section: 'YOUR MARGIN', kind: 'subtotal' },
  { key: 'cm1', label: 'GROSS MARGIN (CM1)', section: 'YOUR MARGIN', kind: 'subtotal' },
  { key: 'cm1Pct', label: 'CM1 %', section: 'YOUR MARGIN', kind: 'percent' },
  { key: 'cm2', label: 'CHANNEL MARGIN (CM2)', section: 'YOUR MARGIN', kind: 'subtotal', note: 'Earnings on Platform, less GST and what the goods cost' },
  { key: 'cm2Pct', label: 'CM2 %', section: 'YOUR MARGIN', kind: 'percent' },
  { key: 'myntraAds', label: 'Less: Myntra Ads', section: 'YOUR MARGIN', kind: 'input', note: 'Manual entry — the P&L report carries no advertising' },
  { key: 'cm3', label: 'CONTRIBUTION MARGIN (CM3)', section: 'YOUR MARGIN', kind: 'subtotal', note: '⭐ the number to manage the business on' },
  { key: 'cm3Pct', label: 'CM3 %', section: 'YOUR MARGIN', kind: 'percent' },
  { key: 'otherCosts', label: 'Less: Other Costs (allocated fixed expenses)', section: 'YOUR MARGIN', kind: 'input' },
  { key: 'cm4', label: 'NET PROFIT (CM4)', section: 'YOUR MARGIN', kind: 'subtotal' },
  { key: 'cm4Pct', label: 'Net Profit %', section: 'YOUR MARGIN', kind: 'percent' },
]

/**
 * Myntra's figures as printed, plus the company's own margin below them.
 *
 * Costs are rendered negative and credits positive, which is how the sheet
 * itself prints them. The subtotals down to Earnings on Platform are Myntra's
 * own values rather than sums computed here — the point of this statement is
 * that it agrees with the file, and re-deriving a total is how a report starts
 * disagreeing with the report it came from.
 */
export function computeMyntraPnl(facts: MyntraPnlFacts): NativeLineValues {
  const netRevenueExGst = facts.estimatedNetSales - facts.productGst
  const totalCogs = facts.cogsPriced + facts.cogsUnpriced
  const cm1 = netRevenueExGst - totalCogs
  // Earnings on Platform is cash including the GST that has to be paid onward,
  // so the GST comes off once here and the goods come off once.
  const cm2 = facts.earningsOnPlatform - facts.productGst - totalCogs
  const cm3 = cm2 - facts.myntraAds
  const pct = (v: number): number => (netRevenueExGst !== 0 ? (v / netRevenueExGst) * 100 : 0)

  return {
    grossSales: facts.grossSales,
    returnsCancellations: -facts.returnsAndCancellations,
    estimatedNetSales: facts.estimatedNetSales,

    totalExpenses: -facts.totalExpenses,
    forwardExpense: -facts.forwardExpense,
    fwdCommissionFee: -facts.fwdCommissionFee,
    fwdTaxesTcs: -facts.fwdTaxesTcs,
    fwdTaxesTds: -facts.fwdTaxesTds,
    fwdLogisticCharge: -facts.fwdLogisticCharge,
    fwdAdditionalCharges: -facts.fwdAdditionalCharges,
    // Myntra reports this one already signed: the recoveries are credits and
    // the reverse logistic charge is a cost, so the net is usually negative.
    reverseExpense: facts.reverseExpense,
    revCommissionRecovery: facts.revCommissionRecovery,
    revTcsRecovery: facts.revTcsRecovery,
    revTdsRecovery: facts.revTdsRecovery,
    revLogisticCharge: -facts.revLogisticCharge,
    revAdditionalRecovery: facts.revAdditionalRecovery,

    estimatedNetSalesAfterExpenses: facts.estimatedNetSalesAfterExpenses,
    productGst: -facts.productGst,

    nodPaid: facts.nodPaid,
    nodDeducted: -facts.nodDeducted,
    rewardsAndBenefits: facts.rewardsAndBenefits,
    sjitIncentive: facts.sjitIncentive,
    commissionDiscount: facts.commissionDiscount,
    orderSpf: facts.orderSpf,

    bankSettlementProjected: facts.bankSettlementProjected,
    bankSettlementSettled: facts.bankSettlementSettled,
    bankSettlementUnsettled: facts.bankSettlementUnsettled,
    inputTaxCredits: facts.inputTaxCredits,
    inputTaxCreditsGstTcs: facts.inputTaxCreditsGstTcs,
    inputTaxCreditsTds: facts.inputTaxCreditsTds,
    earningsOnPlatform: facts.earningsOnPlatform,
    netMarginPct: facts.netMarginPct * 100,

    netRevenueExGst,
    cogsPriced: -facts.cogsPriced,
    cogsUnpriced: -facts.cogsUnpriced,
    totalCogs: -totalCogs,
    cm1,
    cm1Pct: pct(cm1),
    cm2,
    cm2Pct: pct(cm2),
    myntraAds: -facts.myntraAds,
    cm3,
    cm3Pct: pct(cm3),
    otherCosts: 0, // filled in by applyMyntraOtherCosts once the allocation is known
    cm4: cm3,
    cm4Pct: pct(cm3),
  }
}

/** Applies this month's allocated share of fixed expenses to reach CM4. */
export function applyMyntraOtherCosts(computed: NativeLineValues, otherCosts: number): NativeLineValues {
  const cm4 = computed.cm3 - otherCosts
  const netRevenueExGst = computed.netRevenueExGst
  return { ...computed, otherCosts: -otherCosts, cm4, cm4Pct: netRevenueExGst !== 0 ? (cm4 / netRevenueExGst) * 100 : 0 }
}

/**
 * The same month in the generic buckets the Master P&L rolls up.
 *
 * Every rupee Myntra charged has to land in exactly one bucket and none may
 * land in two, so the recoveries are netted against the charges they reverse
 * rather than being added as their own line: commission is the forward fee
 * less the commission recovered on returns, and so on. The SJIT incentive and
 * the input tax credits reduce `otherMarketplaceCharges` because they are
 * money coming back, and the commission discount appears nowhere at all — it
 * is already inside the commission fee.
 */
export function myntraToCanonicalBuckets(facts: MyntraPnlFacts): PnlLineValues {
  const commission = facts.fwdCommissionFee - facts.revCommissionRecovery
  const shipping = facts.fwdLogisticCharge + facts.revLogisticCharge
  const taxesNet = facts.fwdTaxesTcs + facts.fwdTaxesTds - facts.revTcsRecovery - facts.revTdsRecovery
  const other =
    taxesNet + facts.fwdAdditionalCharges - facts.revAdditionalRecovery +
    facts.nodDeducted - facts.nodPaid - facts.orderSpf -
    facts.sjitIncentive - facts.inputTaxCredits

  return {
    grossSales: facts.grossSales,
    discounts: 0,
    returns: facts.returnsAndCancellations,
    // GST was collected on the sale and is owed onward, so it was never
    // revenue. Removing it here is what puts Myntra on the same ex-GST footing
    // as every other channel in the Master P&L.
    otherRevenueAdj: facts.productGst,
    cogs: facts.cogsPriced + facts.cogsUnpriced,
    marketplaceCommission: commission,
    fulfilment: 0,
    shipping,
    collectionFees: 0,
    rtoCharges: 0,
    returnCharges: 0,
    otherMarketplaceCharges: other,
    ads: facts.myntraAds,
    performanceMarketing: 0,
    otherMarketing: 0,
  }
}
