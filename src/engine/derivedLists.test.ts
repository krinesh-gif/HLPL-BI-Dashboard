import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { PNL_STRUCTURE, type PnlLineKey, type PnlSection } from '@/config/pnlStructure'
import type { PnlLineValues } from '@/data/models'
import { buildMisRows } from './mis'
import { computeSubtotals } from './subtotals'
import { PNL_ROWS, buildMultiMonthPnl } from './multiMonthPnl'
import { AMAZON_AE_LINE_DEFS, amazonAeValuesInInr, computeAmazonAePnl } from './nativePnl/amazonAe'
import { AMAZON_USA_LINE_DEFS, amazonUsaValuesInInr } from './nativePnl/amazonUsa'

/**
 * Lists that have to stay in step with something else.
 *
 * This file exists because the same defect has now happened three times, and
 * each time it was a list of line names written out by hand beside the thing
 * it was supposed to describe:
 *
 *   - `PNL_ADDITIVE_KEYS` left out `channelCharges`, so 75,000 rupees was
 *     invisible on the P&L and dropped from its totals.
 *   - Flipkart's fixed fee was in no canonical bucket at all: deducted on the
 *     statement, never seen by the P&L. 4,83,916 rupees across six months,
 *     and the company's EBITDA overstated by the same amount.
 *   - The MIS's own opex list left out `channelCharges` and
 *     `fixedExpensesTotal` — and `fixedExpensesTotal` is the only category
 *     the Fixed Expenses screen has ever been used with. Contribution fell to
 *     EBITDA past three nil cost lines, 6,27,739 rupees unaccounted for on
 *     the page, on the one report written for someone outside the company.
 *
 * Each is now derived from its source. These hold them there, and hold the
 * lists that are still written out by hand to what they are meant to cover.
 */
const inputsIn = (section: PnlSection): PnlLineKey[] =>
  PNL_STRUCTURE.filter((d) => d.section === section && d.kind === 'input').map((d) => d.key)

/** A month with a figure on every input line, so a line left out of a sum
 * shows up as a difference rather than as another zero. */
const EVERY_LINE: PnlLineValues = Object.fromEntries(
  PNL_STRUCTURE.filter((d) => d.kind === 'input').map((d, i) => [d.key, 1_000 * (i + 1)]),
)

describe('the reports account for every line the P&L has', () => {
  /**
   * The MIS is the one that broke. Its cost particulars have to add back to
   * the distance between the margins printed above and below them — a report
   * that does not add up is worse than one that is missing a line, because
   * the reader cannot tell which figure to doubt.
   */
  it('MIS: the cost particulars explain every rupee between the margins', () => {
    const lines = computeSubtotals(EVERY_LINE)
    const rows = buildMisRows('2026-09', () => lines)
    const at = (particular: string): number => {
      const row = rows.find((r) => r.particular === particular)
      expect(row, `no MIS particular called "${particular}"`).toBeDefined()
      return row?.currentMonth ?? 0
    }

    expect(at('Gross Sales') - at('Net Sales')).toBeGreaterThan(0)
    expect(at('Net Sales') - at('COGS')).toBeCloseTo(at('Gross Profit (CM1)'), 6)
    expect(at('Gross Profit (CM1)') - at('Marketplace Fees')).toBeCloseTo(at('Channel Margin (CM2)'), 6)
    expect(at('Channel Margin (CM2)') - at('Advertising (MI)')).toBeCloseTo(at('Contribution (CM3)'), 6)

    const belowContribution = at('Employee Cost') + at('Rent') + at('Other OPEX & Fixed Costs')
    expect(at('Contribution (CM3)') - belowContribution).toBeCloseTo(at('EBITDA'), 6)
  })

  it('MIS: every opex line reaches exactly one particular', () => {
    const lines = computeSubtotals(EVERY_LINE)
    const rows = buildMisRows('2026-09', () => lines)
    const at = (p: string): number => rows.find((r) => r.particular === p)?.currentMonth ?? 0
    const everyOpexLine = inputsIn('opex').reduce((sum, k) => sum + (lines[k] ?? 0), 0)
    expect(at('Employee Cost') + at('Rent') + at('Other OPEX & Fixed Costs')).toBeCloseTo(everyOpexLine, 6)
  })

  /**
   * The same question of the month-across P&L. It shows the channel charges
   * on a line of their own and the rest as Fixed Expenses, so the two
   * together have to be the whole of what sits below contribution.
   */
  it('P&L: the rows below contribution explain the fall to EBITDA', () => {
    const built = buildMultiMonthPnl(['2026-09'], () => computeSubtotals(EVERY_LINE), computeSubtotals)
    const at = (key: string): number => {
      const row = built.rows.find((r) => r.def.key === key)
      expect(row, `no P&L row called "${key}"`).toBeDefined()
      return row?.values[0] ?? 0
    }
    // The row reports the magnitude; the minus is applied when it is printed.
    const below = at('channelCharges') + at('fixedExpenses')
    expect(at('contribution') - below).toBeCloseTo(at('ebitda'), 6)
  })

  it('P&L: the marketplace and marketing rows are the whole of each section', () => {
    const built = buildMultiMonthPnl(['2026-09'], () => computeSubtotals(EVERY_LINE), computeSubtotals)
    const at = (key: string): number => built.rows.find((r) => r.def.key === key)?.values[0] ?? 0
    const total = (section: PnlSection): number =>
      inputsIn(section).reduce((sum, k) => sum + (EVERY_LINE[k] ?? 0), 0)
    expect(Math.abs(at('marketplaceCosts'))).toBeCloseTo(total('marketplaceVariable'), 6)
    expect(Math.abs(at('marketing'))).toBeCloseTo(total('marketing'), 6)
  })

  it('P&L: every input line the structure declares is on a row somewhere', () => {
    // A line that is computed, rolled into EBITDA, and shown nowhere is the
    // shape `channelCharges` was in before it got a row.
    const shown = new Set(PNL_ROWS.map((r) => r.key))
    const summed = new Set<string>()
    for (const section of ['marketplaceVariable', 'marketing', 'opex'] as const) {
      for (const k of inputsIn(section)) summed.add(k)
    }
    for (const def of PNL_STRUCTURE.filter((d) => d.kind === 'input')) {
      expect(shown.has(def.key) || summed.has(def.key), `${def.key} appears on no P&L row`).toBe(true)
    }
  })
})

