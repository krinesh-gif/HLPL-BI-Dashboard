import type { PnlLineValues } from '@/data/models'
import { PNL_STRUCTURE } from '@/config/pnlStructure'
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
  /**
   * Reads the row's value out of one month's computed P&L lines. Null where
   * the figure is undefined rather than zero — a margin in a month with no
   * revenue is not 0%, it is unmeasurable, and printing 0.0% there reads as a
   * month that made no money on everything it sold.
   */
  value: (lines: PnlLineValues) => number | null
  /**
   * How the Total column is produced. Money sums; a percentage is recomputed
   * from the totals of its numerator and denominator.
   */
  total: (totals: PnlLineValues) => number | null
  /** Shown indented under the subtotal it feeds. */
  indent?: boolean
  /**
   * The full name, where the label had to be shortened to keep the column
   * narrow. Shown on hover, so the abbreviation never costs the reader the
   * meaning.
   */
  note?: string
  /**
   * Dropped from the table when it is zero in every column.
   *
   * Only for a line that most views genuinely do not have. Channel Charges is
   * the one: a NextGen fee is Flipkart's and nobody else's, and a row of
   * dashes on nine channels would read as nine channels that forgot to enter
   * something. Every other line is shown always, zero or not, because a
   * report whose rows come and go cannot be compared month to month.
   */
  hideWhenEmpty?: true
  /**
   * How the figure is shown, not how it is stored.
   *
   * Deduction lines hold a positive magnitude — `cogs` is what the goods cost,
   * not minus what they cost — because that is what the engine sums. On screen
   * they are money leaving, so they are printed negative. Without this, a P&L
   * that colours negatives red would print "(−) COGS" in green.
   */
  sign?: 1 | -1
}

/**
 * How a deduction is marked, on this report and on every channel's own
 * statement.
 *
 * It read "Less: " and is now "(−) " — the owner's call, and a good one in a
 * table: the mark is two characters instead of five, so the particulars
 * column is narrower, and it reads as arithmetic rather than as a word that
 * has to be translated into one.
 *
 * The character is U+2212 MINUS SIGN, not a hyphen: it is drawn at the same
 * width and height as a digit, so it sits level with the figures beside it.
 *
 * Exported because the sign rule is checked against it — a deduction line
 * must carry `sign: -1` or the table would print money leaving in green —
 * and a test that hard-coded the word would pass for the wrong reason the
 * next time the mark changes.
 */
export const DEDUCTION_MARK = '(−)'

const sum = (lines: PnlLineValues, keys: (keyof PnlLineValues)[]): number =>
  keys.reduce((acc, k) => acc + (lines[k] ?? 0), 0)

const MARKETPLACE_COST_KEYS: (keyof PnlLineValues)[] = [
  'marketplaceCommission', 'fulfilment', 'shipping', 'collectionFees', 'rtoCharges', 'returnCharges', 'otherMarketplaceCharges',
]
const MARKETING_KEYS: (keyof PnlLineValues)[] = ['ads', 'performanceMarketing', 'otherMarketing']
const FIXED_EXPENSE_KEYS: (keyof PnlLineValues)[] = [
  'fixedExpensesTotal', 'salaries', 'rent', 'software', 'warehouse', 'logistics', 'professionalFees', 'officeExpenses', 'generalExpenses', 'otherOpex',
]

/** A margin over Net Sales, computed from whatever totals it is handed — so
 * the same function serves a single month and the Total column. */
const marginOf = (profit: (l: PnlLineValues) => number) => (l: PnlLineValues): number | null => {
  const net = l.netSales ?? 0
  return net !== 0 ? (profit(l) / net) * 100 : null
}

const grossProfit = (l: PnlLineValues) => l.grossProfit ?? 0
const contribution = (l: PnlLineValues) => l.contributionProfit ?? 0
const ebitda = (l: PnlLineValues) => l.ebitda ?? 0

/** The standard P&L structure. Every view — Master Company and each channel —
 * uses this same set, so the reports are directly comparable. */
