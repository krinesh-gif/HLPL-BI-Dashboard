import { describe, expect, it } from 'vitest'
import { growthPct, movingAverage, sumFacts } from './sales'
import type { CanonicalSalesRecord } from '@/data/models'

describe('growthPct', () => {
  it('computes standard percentage growth', () => {
    expect(growthPct(120, 100)).toBeCloseTo(20)
    expect(growthPct(80, 100)).toBeCloseTo(-20)
  })

  it('returns null when previous is zero and current is non-zero (undefined growth, not Infinity)', () => {
    expect(growthPct(50, 0)).toBeNull()
  })

  it('returns 0 when both current and previous are zero', () => {
    expect(growthPct(0, 0)).toBe(0)
  })
})

describe('movingAverage', () => {
  it('returns null until the window is filled, then a rolling average', () => {
    const result = movingAverage([1, 2, 3, 4, 5], 3)
    expect(result[0]).toBeNull()
    expect(result[1]).toBeNull()
    expect(result[2]).toBeCloseTo(2) // (1+2+3)/3
    expect(result[3]).toBeCloseTo(3) // (2+3+4)/3
    expect(result[4]).toBeCloseTo(4) // (3+4+5)/3
  })
})

describe('sumFacts', () => {
  it('aggregates quantity, revenue, and order count across records', () => {
    const records: CanonicalSalesRecord[] = [
      { orderId: '1', orderDate: '2026-06-01', channel: 'amazon_in_seller', marketplace: 'amazon_in_seller', sellerType: 'seller_central', sku: 'A', productName: 'A', category: 'Cat', quantity: 2, grossSales: 200, discount: 10, netSales: 180, returnUnits: 0, rtoUnits: 0, shippingCost: 5, marketplaceFee: 20, tax: 2, status: 'completed', currency: 'INR', importId: 'x' },
      { orderId: '2', orderDate: '2026-06-02', channel: 'amazon_in_seller', marketplace: 'amazon_in_seller', sellerType: 'seller_central', sku: 'A', productName: 'A', category: 'Cat', quantity: 3, grossSales: 300, discount: 15, netSales: 270, returnUnits: 1, rtoUnits: 0, shippingCost: 5, marketplaceFee: 30, tax: 3, status: 'completed', currency: 'INR', importId: 'x' },
    ]
    const facts = sumFacts(records)
    expect(facts.quantity).toBe(5)
    expect(facts.orders).toBe(2)
    expect(facts.grossSales).toBe(500)
    expect(facts.netSales).toBe(450)
    expect(facts.returnUnits).toBe(1)
  })
})
