import { describe, expect, it } from 'vitest'
import { detectTata1mgSalesReport, normalizeTata1mgSalesReport, tata1mgDate } from './tata1mgSalesReport'
import type { SkuMaster } from '@/data/models'
import type { SkuMapping } from '@/data/skuMapping'

const HEADERS = ['Voucher type', 'Order ID', 'BILL NO.', 'BILL DATE', 'ITEM ID', 'ITEM NAME', 'Product MRP', 'QTY',
  'SGST% ', 'CGST% ', 'IGST% ', 'SALE RATE']

const row = (over: Partial<Record<string, string>> = {}): Record<string, string> => ({
  'Voucher type': 'SalesOrder',
  'Order ID': 'PO21126733434019',
  'BILL NO.': 'C047852600000452',
  'BILL DATE': '01-08-2026',
  'ITEM ID': '1075181',
  'ITEM NAME': 'Aravi Organic Tinted Beetroot Lip Balm SPF 50 PA+++',
  'Product MRP': '279',
  QTY: '1',
  'SGST% ': '9',
  'CGST% ': '9',
  'IGST% ': '18',
  'SALE RATE': '202',
  ...over,
})

const skuMaster: SkuMaster[] = [
  { sku: 'AO/LBalm/Tinted(BT)', productName: 'Tinted Beetroot Lip Balm - 5 gm', category: 'Lip Care', brand: 'Aravi Organic',
    cogs: 21, mrp: 279, gstPct: 18, launchDate: '2025-04-01', status: 'active', leadTimeDays: 21, safetyStock: 0 },
  { sku: 'AO/Shmp/Rosemary/200', productName: 'Rosemary Hair Growth Shampoo - 200 ml', category: 'Hair Care', brand: 'Aravi Organic',
    cogs: 54.5, mrp: 349, gstPct: 5, launchDate: '2025-04-01', status: 'active', leadTimeDays: 21, safetyStock: 0 },
]
const mappings: SkuMapping[] = [
  { channelSku: '1075181', internalSku: 'AO/LBalm/Tinted(BT)', kind: 'SINGLE', source: 'manual', verified: true },
]

const run = (rows: Record<string, string>[]) => normalizeTata1mgSalesReport(rows, skuMaster, mappings, [], 'imp')

describe('recognising the register', () => {
  it('takes a bill number and a voucher type beside a sale rate as 1mg', () => {
    expect(detectTata1mgSalesReport(HEADERS)).toBe(true)
  })

  it('does not claim another channel\'s order list', () => {
    expect(detectTata1mgSalesReport(['order id', 'sku', 'qty', 'sale rate'])).toBe(false)
  })

  it('reads the bill date day first', () => {
    expect(tata1mgDate('01-08-2026')).toBe('2026-08-01')
    expect(tata1mgDate('17-08-2026')).toBe('2026-08-17')
  })
})

describe('a bill line', () => {
  const r = run([row()])

  it('earns the sale rate less the GST inside it', () => {
    expect(r.validRecords[0].netSales).toBeCloseTo(202 / 1.18, 2)
    expect(r.validRecords[0].tax).toBeCloseTo(202 - 202 / 1.18, 2)
  })

  it('shows MRP × quantity as gross and the rest as the discount', () => {
    expect(r.validRecords[0].grossSales).toBe(279)
    expect(r.validRecords[0].discount).toBe(77)
  })

  it('reads SALE RATE as the line total, not a unit price', () => {
    // Two shampoos at ₹311 MRP come to ₹573.98 for the line, not ₹1,147.96.
    const two = run([row({ 'ITEM ID': 'AO_Shmp_Rosemary_200', QTY: '2', 'Product MRP': '311', 'SALE RATE': '573.98', 'IGST% ': '5', 'SGST% ': '2.5', 'CGST% ': '2.5' })])
    expect(two.totals.saleRateInclGst).toBeCloseTo(573.98, 2)
    expect(two.validRecords[0].quantity).toBe(2)
    // At the Master's 5%, not at the 18% the lip balm carries.
    expect(two.validRecords[0].netSales).toBeCloseTo(573.98 / 1.05, 2)
  })

  it('reads an underscore code as the Product Master spells it', () => {
    const r2 = run([row({ 'ITEM ID': 'AO_Shmp_Rosemary_200', 'SALE RATE': '286.99', 'IGST% ': '5' })])
    expect(r2.validRecords[0].productName).toBe('Rosemary Hair Growth Shampoo - 200 ml')
    expect(r2.warnings.some((w) => w.includes('AO_Shmp_Rosemary_200 → AO/Shmp/Rosemary/200'))).toBe(true)
  })

  it('counts a bill with two lines once', () => {
    const r2 = run([row(), row({ 'ITEM ID': 'AO_Shmp_Rosemary_200', 'SALE RATE': '286.99' })])
    expect(r2.totals.bills).toBe(1)
    expect(r2.validRecords[0].lineId).not.toBe(r2.validRecords[1].lineId)
  })
})

describe('what the register does not carry', () => {
  it('says the month shows no returns because none are stated', () => {
    expect(run([row()]).warnings.some((w) => w.includes('no returns because'))).toBe(true)
  })

  it('names an item invoiced at a rate the Product Master disagrees with', () => {
    // August bills rosemary oil at 5% where the Master says 18%.
    const r2 = run([row({ 'IGST% ': '5', 'SGST% ': '2.5', 'CGST% ': '2.5' })])
    expect(r2.warnings.some((w) => w.includes('differs from the Product Master'))).toBe(true)
    expect(r2.validRecords[0].tax).toBeCloseTo(202 - 202 / 1.18, 2)
  })

  it('falls back to the register\'s own rate for an item the Master has never seen', () => {
    const r2 = run([row({ 'ITEM ID': '9999999' })])
    expect(r2.validRecords[0].tax).toBeCloseTo(202 - 202 / 1.18, 2)
  })
})
