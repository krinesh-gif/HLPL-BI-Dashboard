import type { BusinessChannelId } from '@/config/channels'
import { BUSINESS_CHANNEL_IDS, channelOfSource, DEFAULT_ALLOCATION_WEIGHTS } from '@/config/channels'
import type { CanonicalSalesRecord, FixedExpenseEntry, PnlLineValues } from '@/data/models'
import { filterByMonth } from './sales'
import { orderBasisNetSales } from './netSales'

const FIXED_EXPENSE_CATEGORIES = [
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
 * Allocation is per BUSINESS channel. Splitting Amazon India's rent between
 * Seller Central and Vendor Central would be allocating a cost across two
 * reports about the same business.
 */
export function computeSalesContributionWeights(
  allRecords: CanonicalSalesRecord[],
  month: string,
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
    const net = orderBasisNetSales(byChannel.get(channel) ?? []).netSales
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
): Partial<Record<BusinessChannelId, PnlLineValues>> {
  const weights = computeSalesContributionWeights(allRecords, month)
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
