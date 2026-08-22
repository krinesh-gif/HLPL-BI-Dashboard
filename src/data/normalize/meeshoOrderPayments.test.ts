import { describe, expect, it } from 'vitest'
import { detectMeeshoOrderPaymentsSheet, normalizeMeeshoOrderPayments } from './meeshoOrderPayments'
import type { RawSheet } from '@/lib/csvParse'
import type { SkuMaster } from '@/data/models'

const skuMaster: SkuMaster[] = [
  { sku: 'AO/LBalm/Tinted(BT)', productName: 'Beetroot Tinted Lip Balm', category: 'Lip Care', brand: 'Aravi Organic', cogs: 21, mrp: 279, standardSellingPrice: 279, launchDate: '2025-01-01', status: 'active', leadTimeDays: 18, minimumStock: 200, safetyStock: 120 },
]

// Column order matches the real "Order Payments" sheet exactly (43 columns).
function realHeaderRow(): (string | number)[] {
  const h: (string | number)[] = new Array(43).fill('')
  h[0] = 'Sub Order No'; h[1] = 'Order Date'; h[3] = 'Product Name'; h[4] = 'Supplier SKU'
  h[7] = 'Live Order Status'; h[10] = 'Quantity'; h[13] = 'Final Settlement Amount'
  h[15] = 'Total Sale Amount (Incl. Shipping & GST)'; h[16] = 'Total Sale Return Amount (Incl. Shipping & GST)'
  h[17] = 'Fixed Fee (Incl. GST)'; h[18] = 'Warehousing fee (inc Gst)'
  h[19] = 'Return premium (incl GST)'; h[20] = 'Return premium (incl GST) of Return'
  h[22] = 'Meesho Commission (Incl. GST)'; h[23] = 'Meesho gold platform fee (Incl. GST)'
  h[24] = 'Meesho mall platform fee (Incl. GST)'; h[25] = 'Fixed Fee (Incl. GST)'; h[26] = 'Warehousing fee (Incl. GST)'
  h[27] = 'Return Shipping Charge (Incl. GST)'; h[28] = 'GST Compensation (PRP Shipping)'; h[29] = 'Shipping Charge (Incl. GST)'
  h[32] = 'Net Other Support Service Charges (Excl. GST)'; h[33] = 'GST on Net Other Support Service Charges'
  h[34] = 'TCS'; h[36] = 'TDS'; h[37] = 'Compensation'; h[38] = 'Claims'; h[39] = 'Recovery'
  return h
}

function dataRow(overrides: Partial<Record<number, string | number>> = {}): (string | number)[] {
  const row: (string | number)[] = new Array(43).fill(0)
  row[0] = 'SUB1'
  row[1] = '2026-07-13 02:05:04'
  row[3] = 'Beetroot Tinted Lip Balm'
  row[4] = 'AO/LBalm/Tinted(BT)'
  row[7] = 'Delivered'
  row[10] = 2
  row[13] = 277.58
  row[15] = 279.0
  row[16] = 0
  row[17] = 0 // fixed fee #1
  row[18] = 0 // warehousing #1
  row[19] = 0
  row[20] = 0
  row[22] = -20 // commission (stored negative in the real file)
  row[23] = 0
  row[24] = 0
  row[25] = -5 // fixed fee #2
  row[26] = -3 // warehousing #2
  row[27] = 0
  row[28] = 0
  row[29] = -10 // shipping charge
  row[32] = 0
  row[33] = 0
  row[34] = -1.18
  row[36] = 0.24
  row[37] = 0
  row[38] = 0
  row[39] = 0
  Object.entries(overrides).forEach(([k, v]) => { row[Number(k)] = v! })
  return row
}

const sheet: RawSheet = [
  ['Order Related Details'],
  realHeaderRow(),
  new Array(43).fill(''), // formula-key row
  dataRow(),
]

describe('detectMeeshoOrderPaymentsSheet', () => {
  it('recognizes the real sheet by its header row', () => {
    expect(detectMeeshoOrderPaymentsSheet(sheet)).toBe(true)
  })
  it('rejects an unrelated sheet', () => {
    expect(detectMeeshoOrderPaymentsSheet([['a'], ['b', 'c']])).toBe(false)
  })
})

describe('normalizeMeeshoOrderPayments', () => {
  it('sums both same-named Fixed Fee / Warehousing fee columns rather than picking just one', () => {
    const result = normalizeMeeshoOrderPayments(sheet, undefined, skuMaster, 'import-1')
    expect(result.factsByMonth[0].fixedFee).toBe(5) // |0| + |-5|
    expect(result.factsByMonth[0].warehousing).toBe(3) // |0| + |-3|
  })

  it('aggregates facts by the real order month, derived from Order Date', () => {
    const result = normalizeMeeshoOrderPayments(sheet, undefined, skuMaster, 'import-1')
    expect(result.factsByMonth).toHaveLength(1)
    expect(result.factsByMonth[0].month).toBe('2026-07')
    expect(result.factsByMonth[0].grossSale).toBe(279)
    expect(result.factsByMonth[0].commission).toBe(20)
  })

  it('produces a canonical record with the real per-row order date', () => {
    const result = normalizeMeeshoOrderPayments(sheet, undefined, skuMaster, 'import-1')
    expect(result.validRecords).toHaveLength(1)
    expect(result.validRecords[0].orderDate).toBe('2026-07-13')
    expect(result.validRecords[0].sku).toBe('AO/LBalm/Tinted(BT)')
  })

  it('rolls Ads Cost sheet data into the matching month', () => {
    const adsSheet: RawSheet = [
      ['Ads Cost'],
      ['Deduction Duration', 'Deduction Date', 'Campaign ID', 'Ad Cost', 'Credits', 'Ad Cost incl', 'GST', 'Total Ads Cost'],
      new Array(8).fill(''),
      ['2026-07-01', '2026-07-03', '123', 400, 0, -400, -72, -472],
    ]
    const result = normalizeMeeshoOrderPayments(sheet, adsSheet, skuMaster, 'import-1')
    expect(result.factsByMonth[0].ads).toBeCloseTo(472)
  })

  it('estimates COGS for an unmapped SKU and warns', () => {
    const unknownSheet: RawSheet = [sheet[0], sheet[1], sheet[2], dataRow({ 4: 'UNKNOWN-SKU' })]
    const result = normalizeMeeshoOrderPayments(unknownSheet, undefined, skuMaster, 'import-1')
    expect(result.factsByMonth[0].cogs).toBeCloseTo(279 * 0.25)
    expect(result.warnings.some((w) => w.includes('not found in the Product Master'))).toBe(true)
  })
})
