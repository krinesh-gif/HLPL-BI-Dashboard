import type { AdsChannelId } from '@/config/adsChannels'
import { adsChannelLabel, ADS_CHANNEL_IDS, ADS_CHANNEL_MAP } from '@/config/adsChannels'
import { channelOfSource } from '@/config/channels'
import type { AdsRecord, ManualAdSpend } from '@/data/models'
import { DEFAULT_FX_INR, type FxRatesInr } from '@/data/fxRates'
import { adsAmountInr } from './adsAmounts'
import { statementAdSpend } from './channelNetSales'
import type { ChannelFactsStore } from './channelFactsStore'
import { toMonthKey } from '@/lib/format'

/**
 * What a channel spent on advertising in a month, and where that figure came
 * from.
 *
 * Three sources can supply it and they must not be added together — that would
 * double-count a month where more than one exists.
 *
 * The channel's own statement wins. Where a marketplace bills advertising
 * inside the statement it settles on, that is the money it actually took, and
 * it is what the P&L charges: showing anything else here left two screens
 * reporting different advertising for the same month, which is how this was
 * found.
 *
 * An uploaded campaign report comes next. It is the platform's measurement of
 * what the campaigns did, and it is the only source of attributed sales,
 * impressions and clicks — so where a statement supplies the spend and a
 * report exists beside it, the report still supplies those, and its own spend
 * is kept as `reportedSpend` rather than thrown away. The two are cut
 * differently, the statement on the billing cycle and the report on campaign
 * dates, so they disagree month to month while agreeing over a period, and a
 * reader is owed both figures rather than one of them silently.
 *
 * A manual figure fills the gap where neither exists, which is the normal case
 * for a platform that bills by invoice.
 *
 * Whichever is used, the screen says so. A hand-entered number, a billed one
 * and a measured one deserve different confidence, and a reader who cannot
 * tell them apart will treat all three as measured.
 */

export type AdsSpendSource = 'statement' | 'report' | 'manual' | 'none'

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
   * The campaign report's own spend, where one was uploaded beside a statement
   * that disagrees with it. Null when there is no report, or when the report
   * is itself the source.
   *
   * ROAS and ACOS are measured against this rather than against the billed
   * spend: the attributed sales were measured beside this spend, and dividing
   * them by a figure cut on a different calendar states a return neither
   * source claims.
   */
  reportedSpend: number | null
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
  source: 'none', costOnly: false, sourceLabel: 'No data', reportedSpend: null,
})

/**
 * The authoritative ad spend for one channel and month.
 *
 * Priority: what the channel's statement billed, else an uploaded campaign
 * report, else a manual monthly value, else nothing.
 */
export function adsSpendFor(
  channel: AdsChannelId,
  month: string,
  adsRecords: AdsRecord[],
  manualEntries: ManualAdSpend[],
  /** The month's rates, for an account billed in dirhams or dollars. Every
   * figure here is rupees, as the rest of the app's are. */
  fx: FxRatesInr = DEFAULT_FX_INR,
  /** The statements, so a channel that bills advertising inside its own can
   * report what it was actually charged. Required rather than optional: a
   * caller that forgets it gets a figure the P&L disagrees with, silently,
   * which is the whole fault this parameter exists to fix. */
  facts: ChannelFactsStore = NO_STATEMENTS,
): AdsSpendFigure {
  const billed = statementAdSpend(channel, month, facts, fx)

  const reported = adsRecords.filter(
    (r) => channelOfSource(r.channel) === channel && toMonthKey(r.date) === month,
  )

  const fromReport = reported.length > 0 ? reportFigure() : null
  if (billed !== null) {
    return {
      ...(fromReport ?? EMPTY(channel, month)),
      spend: billed,
      // Only when the report has a different figure to offer; the same number
      // twice is noise.
      reportedSpend: fromReport && Math.abs(fromReport.spend - billed) >= 1 ? fromReport.spend : null,
      source: 'statement',
      sourceLabel: 'Charged in the statement',
    }
  }
  if (fromReport) return fromReport

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

  function reportFigure(): AdsSpendFigure {
    // Money is converted; impressions and clicks are counts and are not.
    const sum = (pick: (r: AdsRecord) => number) => reported.reduce((s, r) => s + pick(r), 0)
    const sumMoney = (pick: (r: AdsRecord) => number) =>
      reported.reduce((s, r) => s + adsAmountInr(pick(r), r.currency, fx), 0)
    // A metric the platform does not publish is null, not zero. Blinkit's
    // report carries no clicks column, and "0 clicks" beside 29 impressions
    // reads as a campaign nobody touched rather than one nobody counted.
    const omitted = new Set(ADS_CHANNEL_MAP[channel]?.reportOmits ?? [])
    const spend = sumMoney((r) => r.spend)
    const adSales = sumMoney((r) => r.adSales)
    const impressions = sum((r) => r.impressions)
    const clicks = sum((r) => r.clicks)
    // Spend and not one measured thing beside it: a cost report rather than a
    // campaign report. Judged on the month's rows rather than on which reader
    // wrote them, so it holds whatever the file was called.
    const costOnly = spend !== 0 && adSales === 0 && impressions === 0 && clicks === 0
    // A count that is zero on every row of a month is a column the file did
    // not carry, not a month nobody clicked on: Amazon's monthly report
    // states cost and attributed sales and no impressions at all, and "0
    // impressions" beside ₹2.1 lakh of spend reads as a campaign that never
    // served rather than as a figure this file never had. Money is left
    // alone — a report that measures sales and attributes none of them to
    // the month is saying something, and saying it as zero.
    const counted = (total: number) => (total === 0 ? null : total)
    return {
      channel, month,
      spend,
      adSales: costOnly ? null : adSales,
      adOrders: omitted.has('adOrders') || costOnly ? null : counted(sum((r) => r.adOrders)),
      impressions: costOnly ? null : counted(impressions),
      clicks: omitted.has('clicks') || costOnly ? null : counted(clicks),
      source: 'report',
      costOnly,
      sourceLabel: costOnly ? 'Monthly cost report' : 'Ads report',
      reportedSpend: null,
    }
  }
}

