import type { AdsRecord } from '@/data/models'
import type { ChannelId } from '@/config/channels'
import { adsRecordKey } from './dedupKeys'
import { getField, headersPresent, type RowIssue } from './types'

/**
 * Amazon's monthly advertising cost report — every ad product, every month,
 * one file.
 *
 * The console's campaign reports come one per ad product: Sponsored Products,
 * then Sponsored Brands, then Sponsored Display, three downloads a month and
 * three chances to forget one. This export is the alternative the owner
 * asked for — a month per row group, the campaign, the ASIN it advertised and
 * what it cost — and it covers up to a year at a time, so six months of back
 * data is one upload rather than eighteen.
 *
 * It is also the more complete figure. September reads ₹2,12,876.11 here
 * across 51 campaigns, against ₹2,02,718.37 on 44 rows from the Sponsored
 * Products report alone: the ₹10,157.74 between them is the spend that report
 * never carried.
 *
 * Two things it does not carry, and both matter:
 *
 *  1. NO AD PRODUCT. There is a campaign id and no column saying whether it
 *     was Sponsored Products, Brands or Display, so the spend lands unsplit.
 *     The per-product reports are what that split comes from.
 *  2. NO IMPRESSIONS, CLICKS OR ATTRIBUTED SALES. The cost is all it states.
 *     The P&L wants exactly that — it is what the month cost — but ROAS,
 *     ACOS, CTR and CPC cannot be computed from it, and a month imported from
 *     here alone shows spend and nothing to divide by.
 *
 * THE YEAR. The Month column is a bare number — "9" — because the console
 * exports the last twelve months and expects you to know when you downloaded
 * it. The download date is in the file name (`Report_-_10_19_2026T...`), and
 * the year follows from it: a month at or before the download month is this
 * year, a later one is last year. Without that date nothing here can say
 * whether "9" is this September or the one before, so the reader says so
 * rather than guessing a year that would file a month twelve months out.
 */

const COLUMNS = {
  month: ['month'],
  account: ['advertiser account id'],
  campaign: ['campaign id'],
  asin: ['advertised product id'],
  marketplace: ['advertised product marketplace'],
  currency: ['budget currency'],
  cost: ['total cost'],
}

/** Which Amazon a row belongs to, from the marketplace the product is on. */
const CHANNEL_BY_MARKETPLACE: Record<string, ChannelId> = {
  AMAZON_IN: 'amazon_in_seller',
  AMAZON_US: 'amazon_us',
  AMAZON_AE: 'amazon_ae',
}

export function detectAmazonAdsSpendByMonth(headers: string[]): boolean {
  return (
    headersPresent(headers, COLUMNS.month) &&
    headersPresent(headers, COLUMNS.campaign) &&
    headersPresent(headers, COLUMNS.cost) &&
    headersPresent(headers, COLUMNS.marketplace)
  )
}

/**
 * `="236903289006813"` as `236903289006813`.
 *
 * The console armours long ids so a spreadsheet cannot turn them into
 * floating point. Stored with the armour on, a campaign id would be a
 * different id every time Amazon changed the quoting.
 */
export function unarmour(raw: string | undefined): string {
  return (raw ?? '').replace(/^="?|"?$/g, '').replace(/^"|"$/g, '').trim()
}

/**
 * When the report was downloaded, from the name the console gives it:
 * `Report_-_10_19_2026T11_32_08.csv` is 19 October 2026.
 */
export function reportDownloadDate(fileName: string | undefined): Date | null {
  const m = /(\d{1,2})[_-](\d{1,2})[_-](\d{4})/.exec(fileName ?? '')
  if (!m) return null
  const [month, day, year] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const d = new Date(year, month - 1, day)
  return d.getMonth() === month - 1 ? d : null
}

/**
 * The calendar month a bare month number means, given when the file was
 * downloaded. A month after the download month is last year's.
 */
export function monthKeyFor(monthNumber: number, downloadedOn: Date): string {
  const year = monthNumber <= downloadedOn.getMonth() + 1
    ? downloadedOn.getFullYear()
    : downloadedOn.getFullYear() - 1
  return `${year}-${String(monthNumber).padStart(2, '0')}`
}

export interface AmazonAdsSpendResult {
  adsRecords: AdsRecord[]
  /** The channel-months this file states in full, so the import can replace
   * them rather than add to what is already stored. */
  replaces: { channel: ChannelId; months: string[] }[]
  totalRows: number
  invalidRows: RowIssue[]
  warnings: string[]
}

