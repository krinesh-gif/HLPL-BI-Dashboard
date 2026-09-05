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
  /** Distinguishes several lines of one order where the marketplace reports
   * them separately — Meesho files a sale and its return under the same
   * sub-order, same SKU and same order date, so without this the two collide
   * on the de-dup key and one is silently discarded. */
  lineId?: string
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
  /** 2 = the fee columns are kept one-for-one with Amazon's export in
   * `feeTotalsUsd`. Version 1 collapsed them into eight buckets, which is why
   * only Gross and Net Sales ever tied to the sheet. */
  schemaVersion?: 2
  grossSalesUsd: number
  netSalesUsd: number
  unitsSoldQty?: number
  unitsReturnedQty?: number
  netUnitsSoldQty?: number
  /** Every "... total" fee column of the Product Profitability export, summed
   * over the month and keyed by `AMAZON_USA_FEE_COLUMNS[].id`. Amounts carry
   * the export's own sign: a charge is positive, a credit negative. */
  feeTotalsUsd?: Record<string, number>
  /** Fee columns Amazon added that this build does not recognise, keyed by the
   * header text as exported. Kept and shown rather than dropped or guessed at,
   * so a new Amazon fee is visible in the month it first appears. */
  unmappedFeeTotalsUsd?: Record<string, number>
  /** The same fee columns, kept per SKU, so a fee can be traced to the products
   * carrying it. Keyed sku → fee id → amount, and only for fees the SKU was
   * actually charged, which keeps it to a few hundred numbers a month rather
   * than one entry per SKU per fee. */
  feeBySkuUsd?: Record<string, Record<string, number>>
  /** Fee ids this month's file proved to be contained inside another column —
   * checked row by row at import, not assumed. Empty means every column stands
   * on its own and every one is counted. */
  nestedFeeIds?: string[]
  /** The export's own per-unit seller costs × net units sold. Amazon subtracts
   * both when it computes Net proceeds, so the statement must too. */
  sheetCogsUsd?: number
  sheetMiscCostUsd?: number
  /** Σ of the export's own "Net proceeds total" column — the figure the
   * statement is reconciled against rather than assumed to match. */
  sheetNetProceedsUsd?: number
  /** Version 1 fee buckets. Retained so months imported before the rebuild
   * still render; new imports leave them at zero and use `feeTotalsUsd`. */
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
  /** The rupee amounts behind `cogsUsd` and `freightUsd`.
   *
   * Both are rupee costs — the Product Master's COGS and the India→USA freight
   * — that used to be converted to dollars at import and frozen there. That
   * froze half the statement at whatever rate was configured on upload day
   * while revenue converted at read time, so editing the rate produced a P&L
   * mixing two different exchange rates. Kept in rupees so they convert at the
   * month's rate like everything else. Optional: facts imported before this
   * existed fall back to the frozen dollar figures. */
  cogsSourceInr?: number
  freightSourceInr?: number
  /** How the month's COGS was arrived at, split so the statement can show how
   * much of it is a real cost and how much is filled in for SKUs with none. */
  cogsPricedUsd?: number
  cogsEstimatedUsd?: number
  uncostedUnitsQty?: number
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
}

/**
 * Which calendar the month is cut on.
 *
 * The same order row carries both an order date and a payment date, so one
 * upload produces two complete P&Ls. They are not a discrepancy to reconcile
 * away — they answer different questions, and for Meesho they differ by
 * roughly 2x in a given month because a July payment run settles a great deal
 * of June's trading.
 */
export type PnlBasis = 'order' | 'settlement'

/**
 * Meesho's monthly P&L inputs, in the structure the business actually uses.
 *
 * Every figure is a positive magnitude; the sign convention lives in the
 * compute function. Amounts are as Meesho bills them — inclusive of GST —
 * except advertising, which Meesho reports ex-GST.
 *
 * `schemaVersion` guards against silently mis-reading facts stored under the
 * older, thinner shape. A month without it is treated as absent and prompts a
 * re-upload rather than being rendered as if it were complete.
 */
export interface MeeshoPnlFacts {
  schemaVersion: 3
  month: string // yyyy-mm
  basis: PnlBasis

  // --- Revenue -------------------------------------------------------------
  grossSalesInclGst: number
  salesReturnsInclGst: number
  /** Output GST inside net sales, summed per row at that product's own rate —
   * the catalogue mixes 5% and 18% lines, so a single blended rate would be
   * wrong. */
  outputGstOnSales: number

  // --- Cost of goods -------------------------------------------------------
  cogsUnitsSold: number
  /** RTO stock that came back unsaleable. Shrinkage, not cost of sale. */
  cogsRtoWriteOff: number
  /** Customer returns that came back unsaleable — a worse rate than RTO,
   * because the box has been opened. */
  cogsReturnWriteOff: number

  // --- Marketplace charges, as billed --------------------------------------
  forwardShipping: number
  returnShipping: number
  /** Commission, fixed fee, warehousing, gold and mall fees, return premium,
   * and support-service charges. */
  otherMarketplaceFees: number

  // --- Advertising ---------------------------------------------------------
  adsSpendExGst: number
  adCredits: number

  // --- Advertising, continued ----------------------------------------------
  /** Affiliate and referral commission Meesho recovers against orders. Held
   * apart from `recovery` because it buys demand: it belongs with advertising,
   * not with marketplace fees, and never inside COGS. */
  affiliateFee: number

  // --- Platform adjustments ------------------------------------------------
  compensation: number
  claims: number
  /** Recoveries other than affiliate/referral. */
  recovery: number
  /** Subscription and programme fees Meesho recovers outside order rows. */
  platformRecoverySubscriptions: number

  // --- Volume, which drives own fulfilment cost ----------------------------
  subOrdersDispatched: number
  unitsDispatched: number
  unitsDelivered: number
  unitsRto: number
  unitsReturned: number

  // --- Memo: statutory and settlement bridge -------------------------------
  tcs: number
  tds: number
  gstOnMarketplaceFees: number
  gstOnAds: number
  /** Meesho's own net settlement total for the month, for the bank bridge. */
  netSettlementPerFile: number

  // --- Held out of the figures above ---------------------------------------
  /** Settlement value on rows the importer could not confidently classify.
   * Never folded into revenue or cost; carried so the reconciliation can show
   * exactly how much money is sitting unexplained. */
  unclassifiedSettlement: number
  /** Rows behind `unclassifiedSettlement`, for the review queue's count. */
  unclassifiedRows: number
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
