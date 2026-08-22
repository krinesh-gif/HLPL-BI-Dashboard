import type { ChannelId } from '@/config/channels'
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
  standardSellingPrice: number
  launchDate: string
  status: 'active' | 'inactive' | 'discontinued'
  leadTimeDays: number
  minimumStock: number
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
  channel: ChannelId
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
