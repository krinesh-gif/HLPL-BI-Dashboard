/**
 * Translation between the database's snake_case rows and the app's camelCase
 * models (src/data/models.ts). Kept in one place so a column rename can't
 * silently drift out of sync across several routes.
 */
import type {
  AdsRecord,
  CanonicalSalesRecord,
  FixedExpenseEntry,
  ImportRecord,
  SkuMaster,
} from '../../src/data/models.js'
import type { ChannelId } from '../../src/config/channels.js'
import { normalizeCategory } from '../../src/data/categories.js'

type Row = Record<string, unknown>

const num = (v: unknown): number => Number(v ?? 0) || 0
const str = (v: unknown): string => String(v ?? '')
const optStr = (v: unknown): string | undefined => (v === null || v === undefined || v === '' ? undefined : String(v))

export function toSkuMaster(r: Row): SkuMaster {
  return {
    sku: str(r.sku),
    productName: str(r.product_name),
    category: normalizeCategory(r.category),
    subCategory: optStr(r.sub_category),
    brand: str(r.brand),
    cogs: num(r.cogs),
    mrp: num(r.mrp),
    launchDate: str(r.launch_date),
    status: str(r.status) as SkuMaster['status'],
    leadTimeDays: num(r.lead_time_days),
    safetyStock: num(r.safety_stock),
  }
}

/**
 * One row of the dashboard's sales dataset.
 *
 * `orderId`, `importId` and `raw` are deliberately not here. Nothing on any
 * screen reads them, and at 74,354 rows they were two of the widest columns on
 * the wire. They are still written on every line and still in the database,
 * where de-dup, the audit trail and reversing an import need them; they simply
 * do not travel to the browser.
 */
export function toSalesRecord(r: Row): CanonicalSalesRecord {
  return {
    isAggregate: r.is_aggregate === true,
    orderDate: str(r.order_date),
    channel: str(r.channel) as ChannelId,
    marketplace: str(r.marketplace),
    sellerType: str(r.seller_type) as CanonicalSalesRecord['sellerType'],
    sku: str(r.sku),
    productName: str(r.product_name),
    category: normalizeCategory(r.category),
    subCategory: optStr(r.sub_category),
    quantity: num(r.quantity),
    grossSales: num(r.gross_sales),
    discount: num(r.discount),
    netSales: num(r.net_sales),
    returnUnits: num(r.return_units),
    rtoUnits: num(r.rto_units),
    shippingCost: num(r.shipping_cost),
    marketplaceFee: num(r.marketplace_fee),
    tax: num(r.tax),
    status: str(r.status) as CanonicalSalesRecord['status'],
    currency: str(r.currency) as CanonicalSalesRecord['currency'],
    // How many order lines this row stands for. The dashboard reads rows
    // grouped by day, channel, SKU, status and currency, so the count has to
    // travel with them.
    orders: r.orders === undefined ? 1 : num(r.orders),
  }
}

export function toAdsRecord(r: Row): AdsRecord {
  return {
    date: str(r.date),
    channel: str(r.channel) as ChannelId,
    campaign: str(r.campaign),
    adGroup: optStr(r.ad_group),
    keyword: optStr(r.keyword),
    searchTerm: optStr(r.search_term),
    sku: optStr(r.sku),
    asin: optStr(r.asin),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    spend: num(r.spend),
    adSales: num(r.ad_sales),
    adOrders: num(r.ad_orders),
    importId: str(r.import_id),
  }
}

export function toImportRecord(r: Row): ImportRecord {
  return {
    id: str(r.id),
    fileName: str(r.file_name),
    channel: str(r.channel) as ChannelId,
    reportType: str(r.report_type),
    uploadedAt: r.uploaded_at instanceof Date ? r.uploaded_at.toISOString() : str(r.uploaded_at),
    recordCount: num(r.record_count),
    validRecordCount: num(r.valid_record_count),
    status: str(r.status) as ImportRecord['status'],
    warnings: Array.isArray(r.warnings) ? (r.warnings as string[]) : [],
  }
}


export function toFixedExpense(r: Row): FixedExpenseEntry {
  return {
    month: str(r.month),
    category: str(r.category) as FixedExpenseEntry['category'],
    amount: num(r.amount),
    note: optStr(r.note),
  }
}
