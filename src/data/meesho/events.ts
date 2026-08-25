/**
 * What a row of the Meesho Payment-to-Order report actually is.
 *
 * The report is a ledger of financial events, not a list of orders. One
 * sub-order legitimately appears on several rows — the sale on one, the
 * return on another, an affiliate fee on a third — and each row is a
 * different event against the same order. Reading every row as a sale is
 * what made the app report 145 phantom orders in a single file.
 */
export type MeeshoEventType =
  | 'sale'
  | 'return'
  | 'rto'
  | 'cancellation'
  | 'exchange'
  | 'affiliate_fee'
  | 'recovery'
  | 'compensation'
  | 'claim'
  | 'settlement_adjustment'
  | 'unclassified'

/** How much the classifier trusts what it decided. Anything below `certain`
 * is visible to Finance rather than silently folded into the P&L. */
export type EventConfidence = 'certain' | 'probable' | 'needs_review'

export interface EventClassification {
  eventType: MeeshoEventType
  confidence: EventConfidence
  /** Why the classifier landed here, in words a person can check against the
   * source row. Shown in the exception queue and the Finance audit view. */
  reason: string
  /** Whether this event contributes units and a shipment to volume metrics.
   * Only a real dispatch does — an affiliate fee against an order that was
   * already counted must not be counted again. */
  countsAsDispatch: boolean
  /** Whether this event recognises revenue in the P&L. */
  recognisesRevenue: boolean
}

export interface RowFacts {
  orderStatus: string
  saleAmount: number
  returnAmount: number
  settlementAmount: number
  recovery: number
  compensation: number
  claims: number
  recoveryReason: string
  compensationReason: string
  claimsReason: string
}

const has = (n: number): boolean => Math.abs(n) > 0.005

/**
 * Reason text Meesho writes against a recovery. Matched loosely because the
 * strings are free text from the marketplace: the real file carries both
 * "Affiliate Fee" and "Commission Fee on the NMV generated from the short
 * videos shown on the app", and neither is a stable identifier.
 */
const AFFILIATE_REASON = /affiliate|referral|short video|nmv/i

/**
 * Classifies one row.
 *
 * The governing rule is the spec's: unclassified and visible beats wrongly
 * classified and hidden. Where the row does not say clearly what it is, this
 * returns `unclassified` with `needs_review` rather than picking the most
 * likely bucket.
 */
export function classifyRow(row: RowFacts): EventClassification {
  const status = row.orderStatus.trim().toLowerCase()
  const money = has(row.saleAmount) || has(row.returnAmount) || has(row.settlementAmount)

  // A blank status is never a sale. In the real file every blank-status row
  // is a zero-sale affiliate charge; treating them as delivered orders added
  // phantom units, phantom COGS and phantom packaging cost.
  if (!status) {
    if (has(row.recovery)) {
      if (AFFILIATE_REASON.test(row.recoveryReason)) {
        return {
          eventType: 'affiliate_fee', confidence: 'certain',
          reason: `Blank status with a recovery amount and reason "${row.recoveryReason}".`,
          countsAsDispatch: false, recognisesRevenue: false,
        }
      }
      return {
        eventType: 'recovery',
        confidence: row.recoveryReason ? 'probable' : 'needs_review',
        reason: row.recoveryReason
          ? `Blank status with a recovery amount, reason "${row.recoveryReason}".`
          : 'Blank status with a recovery amount and no reason given.',
        countsAsDispatch: false, recognisesRevenue: false,
      }
    }
    if (has(row.compensation)) {
      return {
        eventType: 'compensation', confidence: row.compensationReason ? 'probable' : 'needs_review',
        reason: `Blank status with a compensation amount${row.compensationReason ? `, reason "${row.compensationReason}"` : ' and no reason given'}.`,
        countsAsDispatch: false, recognisesRevenue: false,
      }
    }
    if (has(row.claims)) {
      return {
        eventType: 'claim', confidence: row.claimsReason ? 'probable' : 'needs_review',
        reason: `Blank status with a claim amount${row.claimsReason ? `, reason "${row.claimsReason}"` : ' and no reason given'}.`,
        countsAsDispatch: false, recognisesRevenue: false,
      }
    }
    if (money) {
      // Money moved and nothing says why. This is the case the spec singles
      // out: a +₹200 settlement against a zero sale is not revenue.
      return {
        eventType: 'settlement_adjustment', confidence: 'needs_review',
        reason: 'Blank status with a settlement amount but no sale, recovery, compensation or claim to explain it.',
        countsAsDispatch: false, recognisesRevenue: false,
      }
    }
    return {
      eventType: 'unclassified', confidence: 'needs_review',
      reason: 'Blank status and no financial amount on the row.',
      countsAsDispatch: false, recognisesRevenue: false,
    }
  }

  if (status.includes('cancel')) {
    return {
      eventType: 'cancellation', confidence: 'certain',
      reason: 'Order status is Cancelled.',
      countsAsDispatch: false, recognisesRevenue: false,
    }
  }

  if (status.includes('rto')) {
    return {
      eventType: 'rto', confidence: 'certain',
      reason: 'Order status is RTO — dispatched, refused or undelivered, returned to origin.',
      countsAsDispatch: true, recognisesRevenue: false,
    }
  }

  if (status.includes('return')) {
    // The return arrives as its own row carrying the negative sale amount; the
    // original dispatch was already counted on the sale row.
    return {
      eventType: 'return', confidence: 'certain',
      reason: 'Order status is Return — a reversal of a sale counted on its own row.',
      countsAsDispatch: false, recognisesRevenue: false,
    }
  }

  if (status.includes('exchange')) {
    // Counted as a dispatch (a parcel did move) but not as new revenue, so the
    // replacement cannot be billed twice against one customer payment.
    return {
      eventType: 'exchange', confidence: 'probable',
      reason: 'Order status is Exchange — a replacement shipment, not a second sale.',
      countsAsDispatch: true, recognisesRevenue: false,
    }
  }

  if (status.includes('deliver') || status.includes('ship')) {
    return {
      eventType: 'sale', confidence: 'certain',
      reason: `Order status is ${row.orderStatus.trim()} with a sale amount.`,
      countsAsDispatch: true, recognisesRevenue: true,
    }
  }

  // An unrecognised status is reported, not guessed at. A future Meesho status
  // must reach Finance rather than quietly become revenue.
  return {
    eventType: 'unclassified', confidence: 'needs_review',
    reason: `Unrecognised order status "${row.orderStatus.trim()}".`,
    countsAsDispatch: false, recognisesRevenue: false,
  }
}
