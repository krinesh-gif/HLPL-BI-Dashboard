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
 * asked for — what each month cost across the whole account — and it covers
 * up to a year at a time, so six months of back data is one upload rather
 * than eighteen.
 *
 * It is also the more complete figure. September reads ₹2,12,876.10 here,
 * against ₹2,02,718.37 on 44 rows from the Sponsored Products report alone:
 * the ₹10,157.73 between them is the spend that report never carried.
 *
 * TWO SHAPES, both read here, because they are the same report at two
 * depths:
 *
 *  - A row per month: `Year`, `Month`, `Budget currency`, the advertiser
 *    account and `Total cost`. Six months is six rows. This is the one the
 *    owner settled on, and it states its own year.
 *  - A row per month, campaign and advertised ASIN, which the console
 *    exports with a `Advertised product marketplace` column and no year.
 *
 * Either way the month's figure is the same, and either way the month is
 * replaced outright on import rather than added to: both state the whole
 * month, so adding one to the other would count it twice.
 *
 * Two things neither shape carries, and both matter:
 *
 *  1. NO AD PRODUCT. There is no column saying whether the spend was
 *     Sponsored Products, Brands or Display, so it lands unsplit. The
 *     per-product reports are what that split comes from.
 *  2. NO IMPRESSIONS, CLICKS OR ATTRIBUTED SALES. The cost is all it states.
 *     The P&L wants exactly that — it is what the month cost — but ROAS,
 *     ACOS, CTR and CPC cannot be computed from it, and a month imported from
 *     here alone shows spend and nothing to divide by.
 *
 * THE YEAR. The month-per-row shape states it in its own column, which ends
 * the guessing. The campaign-level export does not: its Month column is a
 * bare number — "9" — because the console exports the last twelve months and
 * expects you to know when you downloaded it. The download date is in the
 * file name (`Report_-_10_19_2026T...`), and the year follows from it: a
 * month at or before the download month is this year, a later one is last
 * year. With neither a Year column nor that date, nothing here can say
 * whether "9" is this September or the one before, so the reader says so
 * rather than filing a month twelve months out.
 */

