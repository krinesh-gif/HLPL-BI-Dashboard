import { describe, expect, it } from 'vitest'
import { detectAmazonSellerCentralReport, normalizeAmazonSellerCentralRows } from './amazonSellerCentral'
import { recordKey } from './duplicates'
import type { SkuMaster } from '@/data/models'

const skuMaster: SkuMaster[] = [
  { sku: 'HC-ROSE-015', productName: 'Rosemary Hair Oil 15ml', category: 'Hair Care', brand: 'HLPL', cogs: 85, mrp: 299, launchDate: '2025-01-01', status: 'active', leadTimeDays: 21, safetyStock: 300 },
]

describe('detectAmazonSellerCentralReport', () => {
  it('recognizes a valid header set', () => {
    expect(detectAmazonSellerCentralReport(['amazon-order-id', 'purchase-date', 'sku', 'quantity', 'item-price'])).toBe(true)
  })

  it('rejects an unrelated header set', () => {
    expect(detectAmazonSellerCentralReport(['campaign', 'spend', 'clicks'])).toBe(false)
  })
})

describe('normalizeAmazonSellerCentralRows', () => {
  it('normalizes a valid row into a canonical sales record', () => {
    const rows = [
      { 'amazon-order-id': '111-2223334', 'purchase-date': '2026-06-15', sku: 'HC-ROSE-015', 'product-name': 'Rosemary Hair Oil 15ml', quantity: '2', 'item-price': '249', 'item-promotion-discount': '20', 'shipping-price': '0', 'item-tax': '10', 'order-status': 'Shipped' },
    ]
    const result = normalizeAmazonSellerCentralRows(rows, skuMaster, 'import-1')
    expect(result.validRecords).toHaveLength(1)
    expect(result.invalidRows).toHaveLength(0)
    const record = result.validRecords[0]
    expect(record.grossSales).toBe(498)
    expect(record.discount).toBe(20)
    expect(record.netSales).toBe(478)
    expect(record.category).toBe('Hair Care')
    expect(record.status).toBe('completed')
  })

  it('flags rows missing required fields instead of silently dropping them', () => {
    const rows = [
      { 'amazon-order-id': '', 'purchase-date': '2026-06-15', sku: 'HC-ROSE-015', quantity: '1', 'item-price': '249' },
      { 'amazon-order-id': '111-999', 'purchase-date': 'not-a-date', sku: 'HC-ROSE-015', quantity: '1', 'item-price': '249' },
      { 'amazon-order-id': '111-998', 'purchase-date': '2026-06-15', sku: 'HC-ROSE-015', quantity: '0', 'item-price': '249' },
    ]
    const result = normalizeAmazonSellerCentralRows(rows, skuMaster, 'import-1')
    expect(result.validRecords).toHaveLength(0)
    expect(result.invalidRows).toHaveLength(3)
    expect(result.invalidRows[0].reason).toMatch(/order ID/)
    expect(result.invalidRows[1].reason).toMatch(/Invalid date/)
    expect(result.invalidRows[2].reason).toMatch(/Invalid quantity/)
  })

  it('warns (but does not reject) rows referencing a SKU not in the Product Master', () => {
    const rows = [
      { 'amazon-order-id': '111-000', 'purchase-date': '2026-06-15', sku: 'UNKNOWN-SKU', quantity: '1', 'item-price': '100' },
    ]
    const result = normalizeAmazonSellerCentralRows(rows, skuMaster, 'import-1')
    expect(result.validRecords).toHaveLength(1)
    expect(result.validRecords[0].category).toBe('Uncategorized')
    expect(result.warnings.some((w) => w.includes('not found in the Product Master'))).toBe(true)
  })
})

describe('dedup keys for normalized Amazon rows', () => {
  // De-duplication itself is enforced by the database's unique constraint on
  // dedup_key; what still needs testing here is that normalization produces
  // keys that actually distinguish one order line from another.
  it('gives two different orders distinct keys, and the same order a stable one', () => {
    const rows = [
      { 'amazon-order-id': '111-1', 'purchase-date': '2026-06-15', sku: 'HC-ROSE-015', quantity: '1', 'item-price': '249' },
      { 'amazon-order-id': '111-2', 'purchase-date': '2026-06-15', sku: 'HC-ROSE-015', quantity: '1', 'item-price': '249' },
    ]
    const first = normalizeAmazonSellerCentralRows(rows, skuMaster, 'import-1').validRecords
    const again = normalizeAmazonSellerCentralRows(rows, skuMaster, 'import-2').validRecords

    expect(new Set(first.map(recordKey)).size).toBe(2)
    // Re-parsing the same file must reproduce the same keys, or a re-upload
    // would slip past the database's conflict check and double-count.
    expect(again.map(recordKey)).toEqual(first.map(recordKey))
  })
})
