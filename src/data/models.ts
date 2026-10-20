import type { AdsChannelId } from '@/config/adsChannels'
import type { BusinessChannelId, ChannelId } from '@/config/channels'
import type { PnlLineKey } from '@/config/pnlStructure'

// ---------------------------------------------------------------------------
// Canonical Sales Record — every marketplace report is normalized into this
// shape. Marketplace-specific fields that don't fit are preserved in `raw`
// rather than discarded.
// ---------------------------------------------------------------------------
export interface CanonicalSalesRecord {
  /**
   * The marketplace's own order identifier. Set on a freshly normalised row,
   * where it is what de-duplicates an upload; absent on a grouped row read
   * back from the shared dataset, which stands for many orders. Nothing on
   * screen reads it — `orders` carries the count.
   */
  orderId?: string
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
  currency: 'INR' | 'USD' | 'AED'
  /** Original uploaded row, untouched, keyed by original header names. */
  raw?: Record<string, string | number>
  /** Which import batch this row came from — used for de-dup and audit trail. */
  /**
   * True when this row is a month's total for one SKU rather than a single
   * order.
   *
   * Amazon's Product Profitability export and Flipkart's SKU-level P&L are
   * both one aggregated row per SKU per month; neither carries an order count
   * at all. Counting such a row as one order made Amazon USA read 35 orders in
   * a month — its SKU count — and an average order value of ₹70.6K.
   */
  isAggregate?: boolean
  /**
   * How many order lines this row stands for.
   *
   * Absent on a row the app normalised itself, where it means one. The shared
   * dataset sends rows already grouped — one per day, channel, SKU, status and
   * currency — and each carries the number of lines behind it, so the order
   * count is the sum of these rather than the number of rows. The database
   * still stores every line; this is only what crosses the wire.
   */
  orders?: number
  /**
   * Which import batch this row came from. Set on a freshly normalised row,
   * which is what a write needs; absent on a grouped row read back, which can
   * span several imports. Nothing on screen reads it.
   */
  importId?: string
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
  /**
   * The GST rate this product is sold at, as a percentage — 18, 5, or 0.
   *
   * The single source of truth for tax, the way `cogs` is for cost. Channels
   * state rates that disagree with each other: Nykaa's purchase order prices
   * HSN 33011990 and 34011190 at 18% while Swiggy's prices the same two codes
   * at 5%. Only one of those can be right, so no document wins by being the
   * most recent one read — the rate entered here does, and a statement that
   * had to fall back to a channel's own figure says which SKUs it did that
   * for.
   *
   * Optional because unstated and 0% are different answers: a product with no
   * rate yet is a question to put to the accounts team, while a genuine 0%
   * line (Purplle's purchase order carries one, HSN 33012928) is an answer.
   */
  gstPct?: number
  launchDate: string
  status: 'active' | 'inactive' | 'discontinued'
  leadTimeDays: number
  safetyStock: number
}

// ---------------------------------------------------------------------------
// Myntra Ads
// ---------------------------------------------------------------------------
/**
 * A month of Myntra PLA advertising, beyond the spend the P&L charges.
 *
 * The spend itself is stored as ads records, like every other platform's, so
 * the P&L and the ads screens read it the same way. This is what Myntra's
 * report says that those records have no room for: the direct and indirect
 * split of what the advertising sold, the three dayparts the platform bids
 * across, and what state each campaign was in.
 */
export interface MyntraAdsCampaign {
  /** The identity. Two campaigns can share a name; none share an id. */
  campaignId: string
  /** For reading. Carries the id too where a name is used twice. */
  campaignName: string
  adGroups: number
  /** The state on the last day it reported: LIVE, ABORTED, CAMPAIGN_EXPIRED
   * or DAILY_BUDGET_MET. */
  lastStatus: string
  /** Days this campaign appears on. */
  days: number
  spend: number
  impressions: number
  clicks: number
  /** Units of the advertised product itself. */
  unitsDirect: number
  /** Units of anything else of ours the shopper bought after the click. */
  unitsIndirect: number
  revenueDirect: number
  revenueIndirect: number
}

/** One of the three parts of the day Myntra reports every metric against.
 * They partition the month rather than adding to it. */
export interface MyntraAdsDaypart {
  part: 'base' | 'peak' | 'nonPeak'
  impressions: number
  clicks: number
  spend: number
  units: number
  revenue: number
}

export interface MyntraAdsFacts {
  month: string
  schemaVersion: 1
  spend: number
  impressions: number
  clicks: number
  unitsDirect: number
  unitsIndirect: number
  revenueDirect: number
  revenueIndirect: number
  campaigns: MyntraAdsCampaign[]
  dayparts: MyntraAdsDaypart[]
  /** Campaign-days in each state, so a month on the daily budget is visible. */
  statusCounts: Record<string, number>
  /** Days the report covers, which is not the length of the month. */
  days: number
  /** Rows read, one per campaign, ad group and day. */
  rows: number
}

