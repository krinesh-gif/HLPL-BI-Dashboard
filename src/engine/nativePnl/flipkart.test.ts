import { describe, expect, it } from 'vitest'
import { applyFlipkartOtherCosts, computeFlipkartPnl, flipkartToCanonicalBuckets } from './flipkart'
import type { FlipkartPnlFacts } from '@/data/models'

const facts: FlipkartPnlFacts = {
  month: '2026-07',
  grossSales: 2303935,
  estimatedNetSales: 1853511,
  cogsPriced: 451461.35,
  cogsUnpriced: 1160.72,
  commissionFee: 74638.058,
  collectionFee: 0,
  fixedFee: 100821,
  pickPackFee: 83314,
  forwardShippingFee: 0,
  reverseShippingFee: 9443,
  storageFee: 46945.4,
  recallFee: 1030,
  otherMarketplaceFees: 2424.312,
  rewardsSpf: 2004.22,
  flipkartAds: 132930.34,
  sellerFundedDiscount: 81378.72,
  customerAddOns: 2870,
  outputGst: 263830.51645379,
  googleAds: 0,
}

describe('computeFlipkartPnl', () => {
  it('computes the CM1-CM3 waterfall in the same order as the real model', () => {
    // These facts are the real Jul-2026 figures from Aravi_Live_PnL_Model_v3.xlsx,
    // but the real workbook's "Accounted Net Sales" is an independently-reported
    // figure (from Flipkart's Overall Summary tab) rather than a pure subtraction
    // of discount/add-ons from Estimated Net Sales — a source report this app
    // doesn't ingest yet. So this test checks our own formula is internally
    // consistent and correctly sequenced (COGS before fees before ads), not
    // byte-for-byte parity with the real dashboard's CM1-CM3 for this month.
    const computed = computeFlipkartPnl(facts)
    expect(computed.netRevenueExGst).toBeCloseTo(1511171.76, 1)
    expect(computed.cm1).toBeCloseTo(1058549.69, 1)
    expect(computed.cm2).toBeCloseTo(741938.14, 1)
    expect(computed.cm3).toBeCloseTo(609007.8, 1)
  })

  it('deducts COGS before marketplace fees (Flipkart-specific sequencing)', () => {
    const computed = computeFlipkartPnl(facts)
    const netRevenue = computed.netRevenueExGst
    const totalCogs = facts.cogsPriced + facts.cogsUnpriced
    expect(computed.cm1).toBeCloseTo(netRevenue - totalCogs)
  })

  it('leaves otherCosts/cm4 at zero/cm3 until applyFlipkartOtherCosts runs', () => {
    const computed = computeFlipkartPnl(facts)
    expect(computed.otherCosts).toBe(0)
    expect(computed.cm4).toBeCloseTo(computed.cm3)
  })
})

describe('applyFlipkartOtherCosts', () => {
  it('deducts the allocated fixed-expense share to produce CM4', () => {
    const computed = computeFlipkartPnl(facts)
    const withCosts = applyFlipkartOtherCosts(computed, 50000)
    expect(withCosts.cm4).toBeCloseTo(computed.cm3 - 50000)
    expect(withCosts.otherCosts).toBe(-50000)
  })
})

describe('flipkartToCanonicalBuckets', () => {
  it('produces positive-magnitude buckets consistent with engine/pnl.ts convention', () => {
    const buckets = flipkartToCanonicalBuckets(facts)
    expect(buckets.cogs).toBeCloseTo(facts.cogsPriced + facts.cogsUnpriced)
    expect(buckets.marketplaceCommission).toBe(facts.commissionFee)
    expect(buckets.grossSales).toBe(facts.grossSales)
  })
})
