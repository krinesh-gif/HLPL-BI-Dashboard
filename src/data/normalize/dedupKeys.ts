/**
 * The keys that identify an already-imported row.
 *
 * Deliberately free of runtime imports — only erased type imports, via
 * relative paths — because the serverless functions import this to build the
 * same keys the database's unique constraints use. Anything with a real
 * import here (the browser API client, say) would either fail to resolve in a
 * function bundle or drag client-side code onto the server.
 */
import type { AdsRecord, CanonicalSalesRecord } from '../models'

/**
 * What identifies a sales line, and deliberately nothing more.
 *
 * Where the marketplace gives the line its own id, that id plus the order and
 * its date *is* the identity, and the SKU is left out. The SKU is an attribute
 * of the line, not part of what makes it that line, and a marketplace can
 * restate it: Meesho's payment file reports the seller's own Supplier SKU, so
 * renaming a supplier SKU in the Meesho catalogue rewrote it on every
 * historical order. With the SKU in the key those restated rows no longer
 * matched the rows already stored, and one re-upload booked March to June a
 * second time — 2,001 lines and ₹4.77 lakh of sales that never happened.
 * Identity has to be built only from things the marketplace cannot restate.
 *
 * Without a line id there is nothing else to separate two lines of one order,
 * so the SKU stays in the key and does that job. Only Meesho sets a line id
 * today (the payment batch that settled the event, which is what makes a sale
 * row and its return row two rows rather than one); every other channel keeps
 * the older shape, trailing separator included, so their stored keys still
 * match.
 */
export function recordKey(r: Pick<CanonicalSalesRecord, 'channel' | 'orderId' | 'sku' | 'orderDate' | 'lineId'>): string {
  return r.lineId
    ? `${r.channel}|${r.orderId}|${r.orderDate}|${r.lineId}`
    : `${r.channel}|${r.orderId}|${r.sku}|${r.orderDate}|`
}

/**
 * What identifies one row of a campaign report.
 *
 * Every column that separates one line of a report from another, because a
 * key that leaves one out does not de-duplicate those rows — it throws them
 * away. The key was channel, campaign, date and SKU, which holds for a report
 * with one row per campaign per day, and Blinkit's is not one: it reports a
 * row per *targeting value*, carries no SKU, and advertises one campaign
 * against several keywords a day. April's thirteen rows collapsed onto nine
 * keys, `ON CONFLICT DO NOTHING` dropped the other four, and the month's
 * advertising read ₹11.20 against the ₹16.80 the file states.
 *
 * Adding a field changes every key, so the rows already stored would stop
 * matching the file they came from and a re-upload would book the month
 * twice. `SCHEMA_SQL` recomputes the stored keys from the row's own columns
 * with the same formula; the two have to be changed together.
 */
export function adsRecordKey(
  r: Pick<AdsRecord, 'channel' | 'campaign' | 'date' | 'sku' | 'adGroup' | 'keyword' | 'searchTerm'>,
): string {
  return [
    r.channel, r.campaign, r.date,
    r.sku ?? '', r.adGroup ?? '', r.keyword ?? '', r.searchTerm ?? '',
  ].join('|')
}
