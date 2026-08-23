import type { ChannelId } from '@/config/channels'
import { CHANNELS } from '@/config/channels'
import { PNL_STRUCTURE, type PnlLineKey } from '@/config/pnlStructure'
import type { CanonicalSalesRecord, ChannelPnl, FixedExpenseEntry, PnlLineValues, PnlResult, SkuMaster } from '@/data/models'
import { filterByChannel, filterByMonth } from './sales'
import { orderBasisNetSales } from './netSales'
import { allocateFixedExpensesForMonth } from './allocation'

/** Marketing spend, keyed by channel, for a given month. Comes from Amazon Ads / other ad-platform imports. */
export type MarketingByChannel = Partial<Record<ChannelId, { ads: number; performanceMarketing?: number; otherMarketing?: number }>>

function cogsForRecords(records: CanonicalSalesRecord[], skuMaster: SkuMaster[]): number {
  const cogsBySku = new Map(skuMaster.map((s) => [s.sku, s.cogs]))
  return records.reduce((sum, r) => sum + (cogsBySku.get(r.sku) ?? 0) * r.quantity, 0)
}

/**
 * Builds one channel's P&L for one month from:
 *  - order-level sales facts (revenue, discounts, returns, marketplace fees, shipping)
 *  - the SKU master's centralized COGS
 *  - marketing spend supplied separately (ads import), never inferred from order data
 *  - this channel's share of fixed expenses for the month (sales-contribution allocation)
 *
 * Order-level data therefore only ever populates the revenue/COGS/marketplace-fee
 * lines — marketing and fixed-expense lines are always sourced independently,
 * so a re-import of order data can never silently overwrite them.
 */
export function buildChannelPnl(
  allRecords: CanonicalSalesRecord[],
  skuMaster: SkuMaster[],
  fixedExpenses: FixedExpenseEntry[],
  channel: ChannelId,
  month: string,
  marketing: MarketingByChannel,
): ChannelPnl {
  const records = filterByChannel(filterByMonth(allRecords, month), channel)
  // One Net Sales calculation for the whole app: the P&L's revenue lines are
  // the central engine's figure, not a second summation with its own rules
  // about cancellations and currency.
  const facts = orderBasisNetSales(records)
  const cogs = cogsForRecords(records, skuMaster)
  const channelMarketing = marketing[channel] ?? { ads: 0 }
  const allocation = allocateFixedExpensesForMonth(allRecords, fixedExpenses, month)
  const myAllocation = allocation[channel] ?? {}

  const lines: PnlLineValues = {
    grossSales: facts.grossSales,
    discounts: facts.discounts,
    returns: facts.returnsValue,
    otherRevenueAdj: 0,
    cogs,
    marketplaceCommission: facts.marketplaceFee,
    fulfilment: 0,
    shipping: facts.shippingCost,
    collectionFees: 0,
    rtoCharges: 0,
    returnCharges: 0,
    otherMarketplaceCharges: facts.tax,
    ads: channelMarketing.ads ?? 0,
    performanceMarketing: channelMarketing.performanceMarketing ?? 0,
    otherMarketing: channelMarketing.otherMarketing ?? 0,
    ...myAllocation,
  }

  return { channel, month, lines: computeSubtotals(lines) }
}

/** Fills in netSales / grossProfit / contributionProfit / ebitda and their margin %s from the input lines. */
export function computeSubtotals(input: PnlLineValues): PnlLineValues {
  const lines: PnlLineValues = { ...input }
  const get = (k: PnlLineKey) => lines[k] ?? 0

  const netSales =
    get('grossSales') - get('discounts') - get('returns') - get('otherRevenueAdj')
  lines.netSales = netSales

  const grossProfit = netSales - get('cogs')
  lines.grossProfit = grossProfit
  lines.grossMarginPct = netSales !== 0 ? (grossProfit / netSales) * 100 : 0

  const marketplaceVariableTotal =
    get('marketplaceCommission') +
    get('fulfilment') +
    get('shipping') +
    get('collectionFees') +
    get('rtoCharges') +
    get('returnCharges') +
    get('otherMarketplaceCharges')

  const marketingTotal = get('ads') + get('performanceMarketing') + get('otherMarketing')

  const contributionProfit = grossProfit - marketplaceVariableTotal - marketingTotal
  lines.contributionProfit = contributionProfit
  lines.contributionMarginPct = netSales !== 0 ? (contributionProfit / netSales) * 100 : 0

  const opexTotal =
    get('salaries') +
    get('rent') +
    get('software') +
    get('warehouse') +
    get('logistics') +
    get('professionalFees') +
    get('officeExpenses') +
    get('generalExpenses') +
    get('otherOpex')

  const ebitda = contributionProfit - opexTotal
  lines.ebitda = ebitda
  lines.ebitdaMarginPct = netSales !== 0 ? (ebitda / netSales) * 100 : 0

  return lines
}

/** Aggregates every channel's P&L for a month into the consolidated Master P&L (same line-by-line structure). */
export function buildMasterPnl(channelPnls: ChannelPnl[], month: string): PnlResult {
  const additiveKeys = PNL_STRUCTURE.filter((l) => l.kind === 'input').map((l) => l.key)
  const summed: PnlLineValues = {}
  for (const key of additiveKeys) {
    summed[key] = channelPnls.reduce((sum, p) => sum + (p.lines[key] ?? 0), 0)
  }
  return { month, lines: computeSubtotals(summed) }
}

export function buildAllChannelPnls(
  allRecords: CanonicalSalesRecord[],
  skuMaster: SkuMaster[],
  fixedExpenses: FixedExpenseEntry[],
  month: string,
  marketing: MarketingByChannel,
): ChannelPnl[] {
  return CHANNELS.map((c) => buildChannelPnl(allRecords, skuMaster, fixedExpenses, c.id, month, marketing))
}
