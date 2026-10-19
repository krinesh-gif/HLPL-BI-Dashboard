import { createHandler } from './_lib/handler.js'
import { datasetEtag, ensureSchema, sql } from './_lib/db.js'
import { meeshoFactsFromEvents } from './_lib/meeshoFacts.js'
import { requireSession } from './_lib/auth.js'
import { jsonTagged, notModified } from './_lib/http.js'
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

  // Before the queries, not after. This endpoint reads the whole dataset —
  // roughly ten megabytes, eight of them grouped sales rows — and it used to
  // read all of it on every page load before discovering, from a hash of the
  // result, that it had nothing new to send. Four people opening the
  // dashboard a few times a day spent the database's monthly transfer
  // allowance in three weeks that way and took the dashboard offline.
  const etag = await datasetEtag()
  const unchanged = notModified(request, etag)
  if (unchanged) return unchanged

  const [skuRows, salesRows, adsRows, importRows, expenseRows, flipkart, amazonUsa, myntra, nykaa, amazonInSeller, blinkit, amazonAe, amazonInSkuFees, purplle, swiggy, myntraAds, flipkartAds, flipkartGoogleAds, amazonInVendor, meesho, manualAds, channelCharges] =
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
      // Grouped, like the sales rows above and for the same reason. 5,004
      // campaign rows were 1.9 MB on every load, and no screen reads a
      // campaign row: the Ads pages sum a channel's month, split it by ad
      // product, or compare months, and the P&L takes one figure per channel
      // per month. Grouping on exactly what those readings discriminate by —
      // channel, day, ad product and the currency it was billed in — gives
      // 201 rows and 30 kB with every figure identical. The day is kept
      // rather than the month alone because `r.date` is read in several
      // places and a month-only date would quietly change what they mean;
      // the extra 25 kB buys that safety. The rows themselves stay in the
      // database untouched.
      sql`
        SELECT date, channel, program, currency,
               ''                   AS campaign,
               sum(impressions)     AS impressions,
               sum(clicks)          AS clicks,
               sum(spend)           AS spend,
               sum(ad_sales)        AS ad_sales,
               sum(ad_orders)       AS ad_orders,
               min(import_id)       AS import_id
        FROM ads_records
        GROUP BY date, channel, program, currency
        ORDER BY date
      `,
      sql`SELECT * FROM imports ORDER BY uploaded_at DESC`,
      sql`SELECT * FROM fixed_expenses`,
      sql`SELECT data FROM flipkart_facts ORDER BY month`,
      sql`SELECT data FROM amazon_usa_facts ORDER BY month`,
      sql`SELECT data FROM myntra_facts ORDER BY month`,
      sql`SELECT data FROM nykaa_facts ORDER BY month`,
      sql`SELECT data FROM amazon_in_seller_facts ORDER BY month`,
      sql`SELECT data FROM blinkit_facts ORDER BY month`,
      sql`SELECT data FROM amazon_ae_facts ORDER BY month`,
      sql`SELECT data FROM amazon_in_sku_fee_facts ORDER BY month`,
      sql`SELECT data FROM purplle_facts ORDER BY month`,
      sql`SELECT data FROM swiggy_instamart_facts ORDER BY month`,
      sql`SELECT data FROM myntra_ads_facts ORDER BY month`,
      sql`SELECT data FROM flipkart_ads_facts ORDER BY month`,
      sql`SELECT data FROM flipkart_google_ads_facts ORDER BY month`,
      sql`SELECT data FROM amazon_in_vendor_facts ORDER BY month`,
      meeshoFactsFromEvents(),
      sql`SELECT channel, month, amount, file_name, note, entered_at FROM manual_ad_spend ORDER BY month`,
      sql`SELECT month, channel, label, amount, note, updated_at FROM channel_charges ORDER BY month, channel, label`,
    ])

  const salesRecords = (salesRows as Row[]).map(toSalesRecord)

  return jsonTagged({
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
    amazonInSkuFeeFacts: (amazonInSkuFees as Row[]).map((r) => r.data),
    purplleFacts: (purplle as Row[]).map((r) => r.data),
    swiggyInstamartFacts: (swiggy as Row[]).map((r) => r.data),
    myntraAdsFacts: (myntraAds as Row[]).map((r) => r.data),
    flipkartAdsFacts: (flipkartAds as Row[]).map((r) => r.data),
    flipkartGoogleAdsFacts: (flipkartGoogleAds as Row[]).map((r) => r.data),
    amazonInVendorFacts: (amazonInVendor as Row[]).map((r) => r.data),
    // Summed from the stored events, never from a pre-aggregated copy: the
    // same event arrives in several of Meesho's overlapping downloads.
    meeshoFacts: meesho,
    // Charged whole to their channel, never shared out — the P&L keeps them
    // apart from the fixed expenses for exactly that reason.
    channelCharges: (channelCharges as Row[]).map((r) => ({
      month: String(r.month),
      channel: String(r.channel),
      label: String(r.label),
      amount: Number(r.amount),
      note: r.note ? String(r.note) : undefined,
      updatedAt: r.updated_at ? new Date(String(r.updated_at)).toISOString() : undefined,
    })),
    manualAdSpend: (manualAds as Row[]).map((r) => ({
      channel: String(r.channel),
      month: String(r.month),
      amount: Number(r.amount),
      fileName: r.file_name ? String(r.file_name) : undefined,
      note: r.note ? String(r.note) : undefined,
      enteredAt: r.entered_at ? new Date(String(r.entered_at)).toISOString() : new Date().toISOString(),
    })),
  }, etag)
}

export default createHandler({ GET })
