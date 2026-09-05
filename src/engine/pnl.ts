import type { BusinessChannelId } from '@/config/channels'
import { BUSINESS_CHANNEL_IDS, channelOfSource } from '@/config/channels'
import { PNL_STRUCTURE, type PnlLineKey } from '@/config/pnlStructure'
import type { CanonicalSalesRecord, ChannelPnl, FixedExpenseEntry, PnlLineValues, PnlResult, SkuMaster } from '@/data/models'
import { cogsForMonth, type CostVersionsBySku } from '@/data/costVersions'
import { resolveCogs, type ComboComponent, type SkuMapping } from '@/data/skuMapping'
import { filterByMonth } from './sales'
import { orderBasisNetSales } from './netSales'
import { allocateFixedExpensesForMonth } from './allocation'

/** Marketing spend, keyed by channel, for a given month. Comes from Amazon Ads / other ad-platform imports. */
export type MarketingByChannel = Partial<Record<BusinessChannelId, { ads: number; performanceMarketing?: number; otherMarketing?: number }>>

/**
 * Optional inputs that make COGS accurate. Both are optional so a caller that
 * has neither still gets a P&L — it is just costed from the Product Master's
 * current figures, which is what the app did before either existed.
 */
export interface CogsInputs {
  /** Effective-dated costs, so a closed month keeps the cost that applied then. */
  costIndex?: CostVersionsBySku
  /** Marketplace-code mappings and combo recipes, so a bundle is costed from
   * its components rather than falling through as unknown. */
  mappings?: SkuMapping[]
  comboComponents?: ComboComponent[]
}

export interface CogsResult {
  cogs: number
  /** Units that were priced from a real cost. Needed to state what a costed
   * unit averaged this month, which is the basis for estimating the rest. */
  costedUnits: number
  /** Units whose cost could not be established at all. Reported rather than
   * folded in as zero, which would show them at 100% margin. */
  uncostedUnits: number
  uncostedSkus: string[]
  /** Net sales of the rows that could not be costed, so a caller can apply a
   * percentage-of-revenue fallback to them and to nothing else. */
  uncostedNetSales: number
}

/**
 * The COGS of a set of order rows, priced at the cost that applied in `month`.
 *
 * This is what keeps history still. July's P&L asks for July's cost and gets
 * it, no matter how many times the cost has changed since — so re-opening a
 * closed month shows the same margin it showed when it was closed.
 */
export function cogsForRecords(
  records: CanonicalSalesRecord[],
  skuMaster: SkuMaster[],
  month: string,
  inputs: CogsInputs = {},
): CogsResult {
  const costFor = (sku: string): number | undefined => {
    if (inputs.costIndex) {
      const versioned = cogsForMonth(sku, month, inputs.costIndex)
      if (versioned !== null) return versioned
    }
    return undefined
  }

  const masterCost = new Map(skuMaster.map((s) => [s.sku, s.cogs]))
  const tables = {
    skuMaster,
    mappings: inputs.mappings ?? [],
    comboComponents: inputs.comboComponents ?? [],
    costFor,
  }

  // Resolution is per SKU, not per row: a channel with tens of thousands of
  // order lines has only a few hundred distinct codes.
  const unitCost = new Map<string, number | null>()
  const resolve = (sku: string): number | null => {
    const cached = unitCost.get(sku)
    if (cached !== undefined) return cached

    let value = costFor(sku) ?? null
    if (value === null) {
      const resolved = resolveCogs(sku, tables)
      value = resolved ? resolved.cogs : (masterCost.get(sku) ?? null)
    }
    unitCost.set(sku, value)
    return value
  }

  let cogs = 0
  let costedUnits = 0
  let uncostedUnits = 0
  let uncostedNetSales = 0
  const uncostedSkus = new Set<string>()

  for (const r of records) {
    if (r.status === 'cancelled') continue
    const unit = resolve(r.sku)
    if (unit === null || unit <= 0) {
      uncostedUnits += r.quantity
      uncostedNetSales += r.netSales
      uncostedSkus.add(r.sku)
      continue
    }
    cogs += unit * r.quantity
    costedUnits += r.quantity
  }

  return { cogs, costedUnits, uncostedUnits, uncostedSkus: [...uncostedSkus], uncostedNetSales }
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
  channel: BusinessChannelId,
  month: string,
  marketing: MarketingByChannel,
  cogsInputs: CogsInputs = {},
): ChannelPnl {
  // Every report belonging to this business channel. For Amazon India that is
  // Seller Central and Vendor Central together, which is what makes one P&L
  // out of two uploads without anyone combining them by hand.
  const records = filterByMonth(allRecords, month).filter((r) => channelOfSource(r.channel) === channel)
  // One Net Sales calculation for the whole app: the P&L's revenue lines are
  // the central engine's figure, not a second summation with its own rules
  // about cancellations and currency.
  const facts = orderBasisNetSales(records)
  const { cogs } = cogsForRecords(records, skuMaster, month, cogsInputs)
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
  cogsInputs: CogsInputs = {},
): ChannelPnl[] {
  return BUSINESS_CHANNEL_IDS.map((c) => buildChannelPnl(allRecords, skuMaster, fixedExpenses, c, month, marketing, cogsInputs))
}

/**
 * What to charge for units whose SKU has no cost on file.
 *
 * The old rule — 25% of what those units sold for — was wrong in two ways at
 * once on Amazon USA. It was applied to `uncostedNetSales`, which for that
 * channel is denominated in dollars, and added straight onto a rupee COGS
 * total, so April's estimate landed as ₹993 where the same figure converted is
 * ₹94,805. And 25% of the selling price bears no relation to what these goods
 * actually cost: Amazon USA's priced SKUs run about ₹60 a unit against roughly
 * ₹1,150 of net sales a unit, so the rule guessed four times too high on the
 * months it did reach.
 *
 * A missing cost is now filled with what a costed unit of the same channel
 * actually averaged that month. It is still an estimate, but an estimate drawn
 * from the same goods in the same month rather than from the price tag. The
 * share-of-sales rule survives only for a month where nothing at all is
 * costed, which is the one case where there is no average to borrow.
 *
 * `uncostedNetSalesInr` must already be in rupees — the caller knows the
 * currency of its own records; this function cannot.
 */
export const UNPRICED_COGS_SHARE_OF_SALES = 0.25

export interface UncostedCogsEstimate {
  amount: number
  method: 'average-unit-cost' | 'share-of-sales' | 'none'
}

export function estimateUncostedCogs(result: CogsResult, uncostedNetSalesInr: number): UncostedCogsEstimate {
  if (result.uncostedUnits === 0) return { amount: 0, method: 'none' }
  const averageUnitCost = result.costedUnits > 0 ? result.cogs / result.costedUnits : 0
  if (averageUnitCost > 0) {
    return { amount: averageUnitCost * result.uncostedUnits, method: 'average-unit-cost' }
  }
  return { amount: uncostedNetSalesInr * UNPRICED_COGS_SHARE_OF_SALES, method: 'share-of-sales' }
}
