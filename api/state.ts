import { createHandler } from './_lib/handler.js'
import { datasetEtag, ensureSchema, sql } from './_lib/db.js'
import { meeshoFactsFromEvents } from './_lib/meeshoFacts.js'
import { requireSession } from './_lib/auth.js'
import { jsonTagged, notModified } from './_lib/http.js'
import {
  toAdsRecord,
  toFixedExpense,
  toImportRecord,
  toSalesLabel,
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
/**
 * The grouped sales rows, by month or by day.
 *
 * One query text with one substitution, so the two grains cannot drift into
 * different groupings — which is the way a daily figure and a monthly one
 * start disagreeing. The product text is replaced by an id into the
 * dictionary selected beside it; it stays in the GROUP BY, because fifty-one
 * SKUs carry more than one spelling on a single channel and rejoining by SKU
 * would have picked one of them.
 */
function salesQuery(grain: 'month' | 'day'): string {
  const dateExpr = grain === 'day' ? 's.order_date' : `left(s.order_date, 7) || '-01'`
  return `
    WITH labels AS (
      SELECT row_number() OVER (ORDER BY product_name, category, sub_category, marketplace) AS label_id,
             product_name, category, sub_category, marketplace
      FROM (SELECT DISTINCT product_name, category, sub_category, marketplace FROM sales_records) d
    )
    SELECT ${dateExpr}        AS order_date,
           s.channel, s.seller_type, s.sku, s.status, s.currency,
           coalesce(s.is_aggregate, false) AS is_aggregate,
           l.label_id,
           count(*)                AS orders,
           sum(s.quantity)         AS quantity,
           sum(s.gross_sales)      AS gross_sales,
           sum(s.discount)         AS discount,
           sum(s.net_sales)        AS net_sales,
           sum(s.return_units)     AS return_units,
           sum(s.rto_units)        AS rto_units,
           sum(s.shipping_cost)    AS shipping_cost,
           sum(s.marketplace_fee)  AS marketplace_fee,
           sum(s.tax)              AS tax
      FROM sales_records s
      JOIN labels l
        ON l.product_name  IS NOT DISTINCT FROM s.product_name
       AND l.category      IS NOT DISTINCT FROM s.category
       AND l.sub_category  IS NOT DISTINCT FROM s.sub_category
       AND l.marketplace   IS NOT DISTINCT FROM s.marketplace
     GROUP BY 1, s.channel, s.seller_type, s.sku, s.status, s.currency,
              coalesce(s.is_aggregate, false), l.label_id
     ORDER BY 1
  `
}

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

  // Daily rows are asked for by the two screens that read a day — Daily Sales
  // and the settlement-lag cause on the Net Sales Reconciliation — and come
  // back on their own, without the rest of the dataset the caller already
  // holds.
  const grain: 'month' | 'day' =
    new URL(request.url).searchParams.get('grain') === 'daily' ? 'day' : 'month'

  if (grain === 'day') {
    const [dailyRows, dailyLabels] = await Promise.all([
      sql.query(salesQuery('day'), []),
      sql`
        SELECT row_number() OVER (ORDER BY product_name, category, sub_category, marketplace) AS label_id,
               product_name, category, sub_category, marketplace
        FROM (SELECT DISTINCT product_name, category, sub_category, marketplace FROM sales_records) d
      `,
    ])
    return jsonTagged({
      salesRecords: (dailyRows as Row[]).map(toSalesRecord),
      salesLabels: (dailyLabels as Row[]).map(toSalesLabel),
    }, etag)
  }

  const [skuRows, salesRows, labelRows, adsRows, importRows, expenseRows, flipkart, amazonUsa, myntra, nykaa, amazonInSeller, blinkit, amazonAe, amazonInSkuFees, purplle, swiggy, myntraAds, flipkartAds, flipkartGoogleAds, amazonInVendor, meesho, manualAds, channelCharges] =
    await Promise.all([
      sql`SELECT * FROM sku_master ORDER BY sku`,
      // Grouped, not raw, and by month unless a screen asks for the day.
      //
      // 74,354 order lines were 42 MB of JSON on every load; grouping by day
      // brought that to 20,357 rows and 7.8 MB. It was still the largest
      // thing the dashboard read, and the database bills what it sends — the
      // team's ordinary use spent a five-gigabyte monthly allowance in three
      // weeks. Only two screens read a day: Daily Sales, and the settlement-
      // lag cause on the Net Sales Reconciliation. Everything else sums by
      // month, channel, SKU or category first, so the month is what travels
      // and those two ask for `?grain=daily`.
      //
      // 3,496 rows and 888 kB, from 20,357 and 7.8 MB. Every figure is
      // identical and `salesRollup.test.ts` is what proves it. The order
      // lines themselves stay in the database untouched.
      sql.query(salesQuery('month'), []),
      sql`
        SELECT row_number() OVER (ORDER BY product_name, category, sub_category, marketplace) AS label_id,
               product_name, category, sub_category, marketplace
        FROM (SELECT DISTINCT product_name, category, sub_category, marketplace FROM sales_records) d
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
    // The product text the rows point at, sent once rather than on each of
    // them — see src/data/salesLabels.ts.
    salesLabels: (labelRows as Row[]).map(toSalesLabel),
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
