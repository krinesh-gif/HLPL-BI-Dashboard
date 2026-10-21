import { PNL_STRUCTURE, type PnlSection } from '@/config/pnlStructure'
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

/** Sum of specific P&L line keys, used to build composite MIS particulars like "Marketplace Fees". */
function sumLines(lines: PnlLineValues, keys: (keyof PnlLineValues)[]): number {
  return keys.reduce((sum, k) => sum + (lines[k] ?? 0), 0)
}

/** The P&L's own lines for a section, so a line added there reaches this
 * report too. These were three lists written out by hand, and the one below
 * had fallen behind. */
const inputsIn = (section: PnlSection): (keyof PnlLineValues)[] =>
  PNL_STRUCTURE.filter((d) => d.section === section && d.kind === 'input').map((d) => d.key)

const MARKETPLACE_COST_KEYS = inputsIn('marketplaceVariable')
const MARKETING_KEYS = inputsIn('marketing')

/** Salaries and rent have particulars of their own below, so the catch-all is
 * everything else between contribution and EBITDA. */
const OWN_PARTICULAR: (keyof PnlLineValues)[] = ['salaries', 'rent']

/**
 * Everything else below contribution — and *everything*, which is the fix.
 *
 * This was a list of seven: software, warehouse, logistics, professional
 * fees, office, general and other. It left out `channelCharges` and
 * `fixedExpensesTotal`, and `fixedExpensesTotal` is the only category the
 * Fixed Expenses screen has ever been used with — 32,36,885 rupees across
 * six months, every rupee of it. So the MIS showed Contribution, then
 * Employee Cost nil, Rent nil, Other OPEX nil, then an EBITDA 6,27,739 lower
 * than the contribution above it, with nothing on the page to say where
 * September's money went. EBITDA itself was right; the report simply would
 * not add up, on the one screen written to be read by someone outside the
 * company.
 */
const OTHER_OPEX_KEYS = inputsIn('opex').filter((k) => !OWN_PARTICULAR.includes(k))

interface MisParticularDef {
  label: string
  isPercent: boolean
  value: (lines: PnlLineValues) => number
}

const MIS_PARTICULARS: MisParticularDef[] = [
  { label: 'Gross Sales', isPercent: false, value: (l) => l.grossSales ?? 0 },
  { label: 'Net Sales', isPercent: false, value: (l) => l.netSales ?? 0 },
  { label: 'COGS', isPercent: false, value: (l) => l.cogs ?? 0 },
  { label: 'Gross Profit (CM1)', isPercent: false, value: (l) => l.grossProfit ?? 0 },
  { label: 'Gross Margin % (CM1 %)', isPercent: true, value: (l) => l.grossMarginPct ?? 0 },
  { label: 'Marketplace Fees', isPercent: false, value: (l) => sumLines(l, MARKETPLACE_COST_KEYS) },
  // The same rung the P&L strikes, named the same way. The two reports show
  // one ladder; a step that appeared on one and not the other would be read
  // as two different accounts of the month.
  { label: 'Channel Margin (CM2)', isPercent: false, value: (l) => l.channelMargin ?? 0 },
  { label: 'Channel Margin % (CM2 %)', isPercent: true, value: (l) => l.channelMarginPct ?? 0 },
  { label: 'Advertising (MI)', isPercent: false, value: (l) => sumLines(l, MARKETING_KEYS) },
  { label: 'Contribution (CM3)', isPercent: false, value: (l) => l.contributionProfit ?? 0 },
  { label: 'Contribution Margin % (CM3 %)', isPercent: true, value: (l) => l.contributionMarginPct ?? 0 },
  { label: 'Employee Cost', isPercent: false, value: (l) => l.salaries ?? 0 },
  { label: 'Rent', isPercent: false, value: (l) => l.rent ?? 0 },
  // Named for what is in it: with nothing itemised, this carries the month's
  // whole overhead, and calling that "other" would read as a rounding.
  { label: 'Other OPEX & Fixed Costs', isPercent: false, value: (l) => sumLines(l, OTHER_OPEX_KEYS) },
  { label: 'EBITDA', isPercent: false, value: (l) => l.ebitda ?? 0 },
  { label: 'EBITDA Margin % (CM4 %)', isPercent: true, value: (l) => l.ebitdaMarginPct ?? 0 },
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