export const PNL_ROWS: PnlRowDef[] = [
  { key: 'grossSales', label: 'Gross Sales', kind: 'input', value: (l) => l.grossSales ?? 0, total: (t) => t.grossSales ?? 0 },
  { key: 'discounts', label: '(−) Discounts', kind: 'input', indent: true, value: (l) => l.discounts ?? 0, total: (t) => t.discounts ?? 0, sign: -1 },
  { key: 'returns', label: '(−) Returns', kind: 'input', indent: true, value: (l) => l.returns ?? 0, total: (t) => t.returns ?? 0, sign: -1 },
  // Output GST is collected on the sale and paid onward, so it was never
  // revenue and Net Sales is stated after it. It had no row of its own, which
  // meant the revenue block did not add up on screen: Myntra's July read
  // 6,77,353 less 1,37,012 of returns and then a Net Sales of 4,48,588, with
  // the 91,753 of Product GST deducted invisibly. A reader checking the
  // arithmetic could only conclude the report was wrong.
  // Shortened from "Less: Output GST & revenue adjustments", which was the
  // longest label on the report by a wide margin and set the width of the
  // particulars column on every view — costing a month or a channel column
  // of screen on a table that is read by scanning across. The full name is
  // on hover.
  { key: 'otherRevenueAdj', label: '(−) GST & Adjustments', note: 'Output GST and other revenue adjustments', kind: 'input', indent: true, value: (l) => l.otherRevenueAdj ?? 0, total: (t) => t.otherRevenueAdj ?? 0, sign: -1 },
  { key: 'netSales', label: 'Net Sales', kind: 'subtotal', value: (l) => l.netSales ?? 0, total: (t) => t.netSales ?? 0 },

  { key: 'cogs', label: '(−) COGS', kind: 'input', indent: true, value: (l) => l.cogs ?? 0, total: (t) => t.cogs ?? 0, sign: -1 },
  { key: 'grossProfit', label: 'Gross Profit', kind: 'subtotal', value: grossProfit, total: grossProfit },
  { key: 'grossMarginPct', label: 'Gross Margin %', kind: 'percent', value: marginOf(grossProfit), total: marginOf(grossProfit) },

  { key: 'marketplaceCosts', label: '(−) Marketplace Fees', kind: 'input', indent: true, value: (l) => sum(l, MARKETPLACE_COST_KEYS), total: (t) => sum(t, MARKETPLACE_COST_KEYS), sign: -1 },
  { key: 'marketing', label: '(−) Advertising (MI)', kind: 'input', indent: true, value: (l) => sum(l, MARKETING_KEYS), total: (t) => sum(t, MARKETING_KEYS), sign: -1 },
  { key: 'contribution', label: 'Contribution', kind: 'subtotal', value: contribution, total: contribution },
  { key: 'contributionMarginPct', label: 'Contribution Margin %', kind: 'percent', value: marginOf(contribution), total: marginOf(contribution) },

  // A channel's own charges, above its share of the company's. Flipkart's
  // NextGen fee is billed to Flipkart and settled outside its marketplace
  // report, so it is not an allocation and does not belong inside Fixed
  // Expenses. It had no row at all, which left the one channel that carries
  // it unable to add up: September read a contribution of 2,13,793, fixed
  // expenses, and then an EBITDA 25,000 lower than the two of them give.
  { key: 'channelCharges', label: '(−) Channel Charges', kind: 'input', indent: true, hideWhenEmpty: true, value: (l) => l.channelCharges ?? 0, total: (t) => t.channelCharges ?? 0, sign: -1 },
  { key: 'fixedExpenses', label: '(−) Fixed Expenses', kind: 'input', indent: true, value: (l) => sum(l, FIXED_EXPENSE_KEYS), total: (t) => sum(t, FIXED_EXPENSE_KEYS), sign: -1 },
  { key: 'ebitda', label: 'EBITDA', kind: 'subtotal', value: ebitda, total: ebitda },
  { key: 'ebitdaMarginPct', label: 'EBITDA Margin %', kind: 'percent', value: marginOf(ebitda), total: marginOf(ebitda) },
]

/**
 * Line keys that are genuinely additive. Percentages and subtotals are
 * derived, never summed.
 *
 * Taken from `PNL_STRUCTURE` rather than listed here, because a hand-kept list
 * drifts the moment a line is added and the drift is invisible: Channel
 * Charges was added to the structure and not to this list, so every Total
 * column silently dropped it and read an EBITDA 75,000 too high over Jul-Sep.
 * The structure's input lines are exactly what `buildMasterPnl` sums, so
 * deriving it here is also what keeps the two agreeing.
 */
