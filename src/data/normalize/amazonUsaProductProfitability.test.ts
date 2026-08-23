import { describe, expect, it } from 'vitest'
import { detectAmazonUsaProductProfitabilityReport, normalizeAmazonUsaProductProfitability } from './amazonUsaProductProfitability'
import type { SkuMaster } from '@/data/models'

const skuMaster: SkuMaster[] = [
  { sku: 'NX/Spray/Sunscreen/100', productName: 'NX Sunscreen Spray 100ml', category: 'Skin Care', brand: 'Aravi Organic', cogs: 96.4, mrp: 449, launchDate: '2025-01-01', status: 'active', leadTimeDays: 21, safetyStock: 120 },
]

const headers = [
  'Amazon store', 'Start date', 'End date', 'Parent ASIN', 'ASIN', 'MSKU', 'Currency code',
  'Units sold', 'Units returned', 'Net units sold', 'Sales', 'Net sales',
  'Referral fee total', 'FBA fulfillment fees total', 'Base monthly storage fee total',
  'Coupon participation fee total', 'Refund administration fee total', 'FBA Inventory Reimbursement total',
  'Sponsored Products charge total', 'Some New Fee Amazon Added This Month total',
]

function row(overrides: Record<string, string>) {
  return {
    'Amazon store': 'US', 'Start date': '04/01/2026', 'End date': '04/30/2026', 'Parent ASIN': 'B01', 'ASIN': 'B01',
    'MSKU': 'NX/Spray/Sunscreen/100', 'Currency code': 'USD',
    'Units sold': '10', 'Units returned': '1', 'Net units sold': '9', 'Sales': '143.97', 'Net sales': '129.57',
    'Referral fee total': '-21.6', 'FBA fulfillment fees total': '-38.0', 'Base monthly storage fee total': '-0.45',
    'Coupon participation fee total': '-0.5', 'Refund administration fee total': '-0.12',
    'FBA Inventory Reimbursement total': '0.3', 'Sponsored Products charge total': '-6.26',
    'Some New Fee Amazon Added This Month total': '-1.1',
    ...overrides,
  }
}

describe('detectAmazonUsaProductProfitabilityReport', () => {
  it('recognizes the real header set', () => {
    expect(detectAmazonUsaProductProfitabilityReport(headers)).toBe(true)
  })
  it('rejects an unrelated header set', () => {
    expect(detectAmazonUsaProductProfitabilityReport(['Campaign', 'Ad Spend'])).toBe(false)
  })
})

describe('normalizeAmazonUsaProductProfitability', () => {
  it('sums known fee columns into their buckets and unknown ones into "other"', () => {
    const result = normalizeAmazonUsaProductProfitability(headers, [row({})], skuMaster, 'import-1')
    expect(result.facts.referralFeeUsd).toBeCloseTo(21.6)
    expect(result.facts.fbaFulfilmentFeeUsd).toBeCloseTo(38.0)
    expect(result.facts.sponsoredProductsUsd).toBeCloseTo(6.26)
    expect(result.facts.fbaReimbursementsUsd).toBeCloseTo(0.3)
    // A brand-new fee column Amazon introduced this month must not be dropped.
    expect(result.facts.otherAmazonFeesUsd).toBeCloseTo(1.1)
  })

  it('detects the report month from the Start date column', () => {
    const result = normalizeAmazonUsaProductProfitability(headers, [row({})], skuMaster, 'import-1')
    expect(result.month).toBe('2026-04')
  })

  it('skips non-selling SKU rows without treating them as errors, but still reports the count', () => {
    const result = normalizeAmazonUsaProductProfitability(headers, [row({ 'Units sold': '0', 'Net units sold': '0' })], skuMaster, 'import-1')
    expect(result.validRecords).toHaveLength(0)
    expect(result.invalidRows).toHaveLength(0)
    expect(result.warnings.some((w) => w.includes('non-selling SKUs'))).toBe(true)
  })

  it('rejects rows with no MSKU', () => {
    const result = normalizeAmazonUsaProductProfitability(headers, [row({ MSKU: '' })], skuMaster, 'import-1')
    expect(result.invalidRows).toHaveLength(1)
  })
})
