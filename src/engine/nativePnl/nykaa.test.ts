import { describe, expect, it } from 'vitest'
import { applyNykaaOtherCosts, computeNykaaPnl, nykaaRevenue, nykaaToCanonicalBuckets, NYKAA_LINE_DEFS } from './nykaa'
import { computeSubtotals } from '@/engine/pnl'
import type { NykaaPnlFacts } from '@/data/models'

/** August 2026 as Nykaa's files report it. */
const AUG: NykaaPnlFacts = {
  month: '2026-08',
  grossSalesMrp: 2816263,
  returnsMrp: 126725,
  netSalesMrp: 2689538,
  unitsShipped: 6870,
  unitsReturned: 303,
  netUnits: 6567,
  orders: 5911,
  customerPaidValue: 1900158.84,
  platformDiscount: 103260.81,
  nykaaFundedCoupon: 6165.03,
  cogsPriced: 400000,
  cogsUnpriced: 0,
  nykaaAds: 0,
}

describe('nykaaRevenue', () => {
  it('takes the margin off MRP, not off what shoppers paid', () => {
    const { commission, realisationInclGst } = nykaaRevenue(AUG)
    expect(commission).toBeCloseTo(2689538 * 0.38, 2)
    expect(realisationInclGst).toBeCloseTo(2689538 * 0.62, 2)
    // The shopper's price is 7.9 lakh below MRP. Building revenue off it would
    // have lost nearly a third of the month.
    expect(realisationInclGst).not.toBeCloseTo(AUG.customerPaidValue * 0.62, 0)
  })

  it('strips GST as the inclusive fraction, because MRP includes tax', () => {
    const { realisationInclGst, outputGst, netRevenueExGst } = nykaaRevenue(AUG)
    expect(outputGst).toBeCloseTo(realisationInclGst * (18 / 118), 2)
    // Taking a flat 18% of a tax-inclusive figure over-deducts.
    expect(outputGst).toBeLessThan(realisationInclGst * 0.18)
    expect(netRevenueExGst).toBeCloseTo(realisationInclGst - outputGst, 6)
  })

  it('uses the month\'s own rate when it carries one', () => {
    const renegotiated = { ...AUG, commissionPctOfMrp: 35 }
    expect(nykaaRevenue(renegotiated).commission).toBeCloseTo(2689538 * 0.35, 2)
  })

  it('handles a nil GST month without dividing by anything', () => {
    expect(nykaaRevenue({ ...AUG, outputGstPct: 0 }).outputGst).toBe(0)
  })
})

describe('computeNykaaPnl', () => {
  const v = computeNykaaPnl(AUG)

  it('has a value for every line it declares', () => {
    for (const def of NYKAA_LINE_DEFS) {
      expect(Number.isFinite(v[def.key]), `${def.key} has no value`).toBe(true)
    }
  })

  it('walks MRP down to revenue in visible steps', () => {
    expect(v.grossSalesMrp + v.returnsMrp).toBeCloseTo(v.netSalesMrp, 6)
    expect(v.netSalesMrp + v.commission).toBeCloseTo(v.netRealisationInclGst, 6)
    expect(v.netRealisationInclGst + v.outputGst).toBeCloseTo(v.netRevenueExGst, 6)
  })

  it('measures every margin against revenue ex-GST, never against MRP', () => {
    expect(v.cm1Pct).toBeCloseTo((v.cm1 / v.netRevenueExGst) * 100, 6)
    // Against MRP the same month would read far healthier than it is.
    expect(v.cm1Pct).not.toBeCloseTo((v.cm1 / AUG.netSalesMrp) * 100, 1)
  })

  it('keeps the shopper\'s price and the discounts out of every total', () => {
    expect(v.customerPaidValue).toBeCloseTo(1900158.84, 2)
    expect(v.nykaaFundedCoupon).toBeCloseTo(6165.03, 2)
    // Removing all three memos changes nothing below the revenue line.
    const withoutMemos = computeNykaaPnl({ ...AUG, customerPaidValue: 0, platformDiscount: 0, nykaaFundedCoupon: 0 })
    expect(withoutMemos.netRevenueExGst).toBeCloseTo(v.netRevenueExGst, 6)
    expect(withoutMemos.cm1).toBeCloseTo(v.cm1, 6)
    expect(withoutMemos.cm2).toBeCloseTo(v.cm2, 6)
  })

  it('carries CM2 down to Net Profit until fixed expenses are allocated', () => {
    expect(v.cm3).toBeCloseTo(v.cm2, 6)
    const withCosts = applyNykaaOtherCosts(v, 50000)
    expect(withCosts.otherCosts).toBe(-50000)
    expect(withCosts.cm3).toBeCloseTo(v.cm2 - 50000, 6)
  })
})

