import { describe, expect, it } from 'vitest'
import { aov, asp, orderBasisNetSales, orderCount } from './netSales'
import type { CanonicalSalesRecord } from '@/data/models'

/**
 * Amazon's Product Profitability export is one row per SKU per month. It has
 * units sold, units returned and net units sold, and no order count anywhere.
 * Counting each of those rows as one order gave Amazon USA 35 orders in a
 * month — its SKU count — and an average order value of ₹70.6K.
 */
function row(over: Partial<CanonicalSalesRecord>): CanonicalSalesRecord {
  return {
    orderId: 'x', orderDate: '2026-05-01', channel: 'amazon_us', marketplace: 'amazon_us',
    sellerType: 'seller_central', sku: 'S1', productName: 'S1', category: 'Skin Care',
    quantity: 1, grossSales: 100, discount: 0, netSales: 100,
    returnUnits: 0, rtoUnits: 0, shippingCost: 0, marketplaceFee: 0, tax: 0,
    status: 'completed', currency: 'INR', importId: 'i', ...over,
  }
}

describe('a monthly per-SKU aggregate is not an order', () => {
  const aggregates = [
    row({ sku: 'A', quantity: 1200, netSales: 1_400_000, isAggregate: true }),
    row({ sku: 'B', quantity: 868, netSales: 1_072_000, isAggregate: true }),
  ]
  const figure = orderBasisNetSales(aggregates)

  it('still counts the units, which the report does carry', () => {
    expect(figure.units).toBe(2068)
  })

  it('reports no order count rather than the number of SKU rows', () => {
    expect(figure.orders).toBe(0)
    expect(figure.hasAggregateRows).toBe(true)
    expect(orderCount(figure)).toBeNull()
  })

  it('refuses to compute an average order value from it', () => {
    // ₹24.72L over two rows would have read as ₹12.36L an order.
    expect(aov(figure)).toBeNull()
  })

  it('still computes ASP, which needs only units', () => {
    expect(asp(figure)).toBeCloseTo(2_472_000 / 2068, 4)
  })
})

describe('a real order report is unaffected', () => {
  const orders = [
    row({ orderId: 'o1', channel: 'meesho', marketplace: 'meesho', quantity: 2, netSales: 400 }),
    row({ orderId: 'o2', channel: 'meesho', marketplace: 'meesho', quantity: 1, netSales: 200 }),
  ]
  const figure = orderBasisNetSales(orders)

  it('counts its orders', () => {
    expect(figure.orders).toBe(2)
    expect(figure.hasAggregateRows).toBe(false)
    expect(orderCount(figure)).toBe(2)
  })

  it('gives an average order value that means something', () => {
    expect(aov(figure)).toBeCloseTo(300, 6)
    expect(asp(figure)).toBeCloseTo(200, 6)
  })
})

describe('a channel carrying both kinds of row', () => {
  it('will not claim an order count it cannot support', () => {
    // One aggregate among real orders makes the total unknowable, and a
    // partial count presented as a total is worse than no count.
    const mixed = orderBasisNetSales([
      row({ orderId: 'o1', quantity: 1, netSales: 200 }),
      row({ orderId: 'agg', quantity: 500, netSales: 100_000, isAggregate: true }),
    ])
    expect(mixed.orders).toBe(1)
    expect(orderCount(mixed)).toBeNull()
    expect(aov(mixed)).toBeNull()
    expect(mixed.units).toBe(501)
  })
})
