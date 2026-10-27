/**
 * A row that is a charge, not a product.
 *
 * Some channels bill something inside the sales file that was never sold.
 * Smytten's monthly report carries a line with no SKU and the description
 * written into the date cell — `Logistics;Order No.5394741;
 * DTO(11675191307884);Replacement 11675191392061 ; Product Is Damaged` —
 * which is what it costs us when a customer returns a damaged unit and
 * Smytten ships a replacement. It is a real cost and has to reach the P&L,
 * so the reader files it as a row under a code of its own rather than
 * dropping it.
 *
 * That code is not a product, and everything that lists products has to know
 * it. Left unmarked it appears on the SKU Profitability screen as a product
 * losing exactly its own charge, in Top Products with no sales, on SKU
 * Mapping as a code waiting to be linked to something that does not exist,
 * and among the SKUs with no cost on file. It also counted as an order,
 * which moved Smytten's order count and its average order value.
 *
 * Marked here, once, because the alternative is six screens each deciding
 * for themselves what is a product.
 */

/** The code Smytten's reader files a charge under. */
export const SMYTTEN_CHARGE_SKU = 'SMYTTEN/CHARGE'

const CHARGE_SKUS: ReadonlySet<string> = new Set([SMYTTEN_CHARGE_SKU])

/** Whether this code stands for a charge rather than something we sell. */
export function isChargeSku(sku: string): boolean {
  return CHARGE_SKUS.has(sku.trim())
}

/**
 * Which cost a charge is, read from the channel's own description.
 *
 * `return` is the reverse leg: a replacement shipped because the unit arrived
 * damaged or wrong, and the freight on sending it. It belongs on the P&L's
 * return-charges line.
 *
 * Anything else is `other`, which is the honest answer rather than a guess —
 * a storage or penalty charge would read as a return under a looser test, and
 * the line it lands on says only that the marketplace charged it. The upload
 * names every charge, its amount and the line it went to either way, so a new
 * kind is noticed rather than silently absorbed.
 *
 * Not commission on either reading. A charge row sold nothing, so booking it
 * as commission reports a fee on revenue that does not exist.
 */
export function chargeKind(description: string): 'return' | 'other' {
  return /\b(replacement|return(ed|s)?|rto|dto|reverse)\b/i.test(description) ? 'return' : 'other'
}
