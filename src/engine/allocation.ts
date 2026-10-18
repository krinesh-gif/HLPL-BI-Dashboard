import type { BusinessChannelId } from '@/config/channels'
import { BUSINESS_CHANNEL_IDS, channelOfSource, DEFAULT_ALLOCATION_WEIGHTS } from '@/config/channels'
import type { CanonicalSalesRecord, FixedExpenseEntry, PnlLineValues } from '@/data/models'
import { filterByMonth } from './sales'
import { orderBasisNetSales } from './netSales'
import { statementNetSales } from './channelNetSales'
import type { ChannelFactsStore } from './channelFactsStore'
import { DEFAULT_FX_INR, type FxRatesInr } from '@/data/fxRates'

const FIXED_EXPENSE_CATEGORIES = [
  'fixedExpensesTotal',
  'salaries',
  'rent',
  'software',
  'warehouse',
  'logistics',
  'professionalFees',
  'officeExpenses',
  'generalExpenses',
  'otherOpex',
] as const

/**
 * Sales Contribution Method: each channel's share of a month's fixed expenses
 * equals its share of that month's net sales. Falls back to the configured
 * default weights when there is no sales data for the month yet.
 *
 * WHERE THE SHARE IS MEASURED FROM. A channel's net sales is the figure on its
 * own P&L: its statement where it has one for the month, and its order rows
 * where it does not. Measured from order rows alone — which is what this did —
 * a channel whose numbers come from a monthly statement rather than from an
 * order report counts as having sold nothing, and carries none of the month's
 * rent, salaries or software. That is not an edge case: Amazon India is the
 * largest channel in the company, its statements are the NPPM file and the
 * Product Profitability export, neither of which produces an order row, and it
 * was carrying ₹0 of September's ₹5,52,739 while Flipkart, Myntra and Meesho
 * carried its share between them. Any channel added later on the same footing
 * — a statement and no order rows — is included by the same rule, without
 * anything here needing to know it exists.
 *
 * Allocation is per BUSINESS channel. Splitting Amazon India's rent between
 * Seller Central and Vendor Central would be allocating a cost across two
 * reports about the same business, so both halves count towards the one
 * channel's share.
 */
export function computeSalesContributionWeights(
  allRecords: CanonicalSalesRecord[],
  month: string,
  facts?: ChannelFactsStore,
  fxRate: FxRatesInr = DEFAULT_FX_INR,
): Record<BusinessChannelId, number> {
  const byChannel = new Map<BusinessChannelId, CanonicalSalesRecord[]>()
  for (const r of filterByMonth(allRecords, month)) {
    const channel = channelOfSource(r.channel)
    const list = byChannel.get(channel)
    if (list) list.push(r)
    else byChannel.set(channel, [r])
  }

  const netSalesByChannel = new Map<BusinessChannelId, number>()
  let total = 0
  for (const channel of BUSINESS_CHANNEL_IDS) {
    // The statement is the channel's own month and wins where there is one,
    // for the same reason the P&L prefers it: it is what the marketplace
    // itself says was sold.
    const statement = facts ? statementNetSales(channel, month, facts, fxRate) : null
    const net = statement ?? orderBasisNetSales(byChannel.get(channel) ?? []).netSales
    netSalesByChannel.set(channel, net)
    total += net
  }

  if (total <= 0) return { ...DEFAULT_ALLOCATION_WEIGHTS }

  const weights = {} as Record<BusinessChannelId, number>
  for (const channel of BUSINESS_CHANNEL_IDS) {
    weights[channel] = (netSalesByChannel.get(channel) ?? 0) / total
  }
  return weights
}

/** Splits each fixed-expense category for `month` across channels using the given weights. */
export function allocateFixedExpensesForMonth(
  allRecords: CanonicalSalesRecord[],
  fixedExpenses: FixedExpenseEntry[],
  month: string,
  /** Every channel's statements, so a channel that reports by statement rather
   * than by order row carries its share. Omitted only by a caller that has
   * none, which then allocates on order rows alone. */
  facts?: ChannelFactsStore,
  fxRate: FxRatesInr = DEFAULT_FX_INR,
): Partial<Record<BusinessChannelId, PnlLineValues>> {
  const weights = computeSalesContributionWeights(allRecords, month, facts, fxRate)
  const monthExpenses = fixedExpenses.filter((e) => e.month === month)

  const result: Partial<Record<BusinessChannelId, PnlLineValues>> = {}
  for (const channel of BUSINESS_CHANNEL_IDS) {
    const lines: PnlLineValues = {}
    for (const category of FIXED_EXPENSE_CATEGORIES) {
      const total = monthExpenses.filter((e) => e.category === category).reduce((sum, e) => sum + e.amount, 0)
      lines[category] = total * (weights[channel] ?? 0)
    }
    result[channel] = lines
  }
  return result
}
