import { createHandler } from './_lib/handler.js'
import { ensureSchema, sql } from './_lib/db.js'
import { meeshoFactsFromEvents } from './_lib/meeshoFacts.js'
import { requireSession } from './_lib/auth.js'
import { jsonCached } from './_lib/http.js'
import {
  toAdsRecord,
  toFixedExpense,
  toImportRecord,
  toSalesRecord,
  toSkuMaster,
} from './_lib/rows.js'

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

  // The one endpoint every session hits, so it is where a workspace created
  // before a column existed picks up the migration — without it, opening the
  // dashboard is what would fail. Memoized per warm instance, so this costs a
  // round trip once rather than on every load.
  await ensureSchema()

  const [skuRows, salesRows, adsRows, importRows, expenseRows, flipkart, amazonUsa, myntra, nykaa, amazonInSeller, blinkit, amazonAe, meesho, manualAds] =
    await Promise.all([
      sql`SELECT * FROM sku_master ORDER BY sku`,
      // Grouped, not raw. 74,354 order lines were 42 MB of JSON on every
      // load, and no screen reads an order line: every one of them sums by
      // day, channel, SKU or month first. Grouping on exactly the fields a
      // screen can discriminate by — and carrying the line count, so order
      // counts and average order values are unchanged — gives 16,300 rows and
      // 6 MB. Every figure is identical; `salesRollup.test.ts` is what proves
      // it. The lines themselves stay in the database untouched.
      sql`
        SELECT order_date, channel, marketplace, seller_type, sku, product_name,
               category, sub_category, status, currency,
               coalesce(is_aggregate, false) AS is_aggregate,
               count(*)                AS orders,
               sum(quantity)           AS quantity,
               sum(gross_sales)        AS gross_sales,
               sum(discount)           AS discount,
               sum(net_sales)          AS net_sales,
               sum(return_units)       AS return_units,
               sum(rto_units)          AS rto_units,
               sum(shipping_cost)      AS shipping_cost,
               sum(marketplace_fee)    AS marketplace_fee,
               sum(tax)                AS tax
        FROM sales_records
        GROUP BY order_date, channel, marketplace, seller_type, sku, product_name,
                 category, sub_category, status, currency, coalesce(is_aggregate, false)
        ORDER BY order_date
      `,
      sql`SELECT * FROM ads_records ORDER BY date`,
      sql`SELECT * FROM imports ORDER BY uploaded_at DESC`,
      sql`SELECT * FROM fixed_expenses`,
      sql`SELECT data FROM flipkart_facts ORDER BY month`,
      sql`SELECT data FROM amazon_usa_facts ORDER BY month`,
      sql`SELECT data FROM myntra_facts ORDER BY month`,
      sql`SELECT data FROM nykaa_facts ORDER BY month`,
      sql`SELECT data FROM amazon_in_seller_facts ORDER BY month`,
      sql`SELECT data FROM blinkit_facts ORDER BY month`,
      sql`SELECT data FROM amazon_ae_facts ORDER BY month`,
      meeshoFactsFromEvents(),
      sql`SELECT channel, month, amount, file_name, note, entered_at FROM manual_ad_spend ORDER BY month`,
    ])

  const salesRecords = (salesRows as Row[]).map(toSalesRecord)

  return jsonCached(request, {
    // Nothing has been uploaded to the shared database yet, so every figure
    // downstream is a genuine zero rather than a real measurement.
    isEmpty: salesRecords.length === 0,
    skuMaster: (skuRows as Row[]).map(toSkuMaster),
    salesRecords,
    adsRecords: (adsRows as Row[]).map(toAdsRecord),
    imports: (importRows as Row[]).map(toImportRecord),
    fixedExpenses: (expenseRows as Row[]).map(toFixedExpense),
    flipkartFacts: (flipkart as Row[]).map((r) => r.data),
    amazonUsaFacts: (amazonUsa as Row[]).map((r) => r.data),
    myntraFacts: (myntra as Row[]).map((r) => r.data),
    nykaaFacts: (nykaa as Row[]).map((r) => r.data),
    amazonInSellerFacts: (amazonInSeller as Row[]).map((r) => r.data),
    blinkitFacts: (blinkit as Row[]).map((r) => r.data),
    amazonAeFacts: (amazonAe as Row[]).map((r) => r.data),
    // Summed from the stored events, never from a pre-aggregated copy: the
    // same event arrives in several of Meesho's overlapping downloads.
    meeshoFacts: meesho,
    manualAdSpend: (manualAds as Row[]).map((r) => ({
      channel: String(r.channel),
      month: String(r.month),
      amount: Number(r.amount),
      fileName: r.file_name ? String(r.file_name) : undefined,
      note: r.note ? String(r.note) : undefined,
      enteredAt: r.entered_at ? new Date(String(r.entered_at)).toISOString() : new Date().toISOString(),
    })),
  })
}

export default createHandler({ GET })
