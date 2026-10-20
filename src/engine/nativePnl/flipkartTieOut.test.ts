import { describe, expect, it } from 'vitest'
import type { FlipkartPnlFacts } from '@/data/models'
import { computeSubtotals } from '../pnl'
import { computeFlipkartPnl, flipkartToCanonicalBuckets } from './flipkart'

/**
 * Flipkart's own statement and Flipkart's line on the P&L are the same month.
 *
 * They were not. `fixedFee` was deducted inside the statement's Total
 * Marketplace Fees and mapped into no canonical bucket at all, so September
 * read 3,72,564 of fees on the statement and 2,76,032 on the P&L, and the
 * contribution the P&L showed was 81,600 above the statement's CM3. Over
 * Apr-Sep the P&L was missing 4,83,916 of real Flipkart cost, and the
 * company's EBITDA was overstated by every rupee of it.
 *
 * The figures below are September 2026, exactly as uploaded.
 */
const SEPT: FlipkartPnlFacts = {
  month: '2026-09', grossSales: 1_745_467, estimatedNetSales: 1_414_973,
  sellerFundedDiscount: 4_582.34, customerAddOns: 543, outputGst: 130_446.602,
  cogsPriced: 171_550.75, cogsUnpriced: 269_576.04,
  commissionFee: 85_801.805, fixedFee: 81_600, collectionFee: 0, pickPackFee: 71_848,
  forwardShippingFee: 0, reverseShippingFee: 4_255, storageFee: 75_818.28,
  recallFee: 51_965, otherMarketplaceFees: 1_276.359, rewardsSpf: 14_932.42,
  flipkartAds: 288_843.31, googleAds: 60_692.076,
} as FlipkartPnlFacts

const MARKETPLACE_KEYS = [
  'marketplaceCommission', 'fulfilment', 'shipping', 'collectionFees',
  'rtoCharges', 'returnCharges', 'otherMarketplaceCharges',
] as const

const native = computeFlipkartPnl(SEPT)
const canonical = computeSubtotals(flipkartToCanonicalBuckets(SEPT))
const marketplaceFees = MARKETPLACE_KEYS.reduce((sum, k) => sum + (canonical[k] ?? 0), 0)

describe('the statement and the P&L agree about September', () => {
  it('charges the same marketplace fees', () => {
    // The statement nets Rewards & SPF on a line of its own, below the total;
    // the P&L has no such line and nets it into the other charges. Same money,
    // one line later.
    expect(marketplaceFees).toBeCloseTo(-native.totalMarketplaceFees - SEPT.rewardsSpf, 6)
    expect(marketplaceFees).toBeCloseTo(372_564.444 - 14_932.42, 2)
  })

  it('does not lose the fixed fee', () => {
    expect(canonical.collectionFees).toBeCloseTo(SEPT.collectionFee + SEPT.fixedFee, 6)
    expect(marketplaceFees).toBeGreaterThan(SEPT.fixedFee)
  })

  it('states the same net revenue on both', () => {
    expect(canonical.netSales).toBeCloseTo(native.netRevenueExGst, 6)
  })

  /**
   * CM1 and Gross Margin are one figure under two names — net revenue less
   * the cost of the goods — which is why the P&L names both.
   */
  it('reports the same gross margin as CM1', () => {
    expect(canonical.grossProfit).toBeCloseTo(native.cm1, 6)
    expect(canonical.grossMarginPct).toBeCloseTo(native.cm1Pct, 6)
  })

  /**
   * The rung the P&L was missing. Flipkart strikes a margin after the
   * marketplace's fees and before advertising; the P&L now strikes the same
   * one, so "is this marketplace worth being on?" can be asked of every
   * channel at once instead of only on the statements that happen to show it.
   */
  it('reports the same channel margin as CM2', () => {
    expect(canonical.channelMargin).toBeCloseTo(native.cm2, 6)
    expect(canonical.channelMarginPct).toBeCloseTo(native.cm2Pct, 6)
  })

  it('reports the same contribution as CM3, once advertising is off both', () => {
    expect(canonical.contributionProfit).toBeCloseTo(native.cm3, 6)
    expect(canonical.contributionMarginPct).toBeCloseTo(native.cm3Pct, 6)
  })

  it('steps down the ladder one cost at a time', () => {
    const marketing = SEPT.flipkartAds + SEPT.googleAds
    expect((canonical.grossProfit ?? 0) - marketplaceFees).toBeCloseTo(canonical.channelMargin ?? 0, 6)
    expect((canonical.channelMargin ?? 0) - marketing).toBeCloseTo(canonical.contributionProfit ?? 0, 6)
  })
})
