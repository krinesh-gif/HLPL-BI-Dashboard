import type { CanonicalSalesRecord } from '@/data/models'

/** Channel + Order ID + SKU + Order Date uniquely identifies a sales line. */
export function recordKey(r: Pick<CanonicalSalesRecord, 'channel' | 'orderId' | 'sku' | 'orderDate'>): string {
  return `${r.channel}|${r.orderId}|${r.sku}|${r.orderDate}`
}

export interface DuplicateCheckResult {
  duplicateCount: number
  newRecordCount: number
  isLikelyReupload: boolean
}

/** Compares incoming records against everything already imported to catch a re-uploaded file. */
export function checkForDuplicates(
  incoming: CanonicalSalesRecord[],
  existing: CanonicalSalesRecord[],
): DuplicateCheckResult {
  const existingKeys = new Set(existing.map(recordKey))
  const duplicateCount = incoming.filter((r) => existingKeys.has(recordKey(r))).length
  return {
    duplicateCount,
    newRecordCount: incoming.length - duplicateCount,
    isLikelyReupload: incoming.length > 0 && duplicateCount / incoming.length >= 0.9,
  }
}
