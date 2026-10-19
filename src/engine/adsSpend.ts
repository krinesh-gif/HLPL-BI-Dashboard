import type { AdsChannelId } from '@/config/adsChannels'
import { adsChannelLabel, ADS_CHANNEL_IDS, ADS_CHANNEL_MAP } from '@/config/adsChannels'
import { channelOfSource } from '@/config/channels'
import type { AdsRecord, ManualAdSpend } from '@/data/models'
import { toMonthKey } from '@/lib/format'

/**
 * What a channel spent on advertising in a month, and where that figure came
 * from.
 *
 * Two sources can supply it and they must not be added together — that would
 * double-count a month where both exist. The uploaded report wins, because it
 * is the platform's own measurement and carries impressions, clicks and
 * attributed sales that a hand-entered total cannot. A manual figure fills the
 * gap where no report exists, which is the normal case for a platform that
 * bills by invoice.
 *
 * Whichever is used, the screen says so. A manually entered number and a
 * measured one deserve different confidence, and a reader who cannot tell them
 * apart will treat both as measured.
 */

export type AdsSpendSource = 'report' | 'manual' | 'none'

export interface AdsSpendFigure {
  channel: AdsChannelId
  month: string
  spend: number
  /** Attributed sales. Only a report can supply these, so a manual month has
   * null rather than zero — "not measured" is not the same as "nothing". */
  adSales: number | null
  adOrders: number | null
  impressions: number | null
  clicks: number | null
  source: AdsSpendSource
  /**
   * True where the month's report states what was spent and nothing else.
   *
   * Amazon's monthly cost report is this: every ad product's cost, and no
   * impressions, clicks or attributed sales. The spend is as real as any
   * other month's — the P&L wants exactly it — but ROAS, ACOS, CTR and CPC
   * have nothing to divide by, and a row of dashes with no explanation reads
   * as a reporting failure rather than as a choice about which file to
   * download.
   */
  costOnly: boolean
  /** Shown next to the figure, e.g. "Amazon Ads report" or "Entered manually". */
  sourceLabel: string
  /** The manual entry behind a manual figure, for its note and attachment. */
  manualEntry?: ManualAdSpend
}

const EMPTY = (channel: AdsChannelId, month: string): AdsSpendFigure => ({
  channel, month, spend: 0,
  adSales: null, adOrders: null, impressions: null, clicks: null,
  source: 'none', costOnly: false, sourceLabel: 'No data',
})

/**
 * The authoritative ad spend for one channel and month.
 *
 * Priority: an uploaded report, else a manual monthly value, else nothing.
 */
export function adsSpendFor(
  channel: AdsChannelId,
  month: string,
  adsRecords: AdsRecord[],
  manualEntries: ManualAdSpend[],
): AdsSpendFigure {
  const reported = adsRecords.filter(
    (r) => channelOfSource(r.channel) === channel && toMonthKey(r.date) === month,
  )

  if (reported.length > 0) {
    const sum = (pick: (r: AdsRecord) => number) => reported.reduce((s, r) => s + pick(r), 0)
    // A metric the platform does not publish is null, not zero. Blinkit's
    // report carries no clicks column, and "0 clicks" beside 29 impressions
    // reads as a campaign nobody touched rather than one nobody counted.
    const omitted = new Set(ADS_CHANNEL_MAP[channel]?.reportOmits ?? [])
    const spend = sum((r) => r.spend)
    const adSales = sum((r) => r.adSales)
    const impressions = sum((r) => r.impressions)
    const clicks = sum((r) => r.clicks)
    // Spend and not one measured thing beside it: a cost report rather than a
    // campaign report. Judged on the month's rows rather than on which reader
    // wrote them, so it holds whatever the file was called.
    const costOnly = spend !== 0 && adSales === 0 && impressions === 0 && clicks === 0
    return {
      channel, month,
      spend,
      adSales: costOnly ? null : adSales,
      adOrders: omitted.has('adOrders') || costOnly ? null : sum((r) => r.adOrders),
      impressions: costOnly ? null : impressions,
      clicks: omitted.has('clicks') || costOnly ? null : clicks,
      source: 'report',
      costOnly,
      sourceLabel: costOnly ? 'Monthly cost report' : 'Ads report',
    }
  }

  const manual = manualEntries.find((e) => e.channel === channel && e.month === month)
  if (manual) {
    return {
      ...EMPTY(channel, month),
      spend: manual.amount,
      source: 'manual',
      costOnly: true,
      sourceLabel: manual.fileName ? `Entered manually — ${manual.fileName}` : 'Entered manually',
      manualEntry: manual,
    }
  }

  return EMPTY(channel, month)
}