/** For a caller with no statements to hand. Every screen passes the real ones. */
const NO_STATEMENTS: ChannelFactsStore = { flipkartFacts: [], amazonUsaFacts: [], meeshoFacts: [] }

/**
 * The spend a figure's ROAS and ACOS are measured against.
 *
 * The campaign report's own, where the billed spend came from somewhere else:
 * the attributed sales were counted beside that spend and on that calendar.
 */
export function measuredSpendOf(f: AdsSpendFigure): number {
  return f.reportedSpend ?? f.spend
}

/** Return on ad spend, or null where nothing measured it. */
export function roasOf(f: AdsSpendFigure): number | null {
  const spend = measuredSpendOf(f)
  return f.adSales !== null && spend > 0 ? f.adSales / spend : null
}

/** Advertising cost of sale, as a percentage, or null where nothing measured it. */
export function acosOf(f: AdsSpendFigure): number | null {
  const spend = measuredSpendOf(f)
  return f.adSales !== null && f.adSales > 0 ? (spend / f.adSales) * 100 : null
}

/** Every ads channel's figure for a month, for the overview table. */
export function adsSpendForMonth(
  month: string,
  adsRecords: AdsRecord[],
  manualEntries: ManualAdSpend[],
  channels: AdsChannelId[] = ADS_CHANNEL_IDS,
  fx: FxRatesInr = DEFAULT_FX_INR,
  facts: ChannelFactsStore = NO_STATEMENTS,
): AdsSpendFigure[] {
  return channels.map((c) => adsSpendFor(c, month, adsRecords, manualEntries, fx, facts))
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
  fx: FxRatesInr = DEFAULT_FX_INR,
): AdsProgramSpend[] {
  const rows = adsRecords.filter(
    (r) => channelOfSource(r.channel) === channel && toMonthKey(r.date) === month,
  )
  const byProgram = new Map<string | null, { spend: number; adSales: number }>()
  for (const r of rows) {
    const key = r.program ?? null
    const entry = byProgram.get(key) ?? { spend: 0, adSales: 0 }
    entry.spend += adsAmountInr(r.spend, r.currency, fx)
    entry.adSales += adsAmountInr(r.adSales, r.currency, fx)
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
  /** True when a channel's billed spend differs from its campaign report's. */
  hasBilledDifference: boolean
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
    // True where any channel's billed spend differs from what its campaign
    // report measured, so the screen can say why the two do not divide out.
    hasBilledDifference: figures.some((f) => f.reportedSpend !== null),
    includesManual: figures.some((f) => f.source === 'manual'),
  }
}

function measuredSpend(figures: AdsSpendFigure[]): number {
  return figures.filter((f) => f.adSales !== null).reduce((s, f) => s + measuredSpendOf(f), 0)
}

/**
 * The share of a channel's sales the platform credits to its own
 * advertising. What is left is the organic share.
 *
 * BOTH SIDES HAVE TO BE THE SAME SALES, and the first version of this was
 * not: it divided attributed sales by *net* sales and reported Flipkart's
 * September as 111% paid, which is not a share of anything. A platform
 * attributes the order as the customer placed it — gross, before returns
 * and including GST — so the denominator is gross sales on that same basis.
 * The same month is 90.3% of ₹17,45,467 gross rather than 111.4% of
 * ₹14,14,973 net.
 *
 * Above 100% now means something is wrong rather than something expected,
 * so it is left showing rather than clamped: a platform crediting itself
 * with more than the channel sold is worth seeing, and a figure quietly
 * pinned at 100% would hide it.
 *
 * It is still attribution and not causation. A platform credits a sale when
 * the buyer saw or clicked an ad inside its attribution window, whether or
 * not the ad is why they bought — so this is the ceiling of what
 * advertising did, and the organic share below it is the floor.
 *
 * Null where the channel's report attributes no sales at all. Organic
 * cannot be inferred from an unmeasured channel: not knowing what
 * advertising did is not the same as knowing it did nothing.
 */
export function paidShare(adSales: number | null, grossSales: number): number | null {
  return adSales === null || grossSales <= 0 ? null : (adSales / grossSales) * 100
}

/** TACOS: total advertising spend as a share of the business's net sales. */
export function tacos(adSpend: number, netSales: number): number | null {
  return netSales > 0 ? (adSpend / netSales) * 100 : null
}

export { adsChannelLabel }
