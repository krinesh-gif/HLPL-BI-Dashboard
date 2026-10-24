import { describe, expect, it } from 'vitest'
import { detectPharmeasySalesReport, normalizePharmeasySalesReport, pharmeasyDate } from './pharmeasySalesReport'
import type { SkuMaster } from '@/data/models'

const HEADERS = ['c_order_id', 'order_placed_date', 'order_status', 'sku', 'seller_order_mrp', 'unit_selling_price',
  'unit_net_discount', 'fulfilled_qty', 'fulfilled_gmv', 'received_qty', 'received_gmv', 'igst_percent']

/** The owner's first August row: a ₹349 foot roll-on at ₹202.42 to us. */
const row = (over: Partial<Record<string, string>> = {}): Record<string, string> => ({
  c_order_id: '742345987419283456-84910',
  order_placed_date: '01-08-2026',
  order_status: 'DELIVERED',
  sku: 'AO/RO/AB/Foot/50',
  seller_order_mrp: '349',
  unit_selling_price: '202.42',
  unit_net_discount: '146.58',
  fulfilled_qty: '1',
  fulfilled_gmv: '349',
  received_qty: '1',
  received_gmv: '349',
  igst_percent: '18',
  ...over,
})

const skuMaster: SkuMaster[] = [
  { sku: 'AO/RO/AB/Foot/50', productName: '20% Urea Foot Roll on - 50 ml', category: 'Personal Care', brand: 'Aravi Organic',
    cogs: 35.55, mrp: 349, gstPct: 18, launchDate: '2025-04-01', status: 'active', leadTimeDays: 21, safetyStock: 0 },
]

const run = (rows: Record<string, string>[]) => normalizePharmeasySalesReport(rows, skuMaster, [], [], 'imp')

describe('recognising the file', () => {
  it('takes a seller-side MRP beside a fulfilled quantity as PharmEasy', () => {
    expect(detectPharmeasySalesReport(HEADERS)).toBe(true)
  })

  it('does not claim a file without the fulfilled columns', () => {
    expect(detectPharmeasySalesReport(['sku', 'order_status', 'unit_selling_price'])).toBe(false)
  })

  it('reads dd-mm-yyyy, and null where a cancelled line never got invoiced', () => {
    expect(pharmeasyDate('01-08-2026')).toBe('2026-08-01')
    expect(pharmeasyDate('null')).toBeNull()
  })
})

describe('a fulfilled row', () => {
  const r = run([row()])

  it('earns what PharmEasy pays us, not what the shopper paid', () => {
    // ₹202.42 including GST at 18% — ₹171.54 of revenue, not ₹349.
    expect(r.validRecords[0].netSales).toBeCloseTo(202.42 / 1.18, 2)
    expect(r.validRecords[0].tax).toBeCloseTo(30.88, 2)
  })

  it('shows the shopper price as gross and the trade margin as the discount', () => {
    expect(r.validRecords[0].grossSales).toBe(349)
    expect(r.validRecords[0].discount).toBeCloseTo(146.58, 2)
  })

  it('charges nothing as a marketplace fee: the margin is already the discount', () => {
    expect(r.validRecords[0].marketplaceFee).toBe(0)
  })

  it('reads the margin per row rather than at one rate for the file', () => {
    // 42% off on the foot roll-on, 14% on the body wash, in the same month.
    const two = run([row(), row({ sku: 'AO/BWash/Salicylic/300', unit_selling_price: '300.14', unit_net_discount: '48.86' })])
    expect(two.totals.tradeDiscount).toBeCloseTo(146.58 + 48.86, 2)
  })

  it('multiplies the unit price by the quantity fulfilled', () => {
    const two = run([row({ fulfilled_qty: '2', fulfilled_gmv: '698', received_qty: '2' })])
    expect(two.totals.sellerRevenueInclGst).toBeCloseTo(404.84, 2)
  })
})

describe('a row that was not fulfilled', () => {
  const cancelled = row({
    order_status: 'CANCELLATION_RETURN_CREATION_IN_PROGRESS',
    fulfilled_qty: '0', fulfilled_gmv: '0',
  })

  it('keeps the gross PharmEasy billed and earns no net', () => {
    const r = run([cancelled])
    expect(r.validRecords[0].grossSales).toBe(349)
    expect(r.validRecords[0].netSales).toBe(0)
    expect(r.validRecords[0].quantity).toBe(0)
  })

  it('is counted and reported rather than dropped', () => {
    const r = run([row(), cancelled])
    expect(r.totals.cancelledRows).toBe(1)
    expect(r.totals.cancelledGmv).toBe(349)
    expect(r.totals.fulfilledGmv).toBe(349)
  })

  it('reads a cancellation as cancelled, not as a return', () => {
    expect(run([row({ order_status: 'CANCELLED', fulfilled_qty: '0', fulfilled_gmv: '0' })]).validRecords[0].status)
      .toBe('cancelled')
  })
})

describe('checking the file against itself', () => {
  it('says so when MRP is not the price plus the discount', () => {
    const r = run([row({ unit_net_discount: '100' })])
    expect(r.warnings.some((w) => w.includes('do not tie'))).toBe(true)
  })

  it('falls back to the file\'s own rate where the Master has none, and names the gap', () => {
    const r = normalizePharmeasySalesReport([row({ sku: 'AO/UNKNOWN/CODE' })], skuMaster, [], [], 'imp')
    // 18% from the file rather than no tax at all.
    expect(r.validRecords[0].tax).toBeCloseTo(30.88, 2)
  })

  it('names a code the Master taxes differently from the invoice', () => {
    const r = run([row({ igst_percent: '5' })])
    expect(r.warnings.some((w) => w.includes('differs from the Product Master'))).toBe(true)
    // The Master decides: still 18%.
    expect(r.validRecords[0].tax).toBeCloseTo(30.88, 2)
  })
})
