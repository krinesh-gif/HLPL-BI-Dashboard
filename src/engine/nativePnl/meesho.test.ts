import { describe, expect, it } from 'vitest'
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

  it('totals COGS across units sold and both write-offs', () => {
    expect(v.totalCogs).toBe(-45895)
    expect(v.grossProfit).toBe(114641)
    expect(v.grossMarginPct).toBeCloseTo(71.41, 1)
  })

  it('reaches CM1 after marketplace charges', () => {
    expect(v.totalMarketplaceCharges).toBe(-41744)
    expect(v.cm1).toBe(72897)
    expect(v.cm1Pct).toBeCloseTo(45.41, 1)
  })

  it('reaches CM2 after advertising', () => {
    expect(v.cm2).toBe(51857)
    expect(v.cm2Pct).toBeCloseTo(32.30, 1)
  })

  it('charges own fulfilment per shipment and reaches CM3', () => {
    // 1,255 shipments at ₹5 packaging and ₹2 labour = ₹8,785. Meesho bills
    // none of this, so it appears on no marketplace report — and omitting it
    // makes every shipment look more profitable than it is.
    expect(v.totalOwnFulfilment).toBe(-8785)
    expect(v.cm3).toBe(43072)
    expect(v.cm3Pct).toBeCloseTo(26.83, 1)
  })

  it('reaches CM4 after platform adjustments', () => {
    expect(v.netPlatformAdjustments).toBe(-3449)
    expect(v.cm4).toBe(39623)
    expect(v.cm4Pct).toBeCloseTo(24.68, 1)
  })

  it('reaches EBITDA after allocated overheads', () => {
    const withOverheads = applyMeeshoOtherCosts(v, 74436)
    expect(withOverheads.ebitda).toBe(-34813)
    expect(withOverheads.ebitdaPct).toBeCloseTo(-21.69, 1)
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
    expect(v.grossProfit).toBeGreaterThan(v.cm1)
    expect(v.cm1).toBeGreaterThan(v.cm2)
    expect(v.cm2).toBeGreaterThan(v.cm3)
    expect(v.cm3).toBeGreaterThan(v.cm4)
  })

  it('measures every margin against net revenue, not net sales', () => {
    expect(v.cm1Pct).toBeCloseTo((v.cm1 / v.netRevenue) * 100, 6)
    expect(v.cm4Pct).toBeCloseTo((v.cm4 / v.netRevenue) * 100, 6)
  })
})

describe('a month with no trading', () => {
  it('reports zero rather than dividing by it', () => {
    const v = computeMeeshoPnl(meeshoFacts({ month: '2026-09' }))
    expect(v.netRevenue).toBe(0)
    expect(v.grossMarginPct).toBe(0)
    expect(Number.isFinite(v.cm4Pct)).toBe(true)
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

  it('carries own fulfilment across, so the cost is not lost in the roll-up', () => {
    expect(meeshoToCanonicalBuckets(JULY_ORDER_BASIS).fulfilment).toBe(8785)
  })
})
