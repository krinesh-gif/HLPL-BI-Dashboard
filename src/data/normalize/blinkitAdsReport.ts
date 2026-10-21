import type { AdsRecord } from '@/data/models'
import type { ParsedSheet } from '@/lib/csvParse'
import { getField, headersPresent, type NormalizeResult } from './types'

/**
 * Blinkit's campaign report.
 *
 * One row per campaign, per targeting value, per reporting date. The money
 * is in "Estimated Budget Consumed" — the only spend figure in the file.
 * Summed it is what Blinkit advertising cost, and it reaches the P&L the way
 * every other platform's does: as ad records, which `marketingFromAds` turns
 * into the month's Advertising (MI).
 *
 * TWO SHEETS, AND BOTH ARE THE SPEND. The workbook separates the two things
 * Blinkit sells — Product Listing ads and Product Recommendation ads — onto
 * a sheet each, and each has its own Estimated Budget Consumed column. Only
 * the first sheet was read, so every month reported a fraction of what was
 * spent: April 2026 came to ₹16.80. The owner found it.
 *
 * Every sheet carrying that column is read now and the sheet's own name goes
 * on each row as its ad program. That is not decoration: the two sheets can
 * state the same campaign on the same date for the same targeting value, and
 * the program is part of what identifies an ad row — without it the second
 * sheet's row is a duplicate of the first's and is dropped on insert, which
 * would have left this half fixed. It also gives the spend-by-product split
 * the Ads pages already know how to show.
 *
 * Downloaded as `.xls` and actually a modern workbook, which the spreadsheet
 * reader already handles.
 *
 * What the report does not carry is as important as what it does. There is
 * no clicks column and no orders column — only impressions, add-to-carts and
 * quantities. Those are left out rather than filled with a zero that would
 * read as "nobody clicked"; `ADS_CHANNELS` records which metrics Blinkit
 * omits so the screens report them as unmeasured.
 *
 * Add-to-carts and quantities sold are not orders and are not stored as
 * them. A campaign that moved eleven units across an unknown number of
 * baskets has not told us how many orders it produced.
 */
const COLUMNS = {
  date: ['date'],
  campaignId: ['campaign id'],
  campaign: ['campaign name'],
  targetingValue: ['targeting value'],
  impressions: ['impressions'],
  /** Column R. The one figure in the file that is money. */
  spend: ['estimated budget consumed'],
  directSales: ['direct sales'],
  indirectSales: ['indirect sales'],
}

export function detectBlinkitAdsReport(headers: string[]): boolean {
  return (
    headersPresent(headers, COLUMNS.spend) &&
    headersPresent(headers, COLUMNS.campaign) &&
    headersPresent(headers, COLUMNS.impressions)
  )
}

/**
 * The sheets of the workbook that are campaign rows.
 *
 * By their columns rather than by their names, because the names are
 * Blinkit's to change and the columns are what the figures live in. A sheet
 * of notes or a pivot alongside them is left out.
 */
export function blinkitAdsSheets(sheets: ParsedSheet[]): ParsedSheet[] {
  return sheets.filter((s) => detectBlinkitAdsReport(s.headers))
}

