import type { AdsRecord } from '@/data/models'
import { getField, headersPresent, type NormalizeResult } from './types'

/**
 * Blinkit's campaign report.
 *
 * One row per campaign, per targeting value, per reporting date. The money
 * is in "Estimated Budget Consumed" — column R, and the only spend figure in
 * the file. Summed over the month it is what Blinkit advertising cost, and
 * it reaches the P&L the way every other platform's does: as ad records,
 * which `marketingFromAds` turns into the month's Advertising (MI).
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

function num(raw: string | undefined): number {
  if (!raw) return 0
  const n = Number(raw.replace(/[₹,\s]/g, ''))
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
export function blinkitAdsDate(raw: string | undefined): string | null {
  const text = (raw ?? '').trim()
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
}

export function normalizeBlinkitAdsReport(rows: Record<string, string>[], importId: string): BlinkitAdsResult {
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

  return { adsRecords, totalSpend, months, validRecords: [], totalRows: rows.length, invalidRows, warnings }
}
