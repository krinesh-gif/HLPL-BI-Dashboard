import type { AdsRecord, FlipkartGoogleAdsFacts, FlipkartGoogleAdsProduct } from '@/data/models'
import { getField, headersPresent, type NormalizeResult } from './types'

/**
 * Flipkart's Google Ads product performance report.
 *
 * The off-platform half of the channel's advertising — Flipkart buys Google
 * placements for the listings and bills it back on the P&L as `• Google Ads`,
 * separately from `• Ads`, which is the on-platform PLA spend. One row per
 * listing for the period:
 *
 * ```
 * PRODUCT_ITEM_ID,PRODUCT_TITLE,CLICKS,VIEWS,UNITS_SOLD,SALES,CTR,CVR,COST,CPC,ROAS
 * lstsnrhcknzpsfmcwpvvayvik,Aravi Organic Sunscreen …,1342,63268,17.0,6978.31,2.12,1.27,1682.38,1.25,4.15
 * ```
 *
 * Three things about this file decide how it is read.
 *
 * **It carries no date at all.** Not in a column, not in a line above the
 * header. The period is in the name Flipkart gives the download —
 * `product_performance_2026-09-01_to_2026-09-30_<id>.csv` — so that is read,
 * and a file renamed out of that shape asks for its month instead of being
 * filed under a guess.
 *
 * **A listing id is not unique in it.** September names five listings twice,
 * under two different titles each — `lstbwsh7fyyhzhjgz9c5dxjvn` is both
 * "D-tan Body Wash" and "2% Salicylic Acid Exfoliating Body Wash", the same
 * listing renamed mid-month. So rows are summed by id before anything else:
 * one ads record per id, because the dedup key is the id and the second row
 * would otherwise be dropped as a duplicate with its spend. That is exactly
 * how Blinkit's April advertising came to read ₹11 against ₹16.80.
 *
 * **It does not reconcile with what Flipkart bills.** September measures
 * ₹22,155.09 of cost against the ₹60,692.08 on the P&L — 2.74 times more
 * billed than measured, where the PLA report runs 1.18 times, near enough
 * exactly GST. So this is stored as a measurement beside the billed figure and
 * never as a replacement for it, and the upload says the two differ. Until
 * that is explained, the honest screen is both numbers and the gap.
 *
 * It also carries no SKU code — only Flipkart's listing id and the title — so
 * a product's Google spend cannot yet be set against the margin that product
 * earns. The PLA report does carry `Sku Id`, which is why that one maps.
 */

/** What the off-platform rows are called on the ads page, since the report
 * names no campaign of its own. */
export const GOOGLE_ADS_CAMPAIGN = 'Google Ads (off-platform)'

const COLUMNS = {
  productItemId: ['product_item_id'],
  productTitle: ['product_title'],
  clicks: ['clicks'],
  views: ['views'],
  units: ['units_sold'],
  sales: ['sales'],
  cost: ['cost'],
}

export function detectFlipkartGoogleAdsReport(headers: string[]): boolean {
  // `product_item_id` with a `cost` is this report and nothing else: Flipkart
  // is the one that calls an impression a view and a listing an item.
  return (
    headersPresent(headers, COLUMNS.productItemId) &&
    headersPresent(headers, COLUMNS.cost) &&
    headersPresent(headers, COLUMNS.views)
  )
}

function num(raw: string | undefined): number {
  if (raw === undefined) return 0
  const text = raw.replace(/[₹,\s]/g, '')
  if (text === '' || text === '-') return 0
  const n = Number(text)
  return Number.isFinite(n) ? n : 0
}

/**
 * The period out of the name Flipkart gives the download.
 *
 * `product_performance_2026-09-01_to_2026-09-30_461e66a6-….csv`. Only this
 * shape is accepted: there is no other date in the file, so a name that does
 * not carry one has to be said to carry none rather than resolved to a
 * plausible month.
 */
export function flipkartGoogleAdsPeriodFromName(fileName: string): { start: string; end: string } | null {
  const m = /(\d{4}-\d{2}-\d{2})_to_(\d{4}-\d{2}-\d{2})/.exec(fileName)
  if (!m) return null
  const [, start, end] = m
  if (end < start) return null
  return { start, end }
}

export interface FlipkartGoogleAdsNormalizeResult extends NormalizeResult {
  adsRecords: AdsRecord[]
  facts: FlipkartGoogleAdsFacts
  month: string
}

const inr = (v: number): string => `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** The last day of a month, to tell a whole month from part of one. */
function lastDayOfMonth(iso: string): string {
  const [y, m] = iso.split('-').map(Number)
  return `${iso.slice(0, 7)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
}

/** The whole of a month, for a download whose name no longer says otherwise. */
export function flipkartGoogleAdsWholeMonth(month: string): { start: string; end: string } {
  const start = `${month}-01`
  return { start, end: lastDayOfMonth(start) }
}

/**
 * `period` comes from the file name where it has one, and from the uploader
 * where it does not — in which case the month is all that is known and the
 * period is taken as the whole of it.
 */
