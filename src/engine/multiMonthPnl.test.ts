import { describe, expect, it } from 'vitest'
import type { PnlLineValues } from '@/data/models'
import { computeSubtotals } from './pnl'
import {
  anchorWithinData,
  buildMultiMonthPnl,
  comparePnlMonths,
  comparisonMonths,
  monthsBetween,
  monthsForQuickPeriod,
  PNL_ROWS,
  tradedMonths,
} from './multiMonthPnl'

/** Two months with deliberately different margins, so averaging shows up. */
const LINES: Record<string, PnlLineValues> = {
  // ₹10 L net, 50% gross margin
  '2026-07': computeSubtotals({ grossSales: 1000000, discounts: 0, returns: 0, cogs: 500000, ads: 100000, salaries: 50000 }),
  // ₹1 L net, 10% gross margin — a tenth the size
  '2026-08': computeSubtotals({ grossSales: 100000, discounts: 0, returns: 0, cogs: 90000, ads: 10000, salaries: 5000 }),
}
const linesFor = (m: string) => LINES[m] ?? {}

function row(built: ReturnType<typeof buildMultiMonthPnl>, key: string) {
  const found = built.rows.find((r) => r.def.key === key)
  if (!found) throw new Error(`no row ${key}`)
  return found
}

describe('the Total column', () => {
  const built = buildMultiMonthPnl(['2026-07', '2026-08'], linesFor, computeSubtotals)

  it('adds up money', () => {
    expect(row(built, 'grossSales').total).toBe(1100000)
    expect(row(built, 'netSales').total).toBe(1100000)
    expect(row(built, 'cogs').total).toBe(590000)
  })

  it('recomputes a margin from the totals rather than averaging the months', () => {
    // July 50%, August 10%. The average is 30%; the real margin over both
    // months is (1,100,000 - 590,000) / 1,100,000 = 46.4%. Averaging would
    // overweight a month a tenth the size of the other.
    const margin = row(built, 'grossMarginPct')
    expect(margin.values[0]!).toBeCloseTo(50, 5)
    expect(margin.values[1]!).toBeCloseTo(10, 5)
    expect(margin.total!).toBeCloseTo(46.36, 2)
    expect(margin.total!).not.toBeCloseTo(30, 1)
  })

  it('does the same for contribution and EBITDA margins', () => {
    const totals = built.totals
    expect(row(built, 'contributionMarginPct').total!).toBeCloseTo(
      ((totals.contributionProfit ?? 0) / (totals.netSales ?? 1)) * 100, 5)
    expect(row(built, 'ebitdaMarginPct').total!).toBeCloseTo(
      ((totals.ebitda ?? 0) / (totals.netSales ?? 1)) * 100, 5)
  })

  it('keeps the profit identity intact across the period', () => {
    expect(row(built, 'grossProfit').total!).toBeCloseTo(
      row(built, 'netSales').total! - row(built, 'cogs').total!, 5)
  })

  it('derives the Total by the same arithmetic as each month', () => {
    // A one-month table's Total must equal that month exactly, or the two are
    // being computed differently.
    const single = buildMultiMonthPnl(['2026-07'], linesFor, computeSubtotals)
    for (const r of single.rows) expect(r.total).toBeCloseTo(r.values[0]!, 6)
  })
})

describe('a single-month table', () => {
  it('has one month column and no empty padding', () => {
    const built = buildMultiMonthPnl(['2026-08'], linesFor, computeSubtotals)
    expect(built.months).toEqual(['2026-08'])
    expect(built.rows[0].values).toHaveLength(1)
  })
})

describe('the standard structure', () => {
  it('carries every particular the MIS format calls for', () => {
    const labels = PNL_ROWS.map((r) => r.label)
    for (const expected of [
      'Gross Sales', 'Net Sales', 'Gross Profit', 'Gross Margin %',
      'Contribution', 'Contribution Margin %', 'EBITDA', 'EBITDA Margin %',
    ]) {
      expect(labels.some((l) => l.includes(expected))).toBe(true)
    }
  })

  it('is the same set for every view, so channels compare directly', () => {
    const master = buildMultiMonthPnl(['2026-08'], linesFor, computeSubtotals)
    const channel = buildMultiMonthPnl(['2026-08'], () => ({}), computeSubtotals)
    expect(master.rows.map((r) => r.def.key)).toEqual(channel.rows.map((r) => r.def.key))
  })
})

