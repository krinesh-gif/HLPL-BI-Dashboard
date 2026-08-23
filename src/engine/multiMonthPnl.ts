import type { PnlLineValues } from '@/data/models'
import { addMonths, fiscalYearLabel, ytdMonthKeys } from '@/lib/format'

/**
 * The P&L as an investor-style MIS: months across, particulars down, one Total
 * column at the end.
 *
 * The Total column is where this kind of report usually goes wrong. Money adds
 * up, so a total of Net Sales is the sum of its months. A margin does not: the
 * average of five monthly margins is not the margin of the five months
 * together, because each month carries a different amount of revenue behind its
 * percentage. Averaging them would quietly overweight a small month. Every
 * percentage here is therefore recomputed from the summed figures.
 */

export type PnlRowKind = 'input' | 'subtotal' | 'percent' | 'section'

export interface PnlRowDef {
  key: string
  label: string
  kind: PnlRowKind
  /** Reads the row's value out of one month's computed P&L lines. */
  value: (lines: PnlLineValues) => number
  /**
   * How the Total column is produced. Money sums; a percentage is recomputed
   * from the totals of its numerator and denominator.
   */
  total: (totals: PnlLineValues) => number
  /** Shown indented under the subtotal it feeds. */
  indent?: boolean
}

const sum = (lines: PnlLineValues, keys: (keyof PnlLineValues)[]): number =>
  keys.reduce((acc, k) => acc + (lines[k] ?? 0), 0)

const MARKETPLACE_COST_KEYS: (keyof PnlLineValues)[] = [
  'marketplaceCommission', 'fulfilment', 'shipping', 'collectionFees', 'rtoCharges', 'returnCharges', 'otherMarketplaceCharges',
]
const MARKETING_KEYS: (keyof PnlLineValues)[] = ['ads', 'performanceMarketing', 'otherMarketing']
const FIXED_EXPENSE_KEYS: (keyof PnlLineValues)[] = [
  'salaries', 'rent', 'software', 'warehouse', 'logistics', 'professionalFees', 'officeExpenses', 'generalExpenses', 'otherOpex',
]

/** A margin over Net Sales, computed from whatever totals it is handed — so
 * the same function serves a single month and the Total column. */
const marginOf = (profit: (l: PnlLineValues) => number) => (l: PnlLineValues) => {
  const net = l.netSales ?? 0
  return net !== 0 ? (profit(l) / net) * 100 : 0
}

const grossProfit = (l: PnlLineValues) => l.grossProfit ?? 0
const contribution = (l: PnlLineValues) => l.contributionProfit ?? 0
const ebitda = (l: PnlLineValues) => l.ebitda ?? 0

/** The standard P&L structure. Every view — Master Company and each channel —
 * uses this same set, so the reports are directly comparable. */
export const PNL_ROWS: PnlRowDef[] = [
  { key: 'grossSales', label: 'Gross Sales', kind: 'input', value: (l) => l.grossSales ?? 0, total: (t) => t.grossSales ?? 0 },
  { key: 'discounts', label: 'Less: Discounts', kind: 'input', indent: true, value: (l) => l.discounts ?? 0, total: (t) => t.discounts ?? 0 },
  { key: 'returns', label: 'Less: Returns', kind: 'input', indent: true, value: (l) => l.returns ?? 0, total: (t) => t.returns ?? 0 },
  { key: 'netSales', label: 'Net Sales', kind: 'subtotal', value: (l) => l.netSales ?? 0, total: (t) => t.netSales ?? 0 },

  { key: 'cogs', label: 'Less: COGS', kind: 'input', indent: true, value: (l) => l.cogs ?? 0, total: (t) => t.cogs ?? 0 },
  { key: 'grossProfit', label: 'Gross Profit', kind: 'subtotal', value: grossProfit, total: grossProfit },
  { key: 'grossMarginPct', label: 'Gross Margin %', kind: 'percent', value: marginOf(grossProfit), total: marginOf(grossProfit) },

  { key: 'marketplaceCosts', label: 'Less: Marketplace Costs', kind: 'input', indent: true, value: (l) => sum(l, MARKETPLACE_COST_KEYS), total: (t) => sum(t, MARKETPLACE_COST_KEYS) },
  { key: 'marketing', label: 'Less: Marketing', kind: 'input', indent: true, value: (l) => sum(l, MARKETING_KEYS), total: (t) => sum(t, MARKETING_KEYS) },
  { key: 'contribution', label: 'Contribution', kind: 'subtotal', value: contribution, total: contribution },
  { key: 'contributionMarginPct', label: 'Contribution Margin %', kind: 'percent', value: marginOf(contribution), total: marginOf(contribution) },

  { key: 'fixedExpenses', label: 'Less: Fixed Expenses', kind: 'input', indent: true, value: (l) => sum(l, FIXED_EXPENSE_KEYS), total: (t) => sum(t, FIXED_EXPENSE_KEYS) },
  { key: 'ebitda', label: 'EBITDA', kind: 'subtotal', value: ebitda, total: ebitda },
  { key: 'ebitdaMarginPct', label: 'EBITDA Margin %', kind: 'percent', value: marginOf(ebitda), total: marginOf(ebitda) },
]

