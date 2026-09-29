import type { MeeshoEventType } from './events'

/**
 * Which events the company recognises as revenue, and which count as volume.
 *
 * Gross Sales is the file's own Total Sale Amount column, summed by order
 * month — that is the figure the business reconciles the dashboard against, so
 * every row carrying a sale amount belongs in it, whatever its status. What
 * varies below Gross Sales is whether a row shipped stock, cost anything, or
 * needs a person to look at it.
 *
 * This is an accounting policy, not a fact about the file, so it lives in one
 * editable table rather than being spread through the parser. Changing a line
 * here restates the P&L, which is the point: Finance owns these decisions and
 * should be able to see and change them without reading parsing code.
 *
 * What the real August file showed, and why each default is what it is:
 *
 *  - RTO rows book the sale and reverse it on the same row (₹45,532 booked,
 *    ₹45,681 reversed). The revenue therefore cancels itself out; what is
 *    left is the logistics cost of a parcel that travelled twice.
 *  - Cancelled rows still carried a settlement (₹621 of sale, ₹446 settled),
 *    so they sit in Gross Sales but ship nothing and cost nothing. They are
 *    then reversed in full on their own line, because unlike an RTO the file
 *    writes no return against a cancellation — nothing was ever shipped, so
 *    there is nothing to send back. Leaving them unreversed recognised revenue
 *    on orders that never happened: Net Sales carried the whole cancelled
 *    amount, and Output GST was charged on it too.
 *  - Exchange rows carry a sale amount but settle negative, because the
 *    replacement shipment costs return freight. They stay in Gross Sales and
 *    stay flagged, so the double-count question is visible rather than decided
 *    silently in either direction.
 */
export interface RevenuePolicy {
  /** Contributes its sale and return amounts to Gross Sales / Returns. */
  entersRevenue: boolean
  /**
   * Sits in Gross Sales so the top line ties to the file's Total Sale Amount
   * column, then comes straight back out on its own line below it.
   *
   * Only a status the file bills but never reverses needs this. An RTO reverses
   * itself on its own row and must not be listed here, or it would be taken out
   * twice.
   */
  reversedInFull: boolean
  /** Contributes a shipment and its units to volume, ASP and per-shipment
   * fulfilment cost. */
  entersVolume: boolean
  /** Contributes cost of goods. */
  entersCogs: boolean
  /** Shown in the review queue even when confidently classified, because the
   * treatment is a judgement the business should see rather than a fact. */
  alwaysReview: boolean
  note: string
}

export const MEESHO_REVENUE_POLICY: Record<MeeshoEventType, RevenuePolicy> = {
  sale: { entersRevenue: true, reversedInFull: false, entersVolume: true, entersCogs: true, alwaysReview: false,
    note: 'A delivered or shipped order: revenue, volume and cost of goods.' },

  rto: { entersRevenue: true, reversedInFull: false, entersVolume: true, entersCogs: true, alwaysReview: false,
    note: 'Books and reverses its own sale on one row, so revenue nets to nil; the parcel still shipped, so it counts as volume and its unsaleable stock is written off.' },

  return: { entersRevenue: true, reversedInFull: false, entersVolume: false, entersCogs: true, alwaysReview: false,
    note: 'A reversal of a sale counted on another row. No second shipment.' },

  cancellation: { entersRevenue: true, reversedInFull: true, entersVolume: false, entersCogs: false, alwaysReview: true,
    note: 'Carried in Gross Sales because the order was placed and the file bills it there, then reversed in full on its own line: no parcel shipped, so it earns no revenue, no volume and no stock cost. The file writes no return against it, so the reversal has to come from here.' },

  exchange: { entersRevenue: true, reversedInFull: false, entersVolume: true, entersCogs: true, alwaysReview: true,
    note: 'A replacement shipment. Carried in Gross Sales so the total ties to the file, and flagged here because a replacement against an order already counted is a judgement worth seeing.' },

  affiliate_fee: { entersRevenue: false, reversedInFull: false, entersVolume: false, entersCogs: false, alwaysReview: false,
    note: 'Demand-acquisition cost. Reported under Advertising & Marketing, never as a marketplace fee and never in COGS.' },

  recovery: { entersRevenue: false, reversedInFull: false, entersVolume: false, entersCogs: false, alwaysReview: false,
    note: 'Money Meesho took back. A cost, mapped by its stated reason.' },

  compensation: { entersRevenue: false, reversedInFull: false, entersVolume: false, entersCogs: false, alwaysReview: false,
    note: 'Money Meesho paid us outside a sale. Not revenue.' },

  claim: { entersRevenue: false, reversedInFull: false, entersVolume: false, entersCogs: false, alwaysReview: false,
    note: 'A settled claim. Not revenue.' },

  settlement_adjustment: { entersRevenue: false, reversedInFull: false, entersVolume: false, entersCogs: false, alwaysReview: true,
    note: 'Money moved with no sale and no stated reason. Never revenue until the reason is known.' },

  unclassified: { entersRevenue: false, reversedInFull: false, entersVolume: false, entersCogs: false, alwaysReview: true,
    note: 'The row does not say what it is. Held out of every figure and shown to Finance.' },
}
