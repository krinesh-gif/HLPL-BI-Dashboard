import { describe, expect, it } from 'vitest'
import { applyMeeshoOtherCosts, computeMeeshoPnl, meeshoToCanonicalBuckets } from './meesho'
import type { MeeshoPnlFacts } from '@/data/models'

const facts: MeeshoPnlFacts = {
  month: '2026-07',
  grossSale: 100000,
  returns: 8000,
  forwardShipping: 3000,
  reverseShipping: 800,
  returnPremium: 500,
  returnPremiumRecovered: 100,
  commission: 9000,
  fixedFee: 2000,
  warehousing: 1500,
  goldFee: 200,
  mallFee: 0,
  otherSettlementCharge: 300,
  ads: 1200,
  gst: 4000,
  tcs: 500,
  tds: 100,
  compensation: 200,
  claims: 150,
  recovery: 0,
  settlementAmount: 68000,
  cogs: 35000,
}

describe('computeMeeshoPnl', () => {
  it('computes net sale then deducts COGS for CM1', () => {
    const computed = computeMeeshoPnl(facts)
    expect(computed.netSale).toBe(92000)
    expect(computed.cm1).toBe(92000 - 35000)
  })

  it('nets return-premium-recovered against return premium in total fees', () => {
    const computed = computeMeeshoPnl(facts)
    const totalFees = 3000 + 800 + 500 - 100 + 9000 + 2000 + 1500 + 200 + 0 + 300
    expect(computed.cm2).toBeCloseTo(computed.cm1 - totalFees)
  })

  it('deducts ads and adds compensation/claims/recovery to get CM3', () => {
    const computed = computeMeeshoPnl(facts)
    expect(computed.cm3).toBeCloseTo(computed.cm2 - 1200 + 200 + 150 + 0)
  })

  it('treats GST/TCS/TDS as memo lines that do not affect CM3', () => {
    const computed = computeMeeshoPnl(facts)
    const withoutTaxFacts = { ...facts, gst: 0, tcs: 0, tds: 0 }
    const withoutTax = computeMeeshoPnl(withoutTaxFacts)
    expect(withoutTax.cm3).toBeCloseTo(computed.cm3)
  })
})

describe('applyMeeshoOtherCosts', () => {
  it('deducts allocated fixed expenses to get CM4', () => {
    const computed = computeMeeshoPnl(facts)
    const withCosts = applyMeeshoOtherCosts(computed, 5000)
    expect(withCosts.cm4).toBeCloseTo(computed.cm3 - 5000)
  })
})

describe('meeshoToCanonicalBuckets', () => {
  it('rolls up into positive-magnitude canonical buckets', () => {
    const buckets = meeshoToCanonicalBuckets(facts)
    expect(buckets.grossSales).toBe(100000)
    expect(buckets.cogs).toBe(35000)
    expect(buckets.marketplaceCommission).toBe(9000)
    expect(buckets.ads).toBe(1200)
  })
})
