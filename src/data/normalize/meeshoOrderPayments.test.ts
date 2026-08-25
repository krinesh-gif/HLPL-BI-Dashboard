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
  h[34] = 'TCS'; h[35] = 'TDS Rate %'; h[36] = 'TDS'; h[37] = 'Compensation'; h[38] = 'Claims'; h[39] = 'Recovery'
  h[40] = 'Compensation Reason'; h[41] = 'Claims Reason'; h[42] = 'Recovery Reason'
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
    for (const f of result.factsByMonth) expect(f.schemaVersion).toBe(3)
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
  /** The Ads Cost sheet as the real workbook lays it out: a title row, the
   * header, a formula-key row, then data. */
  const adsSheet = (rows: (string | number)[][]): RawSheet => [
    ['Ads Cost'],
    ['Deduction Duration', 'Deduction Date', 'Campaign ID', 'Ad Cost', 'Credits / Waivers / Discounts',
     'Ad Cost incl. Credits/Waivers/Discounts', 'GST', 'Total Ads Cost'],
    ['', '', '', 'A', 'B', '(A + B)', '', ''],
    ...rows,
  ]

  it('lands in both bases on the month Meesho deducted it', () => {
    // Meesho reports ad spend only by deduction date, so spreading it across
    // order months would invent a distribution the report does not carry.
    const ads = adsSheet([['2026-07-29', '2026-07-31', '169618', 5000, 0, -5000, -900, -5900]])
    const r = normalizeMeeshoOrderPayments(sheet, ads, skuMaster, 'i')
    expect(factsFor(r, 'order', '2026-07').adsSpendExGst).toBe(5000)
    expect(factsFor(r, 'settlement', '2026-07').adsSpendExGst).toBe(5000)
  })

  it('takes spend ex-GST and the tax separately, never the two added together', () => {
    // The Total Ads Cost column is spend plus GST. Reading it as spend
    // overstated August advertising by ₹5,099 on ₹28,329 and then added
    // another 18% of tax on top of a figure that already contained it.
    const ads = adsSheet([['2026-07-29', '2026-07-31', '169618', 5000, 0, -5000, -900, -5900]])
    const f = factsFor(normalizeMeeshoOrderPayments(sheet, ads, skuMaster, 'i'), 'order', '2026-07')
    expect(f.adsSpendExGst).toBe(5000)
    expect(f.gstOnAds).toBe(900)
  })

  it('uses the deduction date, not the campaign duration, to pick the month', () => {
    // A campaign running on 31 July is deducted on 2 August; the money left
    // the account in August.
    const ads = adsSheet([['2026-07-31', '2026-08-02', '169618', 1000, 0, -1000, -180, -1180]])
    const r = normalizeMeeshoOrderPayments(sheet, ads, skuMaster, 'i')
    expect(factsFor(r, 'order', '2026-08').adsSpendExGst).toBe(1000)
    expect(r.factsByMonth.find((x) => x.month === '2026-07' && x.basis === 'order')?.adsSpendExGst ?? 0).toBe(0)
  })
})

/**
 * The report is a ledger of financial events, not a list of orders.
 *
 * Every case below was found in the company's real August payment file. Before
 * these fixes that file produced 60 phantom shipments and 61 phantom units in
 * August, each carrying invented cost of goods and packaging cost, because
 * every row was read as an order.
 */
