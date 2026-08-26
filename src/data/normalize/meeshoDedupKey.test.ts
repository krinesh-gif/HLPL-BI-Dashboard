import { describe, expect, it } from 'vitest'
import { recordKey } from './dedupKeys'
import { normalizeMeeshoOrderPayments } from './meeshoOrderPayments'
import type { RawSheet } from '@/lib/csvParse'
import type { SkuMaster } from '@/data/models'

/**
 * Meesho files a sale and its later return under the same sub-order, the same
 * SKU and the same order date. The de-dup key had none of that told apart, so
 * the two rows produced one key and the import's ON CONFLICT DO NOTHING kept
 * whichever arrived first and threw the other away.
 *
 * That mattered more than it looks: when a month has no stored events the P&L
 * falls back to these order rows, so the figures on screen were built from a
 * lossy, arbitrary half of the file — and which half depended on the order the
 * files happened to be uploaded in.
 */

const skuMaster: SkuMaster[] = [
  { sku: 'AO/LBalm/Tinted(BT)', productName: 'Tinted Lip Balm', category: 'Lip Care', brand: 'Aravi Organic',
    cogs: 21, mrp: 279, launchDate: '2025-01-01', status: 'active', leadTimeDays: 18, safetyStock: 120 },
]

function header(): (string | number)[] {
  const h: (string | number)[] = new Array(43).fill('')
  h[0] = 'Sub Order No'; h[1] = 'Order Date'; h[3] = 'Product Name'; h[4] = 'Supplier SKU'
  h[7] = 'Live Order Status'; h[8] = 'Product GST %'; h[10] = 'Quantity'
  h[11] = 'Transaction ID'; h[12] = 'Payment Date'; h[13] = 'Final Settlement Amount'
  h[15] = 'Total Sale Amount (Incl. Shipping & GST)'
  h[16] = 'Total Sale Return Amount (Incl. Shipping & GST)'
  h[29] = 'Shipping Charge (Incl. GST)'
  return h
}

function row(over: Partial<Record<number, string | number>>): (string | number)[] {
  const r: (string | number)[] = new Array(43).fill(0)
  r[0] = 'SUB1'; r[1] = '2026-03-11 02:05:04'; r[3] = 'Tinted Lip Balm'; r[4] = 'AO/LBalm/Tinted(BT)'
  r[7] = 'Delivered'; r[8] = 18; r[10] = 1; r[11] = 'AXIS1'; r[12] = '2026-04-02'
  r[13] = 150; r[15] = 160; r[16] = 0
  Object.entries(over).forEach(([k, v]) => { r[Number(k)] = v! })
  return r
}

describe('a sale and its return under one sub-order', () => {
  const sale = row({ 11: 'AXIS1', 7: 'Delivered', 15: 160, 16: 0, 12: '2026-04-02' })
  const ret = row({ 11: 'AXIS2', 7: 'Return', 15: 0, 16: -160, 13: -251, 12: '2026-05-06' })
  const sheet: RawSheet = [['group'], header(), [''], sale, ret]
  const result = normalizeMeeshoOrderPayments(sheet, undefined, skuMaster, 'i')

  it('produces two order rows, not one', () => {
    expect(result.validRecords).toHaveLength(2)
  })

  it('gives them different de-dup keys, so neither is discarded on import', () => {
    const [a, b] = result.validRecords.map(recordKey)
    expect(a).not.toBe(b)
  })

  it('carries the payment batch as the line id', () => {
    expect(result.validRecords.map((r) => r.lineId).sort()).toEqual(['AXIS1', 'AXIS2'])
  })

  it('keeps the whole file’s sale value in the order rows', () => {
    // The fallback P&L sums these, so losing one row loses real revenue.
    expect(result.validRecords.reduce((n, r) => n + r.grossSales, 0)).toBe(160)
    expect(result.validRecords.reduce((n, r) => n + r.returnUnits, 0)).toBe(1)
  })
})

describe('the de-dup key itself', () => {
  const base = { channel: 'meesho' as const, orderId: 'SUB1', sku: 'A', orderDate: '2026-03-11' }

  it('separates two lines of one order', () => {
    expect(recordKey({ ...base, lineId: 'AXIS1' })).not.toBe(recordKey({ ...base, lineId: 'AXIS2' }))
  })

  it('still matches a genuine re-upload of the same line', () => {
    expect(recordKey({ ...base, lineId: 'AXIS1' })).toBe(recordKey({ ...base, lineId: 'AXIS1' }))
  })

  it('is unchanged for a channel with no line id', () => {
    expect(recordKey({ ...base, channel: 'flipkart' })).toBe('flipkart|SUB1|A|2026-03-11|')
  })
})
