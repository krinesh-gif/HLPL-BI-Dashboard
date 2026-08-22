import type { ChannelId } from '@/config/channels'
import type {
  AmazonUsaPnlFacts,
  CanonicalSalesRecord,
  ChannelPnl,
  FixedExpenseEntry,
  FlipkartPnlFacts,
  MeeshoPnlFacts,
  SkuMaster,
} from '@/data/models'
import { allocateFixedExpensesForMonth } from './allocation'
import { buildChannelPnl, computeSubtotals, type MarketingByChannel } from './pnl'
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
  channel: ChannelId
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
  channel: ChannelId,
  month: string,
): number {
  const allocation = allocateFixedExpensesForMonth(allRecords, fixedExpenses, month)[channel] ?? {}
  return Object.values(allocation).reduce((sum, v) => sum + (v ?? 0), 0)
}

export interface ChannelPnlViewInputs {
  salesRecords: CanonicalSalesRecord[]
  skuMaster: SkuMaster[]
  fixedExpenses: FixedExpenseEntry[]
  marketing: MarketingByChannel
  facts: ChannelFactsStore
}

/**
 * Builds the P&L view for one channel/month. Flipkart, Amazon USA and Meesho
 * render their real native waterfall whenever facts exist for that month;
 * every channel (native or not) also gets the generic canonical bucket
 * structure so the Master P&L and Investor MIS can roll up consistently.
 */
export function buildChannelPnlView(channel: ChannelId, month: string, inputs: ChannelPnlViewInputs): ChannelPnlView {
  if (channel === 'flipkart') {
    const facts = inputs.facts.flipkartFacts.find((f) => f.month === month)
    if (facts) {
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
    const facts = inputs.facts.amazonUsaFacts.find((f) => f.month === month)
    if (facts) {
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
    const facts = inputs.facts.meeshoFacts.find((f) => f.month === month)
    if (facts) {
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
  const canonical = buildChannelPnl(inputs.salesRecords, inputs.skuMaster, inputs.fixedExpenses, channel, month, inputs.marketing)
  return { channel, month, canonical }
}

export function buildAllChannelPnlViews(channels: ChannelId[], month: string, inputs: ChannelPnlViewInputs): ChannelPnlView[] {
  return channels.map((c) => buildChannelPnlView(c, month, inputs))
}
