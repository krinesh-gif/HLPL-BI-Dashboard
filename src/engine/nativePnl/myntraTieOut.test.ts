import { describe, expect, it } from 'vitest'
import type { MyntraPnlFacts } from '@/data/models'
import { computeSubtotals } from '../subtotals'
import { computeMyntraPnl, myntraToCanonicalBuckets, MYNTRA_LINE_DEFS } from './myntra'
import { groupTotalsAgree } from './groupTotals.test'

/**
 * September 2026, exactly as `myntra_facts` holds it.
 *
 * COGS is zero because no Myntra SKU has a cost on file yet. That is a real
 * gap in the data, not a shortcut taken here, and it is the reason this month
 * is useful for the question below: with COGS at zero the whole distance from
 * net revenue down to CM2 is the marketplace's own charge, so if the statement
 * and the P&L disagree about that charge by a rupee, it shows.
 */
const SEPT: MyntraPnlFacts = {
  month: '2026-09',
  sellerId: '26493',
  grossSales: 656895,
  grossSalesUnits: 2729,
  returnsAndCancellations: 156694,
  returnsAndCancellationsUnits: 588,
  estimatedNetSales: 500201,
  estimatedNetSalesUnits: 2141,
  fwdCommissionFee: 78445.07699999944,
  fwdTaxesTcs: 2542.597999999992,
  fwdTaxesTds: 508.67300000000375,
  fwdLogisticCharge: 127384.54235999902,
  fwdAdditionalCharges: 0,
  forwardExpense: 208880.89035999775,
  revCommissionRecovery: 12342.925000000005,
  revTcsRecovery: 406.05100000000033,
  revTdsRecovery: 81.23600000000008,
  revLogisticCharge: 68652.40000000021,
  revAdditionalRecovery: 0,
  reverseExpense: -55822.18799999997,
  totalExpenses: 264703.07835999853,
  estimatedNetSalesAfterExpenses: 235497.92164000147,
  productGst: 86929.80000000045,
  nodPaid: 0,
  nodDeducted: 0,
  sjitIncentive: 30130.997,
  commissionDiscount: 12145.002,
  rewardsAndBenefits: 42275.998999999996,
  orderSpf: 0,
  bankSettlementProjected: 265628.91964000143,
  bankSettlementSettled: 337919.451640001,
  bankSettlementUnsettled: -72290.53199999954,
  inputTaxCredits: 508.67300000000375,
  inputTaxCreditsGstTcs: 508.67300000000375,
  inputTaxCreditsTds: 0,
  earningsOnPlatform: 266137.59264000144,
  netMarginPct: 0.531,
  cogsPriced: 0,
  cogsUnpriced: 0,
  myntraAds: 0,
}

/**
 * The statement and the P&L, on the same month, rung by rung.
 *
 * Two reports of one month have to agree, and the way they stop agreeing is
 * never a wrong formula on both sides — it is a charge that one of them
 * deducts and the other does not see. Flipkart's fixed fee was exactly that:
 * deducted inside Total Marketplace Fees on the statement, in no bucket at
 * all in the P&L, and 4,83,916 of real cost missing from the company's EBITDA
 * for six months before anyone added the two columns up.
 *
 * So each rung is checked against its opposite number rather than against a
 * figure typed in here.
 */
describe('Myntra: the statement and the P&L tell the same story', () => {
  const native = computeMyntraPnl(SEPT)
  const canonical = computeSubtotals(myntraToCanonicalBuckets(SEPT))

  it('starts from the same net revenue', () => {
    expect(native.netRevenueExGst).toBeCloseTo(canonical.netSales ?? 0, 2)
  })

  it('agrees on what the marketplace kept', () => {
    const pnlFees =
      (canonical.marketplaceCommission ?? 0) + (canonical.fulfilment ?? 0) +
      (canonical.shipping ?? 0) + (canonical.collectionFees ?? 0) +
      (canonical.rtoCharges ?? 0) + (canonical.returnCharges ?? 0) +
      (canonical.otherMarketplaceCharges ?? 0)
    expect(Math.abs(native.netMarketplaceCharges)).toBeCloseTo(pnlFees, 2)
    // 2,34,063.41 for September: 2,64,703.08 of expenses, less the 30,131
    // incentive and the 509 of input tax credit that come back.
    expect(Math.abs(native.netMarketplaceCharges)).toBeCloseTo(234063.41, 2)
  })

  it('strikes CM1 after the goods, as the P&L does', () => {
    expect(native.cm1).toBeCloseTo(canonical.grossProfit ?? 0, 2)
  })

  it('strikes CM2 after the marketplace, as the P&L does', () => {
    expect(native.cm2).toBeCloseTo(canonical.channelMargin ?? 0, 2)
  })

  it('strikes CM3 after advertising, as the P&L does', () => {
    expect(native.cm3).toBeCloseTo(canonical.contributionProfit ?? 0, 2)
  })

  it('moved no money when the ladder was reordered', () => {
    // CM2 was derived from Earnings on Platform before the charges were given
    // a line of their own. Same figure, now with its working on the page.
    const cm2FromEarnings = SEPT.earningsOnPlatform - SEPT.productGst - (SEPT.cogsPriced + SEPT.cogsUnpriced)
    // To the paisa, not beyond it: Myntra's printed Earnings on Platform is a
    // tenth of a paisa off the sum of the lines it is made of, in Myntra's own
    // sheet. Nothing here can close that, and nothing should pretend to.
    expect(native.cm2).toBeCloseTo(cm2FromEarnings, 2)
  })

  it('shows the charge block adding up to the figure it hides', () => {
    expect(groupTotalsAgree(MYNTRA_LINE_DEFS, native)).toEqual([])
  })

  it('deducts the marketplace below COGS, not above it', () => {
    // The complaint this ladder answers: "Total Expenses above the COGS — is
    // it not wrong? Flipkart deducts COGS first." Myntra's own report does
    // print its charges first; the company's margin section must not.
    const order = MYNTRA_LINE_DEFS.filter((d) => d.section === 'YOUR MARGIN').map((d) => d.key)
    expect(order.indexOf('totalCogs')).toBeLessThan(order.indexOf('cm1'))
    expect(order.indexOf('cm1')).toBeLessThan(order.indexOf('netMarketplaceCharges'))
    expect(order.indexOf('netMarketplaceCharges')).toBeLessThan(order.indexOf('cm2'))
    expect(order.indexOf('cm2')).toBeLessThan(order.indexOf('myntraAds'))
    expect(order.indexOf('myntraAds')).toBeLessThan(order.indexOf('cm3'))
  })
})
