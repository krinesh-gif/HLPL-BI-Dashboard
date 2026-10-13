import { describe, expect, it } from 'vitest'
import { adsRecordKey, recordKey } from './duplicates'
import type { AdsRecord, CanonicalSalesRecord } from '@/data/models'

function makeRecord(overrides: Partial<CanonicalSalesRecord> = {}): CanonicalSalesRecord {
  return {
    orderId: 'ORD-1',
    orderDate: '2026-06-01',
    channel: 'flipkart',
    marketplace: 'Flipkart',
    sellerType: 'marketplace',
    sku: 'AO/EO/Lavender/15',
    productName: 'Lavender Oil',
    category: 'Essential Oils',
    quantity: 1,
    grossSales: 300,
    discount: 0,
    netSales: 280,
    returnUnits: 0,
    rtoUnits: 0,
    shippingCost: 0,
    marketplaceFee: 20,
    tax: 0,
    status: 'completed',
    currency: 'INR',
    importId: 'import-1',
    ...overrides,
  }
}

describe('recordKey', () => {
  it('is stable for identical rows and differs when any identifying field changes', () => {
    const a = makeRecord()
    const b = makeRecord()
    expect(recordKey(a)).toBe(recordKey(b))
    expect(recordKey(a)).not.toBe(recordKey(makeRecord({ orderId: 'ORD-2' })))
    expect(recordKey(a)).not.toBe(recordKey(makeRecord({ orderDate: '2026-06-02' })))
  })
})

describe('recordKey uniqueness across a batch', () => {
  // The database enforces de-duplication via a unique constraint on these
  // keys, so what matters on the client is that distinct order lines never
  // collide (which would silently drop a real row on import).
  it('produces one distinct key per distinct order line', () => {
    const batch = [
      makeRecord({ orderId: 'ORD-1' }),
      makeRecord({ orderId: 'ORD-2' }),
      makeRecord({ orderId: 'ORD-1', sku: 'AO/EO/Rosemary/15' }),
      makeRecord({ orderId: 'ORD-1', orderDate: '2026-06-02' }),
    ]
    expect(new Set(batch.map(recordKey)).size).toBe(4)
  })
})

type AdsKeyFields = Pick<AdsRecord, 'channel' | 'campaign' | 'date' | 'sku' | 'adGroup' | 'keyword' | 'searchTerm'>

describe('adsRecordKey', () => {
  it('gives the same row the same key, so re-uploading a file adds nothing', () => {
    const a: AdsKeyFields = { channel: 'amazon_us', campaign: 'C1', date: '2026-05-01', sku: undefined }
    const b: AdsKeyFields = { channel: 'amazon_us', campaign: 'C1', date: '2026-05-01', sku: undefined }
    expect(adsRecordKey(a)).toBe(adsRecordKey(b))
  })

  it('differs by sku so two campaigns on the same day are not conflated', () => {
    const base = { channel: 'amazon_us' as const, campaign: 'C1', date: '2026-05-01' }
    expect(adsRecordKey({ ...base, sku: 'SKU-A' })).not.toBe(adsRecordKey({ ...base, sku: 'SKU-B' }))
  })

  it('differs by keyword, because a report can bill one campaign several times a day', () => {
    // Blinkit's does: a row per targeting value, with no SKU to tell them
    // apart. Without the keyword these were one key, and three of the four
    // rows were dropped on import as duplicates of the first.
    const base = { channel: 'blinkit' as const, campaign: 'Tinted Lipbalm -KT', date: '2026-04-11' }
    const keys = ['lipbalm', 'wishcare lip balm', 'lip balm'].map((keyword) => adsRecordKey({ ...base, keyword }))
    expect(new Set(keys).size).toBe(3)
  })

  it('differs by ad group and by search term', () => {
    const base = { channel: 'amazon_us' as const, campaign: 'C1', date: '2026-05-01', keyword: 'k' }
    expect(adsRecordKey({ ...base, adGroup: 'A' })).not.toBe(adsRecordKey({ ...base, adGroup: 'B' }))
    expect(adsRecordKey({ ...base, searchTerm: 'A' })).not.toBe(adsRecordKey({ ...base, searchTerm: 'B' }))
  })

  it('reads a missing field and an empty one as the same thing', () => {
    // The stored keys are rebuilt in SQL with coalesce(col, ''), so a NULL
    // column has to produce the key an absent field produces or the row the
    // file carries stops matching the row the database holds.
    const base = { channel: 'blinkit' as const, campaign: 'C1', date: '2026-04-05' }
    expect(adsRecordKey({ ...base, keyword: undefined })).toBe(adsRecordKey({ ...base, keyword: '' }))
  })
})
