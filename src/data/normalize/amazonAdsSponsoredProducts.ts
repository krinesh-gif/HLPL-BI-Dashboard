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
  /**
   * The day the spend happened. The console exports it only when the report
   * is run with Time unit: Daily, and it is read in preference to everything
   * else because "Start date" means two different things in this export.
   *
   * In a monthly summary every row carries the report's own range — "May 01,
   * 2026" to "May 31, 2026" — and dating by it is right. But the Amazon USA
   * file on record carries each campaign's own launch date instead: 23
   * campaigns across seven different start dates, with ₹2.29 lakh sitting on
   * 30 June because two campaigns happened to launch that day. Dated that
   * way, a campaign that began in April keeps its whole year's spend in
   * April. `monthKeyOf` below tells the two apart and says so.
   */
  date: ['date', 'day'],
  startDate: ['start date'],
  endDate: ['end date'],
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
  const warnings: string[] = []
  // Where no day column was exported: every Start date the rows carry, and
  // the months they and their End dates fall in. One start date in one month
  // is a report range and can be trusted; anything else is campaign dates.
  const fallbackStarts = new Set<string>()
  const fallbackMonths = new Set<string>()

  rows.forEach((row, rowIndex) => {
    const campaign = getField(row, COLUMNS.campaignName)
    const dayRaw = getField(row, COLUMNS.date)
    const dateRaw = dayRaw ?? getField(row, COLUMNS.startDate)
    if (!campaign) return invalidRows.push({ rowIndex, reason: 'Missing Campaign Name' })
    if (!dateRaw) return invalidRows.push({ rowIndex, reason: 'Missing Date' })

    // Campaign Manager exports American dates, same as the seller reports.
    const startDate = parseReportDate(dateRaw, 'us')
    if (!startDate) return invalidRows.push({ rowIndex, reason: `Invalid date: "${dateRaw}"` })

    if (!dayRaw) {
      fallbackStarts.add(dateRaw.trim())
      fallbackMonths.add(toIsoDate(startDate).slice(0, 7))
      const end = parseReportDate(getField(row, COLUMNS.endDate), 'us')
      if (end) fallbackMonths.add(toIsoDate(end).slice(0, 7))
    }

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

  // A monthly summary dates every row with the report's own range, and that
  // is the month the spend belongs to. Several start dates means they are
  // campaign launch dates, and a range that crosses a month end cannot say
  // which month the spend fell in either way.
  if (fallbackStarts.size > 1) {
    warnings.push(
      `This export has no Date column and its ${fallbackStarts.size} rows carry ${fallbackStarts.size} different ` +
      'Start dates, so they are campaign launch dates rather than a reporting period. The spend is being dated by ' +
      'when each campaign began — a campaign started in June keeps its whole spend in June however long it ran, ' +
      'which puts it in the wrong month of the P&L. Run the Campaign report again with Time unit: Daily, one ' +
      'calendar month at a time, and re-upload.',
    )
  } else if (fallbackMonths.size > 1) {
    warnings.push(
      `This export covers ${[...fallbackMonths].sort().join(' and ')}, so its spend cannot be put in one month. ` +
      'Every row is dated by the start of the range. Run the Campaign report one calendar month at a time, or with ' +
      'Time unit: Daily, so each day\u2019s spend lands in its own month.',
    )
  }
  return { adsRecords, totalRows: rows.length, invalidRows, warnings }
}
