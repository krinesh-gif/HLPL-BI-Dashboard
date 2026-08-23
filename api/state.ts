import { sql } from './_lib/db'
import { requireSession } from './_lib/auth'
import { json } from './_lib/http'
import {
  toAdsRecord,
  toFixedExpense,
  toImportRecord,
  toInventorySnapshot,
  toSalesRecord,
  toSkuMaster,
} from './_lib/rows'

type Row = Record<string, unknown>

/**
 * Returns the whole shared dataset in the shape the client's data store
 * expects. One round trip on load keeps the client simple — every page then
 * reads from the same in-memory copy exactly as it did before the backend
 * existed.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = await requireSession(request)
  if (auth.response) return auth.response

  const [skuRows, salesRows, adsRows, importRows, inventoryRows, expenseRows, flipkart, amazonUsa, meesho] =
    await Promise.all([
      sql`SELECT * FROM sku_master ORDER BY sku`,
      sql`SELECT * FROM sales_records ORDER BY order_date`,
      sql`SELECT * FROM ads_records ORDER BY date`,
      sql`SELECT * FROM imports ORDER BY uploaded_at DESC`,
      sql`SELECT * FROM inventory_snapshots`,
      sql`SELECT * FROM fixed_expenses`,
      sql`SELECT data FROM flipkart_facts ORDER BY month`,
      sql`SELECT data FROM amazon_usa_facts ORDER BY month`,
      sql`SELECT data FROM meesho_facts ORDER BY month`,
    ])

  const salesRecords = (salesRows as Row[]).map(toSalesRecord)

  return json({
    // Nothing has been uploaded to the shared database yet, so every figure
    // downstream is a genuine zero rather than a real measurement.
    isEmpty: salesRecords.length === 0,
    skuMaster: (skuRows as Row[]).map(toSkuMaster),
    salesRecords,
    adsRecords: (adsRows as Row[]).map(toAdsRecord),
    imports: (importRows as Row[]).map(toImportRecord),
    inventorySnapshots: (inventoryRows as Row[]).map(toInventorySnapshot),
    fixedExpenses: (expenseRows as Row[]).map(toFixedExpense),
    flipkartFacts: (flipkart as Row[]).map((r) => r.data),
    amazonUsaFacts: (amazonUsa as Row[]).map((r) => r.data),
    meeshoFacts: (meesho as Row[]).map((r) => r.data),
  })
}
