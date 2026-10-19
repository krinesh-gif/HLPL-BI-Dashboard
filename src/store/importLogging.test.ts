import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdsRecord, ImportRecord } from '@/data/models'

/**
 * Every upload is recorded in Upload history, including the ones made
 * entirely of advertising rows.
 *
 * Only `/api/sales/import` writes that row, and a report made of order rows
 * calls it once per batch, so it logs itself. Every other kind depended on
 * one call guarded by "this file produced no rows at all" — which is true of
 * a file that failed to read and false of an advertising report, the one kind
 * that has rows and no order rows. So the history listed the ads uploads that
 * imported nothing and omitted the ones that worked: the September cost
 * report went in, 6 rows and ₹19,97,954.76 across six months, and left no
 * trace of itself.
 */
const posts: { path: string; body: unknown }[] = []

vi.mock('@/lib/apiClient', () => ({
  api: {
    get: vi.fn(async () => ({})),
    post: vi.fn(async (path: string, body: unknown) => {
      posts.push({ path, body })
      return { inserted: 0, skippedAsDuplicate: 0 }
    }),
    patch: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  },
}))

const { useDataStore } = await import('./dataStore')

const importRecord: ImportRecord = {
  id: 'import-1', fileName: 'Amazon_Monthly_Ad_Spend_Report.csv', channel: 'amazon_in_seller',
  reportType: 'Amazon Ads — cost by month (every ad product)', uploadedAt: '2026-10-19T09:10:00.000Z',
  recordCount: 6, validRecordCount: 6, status: 'success', warnings: [],
}

const adsRecord = (month: string, spend: number): AdsRecord => ({
  date: `${month}-01`, channel: 'amazon_in_seller', campaign: 'amzn1.ads-account.g.6oc6',
  impressions: 0, clicks: 0, spend, adSales: 0, adOrders: 0, importId: 'import-1',
})

describe('an upload records itself', () => {
  beforeEach(() => { posts.length = 0 })

  const logged = () => posts.filter((p) => p.path === '/api/sales/import')

  it('logs an advertising report, which has rows but no order rows', async () => {
    await useDataStore.getState().importReport({
      importRecord, salesRecords: [], adsRecords: [adsRecord('2026-09', 212876.1)],
    })
    expect(logged()).toHaveLength(1)
    expect((logged()[0].body as { importRecord: ImportRecord }).importRecord.fileName)
      .toBe('Amazon_Monthly_Ad_Spend_Report.csv')
    expect(posts.some((p) => p.path === '/api/ads/import')).toBe(true)
  })

  it('still logs a file that produced nothing at all', async () => {
    await useDataStore.getState().importReport({ importRecord, salesRecords: [], adsRecords: [] })
    expect(logged()).toHaveLength(1)
  })

  // An order-row report logs itself on each batch, and the row is keyed on
  // the import id — logging it again first would be a wasted round trip on
  // the largest uploads there are.
  it('does not log an order-row report twice', async () => {
    await useDataStore.getState().importReport({
      importRecord,
      salesRecords: [{
        orderId: 'o1', orderDate: '2026-09-01', channel: 'flipkart', marketplace: 'flipkart',
        sellerType: 'marketplace',
        sku: 'S1', productName: 'P', category: 'C', quantity: 1, grossSales: 100, discount: 0,
        netSales: 100, returnUnits: 0, rtoUnits: 0, shippingCost: 0, marketplaceFee: 0, tax: 0,
        status: 'completed', currency: 'INR', importId: 'import-1',
      }],
      adsRecords: [],
    })
    expect(logged()).toHaveLength(1)
    expect((logged()[0].body as { records: unknown[] }).records).toHaveLength(1)
  })
})