function money(raw: string | undefined): number {
  if (!raw) return 0
  const n = Number(raw.replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

export function normalizeAmazonAdsSpendByMonth(
  rows: Record<string, string>[],
  importId: string,
  fileName?: string,
): AmazonAdsSpendResult {
  const invalidRows: RowIssue[] = []
  const warnings: string[] = []
  const downloadedOn = reportDownloadDate(fileName)

  if (!downloadedOn) {
    return {
      adsRecords: [],
      replaces: [],
      totalRows: rows.length,
      invalidRows: [],
      warnings: [
        'This report states a month number and no year, and the file name carries no download date to read it ' +
        'against — so there is no way to tell which year its months are. Upload it under the name the console ' +
        'gave it (Report_-_10_19_2026T11_32_08.csv), which is where the date is.',
      ],
    }
  }

  // Several rows can share a campaign, an ASIN and a month, and the dedup key
  // is exactly those: summed here, because a key that arrives twice is
  // dropped by the insert rather than added.
  const byKey = new Map<string, AdsRecord>()
  let zeroCost = 0

  rows.forEach((row, rowIndex) => {
    const monthNumber = Number(getField(row, COLUMNS.month))
    if (!Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) {
      return invalidRows.push({ rowIndex, reason: `"${getField(row, COLUMNS.month) ?? ''}" is not a month` })
    }
    const marketplace = (getField(row, COLUMNS.marketplace) ?? '').trim().toUpperCase()
    const channel = CHANNEL_BY_MARKETPLACE[marketplace]
    if (!channel) {
      return invalidRows.push({ rowIndex, reason: `${marketplace || '(no marketplace)'} is not an Amazon this app reports on` })
    }
    const campaign = unarmour(getField(row, COLUMNS.campaign))
    if (campaign === '') return invalidRows.push({ rowIndex, reason: 'Missing campaign id' })

    const spend = money(getField(row, COLUMNS.cost))
    if (spend === 0) zeroCost++

    const asin = unarmour(getField(row, COLUMNS.asin))
    const record: AdsRecord = {
      // The month, dated to its first day: the report states a month and no
      // day, and spreading one figure across the days of a month would invent
      // a shape the file does not have.
      date: `${monthKeyFor(monthNumber, downloadedOn)}-01`,
      channel,
      campaign,
      sku: asin === '' ? undefined : asin,
      asin: asin === '' ? undefined : asin,
      impressions: 0,
      clicks: 0,
      spend,
      adSales: 0,
      adOrders: 0,
      importId,
    }
    const key = adsRecordKey(record)
    const seen = byKey.get(key)
    if (seen) seen.spend += spend
    else byKey.set(key, record)
  })

  const adsRecords = [...byKey.values()]
  const byChannel = new Map<ChannelId, Set<string>>()
  for (const r of adsRecords) {
    const months = byChannel.get(r.channel) ?? new Set<string>()
    months.add(r.date.slice(0, 7))
    byChannel.set(r.channel, months)
  }
  const replaces = [...byChannel.entries()].map(([channel, months]) => ({
    channel,
    months: [...months].sort(),
  }))

  const months = [...new Set(adsRecords.map((r) => r.date.slice(0, 7)))].sort()
  if (months.length > 0) {
    const spend = adsRecords.reduce((sum, r) => sum + r.spend, 0)
    warnings.push(
      `Read as Amazon advertising for ${months.join(', ')} — ₹${spend.toFixed(2)} across ` +
      `${new Set(adsRecords.map((r) => r.campaign)).size} campaign(s). The month numbers in the file have no year; ` +
      `they are read against the ${downloadedOn.toISOString().slice(0, 10)} in the file name, so a month after ` +
      'October belongs to the year before.',
    )
    warnings.push(
      'Each of those months is replaced outright by this file, because this report states the whole month. ' +
      'Anything already stored for them from the per-product campaign reports is removed, including the ' +
      'impressions, clicks and attributed sales those carried — this report states cost only, so ROAS and ACOS ' +
      'cannot be worked out from it.',
    )
  }
  if (zeroCost > 0) {
    warnings.push(`${zeroCost} row(s) cost nothing — a campaign that advertised the ASIN without spending on it.`)
  }

  return { adsRecords, replaces, totalRows: rows.length, invalidRows, warnings }
}