/** Line keys that are genuinely additive across months. Percentages and
 * subtotals are derived, never summed. */
const ADDITIVE_KEYS: (keyof PnlLineValues)[] = [
  'grossSales', 'discounts', 'returns', 'otherRevenueAdj', 'cogs',
  ...MARKETPLACE_COST_KEYS, ...MARKETING_KEYS, ...FIXED_EXPENSE_KEYS,
]

export interface MultiMonthPnlRow {
  def: PnlRowDef
  /** Value per month, in the same order as `months`. */
  values: number[]
  total: number
}

export interface MultiMonthPnl {
  months: string[]
  rows: MultiMonthPnlRow[]
  /** The summed line values behind the Total column, for anything that needs
   * to compute its own figure over the period. */
  totals: PnlLineValues
}

/**
 * Builds the table.
 *
 * `computeSubtotals` is passed in rather than imported so the totals column is
 * derived by exactly the same arithmetic as each month — a Total row that is
 * computed differently from the months above it is how a P&L stops adding up.
 */
export function buildMultiMonthPnl(
  months: string[],
  linesForMonth: (month: string) => PnlLineValues,
  computeSubtotals: (lines: PnlLineValues) => PnlLineValues,
): MultiMonthPnl {
  const monthly = months.map((m) => linesForMonth(m))

  const summed: PnlLineValues = {}
  for (const key of ADDITIVE_KEYS) {
    summed[key] = monthly.reduce((acc, l) => acc + (l[key] ?? 0), 0)
  }
  const totals = computeSubtotals(summed)

  return {
    months,
    totals,
    rows: PNL_ROWS.map((def) => ({
      def,
      values: monthly.map((l) => def.value(l)),
      total: def.total(totals),
    })),
  }
}

// ---------------------------------------------------------------------------
// Period selection
// ---------------------------------------------------------------------------

export type QuickPeriod = 'current' | 'previous' | '3m' | '6m' | '12m' | 'fy' | 'all'

export const QUICK_PERIODS: { key: QuickPeriod; label: string }[] = [
  { key: 'current', label: 'Current Month' },
  { key: 'previous', label: 'Previous Month' },
  { key: '3m', label: 'Last 3 Months' },
  { key: '6m', label: 'Last 6 Months' },
  { key: '12m', label: 'Last 12 Months' },
  { key: 'fy', label: 'Current FY' },
  { key: 'all', label: 'All Months' },
]

/**
 * The months a quick selection covers.
 *
 * `all` needs the months that actually have data — showing empty columns back
 * to the beginning of time would bury the real ones.
 */
export function monthsForQuickPeriod(
  period: QuickPeriod,
  anchorMonth: string,
  monthsWithData: string[],
): string[] {
  const back = (n: number) => Array.from({ length: n }, (_, i) => addMonths(anchorMonth, i - (n - 1)))

  switch (period) {
    case 'current':
      return [anchorMonth]
    case 'previous':
      return [addMonths(anchorMonth, -1)]
    case '3m':
      return back(3)
    case '6m':
      return back(6)
    case '12m':
      return back(12)
    case 'fy':
      return ytdMonthKeys(anchorMonth)
    case 'all':
      return monthsWithData.length > 0 ? [...monthsWithData].sort() : [anchorMonth]
  }
}

/** Inclusive month range, e.g. Apr 2026 → Aug 2026. */
export function monthsBetween(from: string, to: string): string[] {
  if (from > to) return monthsBetween(to, from)
  const months: string[] = []
  let cursor = from
  // A guard rather than a while(true): a malformed input should not hang the UI.
  for (let i = 0; i < 600 && cursor <= to; i++) {
    months.push(cursor)
    cursor = addMonths(cursor, 1)
  }
  return months
}

export function periodLabel(months: string[]): string {
  if (months.length === 0) return '—'
  if (months.length === 1) return fiscalYearLabel(months[0])
  return `${months.length} months`
}

// ---------------------------------------------------------------------------
// Month-on-month comparison
// ---------------------------------------------------------------------------

export interface PnlComparisonRow {
  def: PnlRowDef
  earlier: number
  later: number
  /** Rupee change for money rows; percentage-POINT change for percentage rows,
   * which is a different quantity and must not be presented as growth. */
  change: number
  /** Growth %, for money rows only. Null for percentage rows, where growth in
   * a percentage is rarely the question being asked. */
  growthPct: number | null
}

export function comparePnlMonths(
  earlierMonth: string,
  laterMonth: string,
  linesForMonth: (month: string) => PnlLineValues,
): PnlComparisonRow[] {
  const earlierLines = linesForMonth(earlierMonth)
  const laterLines = linesForMonth(laterMonth)

  return PNL_ROWS.map((def) => {
    const earlier = def.value(earlierLines)
    const later = def.value(laterLines)
    return {
      def,
      earlier,
      later,
      change: later - earlier,
      growthPct:
        def.kind === 'percent' || earlier === 0 ? null : ((later - earlier) / Math.abs(earlier)) * 100,
    }
  })
}