describe('period selection', () => {
  const withData = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08']

  it('resolves each quick option to the months it means', () => {
    expect(monthsForQuickPeriod('current', '2026-08', withData)).toEqual(['2026-08'])
    expect(monthsForQuickPeriod('previous', '2026-08', withData)).toEqual(['2026-07'])
    expect(monthsForQuickPeriod('3m', '2026-08', withData)).toEqual(['2026-06', '2026-07', '2026-08'])
    expect(monthsForQuickPeriod('12m', '2026-08', withData)).toHaveLength(12)
  })

  it('gives the fiscal year to date for FY', () => {
    // India FY starts in April.
    expect(monthsForQuickPeriod('fy', '2026-08', withData)).toEqual(withData)
  })

  it('shows only months that have data for All, not all of history', () => {
    expect(monthsForQuickPeriod('all', '2026-08', withData)).toEqual(withData)
  })

  it('falls back to the anchor month when nothing has been uploaded', () => {
    expect(monthsForQuickPeriod('all', '2026-08', [])).toEqual(['2026-08'])
  })

  it('builds an inclusive custom range', () => {
    expect(monthsBetween('2026-06', '2026-08')).toEqual(['2026-06', '2026-07', '2026-08'])
    expect(monthsBetween('2026-08', '2026-08')).toEqual(['2026-08'])
  })

  it('tolerates a range given backwards', () => {
    expect(monthsBetween('2026-08', '2026-06')).toEqual(['2026-06', '2026-07', '2026-08'])
  })
})

describe('comparing two months', () => {
  const rows = comparePnlMonths('2026-07', '2026-08', linesFor)
  const find = (key: string) => rows.find((r) => r.def.key === key)!

  it('reports growth for money rows', () => {
    const net = find('netSales')
    expect(net.earlier).toBe(1000000)
    expect(net.later).toBe(100000)
    expect(net.change).toBe(-900000)
    expect(net.growthPct).toBeCloseTo(-90, 5)
  })

  it('reports percentage rows as a point change, never as growth', () => {
    // 50% to 10% is a fall of 40 percentage points. Calling it "-80% growth"
    // would be a different and much more confusing statement.
    const margin = find('grossMarginPct')
    expect(margin.change!).toBeCloseTo(-40, 5)
    expect(margin.growthPct).toBeNull()
  })
})

describe('fixed expenses entered as one figure', () => {
  it('reaches the Fixed Expenses row and EBITDA exactly as the categories did', () => {
    const build = (lines: PnlLineValues) =>
      buildMultiMonthPnl(['2026-08'], () => computeSubtotals(lines), computeSubtotals)
    const asOne = build({ grossSales: 100000, cogs: 40000, fixedExpensesTotal: 10000 })
    const byCategory = build({ grossSales: 100000, cogs: 40000, salaries: 6000, rent: 4000 })
    const row = (r: ReturnType<typeof build>, key: string) => r.rows.find((x) => x.def.key === key)?.values[0]
    // The row holds the magnitude; the deduction's sign is applied when it is
    // rendered, which is why `sign: -1` lives on the row definition.
    expect(row(asOne, 'fixedExpenses')).toBeCloseTo(10000, 6)
    expect(row(asOne, 'fixedExpenses')).toBeCloseTo(row(byCategory, 'fixedExpenses')!, 6)
    expect(row(asOne, 'ebitda')).toBeCloseTo(row(byCategory, 'ebitda')!, 6)
  })
})

// ---------------------------------------------------------------------------
// A report never runs past its own data
// ---------------------------------------------------------------------------

describe('anchoring a period inside the data', () => {
  // The case this exists for. The dashboard's global month is set from the
  // newest month present anywhere, ad spend included, and ad reports are
  // downloaded while the month is still running. On 8 October 2026 that month
  // was October; the newest month with a P&L in it was September.
  const WITH_DATA = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']

  it('pulls an anchor past the data back to the last month that has some', () => {
    expect(anchorWithinData('2026-10', WITH_DATA)).toBe('2026-09')
  })

  it('leaves an anchor inside the data alone, however far back it is', () => {
    expect(anchorWithinData('2026-09', WITH_DATA)).toBe('2026-09')
    expect(anchorWithinData('2026-05', WITH_DATA)).toBe('2026-05')
  })

  it('does not depend on the list being sorted', () => {
    expect(anchorWithinData('2026-10', ['2026-07', '2026-09', '2026-04'])).toBe('2026-09')
  })

  it('leaves the anchor alone when there is no data at all', () => {
    // Nothing has been uploaded yet. The screen has to open on some month, and
    // the current one is the only honest choice.
    expect(anchorWithinData('2026-10', [])).toBe('2026-10')
  })

  it('ends the last six months on September, so the comparison is Aug vs Sep', () => {
    const months = monthsForQuickPeriod('6m', anchorWithinData('2026-10', WITH_DATA), WITH_DATA)
    expect(months[months.length - 1]).toBe('2026-09')
    expect(months[months.length - 2]).toBe('2026-08')
    expect(months).not.toContain('2026-10')
  })
})

