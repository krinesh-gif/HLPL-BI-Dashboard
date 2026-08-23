import { beforeEach, describe, expect, it } from 'vitest'
import { useDataStore } from './dataStore'
import type { AdsRecord, CanonicalSalesRecord, ImportRecord } from '@/data/models'

function makeSalesRecord(overrides: Partial<CanonicalSalesRecord> = {}): CanonicalSalesRecord {
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

function makeImportRecord(overrides: Partial<ImportRecord> = {}): ImportRecord {
  return {
    id: 'import-1',
    fileName: 'test.csv',
    channel: 'flipkart',
    reportType: 'Flipkart SKU-level P&L',
    uploadedAt: '2026-06-01T00:00:00.000Z',
    recordCount: 1,
    validRecordCount: 1,
    status: 'success',
    warnings: [],
    ...overrides,
  }
}

function makeAdsRecord(overrides: Partial<AdsRecord> = {}): AdsRecord {
  return {
    date: '2026-05-01',
    channel: 'amazon_us',
    campaign: 'NM_AUTO_TARGETING',
    impressions: 100,
    clicks: 5,
    spend: 50,
    adSales: 200,
    adOrders: 2,
    importId: 'import-1',
    ...overrides,
  }
}

describe('useDataStore import de-duplication', () => {
  beforeEach(() => {
    useDataStore.setState({
      isDemo: true,
      salesRecords: [],
      adsRecords: [],
      imports: [],
    })
  })

  it('replaces demo data on the first real sales import without de-dup filtering', () => {
    const record = makeSalesRecord()
    useDataStore.getState().addImportedSales([record], makeImportRecord())
    expect(useDataStore.getState().salesRecords).toEqual([record])
    expect(useDataStore.getState().isDemo).toBe(false)
  })

  it('re-uploading the same file does not double-count already-imported rows', () => {
    const record = makeSalesRecord()
    useDataStore.getState().addImportedSales([record], makeImportRecord())
    // Re-upload the identical row plus one genuinely new order.
    const newRecord = makeSalesRecord({ orderId: 'ORD-2' })
    useDataStore.getState().addImportedSales([record, newRecord], makeImportRecord({ id: 'import-2' }))

    const stored = useDataStore.getState().salesRecords
    expect(stored).toHaveLength(2)
    expect(stored.map((r) => r.orderId).sort()).toEqual(['ORD-1', 'ORD-2'])
  })

  it('adds only the new rows when a monthly file grows between uploads (24 -> 30 rows)', () => {
    const firstBatch = Array.from({ length: 24 }, (_, i) => makeSalesRecord({ orderId: `ORD-${i}` }))
    useDataStore.getState().addImportedSales(firstBatch, makeImportRecord())

    const secondBatch = Array.from({ length: 30 }, (_, i) => makeSalesRecord({ orderId: `ORD-${i}` }))
    useDataStore.getState().addImportedSales(secondBatch, makeImportRecord({ id: 'import-2' }))

    expect(useDataStore.getState().salesRecords).toHaveLength(30)
  })

  it('de-dupes ads rows by channel/campaign/date/sku the same way', () => {
    const adRow = makeAdsRecord()
    useDataStore.getState().addImportedAds([adRow])
    useDataStore.getState().addImportedAds([adRow, makeAdsRecord({ campaign: 'OTHER_CAMPAIGN' })])

    expect(useDataStore.getState().adsRecords).toHaveLength(2)
  })
})
