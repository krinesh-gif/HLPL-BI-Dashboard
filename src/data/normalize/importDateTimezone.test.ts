import { describe, expect, it } from 'vitest'
import { toIsoDate, toMonthKey } from '@/lib/format'
import { normalizeAmazonUsaProductProfitability } from './amazonUsaProductProfitability'
import type { SkuMaster } from '@/data/models'

/**
 * A report date is a calendar date. It carries no time and no zone, so putting
 * it through UTC moves it.
 *
 * This suite runs under Asia/Kolkata (see the file's vitest environment note
 * below) precisely because the sandbox these were written in runs UTC, where
 * the bug is invisible: `new Date('07/01/2026').toISOString()` is correct at
 * UTC+0 and a day early at UTC+5:30. Every check of the import pipeline passed
 * for months for that reason alone.
 */
const skuMaster: SkuMaster[] = [
  { sku: 'AO/Serum/VitC/030', productName: 'Vitamin C Serum', category: 'Skin Care', brand: 'AO', cogs: 120, mrp: 699,
    launchDate: '2025-04-01', status: 'active', leadTimeDays: 21, safetyStock: 0 },
]

const headers = [
  'Amazon store', 'Start date', 'End date', 'MSKU', 'Currency code',
  'Units sold', 'Units returned', 'Net units sold', 'Sales', 'Net sales', 'Referral fee total',
]

const row = {
  'Amazon store': 'US', 'Start date': '07/01/2026', 'End date': '07/31/2026',
  MSKU: 'AO/Serum/VitC/030', 'Currency code': 'USD',
  'Units sold': '10', 'Units returned': '1', 'Net units sold': '9',
  Sales: '143.97', 'Net sales': '129.57', 'Referral fee total': '19.44',
}

describe('an imported order date keeps the day the report says', () => {
  it('stores the first of the month as the first of the month', () => {
    // In India this used to store 2026-06-30: midnight on 1 July IST is
    // 18:30 on 30 June UTC, and the stored date was the UTC one.
    expect(toIsoDate(new Date('07/01/2026'))).toBe('2026-07-01')
  })

  it('puts the order rows in the same month as the facts they were read with', () => {
    // These two disagreeing is what left the P&L unable to find any July rows
    // to price July's COGS from, so it silently used the figure frozen at
    // import and showed no priced/estimated split at all.
    const result = normalizeAmazonUsaProductProfitability(headers, [row], skuMaster, 'tz-test')
    expect(result.month).toBe('2026-07')
    expect(result.validRecords).toHaveLength(1)
    expect(result.validRecords[0].orderDate).toBe('2026-07-01')
    expect(toMonthKey(result.validRecords[0].orderDate)).toBe(result.month)
  })

  it('holds for a date that would shift the other way too', () => {
    // 31 December is the mirror case: behind UTC it would run forward into
    // the next year.
    expect(toIsoDate(new Date('12/31/2026'))).toBe('2026-12-31')
    expect(toIsoDate(new Date('01/01/2027'))).toBe('2027-01-01')
  })

  it('reports an unparseable date as empty rather than as 1970', () => {
    expect(toIsoDate(new Date('not a date'))).toBe('')
  })
})