function num(raw: unknown): number {
  if (raw === null || raw === undefined || raw === '') return 0
  const n = Number(String(raw).replace(/[₹,\s]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/**
 * The report writes `01-05-2026`, which is 1 May.
 *
 * Day first, as Blinkit's Indian reports are written throughout — the payout
 * archive's own cycle header reads `01-Apr-2026`. Read month-first this would
 * be 5 January and a month's spend would land in the wrong one, so anything
 * that is not unambiguously a date is rejected rather than guessed at.
 */
export function blinkitAdsDate(raw: unknown): string | null {
  const text = raw === null || raw === undefined ? '' : String(raw).trim()
  const dmy = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(text)
  if (dmy) {
    const [, d, m, y] = dmy
    if (Number(m) < 1 || Number(m) > 12 || Number(d) < 1 || Number(d) > 31) return null
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(text)
  return iso ? iso[1] : null
}

export interface BlinkitAdsResult extends NormalizeResult {
  adsRecords: AdsRecord[]
  /** Column R summed over every row read — what the month's advertising cost. */
  totalSpend: number
  /** The months the file covers. More than one is not an error; it is worth
   * saying, because the spend then lands in more than one P&L. */
  months: string[]
  /**
   * The channel-months this upload states in full, cleared before its rows
   * are inserted.
   *
   * A campaign report is the whole of the period it was downloaded for, so
   * re-uploading a month should restate it rather than add to it. Relying on
   * the row key alone was enough while the key never moved; adding the ad
   * program to it — which the two sheets need — changes what a row is, so
   * the rows already stored under the old key would have sat beside the new
   * ones and counted twice.
   */
  replaces: { channel: string; months: string[] }[]
}

export function normalizeBlinkitAdsReport(
  rows: Record<string, string>[],
  importId: string,
  /** Which of Blinkit's ad products these rows are — the sheet's own name.
   * Part of a row's identity, so the same campaign on the same day under two
   * products is two rows rather than one overwriting the other. */
  program?: string,
): BlinkitAdsResult {
  const adsRecords: AdsRecord[] = []
  const invalidRows: NormalizeResult['invalidRows'] = []
  const warnings: string[] = []
  let totalSpend = 0

  rows.forEach((row, rowIndex) => {
    const campaign = getField(row, COLUMNS.campaign)
    const rawDate = getField(row, COLUMNS.date)
    if (!campaign && !rawDate) return

    const date = blinkitAdsDate(rawDate)
    if (!date) {
      // A row whose date cannot be read would land its spend in whichever
      // month the rest of the file happened to be, so it is reported instead.
      invalidRows.push({ rowIndex, reason: `Unreadable Date: "${rawDate ?? ''}"` })
      return
    }

    const spend = num(getField(row, COLUMNS.spend))
    totalSpend += spend

    adsRecords.push({
      date,
      channel: 'blinkit',
      campaign: campaign || getField(row, COLUMNS.campaignId) || 'Blinkit campaign',
      keyword: getField(row, COLUMNS.targetingValue) || undefined,
      program,
      impressions: num(getField(row, COLUMNS.impressions)),
      // Blinkit publishes neither. Stored as zero because the record has
      // nowhere else to put them, and declared as omitted in `ADS_CHANNELS`
      // so no screen reports them as measured.
      clicks: 0,
      adOrders: 0,
      spend,
      adSales: num(getField(row, COLUMNS.directSales)) + num(getField(row, COLUMNS.indirectSales)),
      importId,
    })
  })

  const months = [...new Set(adsRecords.map((r) => r.date.slice(0, 7)))].sort()
  if (months.length > 1) {
    warnings.push(
      `This report covers ${months.length} months (${months.join(', ')}), so its spend is split across them rather ` +
      'than counted in one.',
    )
  }
  warnings.push(
    `₹${totalSpend.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} of Blinkit ` +
    'advertising, from the Estimated Budget Consumed column. Blinkit’s report carries no clicks or orders, so ' +
    'those are shown as unmeasured rather than zero.',
  )

  return {
    adsRecords, totalSpend, months, validRecords: [], totalRows: rows.length, invalidRows, warnings,
    replaces: replacesFor(months),
  }
}

/** Blinkit is one channel, so the months it covers are the whole scope. */
function replacesFor(months: string[]): { channel: string; months: string[] }[] {
  return months.length > 0 ? [{ channel: 'blinkit', months }] : []
}

const rupees = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * The whole workbook: every sheet of campaign rows, added together.
 *
 * This is what an upload goes through. Reading one sheet of a two-sheet
 * workbook does not fail or warn — it simply reports less money — so the
 * warning names each sheet and what it contributed, which is the only way a
 * reader can tell a sheet was missed.
 */
export function normalizeBlinkitAdsWorkbook(sheets: ParsedSheet[], importId: string): BlinkitAdsResult {
  const campaignSheets = blinkitAdsSheets(sheets)
  if (campaignSheets.length === 0) {
    return {
      adsRecords: [], totalSpend: 0, months: [], validRecords: [], totalRows: 0, invalidRows: [], replaces: [],
      warnings: ['No sheet in this workbook has an "Estimated Budget Consumed" column, so there is no spend to read.'],
    }
  }

  const parts = campaignSheets.map((sheet) => ({
    sheet,
    result: normalizeBlinkitAdsReport(sheet.rows, importId, sheet.sheetName),
  }))

  const adsRecords = parts.flatMap((p) => p.result.adsRecords)
  const totalSpend = parts.reduce((sum, p) => sum + p.result.totalSpend, 0)
  const totalRows = parts.reduce((sum, p) => sum + p.result.totalRows, 0)
  const invalidRows = parts.flatMap((p) => p.result.invalidRows)
  const months = [...new Set(adsRecords.map((r) => r.date.slice(0, 7)))].sort()

  const warnings: string[] = []
  if (months.length > 1) {
    warnings.push(
      `This report covers ${months.length} months (${months.join(', ')}), so its spend is split across them rather ` +
      'than counted in one.',
    )
  }
  warnings.push(
    `${rupees(totalSpend)} of Blinkit advertising, from the Estimated Budget Consumed column of ` +
    `${campaignSheets.length} sheet(s): ` +
    parts.map((p) => `${p.sheet.sheetName} ${rupees(p.result.totalSpend)}`).join(', ') +
    '. Blinkit’s report carries no clicks or orders, so those are shown as unmeasured rather than zero.',
  )
  const skipped = sheets.filter((s) => !campaignSheets.includes(s))
  if (skipped.length > 0) {
    warnings.push(
      `${skipped.length} other sheet(s) were left out, having no Estimated Budget Consumed column: ` +
      `${skipped.map((s) => s.sheetName).join(', ')}.`,
    )
  }
  if (months.length > 0) {
    warnings.push(
      `${months.join(', ')} is replaced outright by this file. A campaign report is the whole of the period it was ` +
      'downloaded for, so re-uploading a month restates it rather than adding to it.',
    )
  }

  return {
    adsRecords, totalSpend, months, validRecords: [], totalRows, invalidRows, warnings,
    replaces: replacesFor(months),
  }
}
