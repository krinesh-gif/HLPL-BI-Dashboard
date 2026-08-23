import { api } from '@/lib/apiClient'
import { recordKey } from './dedupKeys'
import type { CanonicalSalesRecord } from '@/data/models'

// The key builders live in ./dedupKeys so the serverless functions can import
// them without pulling in the browser API client below. Re-exported here so
// client code has one obvious place to find them.
export { adsRecordKey, recordKey } from './dedupKeys'

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
