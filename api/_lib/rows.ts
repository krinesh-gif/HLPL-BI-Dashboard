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
  InventorySnapshot,
  SkuMaster,
} from '../../src/data/models.js'
import type { ChannelId } from '../../src/config/channels.js'

type Row = Record<string, unknown>

const num = (v: unknown): number => Number(v ?? 0) || 0
const str = (v: unknown): string => String(v ?? '')
const optStr = (v: unknown): string | undefined => (v === null || v === undefined || v === '' ? undefined : String(v))

export function toSkuMaster(r: Row): SkuMaster {
  return {
    sku: str(r.sku),
    productName: str(r.product_name),
    category: str(r.category),
    subCategory: optStr(r.sub_category),
    brand: str(r.brand),
    cogs: num(r.cogs),
    mrp: num(r.mrp),
    standardSellingPrice: num(r.standard_selling_price),
    launchDate: str(r.launch_date),
    status: str(r.status) as SkuMaster['status'],
    leadTimeDays: num(r.lead_time_days),
    minimumStock: num(r.minimum_stock),
    safetyStock: num(r.safety_stock),
  }
}

export function toSalesRecord(r: Row): CanonicalSalesRecord {
  return {
    orderId: str(r.order_id),
    orderDate: str(r.order_date),
    channel: str(r.channel) as ChannelId,
    marketplace: str(r.marketplace),
    sellerType: str(r.seller_type) as CanonicalSalesRecord['sellerType'],
    sku: str(r.sku),
    productName: str(r.product_name),
    category: str(r.category),
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
    raw: (r.raw as CanonicalSalesRecord['raw']) ?? undefined,
    importId: str(r.import_id),
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

export function toInventorySnapshot(r: Row): InventorySnapshot {
  return {
    sku: str(r.sku),
    asOfDate: str(r.as_of_date),
    currentStock: num(r.current_stock),
    inTransit: num(r.in_transit),
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
