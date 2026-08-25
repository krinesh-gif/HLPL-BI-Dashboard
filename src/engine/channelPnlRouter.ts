import type { BusinessChannelId } from '@/config/channels'
import type { PnlBasis } from '@/data/models'
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
import { MEESHO_ASSUMPTIONS, NATIVE_PNL_ASSUMPTIONS } from '@/config/nativePnlAssumptions'
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
  /** Anything the reader needs to know to trust these numbers — currently only
   * raised when effective-dated costs could not be applied. Empty is the
   * normal case. */
  notes: string[]
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

/** How far the order rows' unit count may drift from the statement's dispatched
 * units before they are treated as describing different things. They come from
 * the same upload, so any real gap means one of them is stale. */
const UNIT_MATCH_TOLERANCE = 0.02

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

/**
 * Meesho's three COGS lines, recomputed at the month's effective cost.
 *
 * Meesho's statement splits cost of goods three ways — units actually sold,
 * the unsaleable part of RTO stock, and the unsaleable part of customer
 * returns — because a parcel that comes back is not the same cost as one that
 * stayed sold. Recomputing them as a single number would collapse that split
 * and report an RTO write-off of zero on a month that had 155 RTO units.
 *
 * Only the order basis is recomputed. Order rows are bucketed by order date,
 * so pairing them with a settlement month would price one month's cost using
 * a different month's orders. On settlement basis the imported figure stands.
 */
function recomputedMeeshoCogs(
  month: string,
  imported: MeeshoPnlFacts,
  inputs: ChannelPnlViewInputs,
): { unitsSold: number; rtoWriteOff: number; returnWriteOff: number } | { note: string } | null {
  if (!inputs.cogs?.costIndex) return null

  const records = inputs.salesRecords.filter(
    (r) => channelOfSource(r.channel) === 'meesho' && toMonthKey(r.orderDate) === month,
  )
  if (records.length === 0) return null

  // The order rows and the statement must describe the same month's trading.
  // One upload produces both, so they normally agree exactly; when they do
  // not, the rows are a different population and pricing the statement from
  // them would quietly report a cost for units it never sold. Better to keep
  // the imported figure and say the cost sheet did not reach this month.
  const rowUnits = records.reduce((n, r) => (r.status === 'cancelled' ? n : n + r.quantity), 0)
  const gap = Math.abs(rowUnits - imported.unitsDispatched)
  if (imported.unitsDispatched === 0 || gap > imported.unitsDispatched * UNIT_MATCH_TOLERANCE) {
    return {
      note:
        `Cost sheet not applied to this month: the ${Math.round(rowUnits).toLocaleString('en-IN')} unit(s) in Meesho order rows ` +
        `do not match the ${Math.round(imported.unitsDispatched).toLocaleString('en-IN')} unit(s) the statement reports as ` +
        `dispatched, so COGS is the figure from the uploaded file. Re-upload the aggregated payment workbook for this month ` +
        `to price it from the cost sheet.`,
    }
  }

  const bucket = (rows: CanonicalSalesRecord[]): number => {
    if (rows.length === 0) return 0
    const result = cogsForRecords(rows, inputs.skuMaster, month, inputs.cogs)
    return result.cogs + result.uncostedNetSales * UNPRICED_COGS_FALLBACK_PCT
  }

  return {
    unitsSold: bucket(records.filter((r) => r.status === 'completed' || r.status === 'pending')),
    rtoWriteOff: bucket(records.filter((r) => r.status === 'rto')) * (1 - MEESHO_ASSUMPTIONS.rtoSaleablePct),
    returnWriteOff:
      bucket(records.filter((r) => r.status === 'returned')) * (1 - MEESHO_ASSUMPTIONS.customerReturnSaleablePct),
  }
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
  /** Which calendar Meesho's months are cut on. Defaults to order basis. */
  meeshoBasis?: PnlBasis
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
        notes: [],
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
        notes: [],
      }
    }
  }

  if (channel === 'meesho') {
    const basis = inputs.meeshoBasis ?? 'order'
    // A month stored under the older, thinner shape is treated as absent
    // rather than rendered as if it were complete — a half-read P&L is worse
    // than an obviously missing one.
    const imported = inputs.facts.meeshoFacts.find(
      (f) => f.month === month && f.basis === basis && f.schemaVersion === 3,
    )
    if (imported) {
      // COGS is recomputed from order rows at the month's effective cost
      // where those rows exist, since the imported figure was priced at
      // whatever the Product Master held on upload day. The three-way split
      // is preserved, and only the order basis can be recomputed.
      const recomputed = basis === 'order' ? recomputedMeeshoCogs(month, imported, inputs) : null
      const facts =
        recomputed && !('note' in recomputed)
          ? {
              ...imported,
              cogsUnitsSold: recomputed.unitsSold,
              cogsRtoWriteOff: recomputed.rtoWriteOff,
              cogsReturnWriteOff: recomputed.returnWriteOff,
            }
          : imported
      const otherCosts = computeAllocatedOtherCosts(inputs.salesRecords, inputs.fixedExpenses, channel, month)
      const values = applyMeeshoOtherCosts(computeMeeshoPnl(facts), otherCosts)
      const canonicalLines = computeSubtotals(meeshoToCanonicalBuckets(facts))
      return {
        channel, month,
        canonical: { channel, month, lines: canonicalLines },
        native: { lineDefs: MEESHO_LINE_DEFS, values, currency: 'INR' },
        notes: recomputed && 'note' in recomputed ? [recomputed.note] : [],
      }
    }
  }

  // Every other channel (and these three before any real facts are uploaded)
  // falls back to the generic template built from order-level sales records.
  const canonical = buildChannelPnl(inputs.salesRecords, inputs.skuMaster, inputs.fixedExpenses, channel, month, inputs.marketing, inputs.cogs)
  return { channel, month, canonical, notes: [] }
}

export function buildAllChannelPnlViews(channels: BusinessChannelId[], month: string, inputs: ChannelPnlViewInputs): ChannelPnlView[] {
  return channels.map((c) => buildChannelPnlView(c, month, inputs))
}
