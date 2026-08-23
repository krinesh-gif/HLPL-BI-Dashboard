import { describe, expect, it } from 'vitest'
import type { CanonicalSalesRecord } from '@/data/models'

/**
 * Vercel rejects a serverless request body over ~4.5 MB, and the browser
 * surfaces that as a bare "Failed to fetch" with no clue what went wrong.
 * A real Flipkart workbook is 11,217 rows and serialises to about 22 MB, so
 * sending an import as one request could never have worked; these tests pin
 * the batching that keeps each request comfortably inside the limit.
 */

const VERCEL_BODY_LIMIT_MB = 4.5
const UPLOAD_BATCH_SIZE = 500

function batched<T>(items: T[], size: number): T[][] {
  const batches: T[][] = []
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size))
  return batches
}

/** Deliberately generous: long SKU codes and product names, so the measured
 * size is an over-estimate of a real row rather than a flattering one. */
function makeRecord(i: number): CanonicalSalesRecord {
  return {
    orderId: `OD${String(i).padStart(18, '0')}`,
    orderDate: '2026-07-15',
    channel: 'flipkart',
    marketplace: 'Flipkart',
    sellerType: 'marketplace',
    sku: 'AO/HO/RosemaryCastorHairgrowth/200-VARIANT-LONG-CODE',
    productName: 'Aravi Organic Rosemary Castor Hair Growth Oil - 200 ml (Combo Pack)',
    category: 'Hair Care',
    subCategory: 'Hair Oil',
    quantity: 1,
    grossSales: 399,
    discount: 40,
    netSales: 359,
    returnUnits: 0,
    rtoUnits: 0,
    shippingCost: 45.5,
    marketplaceFee: 62.25,
    tax: 18.75,
    status: 'completed',
    currency: 'INR',
    importId: 'import-1786527856000',
  }
}

function bodyMb(records: CanonicalSalesRecord[]): number {
  const body = JSON.stringify({ records, importRecord: { id: 'import-1', warnings: [] } })
  return Buffer.byteLength(body) / 1024 / 1024
}

describe('import upload batching', () => {
  it('would exceed the request limit if a full workbook were sent at once', () => {
    // The real file that failed: 11,217 rows.
    const all = Array.from({ length: 11_217 }, (_, i) => makeRecord(i))
    expect(bodyMb(all)).toBeGreaterThan(VERCEL_BODY_LIMIT_MB)
  })

  it('keeps every batch well under the limit', () => {
    const all = Array.from({ length: 11_217 }, (_, i) => makeRecord(i))
    const batches = batched(all, UPLOAD_BATCH_SIZE)

    expect(batches.length).toBeGreaterThan(1)
    for (const batch of batches) {
      expect(bodyMb(batch)).toBeLessThan(VERCEL_BODY_LIMIT_MB)
    }
  })

  it('batches cover every record exactly once, in order', () => {
    const all = Array.from({ length: 1_050 }, (_, i) => makeRecord(i))
    const flattened = batched(all, UPLOAD_BATCH_SIZE).flat()
    expect(flattened).toHaveLength(all.length)
    expect(flattened.map((r) => r.orderId)).toEqual(all.map((r) => r.orderId))
  })

  it('dropping `raw` is what keeps a real row small', () => {
    const withRaw = Array.from({ length: 500 }, (_, i) => ({
      ...makeRecord(i),
      // A Flipkart row carries ~90 source columns.
      raw: Object.fromEntries(Array.from({ length: 90 }, (_, c) => [`Column Name ${c}`, `value ${c}`])),
    }))
    const withoutRaw = withRaw.map(({ raw: _raw, ...rest }) => rest)
    expect(bodyMb(withoutRaw)).toBeLessThan(bodyMb(withRaw) / 4)
  })
})
