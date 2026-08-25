/**
 * Where each Meesho charge belongs in the standardized P&L.
 *
 * Two rules drive this table. Affiliate and referral charges are advertising,
 * not a marketplace fee and never COGS — they buy demand, and burying them in
 * fees hides what customer acquisition actually costs. And a charge this app
 * does not recognise is reported as unmapped rather than swept into "other",
 * so a new Meesho fee shows up as a question instead of disappearing into a
 * subtotal.
 */

export type PnlMasterCategory =
  | 'Marketplace & Fulfilment Costs'
  | 'Advertising & Marketing'
  | 'Other Revenue Adjustments'

export type MarketplaceSubCategory =
  | 'Commission / Selling Fees'
  | 'Fulfilment'
  | 'Shipping / Logistics'
  | 'Returns / RTO'
  | 'Storage / Warehousing'
  | 'Collection / Payment'
  | 'Promotions / Seller Funding'
  | 'Adjustments'

export interface FeeMapping {
  /** The workbook's own column header, kept verbatim for the audit view. */
  sourceHeader: string
  master: PnlMasterCategory
  subCategory: MarketplaceSubCategory | 'Affiliate / Referral' | 'Marketplace Ads'
  /** Which occurrence of a repeated header this is. Meesho bills the fixed and
   * warehousing fees twice — once on the order, once on its return. */
  occurrence?: number
}

/**
 * The mapping as it stands for the real workbook's 43 columns. Editable
 * without touching parsing code: the parser reads this table, so a
 * re-classification by Finance is a change here alone.
 */
export const MEESHO_FEE_MAPPING: FeeMapping[] = [
  { sourceHeader: 'Meesho Commission (Incl. GST)', master: 'Marketplace & Fulfilment Costs', subCategory: 'Commission / Selling Fees' },
  { sourceHeader: 'Meesho gold platform fee (Incl. GST)', master: 'Marketplace & Fulfilment Costs', subCategory: 'Commission / Selling Fees' },
  { sourceHeader: 'Meesho mall platform fee (Incl. GST)', master: 'Marketplace & Fulfilment Costs', subCategory: 'Commission / Selling Fees' },

  { sourceHeader: 'Fixed Fee (Incl. GST)', occurrence: 0, master: 'Marketplace & Fulfilment Costs', subCategory: 'Fulfilment' },
  { sourceHeader: 'Fixed Fee (Incl. GST)', occurrence: 1, master: 'Marketplace & Fulfilment Costs', subCategory: 'Fulfilment' },

  { sourceHeader: 'Shipping Charge (Incl. GST)', master: 'Marketplace & Fulfilment Costs', subCategory: 'Shipping / Logistics' },
  { sourceHeader: 'Return Shipping Charge (Incl. GST)', master: 'Marketplace & Fulfilment Costs', subCategory: 'Returns / RTO' },
  { sourceHeader: 'Return premium (incl GST)', master: 'Marketplace & Fulfilment Costs', subCategory: 'Returns / RTO' },
  { sourceHeader: 'Return premium (incl GST) of Return', master: 'Marketplace & Fulfilment Costs', subCategory: 'Returns / RTO' },

  { sourceHeader: 'Warehousing fee (inc Gst)', occurrence: 0, master: 'Marketplace & Fulfilment Costs', subCategory: 'Storage / Warehousing' },
  { sourceHeader: 'Warehousing fee (Incl. GST)', occurrence: 0, master: 'Marketplace & Fulfilment Costs', subCategory: 'Storage / Warehousing' },

  { sourceHeader: 'Net Other Support Service Charges (Excl. GST)', master: 'Marketplace & Fulfilment Costs', subCategory: 'Adjustments' },
  { sourceHeader: 'GST on Net Other Support Service Charges', master: 'Marketplace & Fulfilment Costs', subCategory: 'Adjustments' },
  { sourceHeader: 'GST Compensation (PRP Shipping)', master: 'Marketplace & Fulfilment Costs', subCategory: 'Adjustments' },
]

/**
 * Recovery reasons are free text from Meesho, so they are matched by pattern
 * rather than by exact string. Both entries below appear in the real file.
 */
export interface RecoveryMapping {
  pattern: RegExp
  label: string
  master: PnlMasterCategory
  subCategory: MarketplaceSubCategory | 'Affiliate / Referral'
}

export const MEESHO_RECOVERY_MAPPING: RecoveryMapping[] = [
  {
    pattern: /affiliate|referral/i,
    label: 'Affiliate / referral commission',
    // Deliberately not a marketplace fee: this is paid to acquire a customer.
    master: 'Advertising & Marketing',
    subCategory: 'Affiliate / Referral',
  },
  {
    pattern: /short video|nmv/i,
    label: 'Short-video commission on NMV',
    master: 'Advertising & Marketing',
    subCategory: 'Affiliate / Referral',
  },
]

export interface ResolvedRecovery {
  label: string
  master: PnlMasterCategory
  subCategory: string
  mapped: boolean
}

/** Resolves a recovery reason, or reports it as unmapped so it stays visible. */
export function resolveRecoveryReason(reason: string): ResolvedRecovery {
  for (const entry of MEESHO_RECOVERY_MAPPING) {
    if (entry.pattern.test(reason)) {
      return { label: entry.label, master: entry.master, subCategory: entry.subCategory, mapped: true }
    }
  }
  return {
    label: reason.trim() || 'Recovery with no reason given',
    master: 'Marketplace & Fulfilment Costs',
    subCategory: 'Adjustments',
    mapped: false,
  }
}
