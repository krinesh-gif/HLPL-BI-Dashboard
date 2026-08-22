import type { PnlLineValues } from '@/data/models'
import { addMonths, ytdMonthKeys } from '@/lib/format'
import { growthPct } from './sales'

export interface MisRow {
  particular: string
  isPercent: boolean
  currentMonth: number
  previousMonth: number
  momPct: number | null
  ytd: number
  previousYtd: number
  yoyPct: number | null
}

/** Sum of specific P&L line keys, used to build composite MIS particulars like "Marketplace Costs". */
function sumLines(lines: PnlLineValues, keys: (keyof PnlLineValues)[]): number {
  return keys.reduce((sum, k) => sum + (lines[k] ?? 0), 0)
}

const MARKETPLACE_COST_KEYS: (keyof PnlLineValues)[] = [
  'marketplaceCommission', 'fulfilment', 'shipping', 'collectionFees', 'rtoCharges', 'returnCharges', 'otherMarketplaceCharges',
]
const MARKETING_KEYS: (keyof PnlLineValues)[] = ['ads', 'performanceMarketing', 'otherMarketing']
const OTHER_OPEX_KEYS: (keyof PnlLineValues)[] = [
  'software', 'warehouse', 'logistics', 'professionalFees', 'officeExpenses', 'generalExpenses', 'otherOpex',
]

interface MisParticularDef {
  label: string
  isPercent: boolean
  value: (lines: PnlLineValues) => number
}

const MIS_PARTICULARS: MisParticularDef[] = [
  { label: 'Gross Sales', isPercent: false, value: (l) => l.grossSales ?? 0 },
  { label: 'Net Sales', isPercent: false, value: (l) => l.netSales ?? 0 },
  { label: 'COGS', isPercent: false, value: (l) => l.cogs ?? 0 },
  { label: 'Gross Profit', isPercent: false, value: (l) => l.grossProfit ?? 0 },
  { label: 'Gross Margin %', isPercent: true, value: (l) => l.grossMarginPct ?? 0 },
  { label: 'Marketplace Costs', isPercent: false, value: (l) => sumLines(l, MARKETPLACE_COST_KEYS) },
  { label: 'Marketing', isPercent: false, value: (l) => sumLines(l, MARKETING_KEYS) },
  { label: 'Contribution', isPercent: false, value: (l) => l.contributionProfit ?? 0 },
  { label: 'Contribution Margin %', isPercent: true, value: (l) => l.contributionMarginPct ?? 0 },
  { label: 'Employee Cost', isPercent: false, value: (l) => l.salaries ?? 0 },
  { label: 'Rent', isPercent: false, value: (l) => l.rent ?? 0 },
  { label: 'Other OPEX', isPercent: false, value: (l) => sumLines(l, OTHER_OPEX_KEYS) },
  { label: 'EBITDA', isPercent: false, value: (l) => l.ebitda ?? 0 },
  { label: 'EBITDA Margin %', isPercent: true, value: (l) => l.ebitdaMarginPct ?? 0 },
]

/**
 * Builds the Investor MIS table for `currentMonth`, given a lookup that returns
 * the (already-computed) P&L line values for any yyyy-mm month key.
 */
export function buildMisRows(
  currentMonth: string,
  getLinesForMonth: (month: string) => PnlLineValues,
): MisRow[] {
  const previousMonth = addMonths(currentMonth, -1)
  const previousYearMonth = addMonths(currentMonth, -12)

  const currentLines = getLinesForMonth(currentMonth)
  const previousLines = getLinesForMonth(previousMonth)
  const previousYearLines = getLinesForMonth(previousYearMonth)

  const ytdMonths = ytdMonthKeys(currentMonth)
  const previousYtdMonths = ytdMonths.map((m) => addMonths(m, -12))

  return MIS_PARTICULARS.map((def) => {
    const currentVal = def.value(currentLines)
    const previousVal = def.value(previousLines)
    const previousYearVal = def.value(previousYearLines)

    const ytdVal = def.isPercent
      ? currentVal // percentages aren't summed across months; show current-period rate
      : ytdMonths.reduce((sum, m) => sum + def.value(getLinesForMonth(m)), 0)
    const previousYtdVal = def.isPercent
      ? previousYearVal
      : previousYtdMonths.reduce((sum, m) => sum + def.value(getLinesForMonth(m)), 0)

    return {
      particular: def.label,
      isPercent: def.isPercent,
      currentMonth: currentVal,
      previousMonth: previousVal,
      momPct: def.isPercent ? currentVal - previousVal : growthPct(currentVal, previousVal),
      ytd: ytdVal,
      previousYtd: previousYtdVal,
      yoyPct: def.isPercent ? currentVal - previousYearVal : growthPct(currentVal, previousYearVal),
    }
  })
}
