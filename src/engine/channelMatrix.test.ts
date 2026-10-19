import { describe, expect, it } from 'vitest'
import { PNL_STRUCTURE } from '@/config/pnlStructure'
import type { PnlLineValues } from '@/data/models'
import { buildMasterPnl, computeSubtotals } from './pnl'
import { PNL_ADDITIVE_KEYS, PNL_ROWS, buildPnlColumns, isEmptyPnlColumn } from './multiMonthPnl'

const row = (built: ReturnType<typeof buildPnlColumns>, key: string) =>
  built.rows.find((r) => r.def.key === key)

const flipkart: PnlLineValues = computeSubtotals({
  grossSales: 1_000_000, returns: 200_000, cogs: 300_000,
  marketplaceCommission: 80_000, ads: 60_000,
  channelCharges: 25_000, fixedExpensesTotal: 90_000,
})
const myntra: PnlLineValues = computeSubtotals({
  grossSales: 600_000, returns: 120_000, cogs: 200_000,
  marketplaceCommission: 50_000, ads: 20_000, fixedExpensesTotal: 50_000,
})

describe('the Total column is the Master Company', () => {
  /**
   * Two reports of one month that are computed two ways eventually disagree,
   * and then a meeting has two EBITDAs for September. The channels-across
   * table sums the same input lines `buildMasterPnl` sums, so they cannot.
   */
  it('sums the channels to exactly what buildMasterPnl gives', () => {
    const lines = { flipkart, myntra } as Record<string, PnlLineValues>
    const built = buildPnlColumns(['flipkart', 'myntra'], (c) => lines[c], computeSubtotals)
    const master = buildMasterPnl(
      [
        { channel: 'flipkart', month: '2026-09', lines: flipkart },
        { channel: 'myntra', month: '2026-09', lines: myntra },
      ],
      '2026-09',
    ).lines

    for (const def of PNL_ROWS) {
      expect(row(built, def.key)?.total, def.key).toBeCloseTo(def.total(master) ?? 0, 6)
    }
  })

  it('is unmoved by leaving an empty channel out, which is what makes hiding one safe', () => {
    const lines = { flipkart, myntra, nykaa: computeSubtotals({}) } as Record<string, PnlLineValues>
    const withEmpty = buildPnlColumns(['flipkart', 'myntra', 'nykaa'], (c) => lines[c], computeSubtotals)
    const without = buildPnlColumns(['flipkart', 'myntra'], (c) => lines[c], computeSubtotals)
    expect(row(withEmpty, 'ebitda')?.total).toBe(row(without, 'ebitda')?.total)
    expect(isEmptyPnlColumn(lines.nykaa)).toBe(true)
    expect(isEmptyPnlColumn(flipkart)).toBe(false)
  })
})

describe('channel charges are on the report', () => {
  /**
   * They were not. `channelCharges` was added to the structure and to the
   * subtotals, so EBITDA was right, but no row read it and no total summed it.
   * Flipkart's September showed a contribution, a fixed-expense line, and then
   * an EBITDA 25,000 below the two of them — and the Jul-Sep Total column read
   * an EBITDA 75,000 too high.
   */
  it('lets a column with a channel charge add up', () => {
    const built = buildPnlColumns(['flipkart'], () => flipkart, computeSubtotals)
    const at = (key: string) => row(built, key)?.values[0] ?? 0
    expect(at('contribution') - at('channelCharges') - at('fixedExpenses')).toBeCloseTo(at('ebitda'), 6)
  })

  it('carries them into the Total column', () => {
    const built = buildPnlColumns(['a', 'b', 'c'], () => flipkart, computeSubtotals)
    expect(row(built, 'channelCharges')?.total).toBe(75_000)
    const ebitda = row(built, 'ebitda')!
    expect(ebitda.total).toBeCloseTo((ebitda.values as number[]).reduce((a, b) => a + b, 0), 6)
  })

  it('shows the row only where there are charges, so nine channels do not read as nine blanks', () => {
    const withCharge = buildPnlColumns(['flipkart'], () => flipkart, computeSubtotals)
    const without = buildPnlColumns(['myntra'], () => myntra, computeSubtotals)
    expect(withCharge.rows.map((r) => r.def.key)).toContain('channelCharges')
    expect(without.rows.map((r) => r.def.key)).not.toContain('channelCharges')
  })
})

describe('the additive keys cannot drift from the structure', () => {
  /**
   * The bug above was a hand-kept list that a new line was never added to.
   * Both sums are now taken from `PNL_STRUCTURE`, and this is what says so:
   * add a line there and it is summed everywhere or this test fails.
   */
  it('sums exactly the structure’s input lines', () => {
    expect([...PNL_ADDITIVE_KEYS].sort()).toEqual(
      PNL_STRUCTURE.filter((d) => d.kind === 'input').map((d) => d.key).sort(),
    )
  })
})
