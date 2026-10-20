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
 * Myntra prints its charges first, above anything about the goods, because it
 * has no way of knowing what the goods cost. The company's section below does
 * not inherit that order: it strikes CM1 after COGS and CM2 after the
 * marketplace, the same ladder every other channel uses, and restates the
 * charges as a single block in the place the ladder deducts them.
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
  { key: 'fwdCommissionFee', label: '◦ Commission Fee', section: 'EXPENSES', kind: 'input', fee: 'commission', group: 'expenses' },
  { key: 'fwdTaxesTcs', label: '◦ Taxes (TCS)', section: 'EXPENSES', kind: 'input', fee: 'withholding', group: 'expenses' },
  { key: 'fwdTaxesTds', label: '◦ Taxes (TDS)', section: 'EXPENSES', kind: 'input', fee: 'withholding', group: 'expenses' },
  { key: 'fwdLogisticCharge', label: '◦ Logistic Charge', section: 'EXPENSES', kind: 'input', fee: 'shipping', group: 'expenses' },
  { key: 'fwdAdditionalCharges', label: '◦ Additional Charges', section: 'EXPENSES', kind: 'input', fee: 'otherFees', group: 'expenses' },
  { key: 'reverseExpense', label: '• Reverse Expense', section: 'EXPENSES', kind: 'subtotal', group: 'expenses' },
  { key: 'revCommissionRecovery', label: '◦ Commission Recovery', section: 'EXPENSES', kind: 'input', fee: 'commission', group: 'expenses' },
  { key: 'revTcsRecovery', label: '◦ TCS Recovery', section: 'EXPENSES', kind: 'input', fee: 'withholding', group: 'expenses' },
  { key: 'revTdsRecovery', label: '◦ TDS Recovery', section: 'EXPENSES', kind: 'input', fee: 'withholding', group: 'expenses' },
  { key: 'revLogisticCharge', label: '◦ Reverse Logistic Charge', section: 'EXPENSES', kind: 'input', fee: 'returnsLogistics', group: 'expenses' },
  { key: 'revAdditionalRecovery', label: '◦ Additional Recovery', section: 'EXPENSES', kind: 'input', fee: 'otherFees', group: 'expenses' },

  { key: 'estimatedNetSalesAfterExpenses', label: 'Estimated Net Sales After Expenses', section: 'EXPENSES', kind: 'subtotal' },
  {
    key: 'productGst', label: '• Product GST', section: 'EXPENSES', kind: 'input', memoOf: 'estimatedNetSalesAfterExpenses',
    note: 'Collected on the sale and owed onward — Myntra does not deduct it from the settlement',
  },

  { key: 'nodPaid', label: 'NOD Paid', section: 'SETTLEMENT', kind: 'input', fee: 'otherFees', hideWhenZero: true },
  { key: 'nodDeducted', label: 'NOD Deducted', section: 'SETTLEMENT', kind: 'input', fee: 'otherFees', hideWhenZero: true },
  {
    key: 'rewardsAndBenefits', label: 'Total Rewards & Other Benefits', section: 'SETTLEMENT',
    kind: 'subtotal', group: 'rewards', isGroupHead: true,
  },
  { key: 'sjitIncentive', label: '• SJIT Incentive', section: 'SETTLEMENT', kind: 'input', fee: 'otherFees', group: 'rewards' },
  {
    key: 'commissionDiscount', label: '• Commission Discount', section: 'SETTLEMENT', kind: 'input',
    group: 'rewards', memoOf: 'rewardsAndBenefits',
    note: 'Already inside the Commission Fee — shown for reference, not added again',
  },
  { key: 'orderSpf', label: '• Order SPF', section: 'SETTLEMENT', kind: 'input', fee: 'otherFees', hideWhenZero: true },

  {
    key: 'inputTaxCredits', label: 'Total Input Tax Credits', section: 'SETTLEMENT',
    kind: 'subtotal', group: 'itc', isGroupHead: true,
  },
  { key: 'inputTaxCreditsGstTcs', label: '• GST + TCS', section: 'SETTLEMENT', kind: 'input', group: 'itc' },
  { key: 'inputTaxCreditsTds', label: '• TDS', section: 'SETTLEMENT', kind: 'input', group: 'itc' },
  { key: 'earningsOnPlatform', label: 'Earnings on Platform', section: 'SETTLEMENT', kind: 'subtotal' },
  { key: 'netMarginPct', label: 'Net Margin (% of Net Sales)', section: 'SETTLEMENT', kind: 'percent' },

  { key: 'netRevenueExGst', label: 'NET REVENUE (ex-GST)', section: 'YOUR MARGIN', kind: 'subtotal', note: '⭐ denominator for every % — Estimated Net Sales less Product GST' },
  { key: 'totalCogs', label: 'Total COGS', section: 'YOUR MARGIN', kind: 'subtotal', group: 'cogs', isGroupHead: true },
  { key: 'cogsPriced', label: 'COGS — priced SKUs', section: 'YOUR MARGIN', kind: 'input', group: 'cogs' },
  { key: 'cogsUnpriced', label: 'COGS — unpriced SKUs (est.)', section: 'YOUR MARGIN', kind: 'input', note: '⚠ estimate — goes to zero once every SKU is priced', group: 'cogs' },
  { key: 'cm1', label: 'GROSS MARGIN (CM1)', section: 'YOUR MARGIN', kind: 'subtotal' },
  { key: 'cm1Pct', label: 'CM1 %', section: 'YOUR MARGIN', kind: 'percent' },

  // The rung between CM1 and CM2 used to be invisible here. Myntra's own
  // report prints its charges at the top, above anything about the goods,
  // because Myntra does not know what the goods cost — so the margin section
  // jumped straight from CM1 to CM2 with nothing between them, and read as
  // though this channel deducted its charges before its COGS while Flipkart
  // deducted them after. It never did: both strike CM1 after the goods and
  // CM2 after the marketplace. This block is that deduction, written where
  // the ladder makes it, and it restates the figures above rather than
  // adding any new cost — CM2 is unchanged to the paisa.
  {
    key: 'netMarketplaceCharges', label: 'Net Marketplace Charges', section: 'YOUR MARGIN',
    kind: 'subtotal', group: 'mpCharges', isGroupHead: true,
    note: 'Everything Myntra kept between Estimated Net Sales and Earnings on Platform — the same figure the P&L carries as this channel’s marketplace fees',
  },
  { key: 'mpChargesExpenses', label: '(−) Total Expenses (Forward − Reverse)', section: 'YOUR MARGIN', kind: 'input', group: 'mpCharges', note: 'The block at the top of this statement, restated here — not a second charge' },
  { key: 'mpChargesNodDeducted', label: '(−) NOD Deducted', section: 'YOUR MARGIN', kind: 'input', group: 'mpCharges', hideWhenZero: true },
  { key: 'mpChargesNodPaid', label: 'Add: NOD Paid', section: 'YOUR MARGIN', kind: 'input', group: 'mpCharges', hideWhenZero: true },
  { key: 'mpChargesOrderSpf', label: 'Add: Order SPF', section: 'YOUR MARGIN', kind: 'input', group: 'mpCharges', hideWhenZero: true },
  { key: 'mpChargesSjit', label: 'Add: SJIT Incentive', section: 'YOUR MARGIN', kind: 'input', group: 'mpCharges' },
  { key: 'mpChargesItc', label: 'Add: Input Tax Credits', section: 'YOUR MARGIN', kind: 'input', group: 'mpCharges' },
  { key: 'cm2', label: 'CHANNEL MARGIN (CM2)', section: 'YOUR MARGIN', kind: 'subtotal', note: 'Is this marketplace worth being on?' },
  { key: 'cm2Pct', label: 'CM2 %', section: 'YOUR MARGIN', kind: 'percent' },
  { key: 'myntraAds', label: '(−) Myntra Ads', section: 'YOUR MARGIN', kind: 'input', fee: 'advertising', note: 'From the PLA campaign report\u2019s ad_spend column, summed over the month. Myntra\u2019s P&L report carries no advertising line of its own.' },
  { key: 'cm3', label: 'CONTRIBUTION MARGIN (CM3)', section: 'YOUR MARGIN', kind: 'subtotal', note: '⭐ the number to manage the business on' },
  { key: 'cm3Pct', label: 'CM3 %', section: 'YOUR MARGIN', kind: 'percent' },
  { key: 'otherCosts', label: '(−) Allocated Fixed Expenses', section: 'YOUR MARGIN', kind: 'input' },
  { key: 'cm4', label: 'NET PROFIT (CM4)', section: 'YOUR MARGIN', kind: 'subtotal' },
  { key: 'cm4Pct', label: 'Net Profit %', section: 'YOUR MARGIN', kind: 'percent' },

  // When the money arrives, not what was earned. These three sat in the
  // middle of the statement, between the charges and Earnings on Platform,
  // where Settled read as though it contradicted Projected — 3,37,919
  // against 2,65,629 for September, because what lands in a month is partly
  // last month's sales. Nothing above or below is computed from them, so they
  // belong at the end, after the margin they have no part in.
  {
    key: 'bankSettlementProjected', label: 'Bank Settlement (Projected)', section: 'CASH SETTLEMENT', kind: 'input',
    note: 'What this month\u2019s sales should settle to \u2014 cash timing only, in neither the P&L nor any margin above',
  },
  { key: 'bankSettlementSettled', label: 'Bank Settlement (Settled)', section: 'CASH SETTLEMENT', kind: 'input', note: 'Received in the month, including settlements of earlier months\u2019 sales' },
  { key: 'bankSettlementUnsettled', label: 'Bank Settlement (Unsettled)', section: 'CASH SETTLEMENT', kind: 'input', note: 'Still owed at month end' },
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
  // What Myntra kept: the forward and reverse expenses, less the incentive,
  // the tax credits and the other settlement credits that come back.
  //
  // Built from the parts rather than as `Estimated Net Sales less Earnings on
  // Platform`, because Earnings on Platform does not carry NOD or Order SPF.
  // Those have been zero every month so far, but the day one is not, the
  // difference would be a charge this statement deducted and the P&L did not.
  // Summed this way the two agree by construction.
  const netMarketplaceCharges =
    facts.totalExpenses + facts.nodDeducted - facts.nodPaid - facts.orderSpf -
    facts.sjitIncentive - facts.inputTaxCredits
  const cm2 = cm1 - netMarketplaceCharges
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
    netMarketplaceCharges: -netMarketplaceCharges,
    mpChargesExpenses: -facts.totalExpenses,
    mpChargesNodDeducted: -facts.nodDeducted,
    mpChargesNodPaid: facts.nodPaid,
    mpChargesOrderSpf: facts.orderSpf,
    mpChargesSjit: facts.sjitIncentive,
    mpChargesItc: facts.inputTaxCredits,
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
