import type { BlinkitPnlFacts, PnlLineValues } from '@/data/models'
import type { NativeLineDef, NativeLineValues } from './types'

/**
 * Blinkit's P&L, in the shape of the statement Blinkit itself publishes.
 *
 * The Payout Breakup runs A, B1–B5, C1–C4, D1–D5, E and then the net payout,
 * and it is an arithmetic identity: customer payable less every charge plus
 * every addition equals what lands in the bank. This statement keeps that
 * identity visible — the Net Payout line at the bottom is checked against the
 * figure the file itself states, so a month where the two part company says so
 * instead of quietly reporting the wrong one.
 *
 * Three things about Blinkit make its statement different from the others:
 *
 *  1. STORAGE IS THE MAIN COST, not commission. Blinkit holds our stock in its
 *     dark stores and charges ageing on it by the unit per day, whether or not
 *     it sells. In August that was ₹3,689 against ₹6,430 of sales — more than
 *     half the top line, where commission was ₹152. A statement that grouped
 *     them as "marketplace fees" would hide the only number worth acting on.
 *
 *  2. GST IS SHOWN BESIDE EACH CHARGE, not inside it. Blinkit bills the tax
 *     separately on every line, and it is recoverable as input credit, so a
 *     statement that folded it in would report a cost the business does not
 *     bear. It is deducted from the payout — that is cash — but held out of
 *     the margin ladder.
 *
 *  3. THE PAYOUT IS NOT THE PROFIT. What Blinkit transfers is net of tax it
 *     collects on our behalf and net of GST we reclaim. The ladder below is
 *     measured on NET REVENUE, ex-GST, as Meesho's is, so the two channels'
 *     margins mean the same thing.
 */