/**
 * A statement kept in a foreign currency is converted for the rupee view
 * rather than recomputed, so the two readings cannot drift. Which puts the
 * whole weight on the converter knowing which lines are money.
 *
 * Amazon UAE's converter worked from a hand-kept list of keys, and the ladder
 * work added CM2 and CM3 without adding them to it: two margins printed in
 * dirhams against rupee figures, about a twenty-sixth of their real size,
 * with the percentages beside them still correct — so the line and its own
 * margin contradicted each other and nothing said which to believe.
 */
describe('a foreign-currency statement converts every line and only the money', () => {
  const RATE = 25.93

  it('Amazon UAE: money converts, ratios and tallies do not', () => {
    const facts = {
      month: '2026-09', schemaVersion: 1 as const,
      grossSalesAed: 7_501.29, netSalesAed: 7_250.33, netProceedsAed: 4_311.287,
      unitsSoldQty: 241, unitsReturnedQty: 7, netUnitsSoldQty: 234, nonSellingRows: 3,
    }
    const aed = computeAmazonAePnl(facts, 2_553.19, 400, 1_531.91, 945.96)
    const inr = amazonAeValuesInInr(aed, RATE)
    for (const def of AMAZON_AE_LINE_DEFS) {
      const before = aed[def.key] ?? 0
      if (def.kind === 'percent' || def.kind === 'count') {
        expect(inr[def.key], `${def.key} is not money`).toBeCloseTo(before, 6)
      } else {
        expect(inr[def.key], `${def.key} is money`).toBeCloseTo(before * RATE, 6)
      }
    }
  })

  /**
   * Amazon USA's converter has the opposite shape: it converts everything
   * whose key does not end in `Pct`. Correct today because that statement has
   * no tally on it — and the day one is added, the rupee view would multiply
   * a unit count by the exchange rate and report 6,000 units sold where 234
   * were.
   */
  it('Amazon USA: has no tally for its rule to multiply', () => {
    const counts = AMAZON_USA_LINE_DEFS.filter((d) => d.kind === 'count')
    expect(
      counts.map((d) => d.key),
      'this statement now has a tally, so its converter must skip it by kind rather than by key name',
    ).toEqual([])
  })

  it('Amazon USA: leaves the percentages alone and converts the rest', () => {
    const values = { netSalesUsd: 1_000, cm1: 400, cm1Pct: 40 }
    const inr = amazonUsaValuesInInr(values, 88)
    expect(inr.netSalesUsd).toBeCloseTo(88_000, 6)
    expect(inr.cm1).toBeCloseTo(35_200, 6)
    expect(inr.cm1Pct).toBeCloseTo(40, 6)
  })
})

/**
 * Two lists that are still written out by hand because what they cover is a
 * judgement rather than a section of the P&L. They are held to their purpose
 * here instead.
 */
describe('the lists that stay hand-kept are still complete', () => {
  it('every statement deducts head office on a key the router knows', () => {
    const route = readFileSync(new URL('./channelPnlRouter.ts', import.meta.url), 'utf8')
    const known = /const ALLOCATED_COST_KEYS = \[([^\]]*)\]/.exec(route)?.[1] ?? ''
    const keys = [...known.matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect(keys.length).toBeGreaterThan(0)

    // The line is named the same on all twelve, so the label finds it
    // whatever each statement calls its key.
    for (const [channel, defs] of [
      ['amazon_ae', AMAZON_AE_LINE_DEFS], ['amazon_usa', AMAZON_USA_LINE_DEFS],
    ] as const) {
      const line = defs.find((d) => d.label === '(−) Allocated Fixed Expenses')
      expect(line, `${channel} has no allocated-fixed-expenses line`).toBeDefined()
      expect(keys, `${channel} deducts head office on a key the router does not look for`)
        .toContain(line?.key)
    }
  })

  it('the fees statement can read every charge bucket the P&L has', () => {
    const src = readFileSync(new URL('./feesStatement.ts', import.meta.url), 'utf8')
    const block = /const CANONICAL_AS_FEE[^[]*\[([\s\S]*?)\n\]/.exec(src)?.[1] ?? ''
    const mapped = new Set([...block.matchAll(/line: '([^']+)'/g)].map((m) => m[1]))
    for (const key of [...inputsIn('marketplaceVariable'), ...inputsIn('marketing')]) {
      expect(mapped.has(key), `${key} reaches no line on the fees statement`).toBe(true)
    }
  })
})
