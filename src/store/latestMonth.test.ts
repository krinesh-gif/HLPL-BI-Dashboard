import { describe, expect, it } from 'vitest'
import { latestMonthWithData } from './dataStore'
import type { CanonicalSalesRecord, FlipkartPnlFacts } from '@/data/models'

/**
 * The dashboard used to open on the current calendar month. When the newest
 * upload covered an earlier period — a Flipkart P&L for June and July opened in
 * August, say — every page showed zeroes, which is indistinguishable from the
 * import having silently failed.
 */
function dataset(over: Partial<Parameters<typeof latestMonthWithData>[0]> = {}) {
  return {
    isEmpty: false,
    skuMaster: [],
    salesRecords: [],
    adsRecords: [],
    inventorySnapshots: [],
    fixedExpenses: [],
    imports: [],
    flipkartFacts: [],
    amazonUsaFacts: [],
    meeshoFacts: [],
    manualAdSpend: [],
    ...over,
  }
}

const sale = (orderDate: string) => ({ orderDate }) as CanonicalSalesRecord
const facts = (month: string) => ({ month }) as FlipkartPnlFacts

describe('latestMonthWithData', () => {
  it('returns null when nothing has been uploaded', () => {
    expect(latestMonthWithData(dataset())).toBeNull()
  })

  it('picks the newest month across order rows', () => {
    const d = dataset({ salesRecords: [sale('2026-06-04'), sale('2026-07-28'), sale('2026-06-30')] })
    expect(latestMonthWithData(d)).toBe('2026-07')
  })

  it('also considers channel P&L facts, which may run ahead of order rows', () => {
    const d = dataset({ salesRecords: [sale('2026-06-04')], flipkartFacts: [facts('2026-07')] })
    expect(latestMonthWithData(d)).toBe('2026-07')
  })

  it('handles two uploaded months by landing on the later one', () => {
    const d = dataset({ flipkartFacts: [facts('2026-06'), facts('2026-07')] })
    expect(latestMonthWithData(d)).toBe('2026-07')
  })
})
