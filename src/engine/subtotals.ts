import type { PnlLineKey } from '@/config/pnlStructure'
import type { PnlLineValues } from '@/data/models'

/**
 * The subtotals every P&L in this build shares, in one place.
 *
 * It lives in a module of its own because the net sales identity —
 * gross less discounts, returns and revenue adjustments — is also what decides
 * each channel's share of the month's fixed expenses, and the module that
 * works that out cannot import the whole P&L engine without the two importing
 * each other.
 */
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

  // What the channel earns on the goods once the marketplace has taken its
  // fees, before anything is spent advertising them. It answers a different
  // question from the contribution below it: whether being on this
  // marketplace pays, rather than whether this month's spending on it did.
  const channelMargin = grossProfit - marketplaceVariableTotal
  lines.channelMargin = channelMargin
  lines.channelMarginPct = netSales !== 0 ? (channelMargin / netSales) * 100 : 0

  const marketingTotal = get('ads') + get('performanceMarketing') + get('otherMarketing')

  const contributionProfit = channelMargin - marketingTotal
  lines.contributionProfit = contributionProfit
  lines.contributionMarginPct = netSales !== 0 ? (contributionProfit / netSales) * 100 : 0

  const opexTotal =
    get('channelCharges') +
    get('fixedExpensesTotal') +
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
