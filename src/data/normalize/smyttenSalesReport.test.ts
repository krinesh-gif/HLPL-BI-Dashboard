import { describe, expect, it } from 'vitest'
import type { SkuMaster } from '@/data/models'
import type { SkuMapping } from '@/data/skuMapping'
import {
  detectSmyttenSalesReport, normalizeSmyttenSalesReport, smyttenDate, smyttenIsTotalRow,
  SMYTTEN_CHARGE_SKU,
} from './smyttenSalesReport'

/** The real August sheet's headers, verbatim. */
const HEADERS = [
  'Vendor Name ', 'Brand', 'Date', 'Order ID', 'SKU Id', 'Item', 'No. of Units', 'Party Name',
  'Dispatch location', 'State', 'Product GST %', 'Invoice Value', 'Taxable Value', 'Actual Value',
  'Commission Value', 'GST on Comm', 'TCS(0.5%)', 'TDS (0.1%)', 'Net Value',
]

const skuMaster: SkuMaster[] = [
  { sku: 'AO/RollOn/UAR', productName: 'Underarm Roll On', category: 'Body Care', brand: 'AO', cogs: 72, mrp: 349,
    launchDate: '2025-01-01', status: 'active', leadTimeDays: 21, safetyStock: 0 },
]
const mappings: SkuMapping[] = [
  { channelSku: 'ARV0076AB3', internalSku: 'AO/RollOn/UAR', kind: 'SINGLE', source: 'manual', verified: true },
]

function row(over: Record<string, string | number>): Record<string, string> {
  return {
    'Vendor Name ': 'HIVEFY LIFESTYLE PRIVATE LIMITED', Brand: 'Aravi Organic',
    Date: 46236, 'Order ID': '5292813', 'SKU Id': 'ARV0076AB3',
    Item: 'Under Arm Roll On', 'No. of Units': 1, State: 'Madhya Pradesh',
    'Product GST %': 0.18, 'Invoice Value': 300.14, 'Taxable Value': 254.36, 'Actual Value': 349,
    'Commission Value': 78.04, 'GST on Comm': 14.0472, 'TCS(0.5%)': 1.2718, 'TDS (0.1%)': 0.25436,
    'Net Value': 206.52664,
    ...over,
  } as unknown as Record<string, string>
}

const run = (rows: Record<string, string>[], master = skuMaster, maps = mappings) =>
  normalizeSmyttenSalesReport(rows, master, maps, [], 'test')

describe('recognising the file', () => {
  it('knows Smytten\'s report', () => {
    expect(detectSmyttenSalesReport(HEADERS)).toBe(true)
  })

  it('does not claim a report that merely has an invoice value', () => {
    expect(detectSmyttenSalesReport(['Date', 'SKU', 'Invoice Value', 'Taxable Value'])).toBe(false)
  })
})

describe('the date, which arrives as an Excel serial', () => {
  it('reads 46236 as the day it is', () => {
    expect(smyttenDate('46236')).toBe('2026-08-02')
  })

  it('still reads a written date if the column is ever text', () => {
    expect(smyttenDate('2026-08-02')).toBe('2026-08-02')
    expect(smyttenDate('02/08/2026')).toBe('2026-08-02')
  })

  it('refuses a description rather than inventing a day for it', () => {
    expect(smyttenDate('Logistics;Order No.5333251')).toBeNull()
  })
})

describe('a sale', () => {
  const r = run([row({})])
  const rec = r.validRecords[0]

  it('reads the MRP as gross and the discount as the gap to what was paid', () => {
    expect(rec.grossSales).toBe(349)
    expect(rec.discount).toBeCloseTo(349 - 300.14, 2)
  })

  it('earns the taxable value, ex-GST', () => {
    expect(rec.netSales).toBeCloseTo(254.36, 2)
    expect(rec.tax).toBeCloseTo(300.14 - 254.36, 2)
    expect(rec.taxInGross).toBe(true)
  })

  it('charges the commission and the GST on it, and nothing else', () => {
    // TCS and TDS come back at filing, so charging them would understate the
    // channel by the one amount that is certain to return.
    expect(rec.marketplaceFee).toBeCloseTo(78.04 + 14.0472, 4)
  })

  it('resolves Smytten\'s own code to the product', () => {
    expect(rec.sku).toBe('ARV0076AB3')
    expect(rec.productName).toBe('Underarm Roll On')
  })

  it('reports the withheld tax instead of hiding it', () => {
    expect(r.tcsDeducted).toBeCloseTo(1.2718, 4)
    expect(r.tdsDeducted).toBeCloseTo(0.25436, 4)
    expect(r.warnings.join(' ')).toContain('TCS')
  })
})