// ---------------------------------------------------------------------------
// Amazon India Vendor Central
// ---------------------------------------------------------------------------

/** One ASIN's shipments in a Vendor Central month. */
export interface AmazonInVendorAsin {
  asin: string
  title: string
  /** Units Amazon took delivery of and sold on. */
  units: number
  /** Amazon's realised retail value, ex-GST. */
  gms: number
  /** Amazon's margin on those shipments, in rupees. */
  ppm: number
  /** gms − ppm: what the ASIN invoiced for. */
  invoice: number
}

/**
 * Amazon India Vendor Central for a month, from the NPPM file the vendor
 * manager shares.
 *
 * This half of Amazon India is wholesale, not marketplace: Aravi sells to
 * RK World Infocom Pvt Ltd, which resells. So the money is not what a shopper
 * paid less Amazon's fees — it is what RK World paid, which is the retail
 * value they realised less the margin they are owed on it.
 *
 * `netShippedGms` is ex-GST. Established from the files rather than assumed:
 * the ratio of GMS per unit to the tax-inclusive price never exceeds 1/1.05 in
 * any month and clusters at 1/1.18 and 1/1.05, which are tax rates, so the
 * tax is on top of this figure and no output-GST line belongs on the
 * statement.
 */
export interface AmazonInVendorFacts {
  month: string
  schemaVersion: 1
  /** First and last ship day in the file. */
  periodStart: string
  periodEnd: string
  /** Amazon's realised retail value for the month, ex-GST. */
  netShippedGms: number
  /** The margin RK World earned on it — their PPM, our trade discount. */
  netPpm: number
  /** netShippedGms − netPpm: the month's invoice value, ex-GST. */
  invoiceValue: number
  unitsShipped: number
  /** The margin the contract closed at, as a fraction. It is renegotiated:
   * June ran at 31%, August and September at 32%. */
  marginClosedPct: number
  /** What the month actually achieved, netPpm ÷ netShippedGms. */
  marginAchievedPct: number
  /** The shortfall billed back as contra-COGS, as the file states it. */
  ccogsClaimed: number
  /** Knocked off the claim in negotiation, where the file records one. */
  ccogsDeductions?: number
  /** What the claim settled at, where the file records one. Absent means the
   * claim stands as billed. */
  ccogsFinal?: number
  /**
   * RK World's invoice for that claim, where it has arrived.
   *
   * With it, `ccogsFinal` is what Amazon actually deducted, under a number
   * the accounts team can find in the bank — rather than a figure somebody
   * entered after a phone call.
   */
  ccogsInvoice?: { number: string; date: string; amount: number }
  /** Per-unit price shortfall against the agreed price, where the file
   * carries the comparison. This is what eroded the margin. */
  priceMatchShortfall?: number
  asins: AmazonInVendorAsin[]
  /** Shipment rows read. */
  rows: number
  /** Inward cross-dock, from its own file. Absent until that is uploaded. */
  ixd?: AmazonInVendorIxd
}

/**
 * Amazon's inward cross-dock charge: a flat rate on every unit unpacked at
 * the fulfilment centre, which is a different count from units shipped —
 * August took in 3,888 units and shipped 8,367.
 */
export interface AmazonInVendorIxd {
  unitsUnpacked: number
  /** Rupees per unit, as the file states it rather than as a standing figure. */
  ratePerUnit: number
  charge: number
  /** Value of the goods taken in, which the file states beside the count. */
  valueUnpacked: number
  /** Dates the file covers. */
  periodStart: string
  periodEnd: string
  asins: number
  /**
   * Amazon's own invoice for the charge, where it has arrived.
   *
   * The cross-dock workbook states units and a rate; the invoice states what
   * was actually deducted from the payment, under a number the accounts team
   * can find in the bank. Where both are on file the invoice is the money and
   * the workbook is the detail behind it — and if they disagree, the
   * statement says so rather than choosing quietly.
   */
  invoice?: {
    number: string
    /** As the invoice is dated, which is after the period it bills. */
    date: string
    /** The claim before tax. GST on it is input credit, not a cost. */
    amount: number
  }
}

// ---------------------------------------------------------------------------
// Flipkart Ads
// ---------------------------------------------------------------------------

/** One Flipkart PLA campaign, summed over the report's period. */
export interface FlipkartAdsCampaign {
  campaignId: string
  /** For reading. Carries the id too where a name is used twice. */
  campaignName: string
  adGroups: number
  /** Products advertised under it. */
  skus: number
  spend: number
  views: number
  clicks: number
  /** Units of the advertised product itself. */
  unitsDirect: number
  /** Units of anything else of ours the shopper bought after the click. */
  unitsIndirect: number
  revenue: number
}

