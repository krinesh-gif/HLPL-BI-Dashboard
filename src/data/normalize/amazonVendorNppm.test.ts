import { describe, expect, it } from 'vitest'
import { detectAmazonVendorNppm, normalizeAmazonVendorNppm } from './amazonVendorNppm'
// Serial dates moved to the one place every report date is read, when an
// .xlsx ads export turned out to carry them too.
import { excelSerialDate } from '@/lib/reportDate'
import type { RawSheet } from '@/lib/csvParse'

// 2026-09-01 and 2026-09-30 as Excel writes them.
const SEP_1 = 46266
const SEP_30 = 46295

/**
 * The September layout: a `Working` sheet of sixteen columns with the month's
 * totals written into free cells to the right of the data. Figures are the
 * owner's own, trimmed to four shipment rows whose sums are stated above them.
 */
function septemberSheet(): RawSheet {
  const header = [
    'ASIN', 'Ship Day', 'order_day', 'Net Shipped GMS', 'Quantity Shipped', 'Net PPM',
    'Selling Price with Tax', 'Deal Sheet Price', 'Buyer Platform Price', 'Status', 'Remark',
    'Diffrence', 'Diffrence*QTY', '', '', '',
  ]
  const rows: RawSheet = [
    header,
    ['B0CPFP8NNB', SEP_1, SEP_1, 2345.2701, 9, 470.19, 369, 369, 369, 'Matched', 'Myntra', 0, 0, '', 'Net shipped GMS', 7000],
    ['B0DDBYGTQS', SEP_1, SEP_1, 1766.7091, 12, 390.78, 198, 199, 199, 'Matched', 'Done', 0, 0, '', 'Net PPM', 2140],
    ['B0CPFP8NNB', SEP_30, SEP_30, 1892.9155, 6, 470.28, 447, 449, 449, 'Matched', 'Done', 0, 0, '', '', 0.32],
    ['B0DPC99YWR', SEP_30, SEP_30, 995.1053, 7, 808.75, 296, 299, 296, 'Not matched', 'Flipkart', 3, 21, '', 'Margin closed', 0.32],
  ]
  // 32% contracted against 30.571% achieved on ₹7,000 is exactly ₹100.
  rows.push(['', '', '', '', '', '', '', '', '', '', '', '', '', '', 'CCOGS', 100])
  rows.push(['', '', '', '', '', '', '', '', '', '', '', '', '', '', 'Diffrence', 21])
  return rows
}

const GMS = 2345.2701 + 1766.7091 + 1892.9155 + 995.1053
const PPM = 470.19 + 390.78 + 470.28 + 808.75

/** The August layout: one `Sheet1`, seven columns, totals two columns over. */
function augustSheet(): RawSheet {
  return [
    ['ASIN', 'Ship Day', 'order_day', 'Net Shipped GMS', 'Quantity Shipped', 'Net PPM', 'Selling Price with Tax', '', '', ''],
    ['B0B8ZZ22JQ', 46235, 46235, 2915.2406, 10, 534.0393, 439, '', 'Net shipped GMS', 4357.82],
    ['B0CPFP8NNB', 46236, 46236, 1442.5793, 6, 303.6867, 369, '', 'Net PPM', 837.726],
    ['', '', '', '', '', '', '', '', 'Margin closed', 0.32],
    ['', '', '', '', '', '', '', '', 'CCOGS', 0],
  ]
}

describe('excelSerialDate', () => {
  it('reads a serial day', () => {
    expect(excelSerialDate(SEP_1)).toBe('2026-09-01')
    expect(excelSerialDate(SEP_30)).toBe('2026-09-30')
  })
  it('refuses anything that is not plausibly a date', () => {
    expect(excelSerialDate('')).toBeNull()
    expect(excelSerialDate(9)).toBeNull()
    expect(excelSerialDate('B0CPFP8NNB')).toBeNull()
  })
})

