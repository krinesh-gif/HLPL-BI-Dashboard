import type { MeeshoPnlFacts } from '@/data/models'

/**
 * Combines the facts several payment files contribute to the same month.
 *
 * A Meesho aggregated payment file is cut on payment date, not order date, so
 * every file spans two order months — the April file carries 1,599 March rows
 * and 1,907 April rows. Consecutive files therefore always share a month, and
 * each one holds only the part of that month it happened to settle.
 *
 * Storing a month's facts as one row meant the later upload replaced the
 * earlier one, and a complete April became whatever slice of April the May
 * file happened to contain. That is why a month looked right after its own
 * file was uploaded and wrong again after the next.
 *
 * Files do not overlap at the row level: a payment file covers a distinct
 * payment window, and a sub-order's payment event appears in exactly one of
 * them. So the contributions add up rather than conflicting, and re-uploading
 * a file replaces only its own contribution.
 */

/** Every numeric field of the facts. Listed rather than discovered at runtime
 * so that adding a field is a deliberate decision about whether it sums. */
const SUMMED_FIELDS = [
  'grossSalesInclGst', 'salesReturnsInclGst', 'outputGstOnSales',
  'cogsUnitsSold', 'cogsRtoWriteOff', 'cogsReturnWriteOff',
  'forwardShipping', 'returnShipping', 'otherMarketplaceFees',
  'adsSpendExGst', 'adCredits', 'affiliateFee',
  'compensation', 'claims', 'recovery', 'platformRecoverySubscriptions',
  'subOrdersDispatched', 'unitsDispatched', 'unitsDelivered', 'unitsRto', 'unitsReturned',
  'tcs', 'tds', 'gstOnMarketplaceFees', 'gstOnAds', 'netSettlementPerFile',
  'unclassifiedSettlement', 'unclassifiedRows',
] as const satisfies readonly (keyof MeeshoPnlFacts)[]

export function mergeMeeshoFacts(rows: MeeshoPnlFacts[]): MeeshoPnlFacts[] {
  const byKey = new Map<string, MeeshoPnlFacts>()

  for (const row of rows) {
    // A row stored under an older shape is not comparable with a current one;
    // adding them would produce a figure that is neither. It is dropped here
    // and the month reads as needing a re-upload, which it does.
    if (row.schemaVersion !== 3) continue

    const key = `${row.basis}|${row.month}`
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, { ...row })
      continue
    }
    for (const field of SUMMED_FIELDS) existing[field] += row[field]
  }

  return [...byKey.values()].sort((a, b) => a.month.localeCompare(b.month) || a.basis.localeCompare(b.basis))
}
