import type { AdsChannelId } from '@/config/adsChannels'
import type { BusinessChannelId, ChannelId } from '@/config/channels'
import type { PnlLineKey } from '@/config/pnlStructure'

// ---------------------------------------------------------------------------
// Canonical Sales Record — every marketplace report is normalized into this
// shape. Marketplace-specific fields that don't fit are preserved in `raw`
// rather than discarded.
// ---------------------------------------------------------------------------
export interface CanonicalSalesRecord {
  orderId: string
  orderDate: string // ISO yyyy-mm-dd
  channel: ChannelId
  marketplace: string
  sellerType: 'seller_central' | 'vendor_central' | 'marketplace'
  sku: string
  productName: string
  category: string
  subCategory?: string
  quantity: number
  grossSales: number
  discount: number
  netSales: number
  returnUnits: number
  rtoUnits: number
  shippingCost: number
  marketplaceFee: number
  tax: number
  status: 'completed' | 'returned' | 'rto' | 'cancelled' | 'pending'
  currency: 'INR' | 'USD'
  /** Original uploaded row, untouched, keyed by original header names. */
  raw?: Record<string, string | number>
  /** Which import batch this row came from — used for de-dup and audit trail. */
  importId: string
}

// ---------------------------------------------------------------------------
// SKU Master
// ---------------------------------------------------------------------------
export interface SkuMaster {
  sku: string
  productName: string
  category: string
  subCategory?: string
  brand: string
  cogs: number
  mrp: number
  launchDate: string
  status: 'active' | 'inactive' | 'discontinued'
  leadTimeDays: number
  safetyStock: number
}

// ---------------------------------------------------------------------------
// Amazon Ads
// ---------------------------------------------------------------------------
export interface AdsRecord {
  date: string
  channel: ChannelId
  campaign: string
  adGroup?: string
  keyword?: string
  searchTerm?: string
  sku?: string
  asin?: string
  impressions: number
  clicks: number
  spend: number
  adSales: number
  adOrders: number
  importId: string
}

/**
 * A month's advertising spend entered by hand rather than uploaded.
 *
 * Some platforms bill through a monthly invoice instead of publishing a
 * campaign report — Nykaa's marketing-investment value is the case here. The
 * figure is real money and belongs in the P&L, but it carries no impressions,
 * clicks or attributed sales, so it is stored separately from report data and
 * labelled wherever it is shown.
 */
export interface ManualAdSpend {
  channel: AdsChannelId
  month: string // yyyy-mm
  amount: number
  /** Name of the invoice the figure came from, when one was attached. */
  fileName?: string
  note?: string
  enteredAt: string
  enteredBy?: string
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------
export interface InventorySnapshot {
  sku: string
  asOfDate: string
  currentStock: number
  inTransit: number
}

// ---------------------------------------------------------------------------
// Fixed Expenses — entered/imported per month, not derived from order data.
// ---------------------------------------------------------------------------
export interface FixedExpenseEntry {
  month: string // yyyy-mm
  category:
    | 'salaries'
    | 'rent'
    | 'software'
    | 'warehouse'
    | 'logistics'
    | 'professionalFees'
    | 'officeExpenses'
    | 'generalExpenses'
    | 'otherOpex'
  amount: number
  note?: string
}

// ---------------------------------------------------------------------------
// P&L data — kept as its own controlled structure, isolated from raw order
// data. Order-level uploads feed Sales/SKU/Channel analytics; they do NOT
// silently rewrite these numbers. A P&L is built by the pnl engine from
// (a) aggregated net sales/COGS/marketplace-fee facts derived from sales
// records for a given month+channel, plus (b) manually entered/imported
// marketing and fixed-expense figures.
// ---------------------------------------------------------------------------
export type PnlLineValues = Partial<Record<PnlLineKey, number>>

export interface PnlResult {
  month: string // yyyy-mm
  lines: PnlLineValues
}

export interface ChannelPnl extends PnlResult {
  /** The management-level channel this P&L belongs to. */
  channel: BusinessChannelId
}

// ---------------------------------------------------------------------------
// Channel-native P&L facts — Flipkart, Amazon USA and Meesho each compute
// their real P&L with a genuinely different waterfall (not just different
// numbers in one template), matched from the actual monthly reports these
// channels produce. These facts are the raw, aggregated monthly inputs to
// each channel's native compute function in engine/nativePnl/*; they are
// separate from `PnlLineValues` (the generic bucket structure every channel
// also rolls up into, for the Master P&L / MIS).
// ---------------------------------------------------------------------------

export interface FlipkartPnlFacts {
  month: string
  grossSales: number
  estimatedNetSales: number
  cogsPriced: number
  cogsUnpriced: number
  commissionFee: number
  collectionFee: number
  fixedFee: number
  pickPackFee: number
  forwardShippingFee: number
  reverseShippingFee: number
  storageFee: number
  recallFee: number
  otherMarketplaceFees: number
  rewardsSpf: number
  flipkartAds: number
  /** Manual monthly entries — not present in the SKU-level P&L export. */
  sellerFundedDiscount: number
  customerAddOns: number
  outputGst: number
  googleAds: number
}

export interface AmazonUsaPnlFacts {
  month: string
  grossSalesUsd: number
  netSalesUsd: number
  referralFeeUsd: number
  fbaFulfilmentFeeUsd: number
  storageAgedDisposalUsd: number
  couponDealFeesUsd: number
  refundAdminFeeUsd: number
  fbaReimbursementsUsd: number
  otherAmazonFeesUsd: number
  sponsoredProductsUsd: number
  cogsUsd: number
  freightUsd: number
  /** Manual monthly entries — from the Assumptions-style form. */
  sponsoredBrandsUsd: number
  sponsoredDisplayDspUsd: number
  offAmazonAdsUsd: number
  exportDocsUsd: number
  usImportDutyUsd: number
  amazonSellingPlanUsd: number
  productLiabilityInsuranceUsd: number
  fdaLegalUsd: number
  agencySoftwareUsd: number
  otherOverheadUsd: number
  fxConversionCostPct: number
}

export interface MeeshoPnlFacts {
  month: string
  grossSale: number
  returns: number
  forwardShipping: number
  reverseShipping: number
  returnPremium: number
  returnPremiumRecovered: number
  commission: number
  fixedFee: number
  warehousing: number
  goldFee: number
  mallFee: number
  otherSettlementCharge: number
  ads: number
  gst: number
  tcs: number
  tds: number
  compensation: number
  claims: number
  recovery: number
  settlementAmount: number
  cogs: number
}

// ---------------------------------------------------------------------------
// Import metadata / audit trail
// ---------------------------------------------------------------------------
export interface ImportRecord {
  id: string
  fileName: string
  channel: ChannelId
  reportType: string
  uploadedAt: string
  recordCount: number
  validRecordCount: number
  status: 'success' | 'partial' | 'failed'
  duplicateOfImportId?: string
  warnings: string[]
}
