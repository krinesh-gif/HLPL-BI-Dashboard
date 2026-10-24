import { describe, expect, it } from 'vitest'
import { detectFirstcrySalesReport, firstcryDate, normalizeFirstcrySalesReport } from './firstcrySalesReport'
import type { SkuMaster } from '@/data/models'

const HEADERS = ['POID', 'OrderDate', 'ProductID', 'Brand Name', 'Business Type', 'Quantity', 'MRP', 'MRP Sales',
  'Net Sales', 'subcategoryname', 'categoryname', 'stocktype', 'VendorStyleCode']

const row = (over: Partial<Record<string, string>> = {}): Record<string, string> => ({
  POID: '2776925XPO4DF615A',
  OrderDate: '2026-08-01 00:06:06',
  ProductID: '20556312',
  'Brand Name': 'Aravi',
  'Business Type': 'b2c',
  Quantity: '1',
  MRP: '449',
  'MRP Sales': '449',
  'Net Sales': '299',
  subcategoryname: 'Sun Protection',
  categoryname: 'Womens Personal Care',
  stocktype: 'CreditVendorStock',
  VendorStyleCode: 'AO/Fluid /Sunscreen/50',
  ...over,
})

const skuMaster: SkuMaster[] = [
  { sku: 'AO/Fluid /Sunscreen/50', productName: 'Fluid Sunscreen - 50 ml', category: 'Skin Care', brand: 'Aravi Organic',
    cogs: 51, mrp: 449, gstPct: 18, launchDate: '2025-04-01', status: 'active', leadTimeDays: 21, safetyStock: 0 },
]

const run = (rows: Record<string, string>[]) => normalizeFirstcrySalesReport(rows, skuMaster, [], [], 'imp')

describe('recognising the file', () => {
  it('takes a vendor style code beside MRP Sales as FirstCry', () => {
    expect(detectFirstcrySalesReport(HEADERS)).toBe(true)
  })

  it('does not claim a file with no MRP Sales column', () => {
    expect(detectFirstcrySalesReport(['poid', 'orderdate', 'quantity', 'net sales'])).toBe(false)
  })

  it('reads the timestamp as the calendar day it is', () => {
    expect(firstcryDate('2026-08-01 00:06:06')).toBe('2026-08-01')
    // Not pushed into July by a timezone.
    expect(firstcryDate('2026-08-01 23:59:59')).toBe('2026-08-01')
  })
})

describe('a line', () => {
  const r = run([row()])

  it('earns Net Sales less the GST inside it', () => {
    expect(r.validRecords[0].netSales).toBeCloseTo(299 / 1.18, 2)
    expect(r.validRecords[0].tax).toBeCloseTo(299 - 299 / 1.18, 2)
  })

  it('shows MRP Sales as gross and the price off as the discount', () => {
    expect(r.validRecords[0].grossSales).toBe(449)
    expect(r.validRecords[0].discount).toBe(150)
  })

  it('takes MRP Sales as the line, so a multi-unit row is not doubled', () => {
    const four = run([row({ Quantity: '4', MRP: '649', 'MRP Sales': '2596', 'Net Sales': '1796' })])
    expect(four.totals.mrpSales).toBe(2596)
    expect(four.totals.netSalesInclGst).toBe(1796)
    expect(four.validRecords[0].quantity).toBe(4)
  })

  it('says Net Sales is a shopper price with nothing taken out for FirstCry', () => {
    expect(r.warnings.some((w) => w.includes('nothing has been taken out of it for FirstCry'))).toBe(true)
    expect(r.validRecords[0].marketplaceFee).toBe(0)
  })
})

describe('checking the file against itself', () => {
  it('says so when MRP × Quantity is not MRP Sales', () => {
    expect(run([row({ Quantity: '2', 'MRP Sales': '449' })]).warnings.some((w) => w.includes('do not tie'))).toBe(true)
  })

  it('names a code with no GST rate rather than taxing it at nothing in silence', () => {
    const r2 = run([row({ VendorStyleCode: 'AO/HO/Rsm+HairGrowth/200' })])
    expect(r2.validRecords[0].tax).toBe(0)
    expect(r2.warnings.some((w) => w.includes('no GST rate') && w.includes('AO/HO/Rsm+HairGrowth/200'))).toBe(true)
  })

  it('reports a stocktype that is not FirstCry holding our stock on credit', () => {
    const bought = run([row({ stocktype: 'OutrightPurchase' })])
    expect(bought.warnings.some((w) => w.includes('outright purchase'))).toBe(true)
    expect(run([row()]).warnings.some((w) => w.includes('outright purchase'))).toBe(false)
  })
})
