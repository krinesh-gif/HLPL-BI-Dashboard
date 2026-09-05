import { describe, expect, it } from 'vitest'
import { applyMyntraOtherCosts, computeMyntraPnl, myntraToCanonicalBuckets, MYNTRA_LINE_DEFS } from './myntra'
import type { MyntraPnlFacts } from '@/data/models'

/** July 2026 as Myntra reported it. */
const JULY: MyntraPnlFacts = {
  month: '2026-07',
  sellerId: '26493',
  grossSales: 677353,
  grossSalesUnits: 2810,
  returnsAndCancellations: 137012,
  returnsAndCancellationsUnits: 549,
  estimatedNetSales: 540341,
  estimatedNetSalesUnits: 2261,
  fwdCommissionFee: 85109.049,
  fwdTaxesTcs: 2656.013,
  fwdTaxesTds: 531.401,
  fwdLogisticCharge: 113060.522,
  fwdAdditionalCharges: 0,
  forwardExpense: 201356.985,
  revCommissionRecovery: 11299.675,
  revTcsRecovery: 353.325,
  revTdsRecovery: 70.71,
  revLogisticCharge: 68375.099,
  revAdditionalRecovery: 0,
  reverseExpense: -56651.389,
  totalExpenses: 258008.374,
  estimatedNetSalesAfterExpenses: 282332.626,
  productGst: 91753.31,
  nodPaid: 0,
  nodDeducted: 0,
  sjitIncentive: 17089.994,
  commissionDiscount: 10641,
  rewardsAndBenefits: 27730.994,
  orderSpf: 0,
  bankSettlementProjected: 299422.62,
  bankSettlementSettled: 375765.789,
  bankSettlementUnsettled: -76343.169,
  inputTaxCredits: 531.401,
  inputTaxCreditsGstTcs: 531.401,
  inputTaxCreditsTds: 0,
  earningsOnPlatform: 299954.021,
  netMarginPct: 0.5541,
  cogsPriced: 120000,
  cogsUnpriced: 5000,
  myntraAds: 0,
}

describe('MYNTRA_LINE_DEFS', () => {
  it('has a value for every line it declares', () => {
    const values = computeMyntraPnl(JULY)
    for (const def of MYNTRA_LINE_DEFS) {
      expect(Number.isFinite(values[def.key]), `${def.key} has no value`).toBe(true)
    }
  })

  it('marks the two memo lines so nothing can total them', () => {
    const memos = MYNTRA_LINE_DEFS.filter((d) => d.memoOf).map((d) => d.key)
    expect(memos).toEqual(['productGst', 'commissionDiscount'])
  })
})

describe('computeMyntraPnl', () => {
  const values = computeMyntraPnl(JULY)

  it('shows Myntra\'s own subtotals rather than re-deriving them', () => {
    expect(values.estimatedNetSales).toBe(540341)
    expect(values.estimatedNetSalesAfterExpenses).toBeCloseTo(282332.626, 3)
    expect(values.bankSettlementProjected).toBeCloseTo(299422.62, 2)
    expect(values.earningsOnPlatform).toBeCloseTo(299954.021, 3)
  })

  it('renders costs negative and credits positive, as the sheet prints them', () => {
    expect(values.fwdCommissionFee).toBeCloseTo(-85109.049, 3)
    expect(values.revLogisticCharge).toBeCloseTo(-68375.099, 3)
    expect(values.revCommissionRecovery).toBeCloseTo(11299.675, 3)
    expect(values.reverseExpense).toBeCloseTo(-56651.389, 3)
  })

  it('shows Myntra\'s net margin as a percentage, not a fraction', () => {
    expect(values.netMarginPct).toBeCloseTo(55.41, 2)
  })

  it('states revenue ex-GST, which is what every margin is measured against', () => {
    expect(values.netRevenueExGst).toBeCloseTo(540341 - 91753.31, 2)
  })

  it('takes Product GST off exactly once', () => {
    // It appears twice on screen — as Myntra's memo under the expenses, and as
    // the step from Estimated Net Sales to Net Revenue — and must be deducted
    // once. CM2 built from Earnings on Platform proves it: that figure still
    // contains the GST cash, so removing it there and nowhere else is right.
    const cm2FromEarnings = JULY.earningsOnPlatform - JULY.productGst - (JULY.cogsPriced + JULY.cogsUnpriced)
    expect(values.cm2).toBeCloseTo(cm2FromEarnings, 6)

    const cm2FromNetRevenue =
      values.netRevenueExGst - (JULY.cogsPriced + JULY.cogsUnpriced) -
      JULY.totalExpenses + JULY.sjitIncentive + JULY.inputTaxCredits
    expect(values.cm2).toBeCloseTo(cm2FromNetRevenue, 6)
  })

  it('never adds the Commission Discount, which is already inside the fee', () => {
    // Adding it would move CM2 by exactly 10,641.
    const cm2WithDiscount = values.cm2 + JULY.commissionDiscount
    expect(values.cm2).not.toBeCloseTo(cm2WithDiscount, 2)
    expect(values.commissionDiscount).toBe(10641) // shown, for reference only
  })

  it('deducts the goods once to reach CM1', () => {
    expect(values.totalCogs).toBeCloseTo(-125000, 6)
    expect(values.cm1).toBeCloseTo(values.netRevenueExGst - 125000, 6)
  })

  it('carries CM3 down to CM4 until fixed expenses are allocated', () => {
    expect(values.cm4).toBeCloseTo(values.cm3, 6)
    const withCosts = applyMyntraOtherCosts(values, 20000)
    expect(withCosts.otherCosts).toBe(-20000)
    expect(withCosts.cm4).toBeCloseTo(values.cm3 - 20000, 6)
  })
})

describe('myntraToCanonicalBuckets', () => {
  const buckets = myntraToCanonicalBuckets(JULY)
  const at = (key: keyof typeof buckets): number => buckets[key] ?? 0

  it('nets each recovery against the charge it reverses', () => {
    expect(at('marketplaceCommission')).toBeCloseTo(85109.049 - 11299.675, 3)
    expect(at('shipping')).toBeCloseTo(113060.522 + 68375.099, 3)
  })

  it('accounts for every rupee Myntra charged, once', () => {
    const deductions =
      at('marketplaceCommission') + at('fulfilment') + at('shipping') + at('collectionFees') +
      at('rtoCharges') + at('returnCharges') + at('otherMarketplaceCharges')
    // Everything between Net Sales and Earnings on Platform: the expenses, less
    // the incentive and the tax credits that come back.
    expect(deductions).toBeCloseTo(JULY.totalExpenses - JULY.sjitIncentive - JULY.inputTaxCredits, 6)
  })

  it('removes Product GST from revenue, matching the other channels', () => {
    expect(at('otherRevenueAdj')).toBeCloseTo(91753.31, 2)
    expect(at('grossSales') - at('returns') - at('otherRevenueAdj'))
      .toBeCloseTo(JULY.estimatedNetSales - JULY.productGst, 6)
  })

  it('leaves the Commission Discount out of every bucket', () => {
    const everything = Object.values(buckets).reduce<number>((s, v) => s + (v ?? 0), 0)
    expect(everything).not.toBeCloseTo(everything + JULY.commissionDiscount, 2)
    expect(JSON.stringify(buckets)).not.toContain('10641')
  })
})
