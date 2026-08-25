import type { EventConfidence, MeeshoEventType } from './events'

/**
 * One financial event from the Meesho Payment-to-Order report, normalised but
 * still traceable to the exact cell it came from.
 *
 * Every field the workbook carries is kept, including the ones no P&L line
 * currently uses. A column dropped at import is a column nobody can ask a
 * question about later, and Finance has to be able to answer "where did this
 * number come from" against the original file.
 */
export interface MeeshoTransaction {
  /** Stable within one import: sub-order plus the source row it came from, so
   * the two rows of a returned order stay distinguishable. */
  transactionId: string

  subOrderId: string
  sku: string
  productName: string
  catalogId: string
  transactionRef: string

  /** Three independent dates. None overwrites another: the P&L is cut on one
   * and the settlement on another, and a row can carry all three. */
  orderDate: string
  dispatchDate: string
  paymentDate: string

  orderStatus: string
  orderSource: string
  priceType: string

  eventType: MeeshoEventType
  confidence: EventConfidence
  classificationReason: string
  /** Whether this row is in the review queue. Stored rather than re-derived,
   * so the importer's judgement and the review screen's filter cannot drift
   * apart — a cancelled row is certain about what it is and still needs a
   * person to confirm how it should be treated. */
  flagged: boolean

  quantity: number
  productGstPct: number
  listingPriceInclTax: number
  totalSaleAmount: number
  totalSaleReturnAmount: number

  commissionPct: number
  commission: number
  goldPlatformFee: number
  mallPlatformFee: number
  fixedFee: number
  warehousingFee: number
  returnPremium: number
  shippingCharge: number
  returnShippingCharge: number
  gstCompensation: number
  otherSupportCharges: number
  waivers: number
  gstOnOtherSupport: number

  tcs: number
  tdsRatePct: number
  tds: number

  compensation: number
  claims: number
  recovery: number
  compensationReason: string
  claimsReason: string
  recoveryReason: string

  settlementAmount: number

  /** Where this came from, for the Finance audit view. */
  sourceFile: string
  sourceSheet: string
  sourceRowNumber: number
  /** The untouched cells of the original row, keyed by the workbook's own
   * header names. Kept so a figure can always be checked against the file. */
  raw: Record<string, string>
}

/** A transaction the importer could not confidently place. */
export interface MeeshoException {
  transactionId: string
  subOrderId: string
  sourceRowNumber: number
  orderDate: string
  paymentDate: string
  orderStatus: string
  eventType: MeeshoEventType
  confidence: EventConfidence
  reason: string
  totalSaleAmount: number
  settlementAmount: number
  recovery: number
}