describe('rows that are not orders', () => {
  const factsOf = (r: ReturnType<typeof normalizeMeeshoOrderPayments>, basis: 'order' | 'settlement', month: string) =>
    r.factsByMonth.find((f) => f.basis === basis && f.month === month)!

  it('does not turn a blank-status affiliate fee into a shipment', () => {
    // 145 rows of the real file: blank status, zero sale, a negative recovery
    // with the reason "Affiliate Fee". Each was being counted as delivered.
    const affiliate = dataRow({ 0: 'SUB2', 7: '', 10: 1, 13: -28.25, 15: 0, 39: -28.25, 42: 'Affiliate Fee' })
    const r = normalizeMeeshoOrderPayments([['g'], realHeaderRow(), [''], dataRow(), affiliate], undefined, skuMaster, 'i')
    const f = factsOf(r, 'order', '2026-07')

    expect(f.subOrdersDispatched).toBe(1)   // the real order only
    expect(f.unitsDispatched).toBe(2)
    expect(f.grossSalesInclGst).toBe(279)   // the fee row adds no revenue
    expect(f.affiliateFee).toBe(28.25)      // and is advertising, not a fee
    expect(f.recovery).toBe(0)
  })

  it('charges no cost of goods against a fee row', () => {
    // The clearest symptom: a zero-sale fee row was costed as if a product
    // had shipped, at whatever the Product Master said that SKU cost.
    const affiliate = dataRow({ 0: 'SUB2', 7: '', 10: 1, 13: -28.25, 15: 0, 39: -28.25, 42: 'Affiliate Fee' })
    const withFee = normalizeMeeshoOrderPayments([['g'], realHeaderRow(), [''], dataRow(), affiliate], undefined, skuMaster, 'i')
    const without = normalizeMeeshoOrderPayments([['g'], realHeaderRow(), [''], dataRow()], undefined, skuMaster, 'i')
    expect(factsOf(withFee, 'order', '2026-07').cogsUnitsSold).toBe(factsOf(without, 'order', '2026-07').cogsUnitsSold)
  })

  it('counts one dispatch when a sub-order appears as both a sale and a return', () => {
    // 145 sub-orders in the real file appear twice. The return is a reversal
    // of a shipment already counted, not a second parcel.
    const sale = dataRow({ 0: 'SUB9', 7: 'Shipped', 15: 160, 16: 0 })
    const ret = dataRow({ 0: 'SUB9', 7: 'Return', 15: 0, 16: -160, 13: -251.18, 12: '2026-08-06' })
    const f = factsOf(normalizeMeeshoOrderPayments([['g'], realHeaderRow(), [''], sale, ret], undefined, skuMaster, 'i'), 'order', '2026-07')

    expect(f.subOrdersDispatched).toBe(1)
    expect(f.grossSalesInclGst).toBe(160)
    expect(f.salesReturnsInclGst).toBe(160)   // fully reversed
    expect(f.unitsReturned).toBe(2)
  })

  it('carries an exchange in Gross Sales but still flags it', () => {
    // Gross Sales is the file's Total Sale Amount column, which is what the
    // business reconciles against, so the row belongs in it. Whether a
    // replacement against an already-counted order should earn revenue is a
    // judgement — so it stays visible in the review queue rather than being
    // decided silently in either direction.
    const exchange = dataRow({ 0: 'SUB7', 7: 'Exchange', 15: 190.6, 27: -175 })
    const r = normalizeMeeshoOrderPayments([['g'], realHeaderRow(), [''], exchange], undefined, skuMaster, 'i')
    const f = factsOf(r, 'order', '2026-07')
    expect(f.grossSalesInclGst).toBe(190.6)
    expect(f.subOrdersDispatched).toBe(1)
    expect(f.returnShipping).toBe(175)
    expect(r.exceptions.map((e) => e.eventType)).toContain('exchange')
  })

  it('carries a cancelled order in Gross Sales but ships and costs nothing', () => {
    const cancelled = dataRow({ 0: 'SUB8', 7: 'Cancelled', 15: 323, 13: 279.36 })
    const r = normalizeMeeshoOrderPayments([['g'], realHeaderRow(), [''], cancelled], undefined, skuMaster, 'i')
    const f = factsOf(r, 'order', '2026-07')
    expect(f.grossSalesInclGst).toBe(323)
    expect(f.subOrdersDispatched).toBe(0)   // no parcel moved
    expect(f.cogsUnitsSold).toBe(0)         // and no stock left the shelf
    expect(f.netSettlementPerFile).toBe(279.36)
    expect(r.exceptions.map((e) => e.eventType)).toContain('cancellation')
  })

  it('sends the judgement calls to review rather than deciding silently', () => {
    const rows = [
      dataRow(),
      dataRow({ 0: 'SUB7', 7: 'Exchange', 15: 190.6 }),
      dataRow({ 0: 'SUB8', 7: 'Cancelled', 15: 323 }),
      dataRow({ 0: 'SUB9', 7: 'Teleported', 15: 500 }),
    ]
    const r = normalizeMeeshoOrderPayments([['g'], realHeaderRow(), [''], ...rows], undefined, skuMaster, 'i')
    expect(r.exceptions).toHaveLength(3)
    expect(r.exceptions.map((e) => e.eventType).sort()).toEqual(['cancellation', 'exchange', 'unclassified'])
    // A status this app does not recognise still ships nothing and costs
    // nothing until someone says what it is.
    const f = r.factsByMonth.find((x) => x.basis === 'order')!
    expect(f.subOrdersDispatched).toBe(2) // the ordinary sale and the exchange
  })
})

/**
 * The three columns the business reconciles the dashboard against by hand:
 * Total Sale Amount summed by order-date month, and the shipping charge.
 * If either drifts, the whole statement is untrusted regardless of what the
 * lines below it do.
 */
