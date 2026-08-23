import type { BusinessChannelId } from '@/config/channels'
import type {
  AmazonUsaPnlFacts,
  CanonicalSalesRecord,
  ChannelPnl,
  FixedExpenseEntry,
  FlipkartPnlFacts,
  MeeshoPnlFacts,
  SkuMaster,
} from '@/data/models'
import { channelOfSource } from '@/config/channels'
import { NATIVE_PNL_ASSUMPTIONS } from '@/config/nativePnlAssumptions'
import { toMonthKey } from '@/lib/format'
import { allocateFixedExpensesForMonth } from './allocation'
import { buildChannelPnl, cogsForRecords, computeSubtotals, type CogsInputs, type MarketingByChannel } from './pnl'
import { amazonUsaToCanonicalBuckets, AMAZON_USA_LINE_DEFS, computeAmazonUsaPnl } from './nativePnl/amazonUsa'
import { applyFlipkartOtherCosts, computeFlipkartPnl, flipkartToCanonicalBuckets, FLIPKART_LINE_DEFS } from './nativePnl/flipkart'
import { applyMeeshoOtherCosts, computeMeeshoPnl, meeshoToCanonicalBuckets, MEESHO_LINE_DEFS } from './nativePnl/meesho'
import type { NativeLineDef, NativeLineValues } from './nativePnl/types'

export interface NativePnlView {
  lineDefs: NativeLineDef[]
  values: NativeLineValues
  currency: 'INR' | 'USD'
}

export interface ChannelPnlView {
  channel: BusinessChannelId
  month: string
  /** Always populated — the generic canonical bucket structure, used by Master P&L/MIS. */
  canonical: ChannelPnl
  /** Populated only when this channel has real native facts for this month. */
  native?: NativePnlView
}

export interface ChannelFactsStore {
  flipkartFacts: FlipkartPnlFacts[]
  amazonUsaFacts: AmazonUsaPnlFacts[]
  meeshoFacts: MeeshoPnlFacts[]
}

/** Sums this channel's allocated share (sales-contribution method) of the
 * month's fixed expenses into one lump figure, for channels whose native
 * template has a single "Other Costs" line rather than a category breakdown. */
function computeAllocatedOtherCosts(
  allRecords: CanonicalSalesRecord[],
  fixedExpenses: FixedExpenseEntry[],
  channel: BusinessChannelId,
  month: string,
): number {
  const allocation = allocateFixedExpensesForMonth(allRecords, fixedExpenses, month)[channel] ?? {}
  return Object.values(allocation).reduce((sum, v) => sum + (v ?? 0), 0)
}

/** Share of revenue charged as COGS for a SKU with no cost on file. Matches the
 * fallback the company's own model uses for its unpriced bucket. */
const UNPRICED_COGS_FALLBACK_PCT = 0.25

/**
 * COGS for a channel-month, recomputed from order rows at the cost that applied
 * in that month.
 *
 * Native facts carry a `cogs` figure, but a marketplace does not know what a
 * product costs us — that number was computed by the importer from whatever was
 * in the Product Master on the day the file was uploaded, and then frozen into
 * the facts blob. Left alone it makes effective-dated costs a no-op on exactly
 * the channels that have settlement files, and it prices a month at an
 * arbitrary date rather than at that month's cost.
 *
 * Returns null when there are no order rows to recompute from, in which case
 * the imported figure is the only number available and is kept.
 */
function recomputedCogs(
  channel: BusinessChannelId,
  month: string,
  inputs: ChannelPnlViewInputs,
): { priced: number; unpriced: number; total: number } | null {
  if (!inputs.cogs?.costIndex) return null

  const records = inputs.salesRecords.filter(
    (r) => channelOfSource(r.channel) === channel && toMonthKey(r.orderDate) === month,
  )
  if (records.length === 0) return null

  const result = cogsForRecords(records, inputs.skuMaster, month, inputs.cogs)
  const unpriced = result.uncostedNetSales * UNPRICED_COGS_FALLBACK_PCT
  return { priced: result.cogs, unpriced, total: result.cogs + unpriced }
}

