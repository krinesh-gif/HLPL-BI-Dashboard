import { describe, expect, it } from 'vitest'
import { adsRecordKey, checkForDuplicates, recordKey } from './duplicates'
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

describe('checkForDuplicates', () => {
  it('flags a re-uploaded file where every row is already imported', () => {
    const existing = [makeRecord(), makeRecord({ orderId: 'ORD-2' })]
    const result = checkForDuplicates(existing, existing)
    expect(result.duplicateCount).toBe(2)
    expect(result.newRecordCount).toBe(0)
    expect(result.isLikelyReupload).toBe(true)
  })

  it('reports only the genuinely new rows when a growing month file is re-uploaded', () => {
    const existing = [makeRecord(), makeRecord({ orderId: 'ORD-2' })]
    const incoming = [...existing, makeRecord({ orderId: 'ORD-3' }), makeRecord({ orderId: 'ORD-4' })]
    const result = checkForDuplicates(incoming, existing)
    expect(result.duplicateCount).toBe(2)
    expect(result.newRecordCount).toBe(2)
    expect(result.isLikelyReupload).toBe(false)
  })
})

describe('adsRecordKey', () => {
  it('treats missing sku consistently so two no-sku rows on the same day/campaign collide', () => {
    const a: Pick<AdsRecord, 'channel' | 'campaign' | 'date' | 'sku'> = { channel: 'amazon_us', campaign: 'C1', date: '2026-05-01', sku: undefined }
    const b: Pick<AdsRecord, 'channel' | 'campaign' | 'date' | 'sku'> = { channel: 'amazon_us', campaign: 'C1', date: '2026-05-01', sku: undefined }
    expect(adsRecordKey(a)).toBe(adsRecordKey(b))
  })

  it('differs by sku so two campaigns on the same day are not conflated', () => {
    const base = { channel: 'amazon_us' as const, campaign: 'C1', date: '2026-05-01' }
    expect(adsRecordKey({ ...base, sku: 'SKU-A' })).not.toBe(adsRecordKey({ ...base, sku: 'SKU-B' }))
  })
})
