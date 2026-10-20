import { describe, expect, it } from 'vitest'
import type { AmazonAePnlFacts, PurpllePnlFacts, SwiggyInstamartPnlFacts } from '@/data/models'
import { computeSubtotals } from '../subtotals'
import { amazonAeToCanonicalBuckets, computeAmazonAePnl } from './amazonAe'
import { computePurpllePnl, purplleToCanonicalBuckets } from './purplle'
import { computeSwiggyInstamartPnl, swiggyInstamartToCanonicalBuckets } from './swiggyInstamart'

/**
 * The three short statements, against the P&L, rung for rung.
 *
 * None of them had a CM ladder at all — Gross Profit, Contribution, EBITDA —
 * so there was nothing to compare with a Flipkart month and no CM2 on a
 * channel the owner asked to track CM2 on. They have Flipkart's rungs now,
 * and on two of them CM2 is CM1: Purplle and Swiggy buy the goods and take
 * their margin on the invoice, so the marketplace charges nothing below the
 * revenue line. The rung is struck anyway, because a ladder with a step
 * missing on two channels is not one ladder.
 *
 * September 2026 as each table holds it.
 */
const PURPLLE: PurpllePnlFacts = {
  month: '2026-09', schemaVersion: 1,
  mrpValue: 48_395, marginInr: 15_002.449999999983, marginPct: 0.31, marginBase: 'mrp',
  invoiceValueInr: 33_392.54999999996, outputGst: 5_013.490435835361,
  netRevenue: 28_379.0595641646,
  nmv: 35_611.11, priceOff: 12_783.89, priceOffAlt: 12_764,
  unitsSold: 161, orders: 158, orderLines: 158, skusSold: 14,
  marketingInr: 0, marketingStated: false,
  cogsSourceInr: 0, unpricedSkus: [], gstFallbackSkus: [], gstMismatchSkus: [],
  priceOffDifference: 19.889999999999418, priceOffDifferenceStated: 19.89,
}

const SWIGGY: SwiggyInstamartPnlFacts = {
  month: '2026-09', schemaVersion: 1,
  gmv: 8_263, brandGmv: 8_263, mrpValue: 8_263,
  gmvExGst: 7_002.542372881356, outputGst: 1_260.457627118644,
  unitsSold: 27, skusSold: 5, storesSold: 16, citiesSold: 7, salesRows: 27,
  brandImpressions: 44_159, brandOrders: 27, newToBrandBuyers: 26,
  cogsSourceInr: 0, unpricedSkus: [],
  // No trade margin, no invoice value, no marketing contribution: this is the
  // stored row as it stands, and the absence is the point.
}

const AMAZON_AE: AmazonAePnlFacts = {
  month: '2026-09', schemaVersion: 1,
  grossSalesAed: 7_501.290000000001, netSalesAed: 7_250.330000000001,
  netProceedsAed: 4_311.286999999999,
  unitsSoldQty: 241, unitsReturnedQty: 7, netUnitsSoldQty: 234, nonSellingRows: 3,
  cogsSourceInr: 8_880.25,
}

describe('Purplle: the statement and the P&L tell the same story', () => {
  const COGS = 11_500
  const native = computePurpllePnl(PURPLLE, COGS)
  const canonical = computeSubtotals(purplleToCanonicalBuckets(PURPLLE, COGS))

  it('starts from the same net revenue', () => {
    expect(canonical.netSales).toBeCloseTo(native.netRevenue, 6)
    expect(native.netRevenue).toBeCloseTo(28_379.06, 2)
  })

  it('strikes the same CM1, CM2 and CM3', () => {
    expect(canonical.grossProfit).toBeCloseTo(native.grossProfit, 6)
    expect(canonical.channelMargin).toBeCloseTo(native.channelMargin, 6)
    expect(canonical.contributionProfit).toBeCloseTo(native.contribution, 6)
  })

  it('charges nothing below the revenue line, and says so rather than implying it', () => {
    // Purplle's 31% is taken on the invoice, so it is already out of revenue
    // above. CM2 equal to CM1 is the true statement here; a missing rung
    // would have been a silent one.
    expect(native.marketplaceCharges).toBe(0)
    expect(native.channelMargin).toBeCloseTo(native.grossProfit, 6)
  })
})

describe('Swiggy Instamart: the statement and the P&L tell the same story', () => {
  const COGS = 2_800
  const native = computeSwiggyInstamartPnl(SWIGGY, COGS)
  const canonical = computeSubtotals(swiggyInstamartToCanonicalBuckets(SWIGGY, COGS))

  it('starts from the same net revenue', () => {
    expect(canonical.netSales).toBeCloseTo(native.netRevenue, 6)
    expect(native.netRevenue).toBeCloseTo(7_002.54, 2)
  })

  it('strikes the same CM1, CM2 and CM3', () => {
    expect(canonical.grossProfit).toBeCloseTo(native.grossProfit, 6)
    expect(canonical.channelMargin).toBeCloseTo(native.channelMargin, 6)
    expect(canonical.contributionProfit).toBeCloseTo(native.contribution, 6)
  })
})

describe('Amazon UAE: the statement and the P&L tell the same story', () => {
  // The statement is in dirhams and the P&L in rupees, so the tie-out is run
  // at a rate of 1: what is being checked is the order of the deductions, and
  // a rate would only scale both sides.
  const COGS = 2_000
  const ADS = 300
  const native = computeAmazonAePnl(AMAZON_AE, COGS, 0, ADS)
  const canonical = computeSubtotals(amazonAeToCanonicalBuckets(AMAZON_AE, 1, COGS, ADS))

  it('starts from the same net sales', () => {
    expect(canonical.netSales).toBeCloseTo(native.netSales, 6)
  })

  /**
   * This is the one that used to fail. Amazon's export states its own Net
   * proceeds — net sales less everything it took — and the statement took the
   * goods off that, so its first margin was struck after Amazon's fees while
   * the P&L's gross profit for the same month was struck after the goods. The
   * fees are below CM1 now, where every other channel has them.
   */
  it('strikes CM1 after the goods, not after Amazon', () => {
    expect(canonical.grossProfit).toBeCloseTo(native.grossProfit, 6)
    expect(native.grossProfit).toBeCloseTo(AMAZON_AE.netSalesAed - COGS, 6)
    expect(native.grossProfit).not.toBeCloseTo(AMAZON_AE.netProceedsAed - COGS, 2)
  })

  it('strikes the same CM2 and CM3', () => {
    expect(canonical.channelMargin).toBeCloseTo(native.channelMargin, 6)
    expect(canonical.contributionProfit).toBeCloseTo(native.contribution, 6)
  })

  it('keeps Amazon’s own bottom line on the statement as a memo', () => {
    // It is a fact of the file and the figure the settlement is read against,
    // so it stays — below the ladder, out of every margin.
    expect(native.netProceeds).toBeCloseTo(4_311.29, 2)
  })
})
