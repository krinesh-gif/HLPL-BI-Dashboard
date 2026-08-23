import { describe, expect, it } from 'vitest'
import type { PnlLineValues } from '@/data/models'
import { computeSubtotals } from './pnl'
import {
  buildMultiMonthPnl,
  comparePnlMonths,
  monthsBetween,
  monthsForQuickPeriod,
  PNL_ROWS,
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
    expect(margin.values[0]).toBeCloseTo(50, 5)
    expect(margin.values[1]).toBeCloseTo(10, 5)
    expect(margin.total).toBeCloseTo(46.36, 2)
    expect(margin.total).not.toBeCloseTo(30, 1)
  })

  it('does the same for contribution and EBITDA margins', () => {
    const totals = built.totals
    expect(row(built, 'contributionMarginPct').total).toBeCloseTo(
      ((totals.contributionProfit ?? 0) / (totals.netSales ?? 1)) * 100, 5)
    expect(row(built, 'ebitdaMarginPct').total).toBeCloseTo(
      ((totals.ebitda ?? 0) / (totals.netSales ?? 1)) * 100, 5)
  })

  it('keeps the profit identity intact across the period', () => {
    expect(row(built, 'grossProfit').total).toBeCloseTo(
      row(built, 'netSales').total - row(built, 'cogs').total, 5)
  })

  it('derives the Total by the same arithmetic as each month', () => {
    // A one-month table's Total must equal that month exactly, or the two are
    // being computed differently.
    const single = buildMultiMonthPnl(['2026-07'], linesFor, computeSubtotals)
    for (const r of single.rows) expect(r.total).toBeCloseTo(r.values[0], 6)
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
    expect(margin.change).toBeCloseTo(-40, 5)
    expect(margin.growthPct).toBeNull()
  })
})