describe('detectAmazonVendorNppm', () => {
  it('recognizes both layouts the file arrives in', () => {
    expect(detectAmazonVendorNppm({ Working: septemberSheet() })).toBe(true)
    expect(detectAmazonVendorNppm({ Sheet1: augustSheet() })).toBe(true)
  })
  it('finds the sheet whatever it is called and wherever it sits', () => {
    expect(detectAmazonVendorNppm({ 'Deal Sheet': [['Asin', 'MRP']], Working: septemberSheet() })).toBe(true)
  })
  it('rejects the IXD workbook and anything else', () => {
    expect(detectAmazonVendorNppm({ x: [['Inbound date', 'asin', 'quantity_unpacked']] })).toBe(false)
    expect(detectAmazonVendorNppm({ x: [['Sub Order No']] })).toBe(false)
  })
})

describe('normalizeAmazonVendorNppm', () => {
  it('takes the month from the ship days, which is the only date in the file', () => {
    const r = normalizeAmazonVendorNppm({ Working: septemberSheet() }, 'import-1')
    expect(r.month).toBe('2026-09')
    expect(r.facts?.periodStart).toBe('2026-09-01')
    expect(r.facts?.periodEnd).toBe('2026-09-30')
  })

  it('invoices the retail value less the margin RK World earned on it', () => {
    const f = normalizeAmazonVendorNppm({ Working: septemberSheet() }, 'import-1').facts!
    expect(f.netShippedGms).toBeCloseTo(GMS, 2)
    expect(f.netPpm).toBeCloseTo(PPM, 2)
    expect(f.invoiceValue).toBeCloseTo(GMS - PPM, 2)
    expect(f.marginAchievedPct).toBeCloseTo(PPM / GMS, 6)
    expect(f.unitsShipped).toBe(34)
    expect(f.rows).toBe(4)
  })

  it('rolls an ASIN up across its ship days', () => {
    const f = normalizeAmazonVendorNppm({ Working: septemberSheet() }, 'import-1').facts!
    expect(f.asins).toHaveLength(3)
    const top = f.asins.find((a) => a.asin === 'B0CPFP8NNB')!
    expect(top.units).toBe(15)
    expect(top.gms).toBeCloseTo(2345.2701 + 1892.9155, 2)
    expect(top.invoice).toBeCloseTo(2345.2701 + 1892.9155 - 470.19 - 470.28, 2)
    expect(f.asins.reduce((s, a) => s + a.invoice, 0)).toBeCloseTo(f.invoiceValue, 2)
  })

  // The totals block sits in a different column in each layout, so it is
  // found by its labels. Reading it by position is how the August file would
  // come back with no contracted margin at all.
  it('finds the month totals in either layout', () => {
    const sep = normalizeAmazonVendorNppm({ Working: septemberSheet() }, 'import-1').facts!
    expect(sep.marginClosedPct).toBe(0.32)
    expect(sep.priceMatchShortfall).toBe(21)
    const aug = normalizeAmazonVendorNppm({ Sheet1: augustSheet() }, 'import-1').facts!
    expect(aug.month).toBe('2026-08')
    expect(aug.marginClosedPct).toBe(0.32)
    expect(aug.netShippedGms).toBeCloseTo(2915.2406 + 1442.5793, 2)
  })

  it('checks the rows against the totals the file states', () => {
    const r = normalizeAmazonVendorNppm({ Working: septemberSheet() }, 'import-1')
    expect(r.checks.find((c) => c.name === 'Net Shipped GMS')?.passed).toBe(true)
    expect(r.checks.find((c) => c.name === 'Net PPM')?.passed).toBe(true)
    expect(r.checks.find((c) => c.name === 'Price-match shortfall')?.passed).toBe(true)
  })

  it('catches a total the rows do not come to', () => {
    const sheet = septemberSheet()
    sheet[1][15] = 9999
    const check = normalizeAmazonVendorNppm({ Working: sheet }, 'import-1')
      .checks.find((c) => c.name === 'Net Shipped GMS')!
    expect(check.passed).toBe(false)
    expect(check.detail).toContain('9999.00')
  })

  // The column heading says "Net Shipped GMS" too, and reading that as a
  // stated total would check the month against its own first data row.
  it('does not mistake the column heading for a stated total', () => {
    const sheet = septemberSheet().map((row) => row.slice(0, 14))
    const r = normalizeAmazonVendorNppm({ Working: sheet }, 'import-1')
    expect(r.checks.find((c) => c.name === 'Net Shipped GMS')).toBeUndefined()
    expect(r.facts?.netShippedGms).toBeCloseTo(GMS, 2)
  })

  // The claim is the margin gap applied to the month, and the file states
  // both halves, so one proves the other.
  it('rebuilds the contra-COGS claim from the margin shortfall', () => {
    const r = normalizeAmazonVendorNppm({ Working: septemberSheet() }, 'import-1')
    const check = r.checks.find((c) => c.name === 'Contra-COGS is the margin shortfall')!
    expect(check.passed).toBe(true)
    expect(r.facts?.ccogsClaimed).toBe(100)
    expect((0.32 - PPM / GMS) * GMS).toBeCloseTo(100, 2)
    expect(r.warnings.some((w) => w.includes('comes back as contra-COGS'))).toBe(true)
  })

  it('catches a claim that is not the shortfall', () => {
    const sheet = septemberSheet()
    sheet[5][15] = 250
    const check = normalizeAmazonVendorNppm({ Working: sheet }, 'import-1')
      .checks.find((c) => c.name === 'Contra-COGS is the margin shortfall')!
    expect(check.passed).toBe(false)
  })

  it('carries the negotiated settlement where the file records one', () => {
    const sheet = septemberSheet()
    sheet.push(['', '', '', '', '', '', '', '', '', '', '', '', '', '', 'deductions', 5046])
    sheet.push(['', '', '', '', '', '', '', '', '', '', '', '', '', '', 'Final amount', 50000])
    const f = normalizeAmazonVendorNppm({ Working: sheet }, 'import-1').facts!
    expect(f.ccogsClaimed).toBe(100)
    expect(f.ccogsDeductions).toBe(5046)
    expect(f.ccogsFinal).toBe(50000)
  })

  it('says the revenue is ex-GST, since that decides whether a tax line belongs', () => {
    const r = normalizeAmazonVendorNppm({ Working: septemberSheet() }, 'import-1')
    expect(r.warnings.some((w) => w.includes('Ex-GST'))).toBe(true)
  })

  it('asks for the cross-dock file, which is not in this one', () => {
    const r = normalizeAmazonVendorNppm({ Working: septemberSheet() }, 'import-1')
    expect(r.warnings.some((w) => w.includes('inward cross-dock'))).toBe(true)
  })

  it('imports nothing when no ship day can be read', () => {
    const sheet = septemberSheet().map((row, i) => (i === 0 ? row : row.map((c, j) => (j === 1 ? '' : c))))
    const r = normalizeAmazonVendorNppm({ Working: sheet }, 'import-1')
    expect(r.facts).toBeNull()
    expect(r.warnings[0]).toContain('no month to file it under')
  })

  it('warns when the ship days cross a month end', () => {
    const sheet = septemberSheet()
    sheet[4][1] = SEP_30 + 5
    const r = normalizeAmazonVendorNppm({ Working: sheet }, 'import-1')
    expect(r.month).toBe('2026-09')
    expect(r.warnings.some((w) => w.includes('crosses a month end'))).toBe(true)
  })

  // The totals live in rows whose ASIN cell is empty, so a blank ASIN marks
  // the block rather than a broken shipment, and those rows are not summed.
  it('does not count the totals block as shipments', () => {
    const r = normalizeAmazonVendorNppm({ Working: septemberSheet() }, 'import-1')
    expect(r.facts?.rows).toBe(4)
    expect(r.facts?.netShippedGms).toBeCloseTo(GMS, 2)
    expect(r.invalidRows).toHaveLength(0)
  })
})