/** One advertised product, summed over the report's period. */
export interface FlipkartAdsSku {
  /** Flipkart's own SKU code, as the report writes it. */
  skuId: string
  productName: string
  campaigns: number
  spend: number
  views: number
  clicks: number
  unitsDirect: number
  unitsIndirect: number
  revenue: number
}

/**
 * Flipkart's PLA campaign report for a month.
 *
 * Unlike Myntra's, this is not where the channel's advertising cost comes
 * from: Flipkart's own P&L report states `• Ads` and `• Google Ads`, and the
 * P&L charges those. This file is the detail beside them — which campaign and
 * which product the money went into — and a second measurement of the spend to
 * hold the P&L's figure against.
 */
export interface FlipkartAdsFacts {
  month: string
  schemaVersion: 1
  /** The period the report itself states, which need not be a whole month. */
  periodStart: string
  periodEnd: string
  spend: number
  /** Flipkart's name for impressions. */
  views: number
  clicks: number
  unitsDirect: number
  unitsIndirect: number
  /** Attributed revenue. The file states one figure, not a direct/indirect split. */
  revenue: number
  campaigns: FlipkartAdsCampaign[]
  skus: FlipkartAdsSku[]
  /** Rows read, one per campaign, ad group and product. */
  rows: number
}

/** One advertised listing in Flipkart's Google Ads report. */
export interface FlipkartGoogleAdsProduct {
  /** Flipkart's listing id, which is the identity — the title is not. */
  productItemId: string
  productTitle: string
  /** Titles the same listing also appeared under, where it was renamed during
   * the period. Absent when it kept one name. */
  otherTitles?: string[]
  clicks: number
  /** Flipkart's name for impressions. */
  views: number
  units: number
  sales: number
  cost: number
}

/**
 * Flipkart's off-platform advertising for a month: the Google placements it
 * buys for the listings and bills back as `• Google Ads`.
 *
 * Beside that billed line, never in place of it. The two do not agree —
 * September measures ₹22,155.09 against ₹60,692.08 billed — and which is
 * right is a question about GST and what the export covers.
 */
export interface FlipkartGoogleAdsFacts {
  month: string
  schemaVersion: 1
  /** The period, which the file carries only in the name of the download. */
  periodStart: string
  periodEnd: string
  cost: number
  clicks: number
  views: number
  units: number
  sales: number
  products: FlipkartGoogleAdsProduct[]
  rows: number
  /** Listings the report named more than once, under different titles. */
  renamedListings: number
}

