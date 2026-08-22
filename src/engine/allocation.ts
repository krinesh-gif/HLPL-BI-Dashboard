import type { ChannelId } from '@/config/channels'
import { CHANNELS, DEFAULT_ALLOCATION_WEIGHTS } from '@/config/channels'
import type { CanonicalSalesRecord, FixedExpenseEntry, PnlLineValues } from '@/data/models'
import { filterByMonth, groupByChannel, sumFacts } from './sales'

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
 * Sales Contribution Method: each channel's share of a month's fixed
 * expenses equals its share of that month's net sales. Falls back to the
 * configured default weights when there is no sales data for the month yet.
 */
export function computeSalesContributionWeights(
  allRecords: CanonicalSalesRecord[],
  month: string,
): Record<ChannelId, number> {
  const monthRecords = filterByMonth(allRecords, month)
  const byChannel = groupByChannel(monthRecords)
  const netSalesByChannel = new Map<ChannelId, number>()
  let total = 0

  for (const channel of CHANNELS.map((c) => c.id)) {
    const net = sumFacts(byChannel.get(channel) ?? []).netSales
    netSalesByChannel.set(channel, net)
    total += net
  }

  if (total <= 0) return { ...DEFAULT_ALLOCATION_WEIGHTS }

  const weights = {} as Record<ChannelId, number>
  for (const channel of CHANNELS.map((c) => c.id)) {
    weights[channel] = (netSalesByChannel.get(channel) ?? 0) / total
  }
  return weights
}

/** Splits each fixed-expense category for `month` across channels using the given weights. */
export function allocateFixedExpensesForMonth(
  allRecords: CanonicalSalesRecord[],
  fixedExpenses: FixedExpenseEntry[],
  month: string,
): Partial<Record<ChannelId, PnlLineValues>> {
  const weights = computeSalesContributionWeights(allRecords, month)
  const monthExpenses = fixedExpenses.filter((e) => e.month === month)

  const result: Partial<Record<ChannelId, PnlLineValues>> = {}
  for (const channel of CHANNELS.map((c) => c.id)) {
    const lines: PnlLineValues = {}
    for (const category of FIXED_EXPENSE_CATEGORIES) {
      const total = monthExpenses.filter((e) => e.category === category).reduce((sum, e) => sum + e.amount, 0)
      lines[category] = total * (weights[channel] ?? 0)
    }
    result[channel] = lines
  }
  return result
}
