import { describe, expect, it } from 'vitest'
import { detectWalmartUsItemReport, normalizeWalmartUsItemReport } from './walmartUsItemReport'
import type { SkuMaster } from '@/data/models'

const HEADERS = ['Item Name', 'SKU', 'GMV', 'Units Sold', 'Orders', 'Offer pageviews', 'Offer conversion',
  'Auth Sales', 'Cancelled Sales', 'Refund sales', 'Item ID', 'GMV - commission', 'AUR', 'Cancelled Units']

/** The owner's first August row, written the way Walmart writes money. */
const row = (over: Partial<Record<string, string>> = {}): Record<string, string> => ({
  'Item Name': 'Aravi Organic Rosemary Water Spray 3.38 fl oz',
  SKU: 'AO/Water/Rosemary/100',
  GMV: '$9.99',
  'Units Sold': '1.00',
  Orders: '1.00',
  'Auth Sales': '$9.99',
  'Cancelled Sales': '$0.00',
  'Refund sales': '$0.00',
  'GMV - commission': '$9.35',
  AUR: '$9.99',
  'Cancelled Units': '0.00',
  ...over,
})

const skuMaster: SkuMaster[] = [
  { sku: 'AO/Water/Rosemary/100', productName: 'Rosemary Water Hair Spray - 100 ml', category: 'Hair Care', brand: 'Aravi Organic',
    cogs: 28, mrp: 299, gstPct: 18, launchDate: '2025-04-01', status: 'active', leadTimeDays: 21, safetyStock: 0 },
]

const run = (rows: Record<string, string>[], month = '2026-08') =>
  normalizeWalmartUsItemReport(rows, skuMaster, [], [], month, 'imp')

describe('recognising the export', () => {
  it('takes GMV net of commission beside auth sales as Walmart', () => {
    expect(detectWalmartUsItemReport(HEADERS)).toBe(true)
  })

  it('does not claim another item summary', () => {
    expect(detectWalmartUsItemReport(['sku', 'gmv', 'units sold'])).toBe(false)
  })
})

describe('an item\'s month', () => {
  const r = run([row()])

  it('is stored in dollars, not converted here', () => {
    expect(r.validRecords[0].currency).toBe('USD')
    expect(r.validRecords[0].netSales).toBeCloseTo(9.99, 2)
  })

  it('reads the commission as the gap Walmart states', () => {
    expect(r.validRecords[0].marketplaceFee).toBeCloseTo(0.64, 2)
    expect(r.totals.commission).toBeCloseTo(0.64, 2)
  })

  it('takes cancelled and refunded money out of net sales', () => {
    const r2 = run([row({ GMV: '$44.97', 'Cancelled Sales': '$14.99', 'Refund sales': '$9.99', 'GMV - commission': '$39.57' })])
    expect(r2.validRecords[0].netSales).toBeCloseTo(19.99, 2)
    expect(r2.validRecords[0].grossSales).toBeCloseTo(44.97, 2)
  })

  it('is one row for the whole period, not one order', () => {
    expect(r.validRecords[0].isAggregate).toBe(true)
    expect(r.validRecords[0].orderDate).toBe('2026-08-01')
  })

  it('carries no GST: there is none in the United States', () => {
    expect(r.validRecords[0].tax).toBe(0)
  })

  it('files under the month it was given, and says that is where the month came from', () => {
    expect(run([row()], '2026-09').validRecords[0].orderDate).toBe('2026-09-01')
    expect(r.warnings.some((w) => w.includes('carries no date of its own'))).toBe(true)
  })

  it('states no commission rather than zero when the column is blank', () => {
    const r2 = run([row({ 'GMV - commission': '' })])
    expect(r2.validRecords[0].marketplaceFee).toBe(0)
  })

  it('ignores the blank line the export ends with', () => {
    expect(run([row(), {}]).validRecords).toHaveLength(1)
  })

  it('names a SKU the Product Master has never seen', () => {
    const r2 = run([row({ SKU: 'AO/NOT/IN/MASTER' })])
    expect(r2.warnings.some((w) => w.includes('AO/NOT/IN/MASTER'))).toBe(true)
  })
})