// ---------------------------------------------------------------------------
// Amazon Ads
// ---------------------------------------------------------------------------
export interface AdsRecord {
  date: string
  channel: ChannelId
  campaign: string
  /**
   * Which ad product bought this — "Sponsored Products", "Sponsored Brands",
   * "Sponsored Display".
   *
   * Amazon's console exports one report shape per ad product and names the
   * product in a Program Type column. Without it a month that ran Sponsored
   * Brands as well as Sponsored Products is one undifferentiated figure, and
   * the two are different decisions: Sponsored Products defends a listing,
   * Sponsored Brands buys reach. It is also part of a row's identity — the
   * same campaign name can run under two programs on one day, and a key
   * without it drops one of them as a duplicate.
   *
   * Absent on the platforms whose reports carry no such split.
   */
  program?: string
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
  /**
   * What `spend` and `adSales` are denominated in. Absent means rupees,
   * which every row stored before this field existed is.
   *
   * Amazon bills an advertising account in its marketplace's currency, and
   * the UAE account bills in dirhams: 5,006.88 of them across April to
   * September, which read as ₹5,006.88 and are nearer ₹1.2 lakh. Stored in
   * the currency the file states and converted when read, at the month's own
   * rate — the same rule every other foreign figure here follows, and the
   * only one that lets Amazon UAE's statement stay in dirhams while the
   * Master P&L stays in rupees.
   */
  currency?: 'INR' | 'USD' | 'AED'
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

// ---------------------------------------------------------------------------
// Fixed Expenses — entered/imported per month, not derived from order data.
// ---------------------------------------------------------------------------
/**
 * A charge that belongs to one channel and one month, named by whoever
 * entered it.
 *
 * Some charges never reach the marketplace's own report because they were
 * never settled through it. Flipkart's NextGen programme is billed on a
 * payment link and paid from the bank, so the SKU P&L export — which is a
 * statement of what Flipkart deducted — cannot show it, and the channel's
 * EBITDA read better than it was by exactly that amount.
 *
 * Three things follow from what these are:
 *
 *  - The name is the owner's, not a fixed list. There is no way to enumerate
 *    what a marketplace will invent to charge for next, and a charge filed
 *    under "Other" is a charge nobody can account for a year later.
 *  - It is charged whole to its channel, never shared out. That is the
 *    difference between this and a fixed expense: rent is the company's and
 *    is split across the channels by what each sold; NextGen is Flipkart's.
 *  - It belongs to the month it is entered against and no other. A quarterly
 *    fee is one entry in the month it was billed, or three entries of a third
 *    each — whichever is the truer picture of the month, which is a judgement
 *    the person entering it makes, not one this app should make for them.
 */
export interface ChannelChargeEntry {
  month: string // yyyy-mm
  channel: BusinessChannelId
  /** What it is called on the invoice: "NextGen charges", "Smart Assist". */
  label: string
  amount: number
  note?: string
  updatedAt?: string
}

export interface FixedExpenseEntry {
  month: string // yyyy-mm
  /**
   * `fixedExpensesTotal` is a month's whole fixed cost as one figure, which is
   * how the company works them out: the split is done in a spreadsheet and
   * only the total is worth re-keying. The nine named categories are the older
   * per-line entry and are still read, so a month entered that way keeps its
   * detail — the P&L adds them all up either way.
   */
  category:
    | 'fixedExpensesTotal'
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
  /**
   * Each fee split by the SKU carrying it, keyed by the same field names as
   * the totals above.
   *
   * Optional, and absent on two kinds of month: one imported before this was
   * captured, and one taken from the monthly summary workbook, which states
   * the month's totals and no rows at all. A month without it contributes
   * nothing to the per-SKU view rather than having its total spread across
   * SKUs by guesswork.
   */
  feeBySku?: Record<string, Record<string, number>>
  flipkartAds: number
  /** Manual monthly entries — not present in the SKU-level P&L export. */
  sellerFundedDiscount: number
  customerAddOns: number
  outputGst: number
  googleAds: number
}

/**
 * Myntra's own Profit & Loss report, sheet `PnL_Summary`, one month.
 *
 * Every field is the value that sheet prints, kept as a positive magnitude
 * except where Myntra itself reports a signed net (`reverseExpense`, which is
 * negative whenever reverse logistics outweighs the recoveries). The statement
 * does the subtracting; nothing here is pre-netted, so each line can be shown
 * against the sheet it came from.
 *
 * Two of these lines are memos rather than deductions, and treating them as
 * deductions is the easiest way to get this report wrong:
 *
 *  - `commissionDiscount` is already inside `fwdCommissionFee`. Myntra prints
 *    it under "Rewards & Other Benefits" beside the SJIT incentive, but only
 *    the incentive is added to the settlement — Bank Settlement (Projected) is
 *    exactly Estimated Net Sales After Expenses plus SJIT.
 *  - `productGst` is collected on the sale and owed to the government. Myntra
 *    prints it below the expenses and does not deduct it from the settlement,
 *    because the cash does arrive; it is removed here only to state revenue
 *    ex-GST, the same way Flipkart's output GST is.
 */
export interface MyntraPnlFacts {
  month: string
  /** Myntra's seller id, from the report header. */
  sellerId?: string
  grossSales: number
  grossSalesUnits: number
  returnsAndCancellations: number
  returnsAndCancellationsUnits: number
  estimatedNetSales: number
  estimatedNetSalesUnits: number

  /** Forward expenses — charges on dispatched orders. */
  fwdCommissionFee: number
  fwdTaxesTcs: number
  fwdTaxesTds: number
  fwdLogisticCharge: number
  fwdAdditionalCharges: number
  /** Σ of the forward lines, as the sheet reports it. */
  forwardExpense: number

  /** Reverse expenses. The three recoveries are credits and the reverse
   * logistic charge is a cost, so `reverseExpense` is a signed net and is
   * usually negative. */
  revCommissionRecovery: number
  revTcsRecovery: number
  revTdsRecovery: number
  revLogisticCharge: number
  revAdditionalRecovery: number
  reverseExpense: number

  /** Forward minus reverse, as the sheet reports it. */
  totalExpenses: number
  estimatedNetSalesAfterExpenses: number

  /** Memo — see the note above. */
  productGst: number

  nodPaid: number
  nodDeducted: number
  sjitIncentive: number
  /** Memo — already inside `fwdCommissionFee`. */
  commissionDiscount: number
  rewardsAndBenefits: number
  orderSpf: number

  bankSettlementProjected: number
  bankSettlementSettled: number
  bankSettlementUnsettled: number
  inputTaxCredits: number
  inputTaxCreditsGstTcs: number
  inputTaxCreditsTds: number
  earningsOnPlatform: number
  /** Myntra's own net margin, a fraction of Estimated Net Sales. */
  netMarginPct: number