export function normalizeFlipkartGoogleAdsReport(
  rows: Record<string, string>[],
  period: { start: string; end: string },
  importId: string,
): FlipkartGoogleAdsNormalizeResult {
  const invalidRows: NormalizeResult['invalidRows'] = []
  const warnings: string[] = []
  const month = period.start.slice(0, 7)

  // Summed by listing id first. One row per id afterwards, because the id is
  // what an ads record is keyed by and a renamed listing appears twice.
  const byId = new Map<string, FlipkartGoogleAdsProduct>()
  const titlesById = new Map<string, Set<string>>()
  let rowsRead = 0

  rows.forEach((row, rowIndex) => {
    const productItemId = (getField(row, COLUMNS.productItemId) ?? '').trim()
    if (productItemId === '') {
      invalidRows.push({ rowIndex, reason: 'Missing PRODUCT_ITEM_ID' })
      return
    }
    const productTitle = (getField(row, COLUMNS.productTitle) ?? '').trim()
    const clicks = num(getField(row, COLUMNS.clicks))
    const views = num(getField(row, COLUMNS.views))
    const units = num(getField(row, COLUMNS.units))
    const sales = num(getField(row, COLUMNS.sales))
    const cost = num(getField(row, COLUMNS.cost))
    rowsRead += 1

    const titles = titlesById.get(productItemId)
    if (titles) titles.add(productTitle)
    else titlesById.set(productItemId, new Set([productTitle]))

    const existing = byId.get(productItemId)
    if (existing) {
      existing.clicks += clicks
      existing.views += views
      existing.units += units
      existing.sales += sales
      existing.cost += cost
    } else {
      byId.set(productItemId, { productItemId, productTitle, clicks, views, units, sales, cost })
    }
  })

  const renamed: string[] = []
  for (const [id, titles] of titlesById) {
    const product = byId.get(id)
    if (!product || titles.size < 2) continue
    product.otherTitles = [...titles].filter((t) => t !== product.productTitle)
    renamed.push(id)
  }

  const products = [...byId.values()].sort((a, b) => b.cost - a.cost)
  const facts: FlipkartGoogleAdsFacts = {
    month, schemaVersion: 1,
    periodStart: period.start, periodEnd: period.end,
    cost: products.reduce((s, p) => s + p.cost, 0),
    clicks: products.reduce((s, p) => s + p.clicks, 0),
    views: products.reduce((s, p) => s + p.views, 0),
    units: products.reduce((s, p) => s + p.units, 0),
    sales: products.reduce((s, p) => s + p.sales, 0),
    products,
    rows: rowsRead,
    renamedListings: renamed.length,
  }

  const adsRecords: AdsRecord[] = products.map((p) => ({
    // The period's first day: the only date the file gives, and what puts the
    // row in its month.
    date: period.start,
    channel: 'flipkart',
    // A campaign name of its own, so these never merge with a PLA campaign's
    // rows and the two surfaces stay separable on the ads page.
    campaign: GOOGLE_ADS_CAMPAIGN,
    sku: p.productItemId,
    impressions: p.views,
    clicks: p.clicks,
    spend: p.cost,
    adSales: p.sales,
    adOrders: p.units,
    importId,
  }))

  warnings.push(
    `${inr(facts.cost)} of Google Ads cost across ${products.length} listing(s), for ${period.start} to ` +
    `${period.end}. Flipkart's P&L report states its own "Google Ads" line and the P&L charges that, so this file ` +
    'does not change what the month cost — it is the per-listing detail behind it, and a second measurement to ' +
    'hold it against.',
  )

  if (period.end.slice(0, 7) !== month) {
    warnings.push(
      `The period runs from ${period.start} to ${period.end}, which crosses a month end. No row carries a date of ` +
      `its own, so the whole report is filed under ${month} — download it one calendar month at a time.`,
    )
  } else if (period.start !== `${month}-01` || period.end !== lastDayOfMonth(period.start)) {
    warnings.push(
      `This is part of ${month}, not all of it: ${period.start} to ${period.end}. The spend here will read short ` +
      'against the P&L’s own Google Ads line for that reason alone.',
    )
  }

  if (renamed.length > 0) {
    warnings.push(
      `${renamed.length} listing(s) appear more than once under different titles — the same listing renamed during ` +
      'the period. Their rows are summed against the listing id, which is the identity; the title is not.',
    )
  }

  const noSale = products.filter((p) => p.cost > 0 && p.sales === 0)
  if (noSale.length > 0) {
    warnings.push(
      `${noSale.length} listing(s) returned no attributed sales at all, costing ` +
      `${inr(noSale.reduce((s, p) => s + p.cost, 0))}.`,
    )
  }

  // Worth saying on the upload rather than only on the page: a listing earning
  // less than it costs is money to stop spending this week.
  const underwater = products.filter((p) => p.cost > 0 && p.sales > 0 && p.sales < p.cost)
  if (underwater.length > 0) {
    warnings.push(
      `${underwater.length} listing(s) returned less than they cost. The worst is ` +
      `"${underwater[0].productTitle.slice(0, 60)}" at ${inr(underwater[0].cost)} for ${inr(underwater[0].sales)}.`,
    )
  }

  return { validRecords: [], totalRows: rows.length, invalidRows, warnings, adsRecords, facts, month }
}
