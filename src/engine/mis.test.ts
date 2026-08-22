import { describe, expect, it } from 'vitest'
import { buildMisRows } from './mis'
import type { PnlLineValues } from '@/data/models'

describe('buildMisRows', () => {
  const linesByMonth: Record<string, PnlLineValues> = {
    '2025-07': { grossSales: 900, netSales: 850, cogs: 400, grossProfit: 450, grossMarginPct: 52.9, contributionProfit: 200, contributionMarginPct: 23.5, ebitda: 100, ebitdaMarginPct: 11.8, salaries: 50, rent: 20 },
    '2026-06': { grossSales: 1000, netSales: 900, cogs: 400, grossProfit: 500, grossMarginPct: 55.6, contributionProfit: 250, contributionMarginPct: 27.8, ebitda: 150, ebitdaMarginPct: 16.7, salaries: 60, rent: 20 },
    '2026-07': { grossSales: 1200, netSales: 1100, cogs: 450, grossProfit: 650, grossMarginPct: 59.1, contributionProfit: 300, contributionMarginPct: 27.3, ebitda: 180, ebitdaMarginPct: 16.4, salaries: 60, rent: 20 },
  }

  function getLines(month: string): PnlLineValues {
    return linesByMonth[month] ?? {}
  }

  it('computes MoM growth for absolute particulars', () => {
    const rows = buildMisRows('2026-07', getLines)
    const grossSales = rows.find((r) => r.particular === 'Gross Sales')!
    expect(grossSales.currentMonth).toBe(1200)
    expect(grossSales.previousMonth).toBe(1000)
    expect(grossSales.momPct).toBeCloseTo(20)
  })

  it('treats percentage particulars as point deltas, not growth %', () => {
    const rows = buildMisRows('2026-07', getLines)
    const gm = rows.find((r) => r.particular === 'Gross Margin %')!
    expect(gm.currentMonth).toBeCloseTo(59.1)
    expect(gm.momPct).toBeCloseTo(59.1 - 55.6)
  })

  it('computes YoY against the same month one year prior', () => {
    const rows = buildMisRows('2026-07', getLines)
    const grossSales = rows.find((r) => r.particular === 'Gross Sales')!
    expect(grossSales.yoyPct).toBeCloseTo(((1200 - 900) / 900) * 100)
  })

  it('returns zeros (not NaN) for months with no data', () => {
    const rows = buildMisRows('2020-01', getLines)
    const grossSales = rows.find((r) => r.particular === 'Gross Sales')!
    expect(grossSales.currentMonth).toBe(0)
    expect(grossSales.momPct).toBe(0)
  })
})
