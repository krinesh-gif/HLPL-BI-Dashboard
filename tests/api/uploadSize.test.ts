import { describe, expect, it } from 'vitest'
import type { CanonicalSalesRecord } from '@/data/models'
import type { RawSheet } from '@/lib/csvParse'
import { normalizeMeeshoOrderPayments } from '@/data/normalize/meeshoOrderPayments'

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

/** The columns the Meesho payment file carries, which each event keeps a copy
 * of. The list is what makes an event large, so it is spelled out rather than
 * trimmed to the few the normalizer reads. */
const MEESHO_COLUMNS = [
  'Sub Order No', 'Order Date', 'Dispatch Date', 'Product Name', 'Supplier SKU', 'Catalog ID', 'Order source',
  'Live Order Status', 'Product GST %', 'Listing Price (Incl. taxes)', 'Quantity', 'Transaction ID', 'Payment Date',
  'Final Settlement Amount', 'Price Type', 'Total Sale Amount (Incl. Shipping & GST)',
  'Total Sale Return Amount (Incl. Shipping & GST)', 'Fixed Fee (Incl. GST)', 'Warehousing fee (Incl. GST)',
  'Return premium (incl GST)', 'Return premium (incl GST) of Return', 'Meesho Commission Percentage',
  'Meesho Commission (Incl. GST)', 'Meesho gold platform fee (Incl. GST)', 'Meesho mall platform fee (Incl. GST)',
  'Return Shipping Charge (Incl. GST)', 'GST Compensation (PRP Shipping)', 'Shipping Charge (Incl. GST)',
  'Other Support Service Charges (Excl. GST)', 'Waivers (Excl. GST)', 'Net Other Support Service Charges (Excl. GST)',
  'GST on Net Other Support Service Charges', 'TCS', 'TDS Rate %', 'TDS', 'Compensation', 'Claims', 'Recovery',
  'Compensation Reason', 'Claims Reason', 'Recovery Reason',
]

/** Real events, built by the real normalizer, so the measured size is the one
 * the upload would actually send rather than a guess at it. */
function meeshoEvents(count: number) {
  const cell = (column: string, i: number): string | number => {
    switch (column) {
      case 'Sub Order No': return `2745092056661805${String(i).padStart(4, '0')}_1`
      case 'Order Date': return '2026-04-12 02:05:04'
      case 'Dispatch Date': return '2026-04-13'
      case 'Product Name': return 'Aravi Organic Rosemary Essential Oil For Hair Growth 100 ml'
      case 'Supplier SKU': return 'D1/AO/EO/Rosemary/100'
      case 'Live Order Status': return 'Delivered'
      case 'Transaction ID': return `AXISCN13211833${String(i).padStart(4, '0')}`
      case 'Payment Date': return '2026-05-02'
      case 'Quantity': return 1
      case 'Product GST %': return 18
      case 'Total Sale Amount (Incl. Shipping & GST)': return 690
      case 'Final Settlement Amount': return 512.44
      default: return 0
    }
  }
  const sheet: RawSheet = [
    ['group'], MEESHO_COLUMNS, [''],
    ...Array.from({ length: count }, (_, i) => MEESHO_COLUMNS.map((c) => cell(c, i))),
  ]
  return normalizeMeeshoOrderPayments(sheet, undefined, [], 'April 26 .xlsx').transactions
}

function meeshoBodyMb(transactions: unknown[]): number {
  const body = JSON.stringify({ importId: 'import-1', transactions, adsRows: [], recoveryRows: [] })
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

  it('dropping `raw` is what keeps a real Meesho event small — except it is kept', () => {
    // These tests covered the order rows only, and Meesho's events went up as
    // one request for months. A Meesho event deliberately keeps its untouched
    // source row, because the Transaction Review screen reads it back, so it
    // is roughly ten times an order row and cannot be slimmed the same way.
    // One file's events serialised to about 10 MB, the platform refused the
    // request before it reached the function, and nothing was ever stored:
    // every Meesho month quietly fell back to the order rows instead.
    const events = meeshoEvents(3_500)
    expect(events.length).toBe(3_500)
    expect(meeshoBodyMb(events)).toBeGreaterThan(VERCEL_BODY_LIMIT_MB)

    for (const batch of batched(events, UPLOAD_BATCH_SIZE)) {
      expect(meeshoBodyMb(batch)).toBeLessThan(VERCEL_BODY_LIMIT_MB)
    }
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