export const BLINKIT_LINE_DEFS: NativeLineDef[] = [
  { key: 'mrpValue', label: 'Value at MRP', section: 'REVENUE', kind: 'input',
    note: 'What the same units would have fetched at printed price' },
  { key: 'blinkitDiscount', label: 'Less: Discount to the shopper', section: 'REVENUE', kind: 'input',
    note: 'The gap between MRP and what Blinkit sold at' },
  { key: 'customerPayable', label: 'Customer Payable (incl. GST)', section: 'REVENUE', kind: 'subtotal',
    note: 'Row A of the payout sheet — the top line every charge comes out of' },
  { key: 'outputGst', label: 'Less: Output GST', section: 'REVENUE', kind: 'input',
    note: 'Collected for the government, never revenue' },
  { key: 'netRevenue', label: 'NET REVENUE (ex-GST)', section: 'REVENUE', kind: 'subtotal' },

  { key: 'commission', label: 'Commission', section: 'ORDER CHARGES', kind: 'input', fee: 'commission' },
  { key: 'shipping', label: 'Shipping', section: 'ORDER CHARGES', kind: 'input', fee: 'shipping' },
  { key: 'customerReturnCharge', label: 'Customer return charge', section: 'ORDER CHARGES', kind: 'input', fee: 'returnsLogistics', hideWhenZero: true },
  { key: 'totalOrderCharges', label: 'Total Order Charges', section: 'ORDER CHARGES', kind: 'subtotal' },
  { key: 'cm1', label: 'CONTRIBUTION MARGIN 1 (after order charges)', section: 'ORDER CHARGES', kind: 'subtotal' },
  { key: 'cm1Pct', label: 'CM1 %', section: 'ORDER CHARGES', kind: 'percent' },

  { key: 'storageCharge', label: 'Storage / ageing charge', section: 'INVENTORY & FULFILMENT', kind: 'input', fee: 'storage',
    note: 'Charged per unit per day on stock sitting in Blinkit’s dark stores, sold or not' },
  { key: 'upfrontStorage', label: 'Upfront storage charge', section: 'INVENTORY & FULFILMENT', kind: 'input', fee: 'storage', hideWhenZero: true },
  { key: 'recallCharge', label: 'Recall charge', section: 'INVENTORY & FULFILMENT', kind: 'input', fee: 'returnsLogistics', hideWhenZero: true },
  { key: 'courierCharge', label: 'Courier charge', section: 'INVENTORY & FULFILMENT', kind: 'input', fee: 'shipping', hideWhenZero: true },
  { key: 'totalInventoryCharges', label: 'Total Inventory & Fulfilment', section: 'INVENTORY & FULFILMENT', kind: 'subtotal' },
  { key: 'cm2', label: 'CONTRIBUTION MARGIN 2 (after inventory)', section: 'INVENTORY & FULFILMENT', kind: 'subtotal' },
  { key: 'cm2Pct', label: 'CM2 %', section: 'INVENTORY & FULFILMENT', kind: 'percent' },

  { key: 'adsRefund', label: 'Ads refund', section: 'ADJUSTMENTS', kind: 'input', fee: 'otherFees', hideWhenZero: true },
  { key: 'lostDamagedCompensation', label: 'Lost / damaged stock compensation', section: 'ADJUSTMENTS', kind: 'input', fee: 'otherFees', hideWhenZero: true },
  { key: 'otherCreditDebitNote', label: 'Other credit / debit notes', section: 'ADJUSTMENTS', kind: 'input', fee: 'otherFees', hideWhenZero: true },
  { key: 'otherDeductions', label: 'Other deductions', section: 'ADJUSTMENTS', kind: 'input', fee: 'otherFees', hideWhenZero: true },
  { key: 'netAdjustments', label: 'Net Adjustments', section: 'ADJUSTMENTS', kind: 'subtotal' },
  { key: 'cm3', label: 'CONTRIBUTION MARGIN 3 (after adjustments)', section: 'ADJUSTMENTS', kind: 'subtotal' },
  { key: 'cm3Pct', label: 'CM3 %', section: 'ADJUSTMENTS', kind: 'percent' },

  { key: 'adsSpend', label: 'Less: Advertising', section: 'PROFIT', kind: 'input', fee: 'advertising', hideWhenZero: true,
    note: 'From Blinkit’s own campaign report — the Estimated Budget Consumed column, summed over the month. Billed separately from the payout, so it is not in the ladder above.' },
  { key: 'cogs', label: 'Less: COGS', section: 'PROFIT', kind: 'input',
    note: 'From the cost sheet, for the units Blinkit sold' },
  { key: 'grossProfit', label: 'Gross Profit (after COGS)', section: 'PROFIT', kind: 'subtotal' },
  { key: 'grossMarginPct', label: 'Gross Margin %', section: 'PROFIT', kind: 'percent' },
  { key: 'overheads', label: 'Less: Allocated Fixed Expenses', section: 'PROFIT', kind: 'input',
    note: 'This channel’s share of the month’s fixed expenses, by its share of sales' },
  { key: 'ebitda', label: 'EBITDA', section: 'PROFIT', kind: 'subtotal' },
  { key: 'ebitdaPct', label: 'EBITDA %', section: 'PROFIT', kind: 'percent' },

  // ---- Cash, which is a different question from profit -------------------
  { key: 'gstOnCharges', label: 'GST charged on the above', section: 'WHAT BLINKIT PAID', kind: 'input', fee: 'feeTax',
    note: 'Recoverable as input credit, so it is cash but not cost' },
  { key: 'tcs', label: 'TCS withheld', section: 'WHAT BLINKIT PAID', kind: 'input', fee: 'withholding', hideWhenZero: true },
  { key: 'tds', label: 'TDS withheld (194O & Q)', section: 'WHAT BLINKIT PAID', kind: 'input', fee: 'withholding' },
  { key: 'netPayout', label: 'NET PAYOUT THIS CYCLE', section: 'WHAT BLINKIT PAID', kind: 'subtotal',
    note: 'Row by row, this is the figure the payout sheet ends on' },
  { key: 'payoutPerFile', label: 'Net payout stated by Blinkit', section: 'WHAT BLINKIT PAID', kind: 'input',
    memoOf: 'netPayout', note: 'Checked against the line above — the two must agree' },

  { key: 'lpSpAdjustment', label: 'LP-SP adjustments in this archive', section: 'NOT IN THE PAYOUT', kind: 'input',
    hideWhenZero: true,
    note: 'Credit and debit notes against goods received in earlier months. Not in Blinkit’s payout sheet and not in any margin above.' },
]

const pct = (part: number, whole: number): number => (whole === 0 ? 0 : (part / whole) * 100)

/**
 * The statement, from one month's facts.
 *
 * `cogs` and `overheads` come from outside the archive — Blinkit's file knows
 * what it charged, not what the goods cost us or what head office costs — so
 * they are passed in and default to nil, which reports a gross profit that is
 * plainly missing its cost rather than one that looks complete and is wrong.
 */
/**
 * `adsSpend` comes from the campaign report, not the payout archive: Blinkit
 * bills advertising separately, at a fifteen-day lag, and the payout sheet's
 * own "Ads Budget Spend" row has been nil on every archive so far. If that
 * row ever carries an amount it is reported as a charge with no home rather
 * than quietly added here, so the two sources cannot double-count.
 */