/** Every ads channel's figure for a month, for the overview table. */
export function adsSpendForMonth(
  month: string,
  adsRecords: AdsRecord[],
  manualEntries: ManualAdSpend[],
  channels: AdsChannelId[] = ADS_CHANNEL_IDS,
): AdsSpendFigure[] {
  return channels.map((c) => adsSpendFor(c, month, adsRecords, manualEntries))
}

/**
 * A month's spend broken out by ad product.
 *
 * Amazon runs Sponsored Products, Brands and Display as separate buys with
 * separate reports, and they answer different questions: Sponsored Products
 * defends a listing someone is already looking for, Sponsored Brands buys
 * reach. One figure for the month cannot say which was bought, so where the
 * rows carry a program this is the split.
 *
 * Rows with no program — every platform but Amazon — come back under one
 * entry with a null label, so a caller can tell "not reported by product"
 * from "reported as this product".
 */
export interface AdsProgramSpend {
  program: string | null
  spend: number
  adSales: number
  shareOfSpend: number
  roas: number | null
}

export function adsSpendByProgram(
  channel: AdsChannelId,
  month: string,
  adsRecords: AdsRecord[],
): AdsProgramSpend[] {
  const rows = adsRecords.filter(
    (r) => channelOfSource(r.channel) === channel && toMonthKey(r.date) === month,
  )
  const byProgram = new Map<string | null, { spend: number; adSales: number }>()
  for (const r of rows) {
    const key = r.program ?? null
    const entry = byProgram.get(key) ?? { spend: 0, adSales: 0 }
    entry.spend += r.spend
    entry.adSales += r.adSales
    byProgram.set(key, entry)
  }
  const total = [...byProgram.values()].reduce((sum, e) => sum + e.spend, 0)
  return [...byProgram.entries()]
    .map(([program, e]) => ({
      program,
      spend: e.spend,
      adSales: e.adSales,
      shareOfSpend: total > 0 ? (e.spend / total) * 100 : 0,
      roas: e.spend > 0 ? e.adSales / e.spend : null,
    }))
    .sort((a, b) => b.spend - a.spend)
}

export interface AdsTotals {
  spend: number
  /** Null when no channel in the period reported attributed sales, so ROAS and
   * ACOS are genuinely unknown rather than zero. */
  adSales: number | null
  roas: number | null
  acos: number | null
  /** True when any part of the total was entered by hand. */
  includesManual: boolean
}

export function totalAdsSpend(figures: AdsSpendFigure[]): AdsTotals {
  const spend = figures.reduce((s, f) => s + f.spend, 0)
  const measured = figures.filter((f) => f.adSales !== null)
  const adSales = measured.length > 0 ? measured.reduce((s, f) => s + (f.adSales ?? 0), 0) : null

  return {
    spend,
    adSales,
    // ROAS and ACOS are only meaningful against the spend that was actually
    // measured alongside those sales. Dividing total sales by total spend when
    // part of the spend is a manual figure with no attributed sales would
    // understate ROAS and overstate ACOS.
    roas: adSales !== null && measuredSpend(figures) > 0 ? adSales / measuredSpend(figures) : null,
    acos: adSales !== null && adSales > 0 ? (measuredSpend(figures) / adSales) * 100 : null,
    includesManual: figures.some((f) => f.source === 'manual'),
  }
}

function measuredSpend(figures: AdsSpendFigure[]): number {
  return figures.filter((f) => f.adSales !== null).reduce((s, f) => s + f.spend, 0)
}

/** TACOS: total advertising spend as a share of the business's net sales. */
export function tacos(adSpend: number, netSales: number): number | null {
  return netSales > 0 ? (adSpend / netSales) * 100 : null
}

export { adsChannelLabel }
