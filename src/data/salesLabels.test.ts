import { describe, expect, it } from 'vitest'
import { applySalesLabels, type LabelledSalesRow, type SalesLabel } from './salesLabels'

/**
 * The product text travels once and is put back on the rows here.
 *
 * It is a dictionary and an id rather than a rejoin by SKU for a reason this
 * covers: fifty-one SKUs in the live data carry more than one spelling of
 * their own name or category on a single channel. A rejoin would have picked
 * one of them and quietly changed what the screens show.
 */
const LABELS: SalesLabel[] = [
  { id: 1, productName: 'Rosemary Oil 30ml', category: 'Hair Care', subCategory: 'Oils', marketplace: 'flipkart' },
  { id: 2, productName: 'Rosemary Oil (30 ml)', category: 'Hair', marketplace: 'flipkart' },
]

const row = (over: Partial<LabelledSalesRow>): LabelledSalesRow => ({
  orderDate: '2026-09-01', channel: 'flipkart', sellerType: 'marketplace', sku: 'AO-ROSE-30',
  quantity: 1, grossSales: 499, discount: 0, netSales: 499, returnUnits: 0, rtoUnits: 0,
  shippingCost: 0, marketplaceFee: 50, tax: 0, status: 'completed', currency: 'INR',
  orders: 1, labelId: 1, ...over,
})

describe('putting the product text back on the rows', () => {
  it('gives each row the text its id points at', () => {
    const [a] = applySalesLabels([row({})], LABELS)
    expect(a.productName).toBe('Rosemary Oil 30ml')
    expect(a.category).toBe('Hair Care')
    expect(a.subCategory).toBe('Oils')
    expect(a.marketplace).toBe('flipkart')
  })

  it('keeps two spellings of one SKU apart', () => {
    const [a, b] = applySalesLabels([row({ labelId: 1 }), row({ labelId: 2 })], LABELS)
    expect(a.productName).not.toBe(b.productName)
    expect(a.category).not.toBe(b.category)
    expect(a.sku).toBe(b.sku)
  })

  it('leaves every figure untouched', () => {
    const before = row({ grossSales: 1234.56, netSales: 999.01, quantity: 7, orders: 3 })
    const [after] = applySalesLabels([before], LABELS)
    expect(after.grossSales).toBe(1234.56)
    expect(after.netSales).toBe(999.01)
    expect(after.quantity).toBe(7)
    expect(after.orders).toBe(3)
    expect(after.orderDate).toBe('2026-09-01')
  })

  it('carries no label id onto the records the screens read', () => {
    const [after] = applySalesLabels([row({})], LABELS)
    expect('labelId' in after).toBe(false)
  })

  /**
   * A row whose id is not in the dictionary keeps empty text rather than
   * disappearing: a missing row changes a total, where an unnamed product is
   * visible on screen.
   */
  it('keeps a row whose label is missing', () => {
    const kept = applySalesLabels([row({ labelId: 99 }), row({ labelId: undefined })], LABELS)
    expect(kept).toHaveLength(2)
    expect(kept[0].netSales).toBe(499)
    expect(kept[0].productName).toBe('')
    expect(kept[1].productName).toBe('')
  })

  it('survives an empty dictionary without losing a figure', () => {
    const kept = applySalesLabels([row({}), row({ netSales: 10 })], [])
    expect(kept.map((r) => r.netSales)).toEqual([499, 10])
  })
})
