import type { AdsRecord } from '@/data/models'
import type { ChannelId } from '@/config/channels'
import { NATIVE_PNL_ASSUMPTIONS } from '@/config/nativePnlAssumptions'
import { getField, headersPresent, type RowIssue } from './types'
import { toIsoDate } from '@/lib/format'
import { parseReportDate } from '@/lib/reportDate'

// Column names as they appear in the Amazon Ads console's "Campaign report"
// export. The console exports the same shape for each ad product and names
// the product in Program Type, so Sponsored Brands and Sponsored Display
// downloads read here too — their spend is as real as Sponsored Products' and
// a month that ran both is two lines, not one.
//
// "Portfolio name" is frequently used as the SKU code in single-SKU campaign
// setups; "Campaign Name" is the actual ad campaign. Retailer + Country
// determine which of the app's Amazon channels a row belongs to.
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
  /** Sponsored Products, Sponsored Brands, Sponsored Display. Named on every
   * row of the Sponsored Products export and on none of the Sponsored Brands
   * one, which is what `programOf` is for. */
  programType: ['program type', 'ad product', 'campaign type'],
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

/**
 * Columns only one ad product's report has, for the exports that name no
 * product at all.
 *
 * The Sponsored Products download states "Sponsored Products" in a Program
 * Type column on every row. The real Sponsored Brands export states nothing:
 * September's has Date, Portfolio name, Campaign Name, Cost type, Country and
 * then fifty columns of brand metrics — video quartile views, Brand Store
 * page views, new-to-brand orders — and not one that says which product
 * bought it. Read without this, a month of Sponsored Brands lands beside the
 * Sponsored Products spend as "not reported by product", which is the one
 * thing the file makes obvious.
 */
const PROGRAM_BY_COLUMN: { column: string; program: string }[] = [
  // A Brand Store is a Sponsored Brands placement; nothing else can send
  // traffic to one.
  { column: 'brand store page views', program: 'Sponsored Brands' },
  { column: 'video first quartile views', program: 'Sponsored Brands' },
  { column: '5 second views', program: 'Sponsored Brands' },
]

/**
 * Which ad product this export is, where it does not say.
 *
 * The row's own Program Type wins wherever Amazon writes one. Nothing is
 * inferred from a campaign's name — "SBV" in one tells a human what it is and
 * is a naming habit, not a fact about the file.
 */
function programOf(headers: string[], row: Record<string, string>): string | undefined {
  const stated = getField(row, COLUMNS.programType)
  if (stated) return stated
  const lower = headers.map((h) => h.trim().toLowerCase())
  return PROGRAM_BY_COLUMN.find((p) => lower.includes(p.column))?.program
}

export function detectAmazonAdsSponsoredProductsReport(headers: string[]): boolean {
  return (
    headersPresent(headers, COLUMNS.campaignName) &&
    headersPresent(headers, COLUMNS.spend) &&
    headersPresent(headers, COLUMNS.impressions) &&
    // Either column identifies this console's campaign report. Requiring the
    // portfolio alone turned away any export without one — and a Sponsored
    // Brands download that arrives unrecognised is a month of real spend
    // nobody notices is missing.
    (headersPresent(headers, COLUMNS.portfolioName) || headersPresent(headers, COLUMNS.programType))
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

export function normalizeAmazonAdsSponsoredProductsReport(
  rows: Record<string, string>[],
  importId: string,
): AdsReportNormalizeResult {
  // The columns this export carries, taken from the rows themselves: the
  // uploader keys every row by the header it parsed.
  const headers = Object.keys(rows[0] ?? {})
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
      // Kept as the console writes it. Normalising "Sponsored Brands" into a
      // code of our own would need a list of every name Amazon uses, and a
      // product missing from that list would read as having no program at
      // all rather than as the one it is.
      program: programOf(headers, row),
      sku,
      impressions: Number(getField(row, COLUMNS.impressions)) || 0,
      clicks: Number(getField(row, COLUMNS.clicks)) || 0,
      spend: parseMoney(getField(row, COLUMNS.spend)) * fxRate,
      adSales: parseMoney(getField(row, COLUMNS.sales)) * fxRate,
      adOrders: Number(getField(row, COLUMNS.orders)) || 0,
      importId,
    })
  })

  const spent = adsRecords.reduce((sum, r) => sum + r.spend, 0)
  if (adsRecords.length > 0 && spent === 0) {
    warnings.push(
      `Every row in this export spent nothing: ${adsRecords.length} row(s) across ` +
      `${new Set(adsRecords.map((r) => r.campaign)).size} campaign(s), ₹0 in total. The campaigns existed and did ` +
      'not deliver, so the month really did cost nothing — this is not a failed read.',
    )
  }

  const programs = new Set(adsRecords.map((r) => r.program).filter((p): p is string => p !== undefined))
  if (programs.size > 1) {
    warnings.push(
      `This export covers ${programs.size} ad products: ${[...programs].sort().join(', ')}. Each is on its own ` +
      'line in the P&L’s advertising and on the ads page, so the month shows what was spent on which.',
    )
  }

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
