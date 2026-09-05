import type { PnlLineKey } from '@/config/pnlStructure'

/**
 * Every fee column of the Seller Central ▸ Reports ▸ Business Reports ▸
 * Product Profitability export, named exactly as Amazon names it.
 *
 * Two facts about this export drive the whole design:
 *
 * 1. **Amazon changes the columns between months.** The four months in
 *    Aravi_Amazon_USA_PnL_FY2627_v7.xlsx have 66, 66, 72 and 78 columns, and
 *    the fee blocks sit at different letters in each. Column position is
 *    therefore meaningless — every column is found by its header text.
 *
 * 2. **Some columns contain others.** `FBA fulfillment fees total` is the sum
 *    of `Base fulfillment fee total`, `Fuel and Logistics-related surcharge
 *    total` and `Low-inventory-level fee total` (verified on all 380 rows of
 *    the four months), and `Monthly inventory storage fee total` repeats
 *    `Base monthly storage fee total` value-for-value. Adding those four to
 *    the total would charge the same money twice, so they are carried as
 *    `componentOf` — shown in full, never summed.
 *
 * Amazon's own `Net proceeds total` column is reproduced exactly by
 *   Net sales − Σ(counted fees) − COGS/unit × net units − misc/unit × net units
 * which is what `computeAmazonUsaPnl` builds and what the statement ties to.
 */
export interface AmazonUsaFeeColumn {
  /** Stable key inside the facts record — survives Amazon renaming nothing. */
  id: string
  /** The exact header text, matched case-insensitively after trimming. */
  header: string
  /** Where the line sits on the statement. */
  group: 'marketplace' | 'advertising'
  /** Set when another column already includes this one. Such a line is shown
   * for reference, indented under its parent, and excluded from every total. */
  componentOf?: string
  /** Drop the line entirely once the file has proved it a duplicate rather
   * than a component. A column that merely repeats another one adds nothing to
   * read: there is no sum to check, only the same number printed twice. It
   * comes back the moment a file shows it carrying its own charge. */
  hideWhenNested?: boolean
  /** Which canonical P&L bucket this rolls into for the Master P&L. */
  bucket: PnlLineKey
  /**
   * What can actually be done about this fee, when something can.
   *
   * A referral fee is a percentage of the sale price and is not a lever. A
   * low-inventory-level fee is charged for holding too little stock against
   * demand, and sending more of it earlier makes the fee go away. Separating
   * the two is what turns a table of costs into a list of things to do.
   */
  lever?: string
}

