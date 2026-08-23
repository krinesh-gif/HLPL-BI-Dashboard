import { describe, expect, it } from 'vitest'
import { allocateFixedExpensesForMonth, computeSalesContributionWeights } from './allocation'
import type { CanonicalSalesRecord, FixedExpenseEntry } from '@/data/models'

function record(channel: CanonicalSalesRecord['channel'], netSales: number): CanonicalSalesRecord {
  return {
    orderId: `${channel}-1`, orderDate: '2026-06-10', channel, marketplace: channel, sellerType: 'marketplace',
    sku: 'SKU-1', productName: 'Test', category: 'Test', quantity: 1, grossSales: netSales, discount: 0,
    netSales, returnUnits: 0, rtoUnits: 0, shippingCost: 0, marketplaceFee: 0, tax: 0,
    status: 'completed', currency: 'INR', importId: 'test',
  }
}

describe('computeSalesContributionWeights', () => {
  it('weights channels by their share of net sales for the month', () => {
    // Rows are keyed by the report they came from; weights are per business
    // channel, so both Amazon India reports land on one weight.
    const records = [record('amazon_in_seller', 600), record('amazon_in_vendor', 200), record('flipkart', 200)]
    const weights = computeSalesContributionWeights(records, '2026-06')
    expect(weights.amazon_in).toBeCloseTo(0.8)
    expect(weights.flipkart).toBeCloseTo(0.2)
    expect(weights.meesho).toBe(0)
  })

  it('falls back to default weights when there is no sales data for the month', () => {
    const weights = computeSalesContributionWeights([], '2026-06')
    expect(weights.amazon_in).toBeGreaterThan(0)
    const total = Object.values(weights).reduce((a, b) => a + b, 0)
    expect(total).toBeCloseTo(1)
  })
})

describe('allocateFixedExpensesForMonth', () => {
  it('splits each expense category proportionally to sales share', () => {
    const records = [record('amazon_in_seller', 400), record('amazon_in_vendor', 200), record('flipkart', 400)]
    const fixedExpenses: FixedExpenseEntry[] = [
      { month: '2026-06', category: 'rent', amount: 100000 },
      { month: '2026-05', category: 'rent', amount: 999999 }, // different month, must be ignored
    ]
    const allocation = allocateFixedExpensesForMonth(records, fixedExpenses, '2026-06')
    expect(allocation.amazon_in?.rent).toBeCloseTo(60000)
    expect(allocation.flipkart?.rent).toBeCloseTo(40000)
  })
})
