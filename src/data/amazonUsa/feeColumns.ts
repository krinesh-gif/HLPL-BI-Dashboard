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
}

/** In the order Amazon exports them, which is the order the statement reads. */
export const AMAZON_USA_FEE_COLUMNS: AmazonUsaFeeColumn[] = [
  { id: 'agedInventorySurcharge', header: 'Aged inventory surcharge total', group: 'marketplace', bucket: 'otherMarketplaceCharges' },
  { id: 'baseFulfillmentFee', header: 'Base fulfillment fee total', group: 'marketplace', componentOf: 'fbaFulfillmentFees', bucket: 'fulfilment' },
  { id: 'baseMonthlyStorageFee', header: 'Base monthly storage fee total', group: 'marketplace', bucket: 'otherMarketplaceCharges' },
  { id: 'couponParticipationFee', header: 'Coupon participation fee total', group: 'marketplace', bucket: 'otherMarketplaceCharges' },
  { id: 'couponPerformanceFee', header: 'Coupon performance-based fee total', group: 'marketplace', bucket: 'otherMarketplaceCharges' },
  { id: 'dealDailyFee', header: 'Deal daily fee total', group: 'marketplace', bucket: 'otherMarketplaceCharges' },
  { id: 'dealPerformanceFee', header: 'Deal performance-based fee total', group: 'marketplace', bucket: 'otherMarketplaceCharges' },
  { id: 'fbaInventoryReimbursement', header: 'FBA Inventory Reimbursement total', group: 'marketplace', bucket: 'otherMarketplaceCharges' },
  { id: 'fbaDisposalOrderFee', header: 'FBA disposal order fee total', group: 'marketplace', bucket: 'otherMarketplaceCharges' },
  { id: 'fbaFulfillmentFees', header: 'FBA fulfillment fees total', group: 'marketplace', bucket: 'fulfilment' },
  { id: 'fbaInboundPlacementFee', header: 'FBA inbound placement service fee total', group: 'marketplace', bucket: 'fulfilment' },
  { id: 'fuelLogisticsSurcharge', header: 'Fuel and Logistics-related surcharge total', group: 'marketplace', componentOf: 'fbaFulfillmentFees', bucket: 'fulfilment' },
  { id: 'lowInventoryLevelFee', header: 'Low-inventory-level fee total', group: 'marketplace', componentOf: 'fbaFulfillmentFees', bucket: 'fulfilment' },
  { id: 'monthlyInventoryStorageFee', header: 'Monthly inventory storage fee total', group: 'marketplace', componentOf: 'baseMonthlyStorageFee', hideWhenNested: true, bucket: 'otherMarketplaceCharges' },
  { id: 'referralFeeRefunds', header: 'Referral Fee Refunds total', group: 'marketplace', bucket: 'marketplaceCommission' },
  { id: 'referralFee', header: 'Referral fee total', group: 'marketplace', bucket: 'marketplaceCommission' },
  { id: 'refundAdministrationFee', header: 'Refund administration fee total', group: 'marketplace', bucket: 'returnCharges' },
  { id: 'returnsProcessingFee', header: 'Returns Processing Fee for Non-Apparel and Non-Shoes total', group: 'marketplace', bucket: 'returnCharges' },
  { id: 'storageUtilizationSurcharge', header: 'Storage utilization surcharge total', group: 'marketplace', bucket: 'otherMarketplaceCharges' },
  { id: 'sponsoredProductsCharge', header: 'Sponsored Products charge total', group: 'advertising', bucket: 'ads' },
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
