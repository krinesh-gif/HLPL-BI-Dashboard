import { describe, expect, it } from 'vitest'
import { amazonUsaToCanonicalBuckets, computeAmazonUsaPnl } from './amazonUsa'
import type { AmazonUsaPnlFacts } from '@/data/models'

const facts: AmazonUsaPnlFacts = {
  month: '2026-04',
  grossSalesUsd: 10000,
  netSalesUsd: 9500,
  referralFeeUsd: 1500,
  fbaFulfilmentFeeUsd: 2000,
  storageAgedDisposalUsd: 100,
  couponDealFeesUsd: 50,
  refundAdminFeeUsd: 20,
  fbaReimbursementsUsd: 30,
  otherAmazonFeesUsd: 10,
  sponsoredProductsUsd: 600,
  cogsUsd: 1200,
  freightUsd: 900,
  sponsoredBrandsUsd: 0,
  sponsoredDisplayDspUsd: 0,
  offAmazonAdsUsd: 0,
  exportDocsUsd: 0,
  usImportDutyUsd: 0,
  amazonSellingPlanUsd: 40,
  productLiabilityInsuranceUsd: 0,
  fdaLegalUsd: 0,
  agencySoftwareUsd: 0,
  otherOverheadUsd: 0,
  fxConversionCostPct: 0.5,
}

describe('computeAmazonUsaPnl', () => {
  it('defines CM1 after Amazon fees AND advertising, BEFORE COGS (channel-specific sequencing)', () => {
    const computed = computeAmazonUsaPnl(facts)
    const totalFees = 1500 + 2000 + 100 + 50 + 20 + 10 - 30 // = 3650
    const grossContribution = facts.netSalesUsd - totalFees // 5850
    const cm1Expected = grossContribution - facts.sponsoredProductsUsd // 5250
    expect(computed.cm1).toBeCloseTo(cm1Expected)
    // CM1 must NOT yet reflect COGS/freight.
    expect(computed.cm1).not.toBeCloseTo(cm1Expected - facts.cogsUsd - facts.freightUsd)
  })

  it('deducts COGS and freight only at CM2', () => {
    const computed = computeAmazonUsaPnl(facts)
    const totalLandedCost = facts.cogsUsd + facts.freightUsd
    expect(computed.cm2).toBeCloseTo(computed.cm1 - totalLandedCost)
  })

  it('applies FX conversion cost as a % of net sales at CM3', () => {
    const computed = computeAmazonUsaPnl(facts)
    const fx = facts.netSalesUsd * (facts.fxConversionCostPct / 100)
    expect(computed.cm3).toBeCloseTo(computed.cm2 - facts.amazonSellingPlanUsd - fx)
  })

  it('nets FBA reimbursements against total fees rather than treating them as pure revenue', () => {
    const computed = computeAmazonUsaPnl(facts)
    expect(computed.totalAmazonFeesUsd).toBeLessThan(0)
    expect(Math.abs(computed.totalAmazonFeesUsd)).toBeLessThan(1500 + 2000 + 100 + 50 + 20 + 10)
  })
})

describe('amazonUsaToCanonicalBuckets', () => {
  it('converts USD facts to INR at the given FX rate', () => {
    const buckets = amazonUsaToCanonicalBuckets(facts, 90)
    expect(buckets.grossSales).toBeCloseTo(10000 * 90)
    expect(buckets.cogs).toBeCloseTo(1200 * 90)
  })
})
