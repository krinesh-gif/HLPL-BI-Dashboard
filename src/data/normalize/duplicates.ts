import { api } from '@/lib/apiClient'
import type { AdsRecord, CanonicalSalesRecord } from '@/data/models'

/** Channel + Order ID + SKU + Order Date uniquely identifies a sales line. */
export function recordKey(r: Pick<CanonicalSalesRecord, 'channel' | 'orderId' | 'sku' | 'orderDate'>): string {
  return `${r.channel}|${r.orderId}|${r.sku}|${r.orderDate}`
}

/** Channel + Campaign + Date + SKU uniquely identifies one ads report row
 * (a campaign report has one row per campaign/SKU per reporting day). */
export function adsRecordKey(r: Pick<AdsRecord, 'channel' | 'campaign' | 'date' | 'sku'>): string {
  return `${r.channel}|${r.campaign}|${r.date}|${r.sku ?? ''}`
}

export interface DuplicateCheckResult {
  duplicateCount: number
  newRecordCount: number
  isLikelyReupload: boolean
}

/**
 * Asks the server how many of these rows are already in the shared database,
 * so the upload preview can warn about a re-uploaded file. Only the dedup keys
 * are sent — there is no need to ship whole rows just to count overlaps.
 */
export async function checkForDuplicates(incoming: CanonicalSalesRecord[]): Promise<DuplicateCheckResult> {
  if (incoming.length === 0) return { duplicateCount: 0, newRecordCount: 0, isLikelyReupload: false }
  return api.post<DuplicateCheckResult>('/api/sales/check-duplicates', { keys: incoming.map(recordKey) })
}