export const PNL_ADDITIVE_KEYS: (keyof PnlLineValues)[] =
  PNL_STRUCTURE.filter((d) => d.kind === 'input').map((d) => d.key)

/**
 * Whether a column has nothing in it at all — no sales, no cost, nothing.
 *
 * Used to leave a channel that did not trade out of the all-channels report.
 * Every additive key is zero, so dropping such a column cannot move the Total,
 * which is what makes it safe to hide.
 */
export function isEmptyPnlColumn(lines: PnlLineValues): boolean {
  return PNL_ADDITIVE_KEYS.every((k) => (lines[k] ?? 0) === 0)
}

export interface MultiMonthPnlRow {
  def: PnlRowDef
  /** Value per column, in the same order as `columns`. Null means undefined. */
  values: (number | null)[]
  total: number | null
}

export interface MultiMonthPnl {
  /** The columns, as keys. Months across in the month view; channels across in
   * the all-channels one. */
  columns: string[]
  /** The same list under the name the month view reads it by. */
  months: string[]
  rows: MultiMonthPnlRow[]
  /** The summed line values behind the Total column, for anything that needs
   * to compute its own figure over the period. */
  totals: PnlLineValues
}

/**
 * Builds the table.
 *
 * A column is a month on the P&L screen and a channel on the all-channels one.
 * Both are built here, by one function, for the reason the report exists: the
 * two readings have to agree, and they cannot disagree if there is only one
 * piece of arithmetic. Summing the channels of a month gives the company's
 * month; summing the months of a channel gives the channel's period; and
 * either way the Total column is the sum of the input lines with the subtotals
 * taken afterwards, which is exactly what `buildMasterPnl` does.
 *
 * `computeSubtotals` is passed in rather than imported so the totals column is
 * derived by exactly the same arithmetic as each column — a Total row that is
 * computed differently from the columns beside it is how a P&L stops adding up.
 */
export function buildPnlColumns(
  columns: string[],
  linesForColumn: (column: string) => PnlLineValues,
  computeSubtotals: (lines: PnlLineValues) => PnlLineValues,
): MultiMonthPnl {
  const perColumn = columns.map((c) => linesForColumn(c))

  const summed: PnlLineValues = {}
  for (const key of PNL_ADDITIVE_KEYS) {
    summed[key] = perColumn.reduce((acc, l) => acc + (l[key] ?? 0), 0)
  }
  const totals = computeSubtotals(summed)

  const rows = PNL_ROWS.map((def) => ({
    def,
    values: perColumn.map((l) => def.value(l)),
    total: def.total(totals),
  }))

  return {
    columns,
    months: columns,
    totals,
    // Dropped here rather than in the table, so the CSV export and the screen
    // cannot end up showing different rows.
    rows: rows.filter((r) => !r.def.hideWhenEmpty || r.total !== 0 || r.values.some((v) => v !== 0 && v !== null)),
  }
}

/** The month view: one column per month, in the order given. */
export function buildMultiMonthPnl(
  months: string[],
  linesForMonth: (month: string) => PnlLineValues,
  computeSubtotals: (lines: PnlLineValues) => PnlLineValues,
): MultiMonthPnl {
  return buildPnlColumns(months, linesForMonth, computeSubtotals)
}

// ---------------------------------------------------------------------------
// Period selection
// ---------------------------------------------------------------------------

export type QuickPeriod = 'current' | 'previous' | '3m' | '6m' | '12m' | 'fy' | 'all'

export const QUICK_PERIODS: { key: QuickPeriod; label: string }[] = [
  // Not "Current Month": a quick period ends on the newest finished month, so
  // on the 17th of October this is September. Calling it the current month
  // would be the dropdown telling the reader something untrue.
  { key: 'current', label: 'Latest Month' },
  { key: 'previous', label: 'Month Before' },
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
  earlier: number | null
  later: number | null
  /** Rupee change for money rows; percentage-POINT change for percentage rows,
   * which is a different quantity and must not be presented as growth. Null
   * when either month's figure is undefined. */
  change: number | null
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
    const comparable = earlier !== null && later !== null
    return {
      def,
      earlier,
      later,
      change: comparable ? later - earlier : null,
      growthPct:
        !comparable || def.kind === 'percent' || earlier === 0
          ? null
          : ((later - earlier) / Math.abs(earlier)) * 100,
    }
  })
}

