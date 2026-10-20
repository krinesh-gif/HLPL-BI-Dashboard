import { describe, expect, it } from 'vitest'
import { computeSubtotals } from '../subtotals'
import { meeshoFacts } from '@/data/testFixtures'
import { applyMeeshoOtherCosts, computeMeeshoPnl, meeshoToCanonicalBuckets } from './meesho'

/**
 * Checked against the company's own Meesho P&L workbook, Jul-26 order basis.
 *
 * The figures below are that sheet's, so if this file passes the app is
 * producing the statement the business already runs on. Where a number is
 * approximate it is because COGS in the workbook comes from its own cost
 * master; every line that depends only on the order file is exact.
 */
const JULY_ORDER_BASIS = meeshoFacts({
  month: '2026-07',
  basis: 'order',
  grossSalesInclGst: 233354,
  salesReturnsInclGst: 46818,
  outputGstOnSales: 26000,
  cogsUnitsSold: 44349,
  cogsRtoWriteOff: 359,
  cogsReturnWriteOff: 1187,
  forwardShipping: 31884,
  returnShipping: 9860,
  otherMarketplaceFees: 0,
  adsSpendExGst: 21040,
  recovery: 2506,
  platformRecoverySubscriptions: 943,
  subOrdersDispatched: 1255,
  unitsDispatched: 1266,
  unitsDelivered: 942,
  unitsRto: 155,
  unitsReturned: 64,
  netSettlementPerFile: 141283,
})

describe("the owner's July statement, reproduced", () => {
  const v = computeMeeshoPnl(JULY_ORDER_BASIS)

  it('reaches Net Sales including GST', () => {
    expect(v.netSalesInclGst).toBe(186536)
  })

  it('strips output GST to reach NET REVENUE', () => {
    // ₹1,60,536 in the workbook. Leaving GST in would overstate the margin
    // denominator by 16% and understate every percentage below.
    expect(v.netRevenue).toBe(160536)
  })

  it('reaches CM1 after the cost of the goods', () => {
    expect(v.totalCogs).toBe(-45895)
    expect(v.cm1).toBe(114641)
    expect(v.cm1Pct).toBeCloseTo(71.41, 1)
  })

  it('reaches CM2 after everything the marketplace cost', () => {
    // Meesho's charges, the packaging this company buys to ship for it, and
    // the adjustments it settles afterwards — one rung, as on every other
    // channel: 1,14,641 less 41,744 less 6,275, less the 3,449 of net
    // recovery.
    expect(v.totalMarketplaceCharges).toBe(-41744)
    expect(v.totalOwnFulfilment).toBe(-6275)
    expect(v.netPlatformAdjustments).toBe(-3449)
    expect(v.cm2).toBe(63173)
    expect(v.cm2Pct).toBeCloseTo(39.35, 1)
  })

  it('charges packaging per shipment', () => {
    // 1,255 shipments at the ₹5 standing rate = ₹6,275. Meesho bills none of
    // it, so it appears on no marketplace report — and omitting it makes every
    // shipment look more profitable than it is.
    expect(v.totalOwnFulfilment).toBe(-6275)
  })

  it('takes the month’s own packaging rate when one is entered', () => {
    // The whole point of moving this to Monthly Inputs: a rate correction has
    // to restate the months it applies to, not only the ones loaded after it.
    const atEight = computeMeeshoPnl(JULY_ORDER_BASIS, 0, 8)
    expect(atEight.totalOwnFulfilment).toBe(-1255 * 8)
    expect(atEight.cm2).toBe(v.cm2 + 6275 - 1255 * 8)
  })

  it('reaches CM3 after advertising', () => {
    expect(v.totalAdvertising).toBe(-21040)
    expect(v.cm3).toBe(42133)
    expect(v.cm3Pct).toBeCloseTo(26.24, 1)
  })

  it('reaches Net Profit after allocated overheads', () => {
    const withOverheads = applyMeeshoOtherCosts(v, 74436)
    expect(withOverheads.cm4).toBe(-32303)
  })

  it('reports the volume memo the workbook carries', () => {
    expect(v.rtoPctOfDispatched).toBeCloseTo(12.24, 1)
    expect(v.returnPctOfDispatched).toBeCloseTo(5.06, 1)
    expect(v.netRevenuePerUnitDelivered).toBeCloseTo(170, 0)
  })
})

describe('the margin ladder holds together', () => {
  const v = computeMeeshoPnl(JULY_ORDER_BASIS)

  it('falls monotonically as costs are taken off', () => {
    expect(v.netRevenue).toBeGreaterThan(v.cm1)
    expect(v.cm1).toBeGreaterThan(v.cm2)
    expect(v.cm2).toBeGreaterThan(v.cm3)
  })

  it('measures every margin against net revenue, not net sales', () => {
    expect(v.cm1Pct).toBeCloseTo((v.cm1 / v.netRevenue) * 100, 6)
    expect(v.cm3Pct).toBeCloseTo((v.cm3 / v.netRevenue) * 100, 6)
  })
})

describe('a month with no trading', () => {
  it('reports zero rather than dividing by it', () => {
    const v = computeMeeshoPnl(meeshoFacts({ month: '2026-09' }))
    expect(v.netRevenue).toBe(0)
    expect(v.cm1Pct).toBe(0)
    expect(Number.isFinite(v.cm3Pct)).toBe(true)
  })
})

describe('rolling up into the Master P&L', () => {
  it('carries net revenue ex-GST, so the channel agrees with itself', () => {
    // The native statement's NET REVENUE and the canonical Net Sales must be
    // the same number, or the channel P&L and the Master P&L disagree about
    // what Meesho sold.
    const buckets = meeshoToCanonicalBuckets(JULY_ORDER_BASIS)
    const canonicalNetSales =
      (buckets.grossSales ?? 0) - (buckets.discounts ?? 0) - (buckets.returns ?? 0) - (buckets.otherRevenueAdj ?? 0)
    expect(canonicalNetSales).toBe(computeMeeshoPnl(JULY_ORDER_BASIS).netRevenue)
  })

  /**
   * Rung for rung, on the one ladder.
   *
   * Meesho's statement used to carry four margins numbered CM1 to CM4, each
   * meaning something different from the same name on Flipkart: CM1 after the
   * marketplace charges, CM2 after advertising, CM3 after packaging, CM4
   * after the platform adjustments. Nothing was mis-added — the costs were
   * all there — but the P&L's gross profit for this channel matched no line
   * on it, and two channels could not be compared at any rung.
   */
  it('agrees with the P&L at every margin, not only at net revenue', () => {
    const native = computeMeeshoPnl(JULY_ORDER_BASIS)
    const canonical = computeSubtotals(meeshoToCanonicalBuckets(JULY_ORDER_BASIS))
    expect(canonical.netSales).toBeCloseTo(native.netRevenue, 6)
    expect(canonical.grossProfit).toBeCloseTo(native.cm1, 6)
    expect(canonical.channelMargin).toBeCloseTo(native.cm2, 6)
    expect(canonical.contributionProfit).toBeCloseTo(native.cm3, 6)
  })

  it('carries packaging across, so the cost is not lost in the roll-up', () => {
    expect(meeshoToCanonicalBuckets(JULY_ORDER_BASIS).fulfilment).toBe(6275)
  })

  it('carries the entered rate across too, not just the default', () => {
    // The native statement and the Master P&L must charge the same packaging,
    // or the channel disagrees with the roll-up it is part of.
    expect(meeshoToCanonicalBuckets(JULY_ORDER_BASIS, 8).fulfilment).toBe(1255 * 8)
  })
})
