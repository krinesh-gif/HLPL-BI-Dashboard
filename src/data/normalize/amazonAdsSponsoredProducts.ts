import type { AdsRecord } from '@/data/models'
import type { ChannelId } from '@/config/channels'
import { NATIVE_PNL_ASSUMPTIONS } from '@/config/nativePnlAssumptions'
import { getField, headersPresent, type RowIssue } from './types'
import { toIsoDate } from '@/lib/format'
import { parseReportDate } from '@/lib/reportDate'

// Column names as they appear in the Amazon Ads console's Sponsored Products
// "Campaign report" export. "Portfolio name" is frequently used as the SKU
// code in single-SKU campaign setups; "Campaign Name" is the actual ad
// campaign. Retailer + Country determine which of the app's Amazon channels
// a row belongs to.
const COLUMNS = {
  startDate: ['start date'],
  campaignName: ['campaign name'],
  portfolioName: ['portfolio name'],
  retailer: ['retailer'],
  country: ['country'],
  impressions: ['impressions'],
  clicks: ['clicks'],
  spend: ['spend'],
  // The attribution window is a setting on the export, so the same report
  // comes back as 7-day from one download and 14-day from another. Both are
  // the same column for this purpose: what the console attributes to the ads.
  orders: ['7 day total orders', '14 day total orders', 'total orders'],
  sales: ['7 day total sales', '14 day total sales', 'total sales'],
  currency: ['currency'],
}

export function detectAmazonAdsSponsoredProductsReport(headers: string[]): boolean {
  return (
    headersPresent(headers, COLUMNS.campaignName) &&
    headersPresent(headers, COLUMNS.spend) &&
    headersPresent(headers, COLUMNS.impressions) &&
    headersPresent(headers, COLUMNS.portfolioName)
  )
}

/**
 * `$1596.1` from the US console, `₹1086.27` from the India one.
 *
 * Everything that is not a digit, a dot or a leading minus comes off, rather
 * than a list of symbols that has to be extended each time a new marketplace
 * is added — a symbol the list misses does not raise anything, it makes the
 * month's spend zero.
 */
function parseMoney(raw: string | undefined): number {
  if (!raw) return 0
  const n = Number(raw.replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/**
 * Which Amazon the rows belong to.
 *
 * The console does not always export a Retailer column — the India download
 * of September 2026 has Country and no Retailer — and this is only reached
 * once the headers have already identified the file as the Amazon Ads
 * campaign report. So a Retailer that is present still has to say Amazon, and
 * an absent one is not held against the row; the country decides.
 */
function resolveChannel(retailer: string | undefined, country: string | undefined): ChannelId | null {
  const r = (retailer ?? '').toLowerCase()
  const c = (country ?? '').toLowerCase()
  if (r !== '' && !r.includes('amazon')) return null
  if (c.includes('united states') || c.includes('usa') || c === 'us') return 'amazon_us'
  if (c.includes('india')) return 'amazon_in_seller'
  return null
}

export interface AdsReportNormalizeResult {
  adsRecords: AdsRecord[]
  totalRows: number
  invalidRows: RowIssue[]
  warnings: string[]
}

export function normalizeAmazonAdsSponsoredProductsReport(rows: Record<string, string>[], importId: string): AdsReportNormalizeResult {
  const adsRecords: AdsRecord[] = []
  const invalidRows: RowIssue[] = []

  rows.forEach((row, rowIndex) => {
    const campaign = getField(row, COLUMNS.campaignName)
    const startDateRaw = getField(row, COLUMNS.startDate)
    if (!campaign) return invalidRows.push({ rowIndex, reason: 'Missing Campaign Name' })
    if (!startDateRaw) return invalidRows.push({ rowIndex, reason: 'Missing Start Date' })

    // Campaign Manager exports American dates, same as the seller reports.
    const startDate = parseReportDate(startDateRaw, 'us')
    if (!startDate) return invalidRows.push({ rowIndex, reason: `Invalid date: "${startDateRaw}"` })

    const channel = resolveChannel(getField(row, COLUMNS.retailer), getField(row, COLUMNS.country))
    if (!channel) return invalidRows.push({ rowIndex, reason: 'Could not determine an Amazon channel from Retailer/Country' })

    const portfolioName = getField(row, COLUMNS.portfolioName)
    const sku = portfolioName && portfolioName.toLowerCase() !== 'no portfolio' ? portfolioName : undefined

    // The US console reports Spend/Sales in USD; every other figure in this
    // app (including this same page's India-channel rows) is in INR, so US
    // rows are converted at ingestion — the alternative is a ₹ symbol on a
    // USD number, silently understating real spend by ~95x.
    //
    // The channel decides, and the export's own Currency column can only call
    // the conversion off, never call for one. The two mistakes here are not
    // the same size: failing to convert a dollar figure understates a month,
    // while multiplying a rupee figure by the dollar rate overstates it
    // ninety-fold, so the rule is the one that cannot do the second.
    const currency = (getField(row, COLUMNS.currency) ?? '').toUpperCase()
    const fxRate = channel === 'amazon_us' && currency !== 'INR' ? NATIVE_PNL_ASSUMPTIONS.usdToInrRate : 1

    adsRecords.push({
      date: toIsoDate(startDate),
      channel,
      campaign,
      sku,
      impressions: Number(getField(row, COLUMNS.impressions)) || 0,
      clicks: Number(getField(row, COLUMNS.clicks)) || 0,
      spend: parseMoney(getField(row, COLUMNS.spend)) * fxRate,
      adSales: parseMoney(getField(row, COLUMNS.sales)) * fxRate,
      adOrders: Number(getField(row, COLUMNS.orders)) || 0,
      importId,
    })
  })

  return { adsRecords, totalRows: rows.length, invalidRows, warnings: [] }
}
