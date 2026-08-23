import type { BusinessChannelId } from '@/config/channels'
import { BUSINESS_CHANNEL_IDS, channelLabel } from '@/config/channels'
import { normalizeCategory } from '@/data/categories'
import type { CanonicalSalesRecord } from '@/data/models'
import { toMonthKey } from '@/lib/format'
import {
  addFigures,
  asp,
  EMPTY_FIGURE,
  netSalesForChannelMonth,
  orderBasisNetSales,
  rtoPct,
  type ChannelFacts,
  type NetSalesFigure,
} from './netSales'

/**
 * Month-on-month ASP and RTO, at whatever level of detail is asked for.
 *
 * Both metrics are built on the one Net Sales engine, and both are computed by
 * the same code whether the level is the whole company, one channel, one
 * category or one SKU — so a channel's ASP and the company's ASP cannot be
 * defined differently.
 *
 *   ASP   = Net Sales / Units
 *   RTO % = RTO Units / Shipped Units
 */

export type MetricLevel = 'master' | 'channel' | 'category' | 'sku'

export interface MomRow {
  /** Identifier at this level: a channel id, a category name, a SKU, or 'ALL'. */
  key: string
  label: string

  current: NetSalesFigure
  previous: NetSalesFigure

  // --- ASP ---------------------------------------------------------------
  currentAsp: number | null
  previousAsp: number | null
  /** Rupee change in ASP. Null when either month has no units to divide by. */
  aspChange: number | null
  /** Percentage growth in ASP. */
  aspGrowthPct: number | null

  // --- RTO ---------------------------------------------------------------
  currentRtoPct: number | null
  previousRtoPct: number | null
  /**
   * Change in RTO expressed in PERCENTAGE POINTS: 8.2% to 6.7% is -1.5 points.
   * This is not the same quantity as rtoUnitGrowthPct below and the two must
   * never be shown as if they were — an RTO rate improving while volume grows
   * can still mean more parcels coming back.
   */
  rtoPointChange: number | null
  /** Growth in the NUMBER of RTO units, which is a different question again. */
  rtoUnitGrowthPct: number | null
  /** True when RTO got worse this month, for highlighting. */
  rtoDeteriorated: boolean
}

function growth(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null
  return ((current - previous) / Math.abs(previous)) * 100
}

function buildRow(key: string, label: string, current: NetSalesFigure, previous: NetSalesFigure): MomRow {
  const currentAsp = asp(current)
  const previousAsp = asp(previous)
  const currentRtoPct = rtoPct(current)
  const previousRtoPct = rtoPct(previous)

  const rtoPointChange =
    currentRtoPct !== null && previousRtoPct !== null ? currentRtoPct - previousRtoPct : null

  return {
    key,
    label,
    current,
    previous,
    currentAsp,
    previousAsp,
    aspChange: currentAsp !== null && previousAsp !== null ? currentAsp - previousAsp : null,
    aspGrowthPct: growth(currentAsp, previousAsp),
    currentRtoPct,
    previousRtoPct,
    rtoPointChange,
    rtoUnitGrowthPct: growth(current.rtoUnits, previous.rtoUnits),
    rtoDeteriorated: rtoPointChange !== null && rtoPointChange > 0,
  }
}

export interface MomInputs {
  records: CanonicalSalesRecord[]
  month: string
  previousMonth: string
  facts: ChannelFacts
  /** Management-level channels. Defaults to all of them. */
  channels?: BusinessChannelId[]
}

/** Company-wide, one row. */
export function masterMomRow(inputs: MomInputs): MomRow {
  const sum = (month: string) =>
    (inputs.channels ?? BUSINESS_CHANNEL_IDS)
      .map((channel) => netSalesForChannelMonth({ records: inputs.records, channel, month, facts: inputs.facts }))
      .reduce(addFigures, { ...EMPTY_FIGURE, sourceLabel: 'All channels' })

  return buildRow('ALL', 'All channels', sum(inputs.month), sum(inputs.previousMonth))
}

/** One row per channel that had activity in either month. */
export function channelMomRows(inputs: MomInputs): MomRow[] {
  return (inputs.channels ?? BUSINESS_CHANNEL_IDS)
    .map((channel) =>
      buildRow(
        channel,
        channelLabel(channel),
        netSalesForChannelMonth({ records: inputs.records, channel, month: inputs.month, facts: inputs.facts }),
        netSalesForChannelMonth({ records: inputs.records, channel, month: inputs.previousMonth, facts: inputs.facts }),
      ),
    )
    .filter((r) => r.current.units > 0 || r.previous.units > 0 || r.current.netSales !== 0)
}

/**
 * One row per category, and per SKU.
 *
 * These read order rows directly rather than going through the settlement
 * basis: a settlement report is a monthly total for a whole channel and cannot
 * be split by category or SKU. Using it here would mean attributing a
 * channel-level figure to individual products, which is the sort of quiet
 * cross-contamination the central engine exists to prevent.
 */
export function categoryMomRows(inputs: MomInputs): MomRow[] {
  return groupedRows(inputs, (r) => normalizeCategory(r.category), (key) => key)
}

export function skuMomRows(inputs: MomInputs, nameForSku?: (sku: string) => string): MomRow[] {
  return groupedRows(inputs, (r) => r.sku, (key) => nameForSku?.(key) ?? key)
}

function groupedRows(
  inputs: MomInputs,
  keyOf: (record: CanonicalSalesRecord) => string,
  labelOf: (key: string) => string,
): MomRow[] {
  const current = new Map<string, CanonicalSalesRecord[]>()
  const previous = new Map<string, CanonicalSalesRecord[]>()

  for (const r of inputs.records) {
    const month = toMonthKey(r.orderDate)
    const bucket = month === inputs.month ? current : month === inputs.previousMonth ? previous : null
    if (!bucket) continue
    const key = keyOf(r)
    const list = bucket.get(key)
    if (list) list.push(r)
    else bucket.set(key, [r])
  }

  const keys = new Set([...current.keys(), ...previous.keys()])
  return [...keys]
    .map((key) =>
      buildRow(key, labelOf(key), orderBasisNetSales(current.get(key) ?? []), orderBasisNetSales(previous.get(key) ?? [])),
    )
    .sort((a, b) => b.current.netSales - a.current.netSales)
}

// ---------------------------------------------------------------------------
// Trend series
// ---------------------------------------------------------------------------

export interface TrendPoint {
  month: string
  netSales: number
  units: number
  asp: number | null
  rtoPct: number | null
  rtoUnits: number
}

/** ASP and RTO over a run of months, for the trend charts. */
export function metricTrend(
  records: CanonicalSalesRecord[],
  months: string[],
  facts: ChannelFacts,
  channels: BusinessChannelId[] = BUSINESS_CHANNEL_IDS,
): TrendPoint[] {
  return months.map((month) => {
    const figure = channels
      .map((channel) => netSalesForChannelMonth({ records, channel, month, facts }))
      .reduce(addFigures, { ...EMPTY_FIGURE, sourceLabel: 'All channels' })
    return {
      month,
      netSales: figure.netSales,
      units: figure.units,
      asp: asp(figure),
      rtoPct: rtoPct(figure),
      rtoUnits: figure.rtoUnits,
    }
  })
}
