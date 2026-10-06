import { describe, expect, it } from 'vitest'
import type { CanonicalSalesRecord } from '@/data/models'
import { aov, asp, orderBasisNetSales, orderCount, returnPct, rtoPct } from './netSales'

/**
 * The dashboard reads sales rows grouped, not one per order line.
 *
 * 74,354 order lines were 42 MB of JSON on every page load, and no screen
 * reads an order line: every one of them sums by day, channel, SKU or month
 * first. `/api/state` now groups on exactly the fields a screen can
 * discriminate by and carries the line count, which gives 16,300 rows and
 * 6 MB.
 *
 * That is only safe if it changes no figure, so this rolls records up the way
 * the SQL does and asserts the engine cannot tell the difference. The grouping
 * key here is the GROUP BY in `api/state.ts`; if one gains a field and the
 * other does not, a figure moves and this is what notices.
 */
const KEY: (keyof CanonicalSalesRecord)[] = [
  'orderDate', 'channel', 'marketplace', 'sellerType', 'sku', 'productName',
  'category', 'subCategory', 'status', 'currency', 'isAggregate',
]

const SUMMED: (keyof CanonicalSalesRecord)[] = [
  'quantity', 'grossSales', 'discount', 'netSales',
  'returnUnits', 'rtoUnits', 'shippingCost', 'marketplaceFee', 'tax',
]

/** What the GROUP BY in api/state.ts produces, in TypeScript. */
function rollup(records: CanonicalSalesRecord[]): CanonicalSalesRecord[] {
  const groups = new Map<string, CanonicalSalesRecord>()
  for (const r of records) {
    const key = KEY.map((k) => String(r[k] ?? '')).join('\u0000')
    const found = groups.get(key)
    if (!found) {
      groups.set(key, { ...r, orderId: undefined, importId: undefined, raw: undefined, orders: r.orders ?? 1 })
      continue
    }
    for (const field of SUMMED) {
      ;(found as unknown as Record<string, number>)[field] =
        ((found as unknown as Record<string, number>)[field] ?? 0) + ((r as unknown as Record<string, number>)[field] ?? 0)
    }
    found.orders = (found.orders ?? 0) + (r.orders ?? 1)
  }
  return [...groups.values()]
}

/**
 * Every field of the figure, compared.
 *
 * Keyed off the union of both objects rather than a written list, so a field
 * added to the figure later has to survive the rollup as well. Numbers are
 * compared to six decimals, not exactly: adding 40 fees one at a time and
 * adding one pre-summed fee give 6133.399999999998 and 6133.4, which is
 * floating point, not a difference in the answer — and grouping, doing fewer
 * additions, is the marginally more accurate of the two.
 */
function expectSameFigure(figureA: object, figureB: object): void {
  const a = figureA as Record<string, unknown>
  const b = figureB as Record<string, unknown>
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
  expect(keys).toEqual([...new Set([...Object.keys(b), ...Object.keys(a)])].sort())
  for (const k of keys) {
    if (typeof b[k] === 'number' && typeof a[k] === 'number') {
      expect(a[k] as number, k).toBeCloseTo(b[k] as number, 6)
    } else {
      expect(a[k], k).toEqual(b[k])
    }
  }
}

const line = (over: Partial<CanonicalSalesRecord>): CanonicalSalesRecord => ({
  orderId: `o${Math.random()}`, orderDate: '2026-08-04', channel: 'amazon_in_seller',
  marketplace: 'amazon_in_seller', sellerType: 'seller_central', sku: 'AO-ROSE-30',
  productName: 'Rosemary Oil 30ml', category: 'Hair Care',
  quantity: 1, grossSales: 499, discount: 50, netSales: 449,
  returnUnits: 0, rtoUnits: 0, shippingCost: 38, marketplaceFee: 71, tax: 68,
  status: 'completed', currency: 'INR', importId: 'imp1', ...over,
})

/** A month that exercises every branch the figure has: several SKUs, several
 * channels, returns, RTO, cancellations and a currency that needs converting. */
const MONTH: CanonicalSalesRecord[] = [
  ...Array.from({ length: 40 }, () => line({})),
  ...Array.from({ length: 12 }, () => line({ sku: 'AO-ARGAN-50', grossSales: 899, discount: 120, netSales: 779 })),
  ...Array.from({ length: 7 }, () => line({ orderDate: '2026-08-05', returnUnits: 1, netSales: 0, discount: 0, grossSales: 499 })),
  ...Array.from({ length: 5 }, () => line({ orderDate: '2026-08-06', rtoUnits: 1, netSales: 0, discount: 0, grossSales: 499 })),
  ...Array.from({ length: 3 }, () => line({ status: 'cancelled' })),
  ...Array.from({ length: 9 }, () => line({ channel: 'flipkart', marketplace: 'flipkart', sellerType: 'marketplace', quantity: 2 })),
  ...Array.from({ length: 6 }, () => line({ channel: 'amazon_us', marketplace: 'amazon_us', currency: 'USD', grossSales: 12, discount: 1, netSales: 11, shippingCost: 2, marketplaceFee: 1.8, tax: 0 })),
]

describe('grouping the sales rows changes no figure', () => {
  const raw = orderBasisNetSales(MONTH, 88)
  const rolled = orderBasisNetSales(rollup(MONTH), 88)

  it('collapses the rows it is meant to', () => {
    // The whole point: fewer rows across the wire.
    expect(rollup(MONTH).length).toBeLessThan(MONTH.length / 3)
  })

  it('reports the same figure, field for field', () => {
    expectSameFigure(rolled, raw)
  })

  it('keeps the order count, which is what rows used to stand for', () => {
    // 82 revenue-bearing lines, not 11 groups. Counting groups would have
    // quadrupled every average order value on the dashboard.
    expect(rolled.orders).toBe(raw.orders)
    expect(rolled.orders).toBe(79)
    expect(orderCount(rolled)).toBe(orderCount(raw))
  })

  it('keeps the derived ratios', () => {
    expect(aov(rolled)).toBeCloseTo(aov(raw) as number, 10)
    expect(asp(rolled)).toBeCloseTo(asp(raw) as number, 10)
    expect(rtoPct(rolled)).toBeCloseTo(rtoPct(raw) as number, 10)
    expect(returnPct(rolled)).toBeCloseTo(returnPct(raw) as number, 10)
  })

  it('still knows an aggregate row is not an order', () => {
    // A per-SKU monthly aggregate carries no order count, and grouping must
    // not quietly turn its line count into one.
    const withAggregate = [...MONTH, line({ sku: 'AO-BULK', isAggregate: true, quantity: 1200, netSales: 1_400_000 })]
    const r = orderBasisNetSales(rollup(withAggregate), 88)
    expect(r.hasAggregateRows).toBe(true)
    expect(orderCount(r)).toBeNull()
    expectSameFigure(r, orderBasisNetSales(withAggregate, 88))
  })

  it('counts a row with no count of its own as one order', () => {
    // Rows the app normalises during an upload have never been grouped.
    const fresh = MONTH.map((r) => ({ ...r, orders: undefined }))
    expect(orderBasisNetSales(fresh, 88).orders).toBe(79)
  })
})