describe('tying to the file the owner checks against', () => {
  const factsOf = (r: ReturnType<typeof normalizeMeeshoOrderPayments>, basis: 'order' | 'settlement', month: string) =>
    r.factsByMonth.find((f) => f.basis === basis && f.month === month)!

  it('Gross Sales is the sale-amount column, whatever the row’s status', () => {
    const rows = [
      dataRow({ 0: 'A', 7: 'Delivered', 15: 279 }),
      dataRow({ 0: 'B', 7: 'RTO', 15: 199, 16: -199 }),
      dataRow({ 0: 'C', 7: 'Cancelled', 15: 323 }),
      dataRow({ 0: 'D', 7: 'Exchange', 15: 190.6 }),
      dataRow({ 0: 'E', 7: '', 15: 0, 39: -28.25, 42: 'Affiliate Fee' }),
    ]
    const f = factsOf(normalizeMeeshoOrderPayments([['g'], realHeaderRow(), [''], ...rows], undefined, skuMaster, 'i'), 'order', '2026-07')
    expect(f.grossSalesInclGst).toBeCloseTo(279 + 199 + 323 + 190.6, 6)
  })

  it('a shipping credit reduces shipping cost instead of adding to it', () => {
    // Meesho writes a charge negative and a credit against it positive. Summing
    // magnitudes turned April's ₹147.66 of credits into ₹147.66 of extra cost,
    // and the month read ₹295 above the file across the two months in it.
    const charged = dataRow({ 0: 'A', 29: -100 })
    const credited = dataRow({ 0: 'B', 29: 40 })
    const f = factsOf(normalizeMeeshoOrderPayments([['g'], realHeaderRow(), [''], charged, credited], undefined, skuMaster, 'i'), 'order', '2026-07')
    expect(f.forwardShipping).toBe(60)
  })
})

describe('the Compensation and Recovery sheet', () => {
  const recoverySheet = (rows: (string | number)[][]) => [
    ['Platform Recovery & Compensation'],
    ['Date', 'Program Name', 'Reason', 'Amount (inc GST) INR'],
    [''],
    ...rows,
  ]

  it('charges a subscription recovery that hangs off no order', () => {
    // April's file carries one SELLER_INSIGHTS recovery of ₹942.82. It never
    // appears against an order, so it was being dropped entirely.
    const r = normalizeMeeshoOrderPayments(
      [['g'], realHeaderRow(), [''], dataRow()], undefined, skuMaster, 'i', 'f.xlsx',
      recoverySheet([['2026-07-28', 'SELLER_INSIGHTS', 'Recovery for subscribed sellers', -942.82]]),
    )
    const f = r.factsByMonth.find((x) => x.basis === 'order' && x.month === '2026-07')!
    expect(f.platformRecoverySubscriptions).toBe(942.82)
    expect(r.warnings.some((w) => w.includes('platform recovery'))).toBe(true)
  })

  it('does not read the sheet’s “no data” line as a transaction', () => {
    const r = normalizeMeeshoOrderPayments(
      [['g'], realHeaderRow(), [''], dataRow()], undefined, skuMaster, 'i', 'f.xlsx',
      recoverySheet([['No data is available for these dates.']]),
    )
    const f = r.factsByMonth.find((x) => x.basis === 'order' && x.month === '2026-07')!
    expect(f.platformRecoverySubscriptions).toBe(0)
  })
})

describe('reading the sheet', () => {
  it('finds columns by name, so an inserted column cannot shift the P&L', () => {
    const header = realHeaderRow()
    const row = dataRow()
    header.splice(2, 0, 'Some New Meesho Column')
    row.splice(2, 0, 'x')
    const r = normalizeMeeshoOrderPayments([['g'], header, [''], row], undefined, skuMaster, 'i')
    const f = r.factsByMonth.find((x) => x.basis === 'order')!
    expect(f.grossSalesInclGst).toBe(279)
    expect(r.unmappedColumns).toContain('Some New Meesho Column')
  })

  it('reports a column it does not recognise instead of dropping it', () => {
    const header = realHeaderRow()
    header[43] = 'Brand New Fee (Incl. GST)'
    const r = normalizeMeeshoOrderPayments([['g'], header, [''], dataRow()], undefined, skuMaster, 'i')
    expect(r.unmappedColumns).toContain('Brand New Fee (Incl. GST)')
    expect(r.warnings.some((w) => w.includes('does not map'))).toBe(true)
  })

  it('keeps the sub-order as text, so a long numeric id is not rounded', () => {
    const r = normalizeMeeshoOrderPayments(
      [['g'], realHeaderRow(), [''], dataRow({ 0: '307978112155113600_1' })], undefined, skuMaster, 'i',
    )
    expect(r.transactions[0].subOrderId).toBe('307978112155113600_1')
  })

  it('keeps the original row against each transaction for audit', () => {
    const r = normalizeMeeshoOrderPayments([['g'], realHeaderRow(), [''], dataRow()], undefined, skuMaster, 'i', 'August 2026.xlsx')
    const t = r.transactions[0]
    expect(t.sourceFile).toBe('August 2026.xlsx')
    expect(t.sourceSheet).toBe('Order Payments')
    expect(t.sourceRowNumber).toBe(4)
    expect(t.raw['Total Sale Amount (Incl. Shipping & GST)']).toBe('279')
  })

  it('does not shift a late-evening order into the previous month', () => {
    // A 31 July 23:40 order parsed through a timezone would land in June or
    // August depending on the server, moving revenue between closed months.
    const r = normalizeMeeshoOrderPayments(
      [['g'], realHeaderRow(), [''], dataRow({ 1: '2026-07-31 23:40:00' })], undefined, skuMaster, 'i',
    )
    expect(r.factsByMonth.some((f) => f.basis === 'order' && f.month === '2026-07')).toBe(true)
  })
})