export interface ChannelPnlViewInputs {
  salesRecords: CanonicalSalesRecord[]
  skuMaster: SkuMaster[]
  fixedExpenses: FixedExpenseEntry[]
  marketing: MarketingByChannel
  facts: ChannelFactsStore
  /** Effective-dated costs and combo recipes. Optional so a caller with
   * neither still gets a P&L, costed from the Product Master as before. */
  cogs?: CogsInputs
}

/**
 * Builds the P&L view for one channel/month. Flipkart, Amazon USA and Meesho
 * render their real native waterfall whenever facts exist for that month;
 * every channel (native or not) also gets the generic canonical bucket
 * structure so the Master P&L and Investor MIS can roll up consistently.
 */
export function buildChannelPnlView(channel: BusinessChannelId, month: string, inputs: ChannelPnlViewInputs): ChannelPnlView {
  if (channel === 'flipkart') {
    const imported = inputs.facts.flipkartFacts.find((f) => f.month === month)
    if (imported) {
      const recomputed = recomputedCogs(channel, month, inputs)
      const facts = recomputed
        ? { ...imported, cogsPriced: recomputed.priced, cogsUnpriced: recomputed.unpriced }
        : imported
      const otherCosts = computeAllocatedOtherCosts(inputs.salesRecords, inputs.fixedExpenses, channel, month)
      const values = applyFlipkartOtherCosts(computeFlipkartPnl(facts), otherCosts)
      const canonicalLines = computeSubtotals(flipkartToCanonicalBuckets(facts))
      return {
        channel, month,
        canonical: { channel, month, lines: canonicalLines },
        native: { lineDefs: FLIPKART_LINE_DEFS, values, currency: 'INR' },
      }
    }
  }

  if (channel === 'amazon_us') {
    const imported = inputs.facts.amazonUsaFacts.find((f) => f.month === month)
    if (imported) {
      const recomputed = recomputedCogs(channel, month, inputs)
      const facts = recomputed
        ? { ...imported, cogsUsd: recomputed.total / NATIVE_PNL_ASSUMPTIONS.usdToInrRate }
        : imported
      const values = computeAmazonUsaPnl(facts)
      const canonicalLines = computeSubtotals(amazonUsaToCanonicalBuckets(facts))
      return {
        channel, month,
        canonical: { channel, month, lines: canonicalLines },
        native: { lineDefs: AMAZON_USA_LINE_DEFS, values, currency: 'USD' },
      }
    }
  }

  if (channel === 'meesho') {
    const imported = inputs.facts.meeshoFacts.find((f) => f.month === month)
    if (imported) {
      const recomputed = recomputedCogs(channel, month, inputs)
      const facts = recomputed ? { ...imported, cogs: recomputed.total } : imported
      const otherCosts = computeAllocatedOtherCosts(inputs.salesRecords, inputs.fixedExpenses, channel, month)
      const values = applyMeeshoOtherCosts(computeMeeshoPnl(facts), otherCosts)
      const canonicalLines = computeSubtotals(meeshoToCanonicalBuckets(facts))
      return {
        channel, month,
        canonical: { channel, month, lines: canonicalLines },
        native: { lineDefs: MEESHO_LINE_DEFS, values, currency: 'INR' },
      }
    }
  }

  // Every other channel (and these three before any real facts are uploaded)
  // falls back to the generic template built from order-level sales records.
  const canonical = buildChannelPnl(inputs.salesRecords, inputs.skuMaster, inputs.fixedExpenses, channel, month, inputs.marketing, inputs.cogs)
  return { channel, month, canonical }
}

export function buildAllChannelPnlViews(channels: BusinessChannelId[], month: string, inputs: ChannelPnlViewInputs): ChannelPnlView[] {
  return channels.map((c) => buildChannelPnlView(c, month, inputs))
}