export function computeBlinkitPnl(facts: BlinkitPnlFacts, cogs = 0, overheads = 0, adsSpend = 0): NativeLineValues {
  const netRevenue = facts.customerPayable - facts.outputGstOnSales
  const blinkitDiscount = Math.max(0, facts.mrpValue - facts.customerPayable)

  const totalOrderCharges = facts.commission + facts.shipping + facts.customerReturnCharge
  const cm1 = netRevenue - totalOrderCharges

  const totalInventoryCharges =
    facts.storageCharge + facts.upfrontStorage + facts.recallCharge + facts.courierCharge
  const cm2 = cm1 - totalInventoryCharges

  // Additions count for us, deductions against. Blinkit's own D block is
  // money coming back, so it lifts the margin rather than lowering it.
  const netAdjustments =
    facts.adsRefund + facts.lostDamagedCompensation + facts.otherCreditDebitNote - facts.otherDeductions
  const cm3 = cm2 + netAdjustments

  const grossProfit = cm3 - cogs
  // Advertising sits below gross profit and above the allocated overhead, the
  // same place it sits in the canonical buckets, so the two agree on EBITDA.
  const ebitda = grossProfit - adsSpend - overheads

  // What actually moves: every charge's GST and the tax withheld at source.
  // Recoverable or creditable, so none of it is in the ladder above, but all
  // of it is out of the bank this cycle.
  const gstOnCharges =
    facts.commissionGst + facts.shippingGst + facts.customerReturnChargeGst +
    facts.storageChargeGst + facts.upfrontStorageGst + facts.recallChargeGst + facts.courierChargeGst -
    facts.adsRefundGst
  const netPayout =
    facts.customerPayable
    - totalOrderCharges - totalInventoryCharges - gstOnCharges
    - facts.tcs - facts.tds
    + facts.adsRefund + facts.lostDamagedCompensation + facts.otherCreditDebitNote
    + facts.tcsReimbursement + facts.tdsReimbursement
    - facts.otherDeductions

  return {
    adsSpend: -adsSpend,
    mrpValue: facts.mrpValue,
    blinkitDiscount: -blinkitDiscount,
    customerPayable: facts.customerPayable,
    outputGst: -facts.outputGstOnSales,
    netRevenue,

    commission: -facts.commission,
    shipping: -facts.shipping,
    customerReturnCharge: -facts.customerReturnCharge,
    totalOrderCharges: -totalOrderCharges,
    cm1,
    cm1Pct: pct(cm1, netRevenue),

    storageCharge: -facts.storageCharge,
    upfrontStorage: -facts.upfrontStorage,
    recallCharge: -facts.recallCharge,
    courierCharge: -facts.courierCharge,
    totalInventoryCharges: -totalInventoryCharges,
    cm2,
    cm2Pct: pct(cm2, netRevenue),

    adsRefund: facts.adsRefund,
    lostDamagedCompensation: facts.lostDamagedCompensation,
    otherCreditDebitNote: facts.otherCreditDebitNote,
    otherDeductions: -facts.otherDeductions,
    netAdjustments,
    cm3,
    cm3Pct: pct(cm3, netRevenue),

    cogs: -cogs,
    grossProfit,
    grossMarginPct: pct(grossProfit, netRevenue),
    overheads: -overheads,
    ebitda,
    ebitdaPct: pct(ebitda, netRevenue),

    gstOnCharges: -gstOnCharges,
    tcs: -facts.tcs,
    tds: -facts.tds,
    netPayout,
    payoutPerFile: facts.netPayoutPerFile,

    lpSpAdjustment: facts.lpSpAdjustmentInclTax,
  }
}

/**
 * Blinkit's figures in the generic buckets the Master P&L rolls up.
 *
 * Net Sales is NET REVENUE (ex-GST), the same basis Meesho uses, so the two
 * add together meaningfully. Storage is the interesting mapping: it is not a
 * commission and not shipping, so it goes to fulfilment, which is where a cost
 * of holding stock belongs.
 */
export function blinkitToCanonicalBuckets(facts: BlinkitPnlFacts, cogs = 0, adsSpend = 0): PnlLineValues {
  return {
    grossSales: facts.customerPayable,
    discounts: 0,
    returns: facts.customerReturnCharge,
    otherRevenueAdj: facts.outputGstOnSales,
    cogs,
    marketplaceCommission: facts.commission,
    fulfilment: facts.storageCharge + facts.upfrontStorage + facts.recallCharge,
    shipping: facts.shipping + facts.courierCharge,
    collectionFees: 0,
    rtoCharges: 0,
    returnCharges: 0,
    // Blinkit's D block nets against the marketplace's other charges. A
    // refund is money back, so it reduces the cost rather than adding to it.
    otherMarketplaceCharges:
      facts.otherDeductions - facts.adsRefund - facts.lostDamagedCompensation - facts.otherCreditDebitNote,
    // Billed separately from the payout and read from the campaign report,
    // the same figure the Ads screens show. One figure, one source.
    ads: adsSpend,
    performanceMarketing: 0,
    otherMarketing: 0,
  }
}