  /** Computed here, not by Myntra: the cost of the goods sold, priced from the
   * company's own cost sheet at the month's effective cost. */
  cogsPriced: number
  cogsUnpriced: number
  /** Manual monthly entry — Myntra's P&L report carries no advertising. */
  myntraAds: number
}

/**
 * Nykaa — one month of the three files Nykaa sends.
 *
 * Nykaa is a B2B channel, which changes where revenue comes from. Nykaa buys
 * the goods and resells them, taking a flat margin on MRP. So the revenue line
 * is measured at MRP, which is what Nykaa raises its PO on.
 *
 * The discount a shopper gets is a second, separate thing. We fund it: Nykaa
 * sells below MRP and recovers the difference from us with a Financial Debit
 * Note, raised without GST. So the sale price is not a memo — the gap between
 * MRP and it is a real cost, and the fields below carry it.
 *
 * Amounts are positive magnitudes. The statement does the subtracting.
 */
export interface NykaaPnlFacts {
  month: string
  /** Σ row_mrp — everything that shipped, valued at MRP. */
  grossSalesMrp: number
  /** Σ return_mrp2 — what came back, valued at the same MRP. */
  returnsMrp: number
  /** Σ final_mrp — shipped less returned. The base every rupee below is
   * computed from. */
  netSalesMrp: number

  unitsShipped: number
  unitsReturned: number
  netUnits: number
  orders: number

  /** Nykaa\'s margin and the output tax, as a percentage. Absent means the
   * standing assumption applies, so correcting that restates every month. */
  commissionPctOfMrp?: number
  outputGstPct?: number

  /** What the shopper actually paid, Σ final_sp. Everything Nykaa sold below
   * MRP is recovered from us, so this is where the discount cost comes from. */
  customerPaidValue: number
  /** The standing discount off MRP, Σ (final_mrp − final_subtotal): the gap
   * between the printed price and the price the product is listed at. */
  listDiscount: number
  /** Promotions on top of the listed price, Σ (final_subtotal − final_sp) —
   * coupons, cart rules, offer codes. */
  promoDiscount: number
  /** The slice of `promoDiscount` the Cart Rule file marks COUPON_NYKAA_FUNDED.
   * Nykaa pays for that one, so it is credited back out of what we owe. */
  nykaaFundedCoupon: number
  /** What Nykaa recovers by debit note: list + promo, less anything Nykaa
   * funds itself. A real deduction, carrying no GST and so no input credit. */
  customerDiscount: number

  /** What Nykaa confirmed by email that it is charging back for the month.
   * Entered by hand, applied when the statement is read, and it beats every
   * figure derived from the sales file — which is provisional and routinely
   * disagrees with what is finally billed. */
  confirmedDiscount?: number

  /** Nykaa\'s Financial Debit Note for the month, once it arrives — the
   * document that actually charges the discount back. It is not what the P&L
   * deducts (it can arrive months late, and the month has to close without
   * it); it is read to check the figure the sales file already implies. */
  discountDebitNote?: {
    amount: number
    documentNumber: string
    documentDate: string
  }

