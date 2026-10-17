import { describe, expect, it } from 'vitest'
import { detectAmazonVendorIxd, normalizeAmazonVendorIxd } from './amazonVendorIxd'
import type { RawSheet } from '@/lib/csvParse'

// 2026-08-08 and 2026-08-23 as Excel writes them.
const AUG_8 = 46242
const AUG_23 = 46257

const HEADER = [
  'Inbound date', 'asin', 'item_name', 'merchant_brand_name', 'Subcategory', 'Category', 'GL',
  'vendor_program', 'warehouse_id', 'distributor_id', 'order_id', 'hnb_asin_flag', 'hnb_fc_flag',
  'product_site_launch_day', 'first_receipt_date', 'value_unpacked', 'quantity_unpacked', 'Amount', 'Total',
]

function row(over: { date?: number; asin?: string; value?: number; qty?: number; rate?: number; total?: number } = {}): (string | number)[] {
  const { date = AUG_8, asin = 'B0GQSJ3FXR', value = 4453.32, qty = 34, rate = 2, total = qty * rate } = over
  return [date, asin, 'Aravi Organic Lip Balm', 'Aravi Organic', '4002 Face', '4000 Skin Care', 'Beauty',
    'MVR', 'ISK3', 'WBA7J', '4S3EGSHP', 'non_hnb_asin', 'Core-IXD', 46083, 46104, value, qty, rate, total]
}

const sheet: RawSheet = [
  HEADER,
  row(),
  row({ asin: 'B0GQSSXWSK', value: 20825.82, qty: 159 }),
  row({ date: AUG_23, asin: 'B0F888R525', value: 28555.32, qty: 249 }),
]
const UNITS = 34 + 159 + 249

describe('detectAmazonVendorIxd', () => {
  it('recognizes the cross-dock workbook', () => {
    expect(detectAmazonVendorIxd({ Sum_of_Value_unpacked: sheet })).toBe(true)
  })
  it('rejects the NPPM workbook, which has its own reader', () => {
    expect(detectAmazonVendorIxd({ Working: [['ASIN', 'Ship Day', 'Net Shipped GMS', 'Net PPM']] })).toBe(false)
  })
})

describe('normalizeAmazonVendorIxd', () => {
  it('charges the month the goods came in, from the inbound dates', () => {
    const r = normalizeAmazonVendorIxd({ s: sheet })
    expect(r.month).toBe('2026-08')
    expect(r.ixd?.periodStart).toBe('2026-08-08')
    expect(r.ixd?.periodEnd).toBe('2026-08-23')
  })

  it('totals the units unpacked, their value and the charge', () => {
    const ixd = normalizeAmazonVendorIxd({ s: sheet }).ixd!
    expect(ixd.unitsUnpacked).toBe(UNITS)
    expect(ixd.charge).toBe(UNITS * 2)
    expect(ixd.valueUnpacked).toBeCloseTo(4453.32 + 20825.82 + 28555.32, 2)
    expect(ixd.asins).toBe(3)
  })

  // The rate comes from the file. A ₹2 held in the code would go on being
  // charged after the rate changed, with nothing to say so.
  it('takes the rate from the file and checks the charge against it', () => {
    const ixd = normalizeAmazonVendorIxd({ s: sheet }).ixd!
    expect(ixd.ratePerUnit).toBe(2)
    const check = normalizeAmazonVendorIxd({ s: sheet }).checks.find((c) => c.name === 'Charge is the rate on every unit')!
    expect(check.passed).toBe(true)
  })

  it('catches a charge that is not the rate on every unit', () => {
    const wrong: RawSheet = [HEADER, row({ total: 999 })]
    const check = normalizeAmazonVendorIxd({ s: wrong }).checks.find((c) => c.name === 'Charge is the rate on every unit')!
    expect(check.passed).toBe(false)
    expect(check.detail).toContain('999')
  })

  it('stores no single rate when the file charges at more than one', () => {
    const mixed: RawSheet = [HEADER, row(), row({ asin: 'B0X', qty: 10, rate: 3 })]
    const r = normalizeAmazonVendorIxd({ s: mixed })
    expect(r.ixd?.ratePerUnit).toBe(0)
    expect(r.ixd?.charge).toBe(34 * 2 + 10 * 3)
    expect(r.warnings.some((w) => w.includes('more than one rate'))).toBe(true)
  })

  it('says the count is the inbound one, not the month’s sales', () => {
    const r = normalizeAmazonVendorIxd({ s: sheet })
    expect(r.warnings[0]).toContain('not the month’s units sold')
  })

  it('rejects a row whose inbound date cannot be read', () => {
    const bad: RawSheet = [HEADER, row(), row({ date: 0 as unknown as number })]
    const r = normalizeAmazonVendorIxd({ s: bad })
    expect(r.invalidRows).toHaveLength(1)
    expect(r.ixd?.unitsUnpacked).toBe(34)
  })

  it('imports nothing when the workbook is not the cross-dock file', () => {
    const r = normalizeAmazonVendorIxd({ s: [['Sub Order No']] })
    expect(r.ixd).toBeNull()
    expect(r.warnings[0]).toContain('quantity_unpacked')
  })

  it('warns when the inbound dates cross a month end', () => {
    const crossing: RawSheet = [HEADER, row({ date: AUG_23 }), row({ date: AUG_23 + 10 })]
    const r = normalizeAmazonVendorIxd({ s: crossing })
    expect(r.month).toBe('2026-08')
    expect(r.warnings.some((w) => w.includes('crosses a month end'))).toBe(true)
  })
})
