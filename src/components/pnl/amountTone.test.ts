import { describe, expect, it } from 'vitest'
import { amountTone } from './amountTone'
import { PNL_ROWS } from '@/engine/multiMonthPnl'

describe('amountTone', () => {
  it('paints money coming in green', () => {
    expect(amountTone(448587.69)).toContain('--good-ink')
    expect(amountTone(0.01)).toContain('--good-ink')
  })

  it('paints money going out red', () => {
    expect(amountTone(-137012)).toContain('--critical-ink')
    expect(amountTone(-0.01)).toContain('--critical-ink')
  })

  it('leaves nothing neutral — a line worth zero is not money in', () => {
    expect(amountTone(0)).toContain('--ink-3')
    expect(amountTone(null)).toContain('--ink-3')
    expect(amountTone(undefined)).toContain('--ink-3')
    expect(amountTone(Number.NaN)).toContain('--ink-3')
  })
})

describe('P&L row signs', () => {
  /**
   * The colour rule is only honest if a deduction is shown negative. These
   * rows hold positive magnitudes — `cogs` is what the goods cost — so without
   * a sign the table would print "Less: COGS" in green.
   */
  it('marks every "Less:" row as a deduction', () => {
    for (const row of PNL_ROWS) {
      if (row.label.startsWith('Less:')) {
        expect(row.sign, `${row.key} is a deduction but has no sign`).toBe(-1)
      }
    }
  })

  it('leaves revenue, subtotals and percentages positive', () => {
    for (const row of PNL_ROWS) {
      if (!row.label.startsWith('Less:')) {
        expect(row.sign ?? 1, `${row.key} should not be signed`).toBe(1)
      }
    }
  })

  it('turns a deduction red once its sign is applied', () => {
    const cogs = PNL_ROWS.find((r) => r.key === 'cogs')!
    expect(amountTone(114296 * (cogs.sign ?? 1))).toContain('--critical-ink')
    const netSales = PNL_ROWS.find((r) => r.key === 'netSales')!
    expect(amountTone(448587 * (netSales.sign ?? 1))).toContain('--good-ink')
  })
})
