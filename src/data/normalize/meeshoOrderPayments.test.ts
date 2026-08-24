import { describe, expect, it } from 'vitest'
import { detectMeeshoOrderPaymentsSheet, normalizeMeeshoOrderPayments } from './meeshoOrderPayments'
import type { RawSheet } from '@/lib/csvParse'
import type { SkuMaster } from '@/data/models'

const skuMaster: SkuMaster[] = [
  { sku: 'AO/LBalm/Tinted(BT)', productName: 'Beetroot Tinted Lip Balm', category: 'Lip Care', brand: 'Aravi Organic', cogs: 21, mrp: 279, launchDate: '2025-01-01', status: 'active', leadTimeDays: 18, safetyStock: 120 },
]

// Column order matches the real "Order Payments" sheet exactly (43 columns).
function realHeaderRow(): (string | number)[] {
  const h: (string | number)[] = new Array(43).fill('')
  h[0] = 'Sub Order No'; h[1] = 'Order Date'; h[3] = 'Product Name'; h[4] = 'Supplier SKU'
  h[7] = 'Live Order Status'; h[8] = 'Product GST %'; h[10] = 'Quantity'
  h[12] = 'Payment Date'; h[13] = 'Final Settlement Amount'
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
  row[8] = 18            // GST rate for this product
  row[10] = 2
  row[12] = '2026-08-05 00:00:00'  // settles the month after it was ordered
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

/** Facts for one basis and month, from a parsed sheet. */
function factsFor(result: ReturnType<typeof normalizeMeeshoOrderPayments>, basis: 'order' | 'settlement', month: string) {
  const f = result.factsByMonth.find((x) => x.basis === basis && x.month === month)
  if (!f) throw new Error(`no ${basis} facts for ${month}`)
  return f
}

describe('one upload, two bases', () => {
  const result = normalizeMeeshoOrderPayments(sheet, undefined, skuMaster, 'import-1')

  it('buckets the same row by order date and by payment date', () => {
    // Ordered in July, paid in August. Both statements must show it, in their
    // own month — that is the whole reason the two bases differ.
    expect(factsFor(result, 'order', '2026-07').grossSalesInclGst).toBe(279)
    expect(factsFor(result, 'settlement', '2026-08').grossSalesInclGst).toBe(279)
  })

  it('does not put the row in the other basis\'s month', () => {
    expect(result.factsByMonth.find((f) => f.basis === 'order' && f.month === '2026-08')).toBeUndefined()
    expect(result.factsByMonth.find((f) => f.basis === 'settlement' && f.month === '2026-07')).toBeUndefined()
  })

  it('stamps a schema version so an older stored shape cannot be misread', () => {
    for (const f of result.factsByMonth) expect(f.schemaVersion).toBe(2)
  })

  it('leaves a row with no payment date out of the settlement basis only', () => {
    const unpaid: RawSheet = [sheet[0], sheet[1], sheet[2], dataRow({ 12: '' })]
    const r = normalizeMeeshoOrderPayments(unpaid, undefined, skuMaster, 'i')
    expect(factsFor(r, 'order', '2026-07').grossSalesInclGst).toBe(279)
    expect(r.factsByMonth.some((f) => f.basis === 'settlement')).toBe(false)
    expect(r.warnings.some((w) => w.includes('no payment date'))).toBe(true)
  })
})

describe('GST', () => {
  it('is taken at each product\'s own rate, not a blended one', () => {
    // ₹279 at 18% carries ₹42.56 of GST: 279 × 18/118.
    const f = factsFor(normalizeMeeshoOrderPayments(sheet, undefined, skuMaster, 'i'), 'order', '2026-07')
    expect(f.outputGstOnSales).toBeCloseTo(279 * 18 / 118, 2)
  })

  it('follows the row when a product sits at a different rate', () => {
    const lowRate: RawSheet = [sheet[0], sheet[1], sheet[2], dataRow({ 8: 5 })]
    const f = factsFor(normalizeMeeshoOrderPayments(lowRate, undefined, skuMaster, 'i'), 'order', '2026-07')
    expect(f.outputGstOnSales).toBeCloseTo(279 * 5 / 105, 2)
  })

  it('is deducted from the net sales on the order rows too', () => {
    // The statement and the order rows must agree on what a sale was worth.
    const r = normalizeMeeshoOrderPayments(sheet, undefined, skuMaster, 'i')
    expect(r.validRecords[0].netSales).toBeCloseTo(279 - 279 * 18 / 118, 2)
  })

  it('takes no GST off a row that reports no rate', () => {
    const noRate: RawSheet = [sheet[0], sheet[1], sheet[2], dataRow({ 8: 0 })]
    const f = factsFor(normalizeMeeshoOrderPayments(noRate, undefined, skuMaster, 'i'), 'order', '2026-07')
    expect(f.outputGstOnSales).toBe(0)
  })
})

describe('marketplace charges', () => {
  const f = factsFor(normalizeMeeshoOrderPayments(sheet, undefined, skuMaster, 'i'), 'order', '2026-07')

  it('separates shipping from the other fees, as the statement does', () => {
    expect(f.forwardShipping).toBe(10)
    expect(f.returnShipping).toBe(0)
    // commission 20 + fixed 5 + warehousing 3
    expect(f.otherMarketplaceFees).toBe(28)
  })

  it('stores magnitudes, whatever sign the file used', () => {
    // The real file writes fees negative; the P&L applies the sign itself.
    expect(f.otherMarketplaceFees).toBeGreaterThan(0)
    expect(f.tcs).toBe(1.18)
  })
})

describe('returned stock', () => {
  it('charges a delivered unit to cost of sale', () => {
    const f = factsFor(normalizeMeeshoOrderPayments(sheet, undefined, skuMaster, 'i'), 'order', '2026-07')
    expect(f.cogsUnitsSold).toBe(21 * 2)
    expect(f.cogsRtoWriteOff).toBe(0)
    expect(f.unitsDelivered).toBe(2)
  })

  it('writes off only the unsaleable part of an RTO', () => {
    // 5% of RTO stock does not come back saleable.
    const rto: RawSheet = [sheet[0], sheet[1], sheet[2], dataRow({ 7: 'RTO' })]
    const f = factsFor(normalizeMeeshoOrderPayments(rto, undefined, skuMaster, 'i'), 'order', '2026-07')
    expect(f.cogsUnitsSold).toBe(0)
    expect(f.cogsRtoWriteOff).toBeCloseTo(21 * 2 * 0.05, 4)
    expect(f.unitsRto).toBe(2)
  })

  it('writes off more of a customer return, since the box was opened', () => {
    const returned: RawSheet = [sheet[0], sheet[1], sheet[2], dataRow({ 7: 'Return' })]
    const f = factsFor(normalizeMeeshoOrderPayments(returned, undefined, skuMaster, 'i'), 'order', '2026-07')
    expect(f.cogsReturnWriteOff).toBeCloseTo(21 * 2 * 0.4, 4)
    expect(f.unitsReturned).toBe(2)
  })

  it('does not count a cancelled order as dispatched', () => {
    const cancelled: RawSheet = [sheet[0], sheet[1], sheet[2], dataRow({ 7: 'Cancelled' })]
    const f = factsFor(normalizeMeeshoOrderPayments(cancelled, undefined, skuMaster, 'i'), 'order', '2026-07')
    expect(f.subOrdersDispatched).toBe(0)
    expect(f.unitsDispatched).toBe(0)
    expect(f.cogsUnitsSold).toBe(0)
  })
})

describe('advertising', () => {
  it('lands in both bases on the month Meesho deducted it', () => {
    // Meesho reports ad spend only by deduction date, so spreading it across
    // order months would invent a distribution the report does not carry.
    const ads: RawSheet = [['Ads'], ['Date'], [''], ['2026-07-31', '', '', '', '', '', '', 5000]]
    const r = normalizeMeeshoOrderPayments(sheet, ads, skuMaster, 'i')
    expect(factsFor(r, 'order', '2026-07').adsSpendExGst).toBe(5000)
    expect(factsFor(r, 'settlement', '2026-07').adsSpendExGst).toBe(5000)
  })
})