describe('the Total row at the foot of the sheet', () => {
  it('is recognised by what it says, not by where it sits', () => {
    expect(smyttenIsTotalRow('Total', '', '')).toBe(true)
    expect(smyttenIsTotalRow('Aravi Organic', '46236', 'ARV0076AB3')).toBe(false)
  })

  it('is left out, so the month is not read at twice its size', () => {
    const r = run([
      row({}),
      row({ Brand: 'Total', Date: '', 'Order ID': '', 'SKU Id': '', Item: '', 'No. of Units': 1,
        'Invoice Value': 300.14, 'Taxable Value': 254.36, 'Actual Value': 349,
        'Commission Value': 78.04, 'GST on Comm': 14.0472, 'Net Value': 206.52664 }),
    ])
    expect(r.validRecords).toHaveLength(1)
    expect(r.validRecords[0].netSales).toBeCloseTo(254.36, 2)
    expect(r.warnings.join(' ')).toContain('Total')
  })

  it('does not count the Total row\'s commission as a charge', () => {
    const r = run([
      row({}),
      row({ Brand: 'Total', Date: '', 'Order ID': '', 'SKU Id': '', 'Commission Value': 78.04, 'GST on Comm': 14.0472 }),
    ])
    expect(r.charges).toHaveLength(0)
  })
})

describe('the reverse-logistics charge hidden in the Date column', () => {
  const description = 'Logistics;Order No.5333251;  DTO(11675189323970);Replacement 0 ; Wrong Product Received'
  const r = run([
    row({}),
    row({ Date: description, 'Order ID': '', 'SKU Id': '', Item: '', 'No. of Units': '',
      'Product GST %': '', 'Invoice Value': '', 'Taxable Value': '', 'Actual Value': '',
      'Commission Value': 125, 'GST on Comm': 22.5, 'TCS(0.5%)': 0, 'TDS (0.1%)': 0, 'Net Value': -147.5 }),
  ])

  it('is kept as a cost rather than dropped with the row it is written on', () => {
    const charge = r.validRecords.find((x) => x.sku === SMYTTEN_CHARGE_SKU)!
    expect(charge.marketplaceFee).toBe(147.5)
    expect(charge.netSales).toBe(0)
    expect(charge.quantity).toBe(0)
  })

  it('is dated to the month of the file it came in', () => {
    const charge = r.validRecords.find((x) => x.sku === SMYTTEN_CHARGE_SKU)!
    expect(charge.orderDate).toBe('2026-08-01')
  })

  it('says what it was and what it cost', () => {
    expect(r.charges).toEqual([{ description, amount: 147.5 }])
    expect(r.warnings.join(' ')).toContain('Wrong Product Received')
  })

  it('says which P&L line it went to, so a new kind of charge gets noticed', () => {
    const warning = r.warnings.find((w) => w.includes('Wrong Product Received'))!
    expect(warning).toContain('Return Charges')
    expect(warning).toContain('reverse leg of a replacement')
  })

  it('does not call a storage fee a return', () => {
    const storage = run([
      row({}),
      row({ Date: 'Storage fee for August', 'Order ID': '', 'SKU Id': '', Item: '', 'No. of Units': '',
        'Product GST %': '', 'Invoice Value': '', 'Taxable Value': '', 'Actual Value': '',
        'Commission Value': 50, 'GST on Comm': 0, 'TCS(0.5%)': 0, 'TDS (0.1%)': 0, 'Net Value': -50 }),
    ])
    const warning = storage.warnings.find((w) => w.includes('Storage fee'))!
    expect(warning).toContain('Other Marketplace Charges')
  })

  it('is dropped, not parked in an arbitrary month, when the file has no sale to date it by', () => {
    const alone = run([row({ Date: description, 'Order ID': '', 'SKU Id': '', Item: '',
      'Commission Value': 125, 'GST on Comm': 22.5, 'Net Value': -147.5 })])
    expect(alone.validRecords).toHaveLength(0)
  })
})

describe('a row of two units', () => {
  it('reads the values as the row\'s total, not per unit', () => {
    const r = run([row({ 'No. of Units': 2, 'Invoice Value': 476.56, 'Taxable Value': 403.86, 'Actual Value': 644 })])
    expect(r.validRecords[0].quantity).toBe(2)
    expect(r.validRecords[0].grossSales).toBe(644)
    expect(r.validRecords[0].netSales).toBeCloseTo(403.86, 2)
  })
})

describe('a Smytten code mapped to nothing', () => {
  const r = run([row({ 'SKU Id': 'ARV9999ZZ9', Item: 'Something New' })], skuMaster, [])

  it('counts the sale and names the code so it can be mapped', () => {
    expect(r.validRecords).toHaveLength(1)
    expect(r.unmappedCodes).toEqual([{ code: 'ARV9999ZZ9', item: 'Something New', units: 1 }])
    expect(r.warnings.join(' ')).toContain('SKU Mapping')
  })
})

describe('a row with no MRP', () => {
  it('reports no discount rather than a discount of its whole value', () => {
    const r = run([row({ 'Actual Value': '' })])
    expect(r.validRecords[0].grossSales).toBeCloseTo(300.14, 2)
    expect(r.validRecords[0].discount).toBe(0)
  })
})
