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
 * Channel + Order ID + SKU + Order Date identifies a sales line, plus the
 * line's own id where the marketplace reports several lines against one order.
 *
 * Meesho files a sale and its later return under the same sub-order, the same
 * SKU and the same order date. Without the line id those two rows produced the
 * same key, and the insert's ON CONFLICT DO NOTHING kept whichever arrived
 * first and dropped the other — so a month's order rows were a lossy, arbitrary
 * subset of the file, and which half survived depended on upload order.
 */
export function recordKey(r: Pick<CanonicalSalesRecord, 'channel' | 'orderId' | 'sku' | 'orderDate' | 'lineId'>): string {
  return `${r.channel}|${r.orderId}|${r.sku}|${r.orderDate}|${r.lineId ?? ''}`
}

/** Channel + Campaign + Date + SKU uniquely identifies one ads report row
 * (a campaign report has one row per campaign/SKU per reporting day). */
export function adsRecordKey(r: Pick<AdsRecord, 'channel' | 'campaign' | 'date' | 'sku'>): string {
  return `${r.channel}|${r.campaign}|${r.date}|${r.sku ?? ''}`
}