describe('the months of a period that traded', () => {
  const months = ['2026-06', '2026-07', '2026-08', '2026-09']

  it('drops the months with nothing in them', () => {
    // Flipkart's September file has not arrived yet, on a period every other
    // channel has four months of.
    expect(tradedMonths(months, (i) => i < 3)).toEqual(['2026-06', '2026-07', '2026-08'])
  })

  it('keeps a gap in the middle rather than closing over it', () => {
    expect(tradedMonths(months, (i) => i !== 1)).toEqual(['2026-06', '2026-08', '2026-09'])
  })

  it('is empty when the view has no trading in the period', () => {
    expect(tradedMonths(months, () => false)).toEqual([])
  })

  it('names the two months a comparison should use', () => {
    // What the P&L screen does with it: the last two that traded, so an empty
    // month at the end of the period cannot become the "later" column and
    // print a 100% fall that never happened.
    const traded = tradedMonths(months, (i) => i < 3)
    expect(traded[traded.length - 1]).toBe('2026-08')
    expect(traded[traded.length - 2]).toBe('2026-07')
  })
})

describe('which two months a comparison puts side by side', () => {
  // 8 October 2026, the day this was reported.
  const TODAY = '2026-10'

  it('is Aug vs Sep when the data stops at September', () => {
    // The reported case, exactly: the period ran to October because October
    // had ad spend in it, and the screen read "Oct 2026 vs Sep 2026" with
    // every line down 100%.
    const traded = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09']
    expect(comparisonMonths(traded, TODAY)).toEqual({ earlierMonth: '2026-08', laterMonth: '2026-09' })
  })

  it('is still Aug vs Sep when October has started trading', () => {
    // Eight days of October is not a month. Against the whole of September it
    // reads as a collapse that has not happened and will not have happened by
    // the 31st, so the month we are in never becomes the later column.
    const traded = ['2026-07', '2026-08', '2026-09', '2026-10']
    expect(comparisonMonths(traded, TODAY)).toEqual({ earlierMonth: '2026-08', laterMonth: '2026-09' })
  })

  it('skips a month the view did not trade in rather than comparing against nothing', () => {
    // A channel whose August file has not been uploaded. Comparing September
    // with July is at least two months of trading, and both columns are
    // labelled with the month they are.
    expect(comparisonMonths(['2026-06', '2026-07', '2026-09'], TODAY)).toEqual({
      earlierMonth: '2026-07',
      laterMonth: '2026-09',
    })
  })

  it('shows no comparison when only one month has finished and traded', () => {
    expect(comparisonMonths(['2026-09', '2026-10'], TODAY)).toBeNull()
    expect(comparisonMonths(['2026-09'], TODAY)).toBeNull()
    expect(comparisonMonths([], TODAY)).toBeNull()
  })

  it('compares the last two of a period that is wholly in the past', () => {
    const traded = ['2026-04', '2026-05', '2026-06']
    expect(comparisonMonths(traded, TODAY)).toEqual({ earlierMonth: '2026-05', laterMonth: '2026-06' })
  })

  it('crosses a calendar year the way string months sort', () => {
    expect(comparisonMonths(['2025-11', '2025-12', '2026-01'], '2026-01')).toEqual({
      earlierMonth: '2025-11',
      laterMonth: '2025-12',
    })
  })
})

describe('the whole selection, end to end', () => {
  it('turns a 6-month period anchored on October into an Aug vs Sep comparison', () => {
    // The three rules together, on the owner's situation: the anchor is pulled
    // back to September, the period ends there, every month of it traded, and
    // the comparison is the last two.
    const monthsWithData = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']
    const months = monthsForQuickPeriod('6m', anchorWithinData('2026-10', monthsWithData), monthsWithData)
    const traded = tradedMonths(months, () => true)

    expect(months).toEqual(monthsWithData)
    expect(comparisonMonths(traded, '2026-10')).toEqual({ earlierMonth: '2026-08', laterMonth: '2026-09' })
  })
})