describe('nykaaToCanonicalBuckets', () => {
  /**
   * The statement and the Master P&L are two views of one month and have to
   * agree. Booking Nykaa's margin below the revenue line made August read
   * 72.4% gross margin on one page and 52.4% on the other.
   */
  it('reports the same Net Sales and the same margin as the statement', () => {
    const native = computeNykaaPnl(AUG)
    const canonical = computeSubtotals(nykaaToCanonicalBuckets(AUG))
    expect(canonical.netSales).toBeCloseTo(native.netRevenueExGst, 6)
    expect(canonical.grossMarginPct).toBeCloseTo(native.cm1Pct, 6)
    expect(canonical.contributionProfit).toBeCloseTo(native.cm2, 6)
  })

  it('books the margin as the trade discount it is, above the line', () => {
    const b = nykaaToCanonicalBuckets(AUG)
    expect(b.discounts).toBeCloseTo(2689538 * 0.38, 2)
    expect(b.marketplaceCommission).toBe(0)
    expect(b.grossSales).toBe(2816263)
  })

  it('leaves the memo figures out of every bucket', () => {
    const b = nykaaToCanonicalBuckets(AUG)
    const loud = nykaaToCanonicalBuckets({ ...AUG, customerPaidValue: 9e9, platformDiscount: 9e9, nykaaFundedCoupon: 9e9 })
    expect(loud).toEqual(b)
  })
})

describe('the MI reaches the statement', () => {
  /**
   * Nykaa's Marketing Invest bill arrives as a PDF, not inside the sales
   * files, so the P&L reads ad spend from where the Ads screens store it.
   * Without that the MI would be entered, shown on the Ads page, and silently
   * missing from CM2.
   */
  it('takes CM2 below CM1 once a month has marketing', () => {
    const withMi = computeNykaaPnl({ ...AUG, nykaaAds: 135542 })
    expect(withMi.cm2).toBeCloseTo(withMi.cm1 - 135542, 6)
    expect(withMi.cm2).toBeLessThan(withMi.cm1)
    expect(withMi.nykaaAds).toBe(-135542)
  })

  it('charges the taxable value only — the GST on it is not a cost', () => {
    const taxable = computeNykaaPnl({ ...AUG, nykaaAds: 135542 })
    const wrongly = computeNykaaPnl({ ...AUG, nykaaAds: 159939.56 })
    expect(taxable.cm2 - wrongly.cm2).toBeCloseTo(24397.56, 2)
  })

  it('leaves CM2 equal to CM1 when no invoice has arrived', () => {
    const v = computeNykaaPnl({ ...AUG, nykaaAds: 0 })
    expect(v.cm2).toBeCloseTo(v.cm1, 6)
  })
})

/**
 * Nykaa's own margin table, from the agreement, at MRP = 100.
 *
 * It is the contract, so it is pinned here: any change to how the margin or
 * the tax is applied has to keep reproducing these figures or fail.
 *
 *   MRP            100.00      Gross Margin 38%     38.00
 *   Invoice Value   62.00      input GST 18/118      9.46
 *   Cost to Nykaa   52.54   ← our revenue, ex-GST
 */
describe("Nykaa's agreement margin table", () => {
  const perHundred = (over: Partial<NykaaPnlFacts> = {}) =>
    nykaaRevenue({ ...AUG, grossSalesMrp: 100, returnsMrp: 0, netSalesMrp: 100, ...over })

  it('reproduces the inflow block to the paisa', () => {
    const { commission, realisationInclGst, outputGst, netRevenueExGst } = perHundred()
    expect(commission).toBeCloseTo(38.0, 2)       // Gross Margin 38%
    expect(realisationInclGst).toBeCloseTo(62.0, 2) // Invoice Value
    expect(outputGst).toBeCloseTo(9.46, 2)        // input IGST 18%, interstate
    expect(outputGst / 2).toBeCloseTo(4.73, 2)    // input CGST + SGST 9% each, local
    expect(netRevenueExGst).toBeCloseTo(52.54, 2) // Cost to Nykaa
  })

  it('realises 52.54 paise ex-GST for every rupee of MRP', () => {
    const v = computeNykaaPnl({ ...AUG, grossSalesMrp: 100, returnsMrp: 0, netSalesMrp: 100 })
    expect(v.realisationPctOfMrp).toBeCloseTo(52.5424, 3)
  })

  it('keeps that rate at the real August scale', () => {
    // 26,89,538 of net MRP at the agreement's rate is the 14,13,147.08 the
    // statement shows. The rate is 0.62/1.18 exactly — 52.5424% is that
    // rounded for reading, and rounding it before multiplying moves August by
    // 73 paise.
    const { netRevenueExGst } = nykaaRevenue(AUG)
    expect(netRevenueExGst).toBeCloseTo(2689538 * (0.62 / 1.18), 2)
    expect(netRevenueExGst).toBeCloseTo(1413147.08, 2)
    expect(computeNykaaPnl(AUG).realisationPctOfMrp).toBeCloseTo(52.5424, 3)
  })

  it('leaves the agreement\'s GST LOSS row out of our books, because it is Nykaa\'s', () => {
    // The table's outflow block is Nykaa reselling at MRP: output GST 15.25
    // less the 9.46 it paid us is a 5.80 GST differential, which turns its
    // headline 38 into a real 32.20. None of that is ours — our revenue stops
    // at Cost to Nykaa — so none of it appears in this statement.
    const { outputGst: ourGst, netRevenueExGst } = perHundred()
    const nykaaOutputGst = 100 * (18 / 118)
    const gstLoss = nykaaOutputGst - ourGst
    expect(gstLoss).toBeCloseTo(5.8, 2)
    expect(100 - nykaaOutputGst - netRevenueExGst).toBeCloseTo(32.2, 1) // Nykaa's net margin
    // Our own figures are untouched by any of it.
    expect(netRevenueExGst).toBeCloseTo(52.54, 2)
  })
})