  /** Computed here, not by Nykaa: what the goods cost, priced from the
   * company\'s own cost sheet at the month\'s effective cost. */
  cogsPriced: number
  cogsUnpriced: number
  /** Manual monthly entry — Nykaa\'s MI/ad invoice carries no report. */
  nykaaAds: number
  /** Getting the goods to Nykaa\'s warehouse: the month\'s units at the rate
   * card. Priced when the statement is read, from the rate entered for the
   * month, so it is never frozen into an import. */
  inboundFreight?: number
}

/**
 * Swiggy Instamart's month, as its sales report states it.
 *
 * Swiggy sends two sheets. `Sales Report` is one row per product per store per
 * day: the item code, the city, the base MRP, the units and the GMV, which is
 * base MRP × units on every row of June. `Brand Metrics` is per city per day:
 * impressions, orders, new-to-brand buyers, and the same GMV again.
 *
 * What it does not send is anything Swiggy took, any discount off MRP, and any
 * GST rate — so `outputGst` is computed at a declared assumption rather than
 * read, and the statement says so on the line.
 */
export interface SwiggyInstamartPnlFacts {
  month: string
  schemaVersion: 1
  /** Σ GMV — at base MRP, and so including GST. What Swiggy sold, not what
   * we invoiced: the trade margin comes off below. */
  gmv: number
  /** Σ BASE_MRP × UNITS_SOLD, which June's file reproduces exactly. Kept
   * separately so a month where the two part company is visible rather than
   * averaged away. */
  mrpValue: number
  /** Swiggy's trade margin on that GMV, and the terms it was taken from:
   * 25%, inclusive, on MRP, proved line by line on purchase order
   * FC5PO365689. Stored with the month so a change of terms cannot restate a
   * closed one.
   *
   * Optional because every month on file predates it: those rows carry no
   * margin at all, and a reader has to treat its absence as nothing deducted
   * rather than as NaN. They need their sales reports uploading again. */
  marginInr?: number
  marginPct?: number
  /** GMV less that margin: what we invoice Swiggy, GST included. Absent on a
   * month stored before the margin was computed. */
  invoiceValueInr?: number
  /** The tax inside the invoice value, at each item's own rate from the
   * Product Master. The sales report states no rate. */
  outputGst: number
  /** Item codes with no GST rate in the Product Master, whose tax fell back
   * to the rate on Swiggy's purchase order — or to the standing rate where
   * no order names them. Named so the gap is nameable rather than silent. */
  gstFallbackSkus?: string[]
  /** Marketing contribution charged for the month: 10% of MRP sales, for the
   * first six months from launch. Zero outside that window, and absent on a
   * month stored before it was computed. */
  marketingContributionInr?: number
  marketingContributionPct?: number
  /** The invoice value less GST — the basis every other channel's margins
   * are on. */
  gmvExGst: number
  unitsSold: number
  /** Rows of the sales report — one product, one store, one day. */
  salesRows: number
  skusSold: number
  storesSold: number
  citiesSold: number
  /** From `Brand Metrics`, which is reach rather than money. Absent in a file
   * that does not carry the sheet. */
  brandImpressions: number
  brandOrders: number
  newToBrandBuyers: number
  /** `Brand Metrics` states GMV as well. Reading both is how the two sheets
   * can be checked against each other instead of trusted. */
  brandGmv: number
  /** COGS priced at upload from the Product Master. */
  cogsSourceInr: number
  /** Swiggy item codes with no cost behind them. */
  unpricedSkus: string[]
}

/**
 * Purplle's month, as its sales file states it.
 *
 * Everything here comes from the file and nothing is inferred: Purplle sends
 * order lines with MRP, the price off, what the shopper paid (`nmv`, which
 * includes GST) and the GST rate, and states nothing it took. There is no
 * fee field on this record because there is no fee in the file, and an
 * invented one would be read as measured.
 */
export interface PurpllePnlFacts {
  month: string
  schemaVersion: 1
  /** Σ MRP of the lines that sold. */
  mrpValue: number
  /** Σ "Price Off Amt" — the discount against MRP. */
  priceOff: number
  /** Σ nmv: what shoppers paid, including GST — MRP less the price off.
   * Purplle's shop floor, not our revenue: the price off comes out of
   * Purplle's margin, since the margin sheet charges no discount back to us.
   * Kept because sell-through is the thing this channel is read for. */
  nmv: number
  /** The tax inside the invoice value, at each line's own rate from the
   * Product Master. Our GST is on what we sell to Purplle for, not on what
   * Purplle sells for. */
  outputGst: number
  /** Purplle codes with no GST rate in the Product Master, whose tax fell
   * back to the rate stated on Purplle's own file. Optional: months read
   * before the Master carried rates have neither array. */
  gstFallbackSkus?: string[]
  /** Codes where the Master and Purplle's file state different rates. The
   * Master decides the statement, and this says where the two disagree —
   * a difference worth taking up with Purplle, since it is the rate they
   * are invoicing at. */
  gstMismatchSkus?: string[]
  /** The invoice value less that GST — the basis every other channel's
   * margins are on. */
  netRevenue: number
  unitsSold: number
  orderLines: number
  orders: number
  skusSold: number
  /** Purplle's Basic Product Margin on the month's sell-out, and the terms it
   * was taken from: 31%, inclusive, on MRP. Not in any file Purplle sends —
   * it is the margin sheet — so the rate and its base are stored with the
   * month, and a later change of terms cannot silently restate a closed one. */
  marginInr: number
  marginPct: number
  marginBase: 'mrp' | 'nmv'
  /** MRP less that margin: what we invoice Purplle, GST included. This is the
   * channel's revenue, not the nmv shoppers paid. */
  invoiceValueInr: number
  /** The "Marketing" figure written above the table, when there is one —
   * otherwise the unnamed per-row column that carries the same charge. */
  marketingInr: number
  /** Whether the file labelled it, which is different from stating nil and
   * different again from leaving the column unnamed. */
  marketingStated: boolean
  /** What that charge works out at against the month's MRP. April's labelled
   * figure and June's unnamed column are both exactly 5%, which is what
   * makes them the same charge written two ways. Optional: months read
   * before this was noticed do not carry it. */
  marketingPctOfMrp?: number
  /** COGS priced at upload from the Product Master. The statement prefers the
   * cost sheet for the month and falls back to this. */
  cogsSourceInr: number
  /** Purplle codes with no cost behind them, so the gap is nameable. */
  unpricedSkus: string[]
  /** The file's second discount column and how far it differs from the first.
   * The sender carries both and their own difference column; April's disagree
   * by ₹48, which is worth saying rather than quietly picking one. */
  priceOffAlt: number
  priceOffDifference: number
  /** The file's own "Difference" column, summed. April's totals ₹48 while the
   * two discount columns are ₹46 apart, so the file does not agree with
   * itself either — worth saying when asking Purplle which figure is right. */
  priceOffDifferenceStated: number
}

/**
 * Amazon India's fees, traced to the SKUs carrying them.
 *
 * This is the Seller Central half's statement, and the month it states is the
 * whole month: every SKU sold, with units, returns, sales net of returns and
 * each fee Amazon charged, column by column.
 *
 * It was not always. The statement used to be built from the settlement
 * report, which states one fortnight's cash — and with two of those uploaded,
 * Seller Central read as an ₹8,000 business for six months against the ₹2
 * lakh these exports show. The settlement is now the tie to what Amazon
 * deposited rather than the source of the month.
 *
 * Still no sales rows: these are a month's facts, and a second set of order
 * rows for a month would count it twice. Everything is in rupees, as the
 * export states it, and ex-GST — see `nativePnl/amazonInSellerExport`, which
 * establishes that from the file rather than assuming it.
 */
export interface AmazonInSkuFeeFacts {
  month: string
  schemaVersion: 1
  /** Every "... total" fee column, summed over the month and keyed by
   * `AMAZON_USA_FEE_COLUMNS[].id`. The export's own sign: a charge positive,
   * a credit negative. */
  feeTotalsInr: Record<string, number>
  /** Columns this build does not recognise, keyed by the header as exported.
   * Amazon sent April's with one fee block unnamed — three columns headed
   * only " per unit", " quantity" and " total" — and ₹12,431.30 of real
   * charges in it. Kept under the heading it arrived with rather than
   * dropped, or given a name nobody can check. */
  unmappedFeeTotalsInr: Record<string, number>
  /** sku → fee id → amount, for the fees that SKU was actually charged. */
  feeBySkuInr: Record<string, Record<string, number>>
  /**
   * sku → units sold, and sku → net sales.
   *
   * Read so the month's cost of goods can be priced from our own cost sheet
   * per SKU rather than estimated as a share of sales. Optional because the
   * months imported before this export became the statement do not carry it;
   * such a month estimates its cost and says so.
   */
  unitsBySku?: Record<string, number>
  netSalesBySku?: Record<string, number>
  /** Fee ids this month's file proved to sit inside another column, checked
   * row by row rather than assumed. */
  nestedFeeIds: string[]
  unitsSoldQty: number
  unitsReturnedQty: number
  netUnitsSoldQty: number
  grossSalesInr: number
  netSalesInr: number
  /** Amazon's own "Net proceeds total" column, summed. What the fees are
   * reconciled against rather than assumed to agree with. */
  sheetNetProceedsInr: number
  /** The export's own per-unit seller costs × net units sold, which Amazon
   * subtracts in its Net proceeds. Zero in a file that leaves them blank. */
  sheetCogsInr: number
  sheetMiscCostInr: number
  /** Rows charged a fee without selling anything — stock sitting in the
   * warehouse, or a removal order. */
  nonSellingChargedRows: number
}

/**
 * Amazon India Seller Central, as its settlement report states it.
 *
 * Every (amount-type, amount-description) pair the file carries is kept under
 * its own key rather than mapped into a fixed set of buckets. Amazon adds fee
 * descriptions without warning, and a closed list silently drops the ones it
 * has not been taught — the same mistake that left Amazon USA's old eight
 * buckets unable to tie to its own sheet.
 */
export interface AmazonInSellerPnlFacts {
  month: string
  schemaVersion: 1
  /** Which weekly settlements contributed to this month. */
  settlementIds: string[]
  /** Slug → rupees, already signed: a charge is negative, a credit positive. */
  amounts: Record<string, number>
  /** Every amount in the month, summed. Ties to the deposits. */
  settlementTotal: number
  orders: number
  units: number
  /** Priced here, not by Amazon, from the order rows at the month's cost. */
  cogsPriced?: number
  cogsUnpriced?: number
  /** Advertising, which the settlement report does not carry. */
  ads?: number
}

/**
 * Amazon UAE's Product Profitability export, summed for a month.
 *
 * The same report as Amazon USA's, and deliberately not the same shape. The
 * US download resolves every one of its fee columns — referral fee, FBA
 * fulfilment, storage, aged inventory, advertising — and the UAE download of
 * September 2026 carries none of them: its headings came out as raw internal
 * keys (`skucentral-amz-fees-card-sales`), two columns arrived with no
 * heading at all, and the two named `SC_FBA_SER_per_unit` are empty in every
 * row.
 *
 * So there is no fee breakdown to store, and inventing one by apportioning
 * Amazon's bottom line across fee names would be writing figures Amazon never
 * stated. What the export does carry is reliable: units, sales, net sales,
 * and Amazon's own Net proceeds. Everything Amazon took is therefore one
 * figure — net sales less net proceeds — named as exactly that.
 *
 * When a download arrives with its fee columns intact, they are additive:
 * `feeTotalsAed` fills in and the statement gains the breakdown without any
 * of the figures below changing.
 */
export interface AmazonAePnlFacts {
  month: string
  schemaVersion: 1
  /** Dirhams, as the export states them. */
  grossSalesAed: number
  netSalesAed: number
  /** Amazon's own bottom line for the month, after everything it charged.
   * Carried rather than derived, so the statement can be checked against the
   * export instead of trusted. */
  netProceedsAed: number
  unitsSoldQty: number
  unitsReturnedQty: number
  netUnitsSoldQty: number
  /** Rows charged something while selling nothing — storage on stock that sat
   * there. Counted so the statement can say the month's fees are not only
   * about what sold. */
  nonSellingRows: number
  /** Cost of the goods, in rupees, priced from the Product Master at import.
   * Recomputed at the month's effective cost when order rows are on file. */
  cogsSourceInr?: number
  /**
   * Fee columns, once a download arrives carrying them, keyed as the Amazon
   * USA export keys them. Absent is the normal case today and means the
   * export had none — not that the month was free of fees.
   */
  feeTotalsAed?: Record<string, number>
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
  /**
   * The five US overhead lines — selling plan, liability insurance, FDA and
   * legal, agency software, other — are gone. They were a per-channel way of
   * entering fixed costs, always left at zero, and the company's fixed costs
   * are now entered once as a monthly total and allocated by sales share.
   * Keeping them would have offered two places to put the same cost, which is
   * how it ends up counted twice. Months stored with them simply ignore them.
   */
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
  /**
   * Orders billed in Gross Sales that were cancelled before anything shipped.
   *
   * On its own line rather than inside `salesReturnsInclGst` because a
   * cancellation is not a return: merging them would bury the cancellation rate
   * inside the return rate, and the two have different causes and different
   * fixes. Derived from the stored event type rather than from the file, which
   * writes no return amount against a cancelled row at all — which is exactly
   * how these came to be recognised as revenue.
   */
  cancellationsInclGst: number
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

// ---------------------------------------------------------------------------
// Blinkit
// ---------------------------------------------------------------------------
/**
 * One Blinkit payout cycle, as Blinkit's own Payout Breakup states it.
 *
 * Blinkit publishes the month as a folder of workbooks, and one of them — the
 * Payout Breakup — is the statement everything else explains. Its lettered
 * rows run A, B1–B5, C1–C4, D1–D5, E and then the net payout, and they add up
 * exactly: for August 2026, 6,430 less 128.60, 23.15, 1,500, 270, 5.45, 3,126
 * and 562.68 is the 814.12 Blinkit paid. The facts below are those rows, so
 * the statement this app draws can be checked line by line against the file it
 * came from.
 *
 * Every charge is held as a positive magnitude, as the other channels' facts
 * are, and the statement applies the signs. Storing Blinkit's own negatives
 * would mean a reader could never tell a charge that fell from a sign error.
 *
 * GST is kept on its own field beside each charge rather than folded in. It is
 * recoverable as input credit, so a statement that buries it reports a cost
 * the business does not ultimately bear.
 */
export interface BlinkitPnlFacts {
  schemaVersion: 1
  month: string // yyyy-mm

