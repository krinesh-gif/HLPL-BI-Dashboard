import type { MeeshoPnlFacts, PnlBasis } from '@/data/models'

/**
 * What one row of a Meesho file adds to a month.
 *
 * A month's facts are the sum of the contributions of the events that fall in
 * it — nothing more. That is the whole reason this type exists: figures were
 * previously aggregated per uploaded file and the files' totals added
 * together, which silently doubled every month once it turned out that
 * Meesho's "previous aggregated payment" downloads repeat earlier rows. Sum
 * events, not files, and a row counted twice is impossible rather than merely
 * unlikely.
 */
export type MeeshoContribution = Omit<MeeshoPnlFacts, 'schemaVersion' | 'month' | 'basis'>

/** Every field a contribution carries. Named once, so the client's summing and
 * the database's aggregation cannot drift apart. */
export const CONTRIBUTION_FIELDS = [
  'grossSalesInclGst', 'salesReturnsInclGst', 'outputGstOnSales',
  'cogsUnitsSold', 'cogsRtoWriteOff', 'cogsReturnWriteOff',
  'forwardShipping', 'returnShipping', 'otherMarketplaceFees',
  'adsSpendExGst', 'adCredits', 'affiliateFee',
  'compensation', 'claims', 'recovery', 'platformRecoverySubscriptions',
  'subOrdersDispatched', 'unitsDispatched', 'unitsDelivered', 'unitsRto', 'unitsReturned',
  'tcs', 'tds', 'gstOnMarketplaceFees', 'gstOnAds', 'netSettlementPerFile',
  'unclassifiedSettlement', 'unclassifiedRows',
] as const satisfies readonly (keyof MeeshoContribution)[]

export function emptyContribution(): MeeshoContribution {
  const zeroed = {} as MeeshoContribution
  for (const field of CONTRIBUTION_FIELDS) zeroed[field] = 0
  return zeroed
}

export function addContribution(into: MeeshoContribution, from: Partial<MeeshoContribution>): void {
  for (const field of CONTRIBUTION_FIELDS) into[field] += from[field] ?? 0
}

/** One dated contribution: the row's own numbers, plus the two dates that
 * decide which month it lands in on each basis. */
export interface DatedContribution {
  /** yyyy-mm-dd, or '' when the row carries no such date. */
  orderDate: string
  paymentDate: string
  contribution: Partial<MeeshoContribution>
}

const monthOf = (date: string): string => date.slice(0, 7)

/**
 * Rolls dated contributions up into one set of facts per month and basis.
 *
 * A row with no payment date has not been settled yet, so it appears on the
 * order-date statement and not on the payment-date one — which is correct, not
 * a gap.
 */
export function factsFromContributions(rows: DatedContribution[]): MeeshoPnlFacts[] {
  const byKey = new Map<string, MeeshoPnlFacts>()

  const target = (basis: PnlBasis, month: string): MeeshoPnlFacts => {
    const key = `${basis}|${month}`
    let facts = byKey.get(key)
    if (!facts) {
      facts = { schemaVersion: 3, month, basis, ...emptyContribution() }
      byKey.set(key, facts)
    }
    return facts
  }

  for (const row of rows) {
    for (const [basis, date] of [['order', row.orderDate], ['settlement', row.paymentDate]] as const) {
      if (!date) continue
      addContribution(target(basis, monthOf(date)), row.contribution)
    }
  }

  return [...byKey.values()].sort((a, b) => a.month.localeCompare(b.month) || a.basis.localeCompare(b.basis))
}
