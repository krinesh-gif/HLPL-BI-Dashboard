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
  orders: ['7 day total orders', 'total orders'],
  sales: ['7 day total sales', 'total sales'],
}

export function detectAmazonAdsSponsoredProductsReport(headers: string[]): boolean {
  return (
    headersPresent(headers, COLUMNS.campaignName) &&
    headersPresent(headers, COLUMNS.spend) &&
    headersPresent(headers, COLUMNS.impressions) &&
    headersPresent(headers, COLUMNS.portfolioName)
  )
}

function parseMoney(raw: string | undefined): number {
  if (!raw) return 0
  const n = Number(raw.replace(/[$,]/g, ''))
  return Number.isFinite(n) ? n : 0
}

function resolveChannel(retailer: string | undefined, country: string | undefined): ChannelId | null {
  const r = (retailer ?? '').toLowerCase()
  const c = (country ?? '').toLowerCase()
  if (!r.includes('amazon')) return null
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
    const fxRate = channel === 'amazon_us' ? NATIVE_PNL_ASSUMPTIONS.usdToInrRate : 1

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