const COLUMNS = {
  year: ['year'],
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

/**
 * The same, from what the account is billed in, for the shape that states no
 * marketplace.
 *
 * An Amazon Ads account belongs to one marketplace group and is billed in
 * that marketplace's currency, so the currency names the store: the India
 * account bills in rupees and cannot bill in dirhams. It is weaker evidence
 * than the marketplace column and is only used where there is no such column
 * — and the account id is reported back, so which account was read is never
 * a matter of trust.
 */
const CHANNEL_BY_CURRENCY: Record<string, ChannelId> = {
  INR: 'amazon_in_seller',
  USD: 'amazon_us',
  AED: 'amazon_ae',
}

export function detectAmazonAdsSpendByMonth(headers: string[]): boolean {
  return (
    headersPresent(headers, COLUMNS.month) &&
    headersPresent(headers, COLUMNS.cost) &&
    (headersPresent(headers, COLUMNS.year) || headersPresent(headers, COLUMNS.marketplace))
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

/**
 * A year the file states, or null where it states none.
 *
 * Bounded, because a year is the one field here that cannot be checked
 * against anything else: a mis-parsed one files the month somewhere nobody
 * will look for it rather than failing.
 */
export function statedYear(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const year = Number(raw.trim())
  return Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : null
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
  const statesYear = rows.some((row) => statedYear(getField(row, COLUMNS.year)) !== null)

  if (!statesYear && !downloadedOn && rows.length > 0) {
    return {
      adsRecords: [],
      replaces: [],
      totalRows: rows.length,
      invalidRows: [],
      warnings: [
        'This report states a month number and no year, and the file name carries no download date to read it ' +
        'against — so there is no way to tell which year its months are. Either upload it with a Year column ' +
        'beside the Month one, or under the name the console gave it (Report_-_10_19_2026T11_32_08.csv), which ' +
        'is where the date is.',
      ],
    }
  }

  // Several rows can share a campaign, an ASIN and a month, and the dedup key
  // is exactly those: summed here, because a key that arrives twice is
  // dropped by the insert rather than added.
  const byKey = new Map<string, AdsRecord>()
  const accounts = new Set<string>()
  let zeroCost = 0
  let inferredYears = 0
  let campaignRows = 0

  rows.forEach((row, rowIndex) => {
    const monthNumber = Number(getField(row, COLUMNS.month))
    if (!Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) {
      return invalidRows.push({ rowIndex, reason: `"${getField(row, COLUMNS.month) ?? ''}" is not a month` })
    }

    // The row's own year where it has one; otherwise the one the download
    // date implies. A row with neither is left out rather than placed by
    // guesswork.
    const year = statedYear(getField(row, COLUMNS.year))
    let monthKey: string
    if (year !== null) {
      monthKey = `${year}-${String(monthNumber).padStart(2, '0')}`
    } else if (downloadedOn) {
      monthKey = monthKeyFor(monthNumber, downloadedOn)
      inferredYears++
    } else {
      return invalidRows.push({
        rowIndex,
        reason: `Month ${monthNumber} with no year, in a file whose other rows state one`,
      })
    }

    const marketplace = (getField(row, COLUMNS.marketplace) ?? '').trim().toUpperCase()
    const currency = (getField(row, COLUMNS.currency) ?? '').trim().toUpperCase()
    const channel = marketplace === ''
      ? CHANNEL_BY_CURRENCY[currency]
      : CHANNEL_BY_MARKETPLACE[marketplace]
    if (!channel) {
      return invalidRows.push({
        rowIndex,
        reason: marketplace !== ''
          ? `${marketplace} is not an Amazon this app reports on`
          : `No marketplace, and ${currency || '(no currency)'} does not say which Amazon this is`,
      })
    }

    const account = unarmour(getField(row, COLUMNS.account))
    // A campaign id where the file breaks the month down by campaign; the
    // account itself where it does not, because that is what the row is — the
    // whole account's cost for the month. Either way it has to be something
    // stable, since it is part of what identifies the row.
    const campaign = unarmour(getField(row, COLUMNS.campaign))
    if (campaign !== '') campaignRows++
    const subject = campaign !== '' ? campaign : account
    if (subject === '') {
      return invalidRows.push({ rowIndex, reason: 'Neither a campaign id nor an advertiser account to book it to' })
    }
    if (account !== '') accounts.add(account)

    const spend = money(getField(row, COLUMNS.cost))
    if (spend === 0) zeroCost++

    const asin = unarmour(getField(row, COLUMNS.asin))
    const record: AdsRecord = {
      // The month, dated to its first day: the report states a month and no
      // day, and spreading one figure across the days of a month would invent
      // a shape the file does not have.
      date: `${monthKey}-01`,
      channel,
      campaign: subject,
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
    const read = `Read as Amazon advertising for ${months.join(', ')} — ₹${spend.toFixed(2)}`
    warnings.push(campaignRows > 0
      ? `${read} across ${new Set(adsRecords.map((r) => r.campaign)).size} campaign(s).`
      : `${read} in all, one row per month: the whole account's cost on ` +
        `${accounts.size === 1 ? 'account' : 'accounts'} ${[...accounts].join(', ')}, with no campaign or ` +
        'ASIN split.')
    if (inferredYears > 0) {
      warnings.push(
        `${inferredYears} row(s) state a month with no year. They are read against the ` +
        `${downloadedOn?.toISOString().slice(0, 10)} in the file name, so a month after that one belongs to the ` +
        'year before.',
      )
    }
    warnings.push(
      'Each of those months is replaced outright by this file, because this report states the whole month. ' +
      'Anything already stored for them from the per-product campaign reports is removed, including the ' +
      'impressions, clicks and attributed sales those carried — this report states cost only, so ROAS and ACOS ' +
      'cannot be worked out from it.',
    )
  }
  if (zeroCost > 0) {
    warnings.push(`${zeroCost} row(s) cost nothing — a month or campaign that advertised without spending.`)
  }

  return { adsRecords, replaces, totalRows: rows.length, invalidRows, warnings }
}
