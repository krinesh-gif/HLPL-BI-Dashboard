import { sql } from './db.js'

/**
 * Meesho's monthly figures, summed from the individual events.
 *
 * They are not stored. Storing a month's totals meant that when the same event
 * arrived in two uploads — which Meesho's "previous aggregated payment"
 * downloads guarantee, since each carries earlier rows forward — the totals
 * were added and every shared month roughly doubled. Summing from rows keyed
 * on their own identity makes that impossible: an event uploaded five times is
 * still one row, and a month is the sum of its rows.
 */

/** Every figure a month carries. Must match CONTRIBUTION_FIELDS on the client;
 * a test asserts the two lists are identical. */
export const CONTRIBUTION_FIELDS = [
  'grossSalesInclGst', 'salesReturnsInclGst', 'outputGstOnSales',
  'cogsUnitsSold', 'cogsRtoWriteOff', 'cogsReturnWriteOff',
  'forwardShipping', 'returnShipping', 'otherMarketplaceFees',
  'adsSpendExGst', 'adCredits', 'affiliateFee',
  'compensation', 'claims', 'recovery', 'platformRecoverySubscriptions',
  'subOrdersDispatched', 'unitsDispatched', 'unitsDelivered', 'unitsRto', 'unitsReturned',
  'tcs', 'tds', 'gstOnMarketplaceFees', 'gstOnAds', 'netSettlementPerFile',
  'unclassifiedSettlement', 'unclassifiedRows',
] as const

type Facts = Record<string, unknown>

/** `sum((contribution->>'field')::float8)` for each field, aliased to it. */
const sumList = CONTRIBUTION_FIELDS
  .map((f) => `coalesce(sum((contribution->>'${f}')::float8), 0) AS "${f}"`)
  .join(',\n         ')

function blankFacts(month: string, basis: string): Facts {
  const facts: Facts = { schemaVersion: 3, month, basis }
  for (const field of CONTRIBUTION_FIELDS) facts[field] = 0
  return facts
}

/**
 * Both statements, for every month that has any activity.
 *
 * The order-date and payment-date statements are the same events cut on
 * different dates, so each is its own aggregation over the same rows. A row
 * with no payment date has not been settled and appears only on the order-date
 * side, which is correct rather than missing.
 */
export async function meeshoFactsFromEvents(): Promise<Facts[]> {
  const byKey = new Map<string, Facts>()

  const absorb = (rows: Facts[], basis: string): void => {
    for (const row of rows) {
      const month = String(row.month ?? '')
      if (!month) continue
      const key = `${basis}|${month}`
      const facts = byKey.get(key) ?? blankFacts(month, basis)
      for (const field of CONTRIBUTION_FIELDS) {
        facts[field] = (facts[field] as number) + Number(row[field] ?? 0)
      }
      byKey.set(key, facts)
    }
  }

  for (const [basis, dateColumn] of [['order', 'order_date'], ['settlement', 'payment_date']] as const) {
    const rows = (await sql.query(
      `SELECT left(${dateColumn}, 7) AS month,
              ${sumList}
         FROM meesho_transactions
        WHERE ${dateColumn} <> ''
        GROUP BY 1`,
    )) as Facts[]
    absorb(rows, basis)

    // Advertising and platform recovery are dated, not ordered, so the same
    // figure belongs to that month on both statements.
    const ads = (await sql.query(
      `SELECT left(deduction_date, 7) AS month,
              coalesce(sum(spend_ex_gst), 0) AS "adsSpendExGst",
              coalesce(sum(credits), 0)     AS "adCredits",
              coalesce(sum(gst), 0)         AS "gstOnAds"
         FROM meesho_ads WHERE deduction_date <> '' GROUP BY 1`,
    )) as Facts[]
    absorb(ads, basis)

    const recovery = (await sql.query(
      `SELECT left(entry_date, 7) AS month,
              coalesce(sum(amount), 0) AS "platformRecoverySubscriptions"
         FROM meesho_platform_recovery WHERE entry_date <> '' GROUP BY 1`,
    )) as Facts[]
    absorb(recovery, basis)
  }

  return [...byKey.values()].sort(
    (a, b) => String(a.month).localeCompare(String(b.month)) || String(a.basis).localeCompare(String(b.basis)),
  )
}