// ---------------------------------------------------------------------------
// Which months a report should actually report on
// ---------------------------------------------------------------------------

/**
 * Keeps a period from running past the last month that has numbers in it.
 *
 * The quick periods are counted back from an anchor month, and the anchor is
 * the dashboard's global month — which is set from the newest month present
 * anywhere in the data, ad spend included. Ad reports are downloaded while the
 * month is still running, so on 8 October the anchor was October while the
 * last month with a P&L in it was September. "Last 6 Months" then ended on an
 * empty column and the comparison underneath read "Oct 2026 vs Sep 2026" with
 * every line down 100% — which is a statement about which files have been
 * uploaded, not about the business.
 *
 * The anchor is only ever pulled back, never pushed forward: an anchor that is
 * already inside the data is a month someone chose, and reading an earlier
 * month is a real choice.
 */
export function anchorWithinData(anchorMonth: string, monthsWithData: string[]): string {
  const last = monthsWithData.reduce<string | null>((latest, m) => (latest === null || m > latest ? m : latest), null)
  return last !== null && anchorMonth > last ? last : anchorMonth
}

/**
 * Where a quick period should end.
 *
 * `anchorWithinData` deals with an anchor past the end of the data. This deals
 * with the other half of the same problem: a month that has data but is not
 * over yet.
 *
 * A month in progress is not a month. On the 17th it holds whatever has been
 * uploaded so far — one channel's file, or a few days of orders — and putting
 * it at the end of "Last 6 Months" ends the table on a column that is a
 * fraction of the others. Every line reads as a collapse and the comparison
 * under the table reads as a disaster, when all that happened is that the
 * month is young.
 *
 * So a quick period ends on the newest month that is both in the data and
 * finished. The running month is still reachable — the custom range and the
 * global month filter both reach it — but nothing picks it by default.
 *
 * The one exception is a business with nothing else: if the running month is
 * the only month with data, it is what there is to show.
 */
export function quickPeriodAnchor(
  anchorMonth: string,
  monthsWithData: string[],
  currentMonth: string,
): string {
  const within = anchorWithinData(anchorMonth, monthsWithData)
  if (within < currentMonth) return within
  const finished = monthsWithData.filter((m) => m < currentMonth)
  if (finished.length === 0) return within
  return finished.reduce((latest, m) => (m > latest ? m : latest))
}

/**
 * The months of a period that actually traded, in order.
 *
 * The period is the same set of months for every view; the data is not. One
 * channel's reports can stop a month before another's, so anything that means
 * "the latest month" or "this month against last" has to mean the latest month
 * *this view* has figures for. Otherwise opening a channel whose file has not
 * arrived yet shows it as having collapsed to nothing.
 */
export function tradedMonths(months: string[], tradedAt: (index: number) => boolean): string[] {
  return months.filter((_month, i) => tradedAt(i))
}

/**
 * The two months a month-on-month comparison should put side by side, out of
 * the months of the period that traded.
 *
 * Not simply the last two of them. Two different things disqualify the last:
 *
 *  - It can be empty, because the period is anchored on the newest month
 *    present anywhere in the data and ad spend arrives while a month is still
 *    running. "Oct 2026 vs Sep 2026", every line down 100%, is a statement
 *    about which files have been uploaded.
 *  - It can be the month we are in, which is only part of a month. Eight days
 *    of October against the whole of September shows a collapse that has not
 *    happened and will not have happened by the 31st.
 *
 * So the later column is the most recent month of the period that traded and
 * has finished, and the earlier column is the one before it that traded. Null
 * when there are not two such months: a single month has nothing to be
 * compared with, and comparing it against a part month or an empty one is
 * worse than showing no comparison at all.
 */
export function comparisonMonths(
  traded: string[],
  currentMonth: string,
): { earlierMonth: string; laterMonth: string } | null {
  const finished = traded.filter((m) => m < currentMonth)
  if (finished.length < 2) return null
  return { earlierMonth: finished[finished.length - 2], laterMonth: finished[finished.length - 1] }
}