/** In the order Amazon exports them, which is the order the statement reads. */
export const AMAZON_USA_FEE_COLUMNS: AmazonUsaFeeColumn[] = [
  { id: 'agedInventorySurcharge', header: 'Aged inventory surcharge total', group: 'marketplace', bucket: 'otherMarketplaceCharges',
    lever: 'Charged on stock held past 180 days. Mark down, bundle or remove the aged units before the next assessment.' },
  { id: 'baseFulfillmentFee', header: 'Base fulfillment fee total', group: 'marketplace', componentOf: 'fbaFulfillmentFees', bucket: 'fulfilment' },
  { id: 'baseMonthlyStorageFee', header: 'Base monthly storage fee total', group: 'marketplace', bucket: 'otherMarketplaceCharges',
    lever: 'Charged per cubic foot held. Cut cover on slow movers and clear dead stock.' },
  { id: 'couponParticipationFee', header: 'Coupon participation fee total', group: 'marketplace', bucket: 'otherMarketplaceCharges',
    lever: 'A fixed fee per redeemed coupon. Worth running only if the coupon moved enough units to cover it.' },
  { id: 'couponPerformanceFee', header: 'Coupon performance-based fee total', group: 'marketplace', bucket: 'otherMarketplaceCharges',
    lever: 'A percentage of coupon-driven sales. Check the coupon pays for itself before renewing it.' },
  { id: 'dealDailyFee', header: 'Deal daily fee total', group: 'marketplace', bucket: 'otherMarketplaceCharges',
    lever: 'A flat fee to run the deal. Weigh it against the units the deal actually moved.' },
  { id: 'dealPerformanceFee', header: 'Deal performance-based fee total', group: 'marketplace', bucket: 'otherMarketplaceCharges',
    lever: 'A percentage of deal sales. Same test as the daily fee — did the deal earn its cost?' },
  { id: 'fbaInventoryReimbursement', header: 'FBA Inventory Reimbursement total', group: 'marketplace', bucket: 'otherMarketplaceCharges' },
  { id: 'fbaDisposalOrderFee', header: 'FBA disposal order fee total', group: 'marketplace', bucket: 'otherMarketplaceCharges',
    lever: 'Charged to destroy or return units. Usually the tail of an aged-inventory problem rather than a problem of its own.' },
  { id: 'fbaFulfillmentFees', header: 'FBA fulfillment fees total', group: 'marketplace', bucket: 'fulfilment',
    lever: 'Set by unit size and weight band. Reducing pack dimensions moves a SKU into a cheaper band.' },
  { id: 'fbaInboundPlacementFee', header: 'FBA inbound placement service fee total', group: 'marketplace', bucket: 'fulfilment',
    lever: 'Charged when a shipment is split across centres. Sending to the centres Amazon asks for reduces or removes it.' },
  { id: 'fuelLogisticsSurcharge', header: 'Fuel and Logistics-related surcharge total', group: 'marketplace', componentOf: 'fbaFulfillmentFees', bucket: 'fulfilment' },
  { id: 'lowInventoryLevelFee', header: 'Low-inventory-level fee total', group: 'marketplace', componentOf: 'fbaFulfillmentFees', bucket: 'fulfilment',
    lever: 'Charged when cover runs thin against demand. Sending more inventory, earlier, removes it entirely.' },
  { id: 'monthlyInventoryStorageFee', header: 'Monthly inventory storage fee total', group: 'marketplace', componentOf: 'baseMonthlyStorageFee', hideWhenNested: true, bucket: 'otherMarketplaceCharges' },
  { id: 'referralFeeRefunds', header: 'Referral Fee Refunds total', group: 'marketplace', bucket: 'marketplaceCommission' },
  { id: 'referralFee', header: 'Referral fee total', group: 'marketplace', bucket: 'marketplaceCommission' },
  { id: 'refundAdministrationFee', header: 'Refund administration fee total', group: 'marketplace', bucket: 'returnCharges',
    lever: 'Charged per refund. Driven by return rate, so it follows listing accuracy and packaging.' },
  { id: 'returnsProcessingFee', header: 'Returns Processing Fee for Non-Apparel and Non-Shoes total', group: 'marketplace', bucket: 'returnCharges',
    lever: 'Charged on SKUs whose return rate is above the category threshold. Fix the listing, sizing or packaging.' },
  { id: 'storageUtilizationSurcharge', header: 'Storage utilization surcharge total', group: 'marketplace', bucket: 'otherMarketplaceCharges',
    lever: 'Charged when stored volume runs high against your sales rate. Improve sell-through or hold less.' },
  { id: 'sponsoredProductsCharge', header: 'Sponsored Products charge total', group: 'advertising', bucket: 'ads',
    lever: 'Ad spend is entirely a choice. Review it per SKU against the sales it produced.' },
]

/**
 * The order the statement reads in: each counted column, immediately followed
 * by the columns it contains.
 *
 * Amazon exports them alphabetically, which scatters a parent away from its
 * parts — "Base fulfillment fee" sits eight rows above the "FBA fulfillment
 * fees" that contains it, so the arithmetic is invisible. Grouping them puts
 * the sum on top of its own addends, where it can be checked at a glance.
 */
export const AMAZON_USA_FEE_COLUMNS_IN_ORDER: AmazonUsaFeeColumn[] = AMAZON_USA_FEE_COLUMNS
  .filter((c) => !c.componentOf)
  .flatMap((parent) => [parent, ...AMAZON_USA_FEE_COLUMNS.filter((c) => c.componentOf === parent.id)])

/** The columns that actually add up. A `componentOf` line is already inside
 * another one, so counting it too would double-charge the month. */
export const AMAZON_USA_COUNTED_FEE_COLUMNS = AMAZON_USA_FEE_COLUMNS.filter((c) => !c.componentOf)

const BY_HEADER = new Map(AMAZON_USA_FEE_COLUMNS.map((c) => [c.header.trim().toLowerCase(), c]))

/** The fee column a header names, or undefined for one this build has never
 * seen — those are kept and shown rather than folded into a catch-all, so a
 * fee Amazon introduces next month is visible instead of silently absorbed. */
export function feeColumnForHeader(header: string): AmazonUsaFeeColumn | undefined {
  return BY_HEADER.get(header.trim().toLowerCase())
}

/** Sums the fee lines that count, ignoring the component lines. */
export function sumCountedFees(feeTotals: Record<string, number>, group?: AmazonUsaFeeColumn['group']): number {
  return AMAZON_USA_COUNTED_FEE_COLUMNS
    .filter((c) => group === undefined || c.group === group)
    .reduce((sum, c) => sum + (feeTotals[c.id] ?? 0), 0)
}