  /** A — what customers paid, inclusive of GST. The top line, and what every
   * charge below is taken out of. */
  customerPayable: number
  /** The GST inside `customerPayable`. Collected for the government, so it was
   * never revenue. */
  outputGstOnSales: number
  /** Σ MRP of the same lines. The gap to `customerPayable` is what Blinkit
   * discounted, which is a real cost of selling even though nobody invoices
   * it. */
  mrpValue: number
  unitsSold: number
  /** Order lines on the file, not distinct orders: Blinkit bills a line per
   * item, and counting them as orders would understate average order value. */
  orderLines: number

  /** B1–B5, the charges Blinkit raises against an order. */
  commission: number
  commissionGst: number
  shipping: number
  shippingGst: number
  customerReturnCharge: number
  customerReturnChargeGst: number
  tcs: number
  tds: number

  /** C1–C4, the charges for holding and moving stock in Blinkit's warehouses.
   * Each is net of the reversals and credit notes the file carries against it,
   * because that is what the Payout Breakup's Net Amount column states. */
  upfrontStorage: number
  upfrontStorageGst: number
  recallCharge: number
  recallChargeGst: number
  storageCharge: number
  storageChargeGst: number
  courierCharge: number
  courierChargeGst: number

  /** D1–D5, money coming back. Positive means in our favour. */
  adsRefund: number
  adsRefundGst: number
  lostDamagedCompensation: number
  tcsReimbursement: number
  tdsReimbursement: number
  otherCreditDebitNote: number

  /** E, a deduction with no category of its own. */
  otherDeductions: number

  /** What the file says Blinkit paid for the cycle. Held so the statement can
   * be checked against it rather than trusted. */
  netPayoutPerFile: number

  /**
   * The landing-price / selling-price adjustments the archive carries.
   *
   * A memo, not a line of the statement. These are credit and debit notes
   * against goods received in earlier months — the August file's run back to
   * December — and not one rupee of them appears in the Payout Breakup. They
   * are carried so the figure is visible and can be asked about, never summed
   * into revenue on an assumption about what they settle.
   */
  lpSpAdjustmentInclTax: number
  lpSpAdjustmentTax: number
  lpSpAdjustmentLines: number
}
