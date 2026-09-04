import { describe, expect, it } from 'vitest'
import { NATIVE_PNL_ASSUMPTIONS } from '@/config/nativePnlAssumptions'
import { fxRateForMonth, lineValuesToUsd, monthsMissingFxRate, type FxRate } from './fxRates'

/**
 * The rate scales an entire channel, so where it comes from has to be visible.
 * A month that was closed at 88.10 must keep reading 88.10 no matter what this
 * month's rate is — the same rule the cost sheet follows.
 */
const rates: FxRate[] = [
  { month: '2026-06', rate: 88.1, note: 'HDFC remittance advice' },
  { month: '2026-07', rate: 89.45 },
]

describe('the rate for a month', () => {
  it('is the one entered for that month', () => {
    expect(fxRateForMonth('2026-06', rates)).toMatchObject({ rate: 88.1, entered: true })
  })

  it('holds a closed month at the rate it was closed on', () => {
    // June keeps 88.10 even though July is 89.45.
    expect(fxRateForMonth('2026-06', rates).rate).toBe(88.1)
    expect(fxRateForMonth('2026-07', rates).rate).toBe(89.45)
  })

  it('falls back to the configured default, and says that it did', () => {
    const r = fxRateForMonth('2026-08', rates)
    expect(r.rate).toBe(NATIVE_PNL_ASSUMPTIONS.usdToInrRate)
    expect(r.entered).toBe(false)
  })

  it('does not interpolate or borrow a neighbouring month', () => {
    // A rate invented between June and July would look entered but be fiction.
    expect(fxRateForMonth('2026-08', rates).entered).toBe(false)
    expect(fxRateForMonth('2026-05', rates).entered).toBe(false)
  })

  it('ignores a nonsense rate rather than dividing by it', () => {
    const broken: FxRate[] = [{ month: '2026-06', rate: 0 }, { month: '2026-07', rate: Number.NaN }]
    expect(fxRateForMonth('2026-06', broken).entered).toBe(false)
    expect(fxRateForMonth('2026-07', broken).entered).toBe(false)
  })

  it('carries the note through, so the source of the rate is on screen', () => {
    expect(fxRateForMonth('2026-06', rates).note).toBe('HDFC remittance advice')
  })
})

describe('naming the months without a rate', () => {
  it('lists them so a warning can be specific', () => {
    expect(monthsMissingFxRate(['2026-05', '2026-06', '2026-07', '2026-08'], rates))
      .toEqual(['2026-05', '2026-08'])
  })

  it('is empty when every month has one', () => {
    expect(monthsMissingFxRate(['2026-06', '2026-07'], rates)).toEqual([])
  })
})

describe('restating P&L lines into dollars', () => {
  const inr = { grossSales: 881_000, cogs: -264_000, grossProfit: 617_000, grossMarginPct: 70.03 }

  it('divides every money line by the rate', () => {
    const usd = lineValuesToUsd(inr, 88.1)
    expect(usd.grossSales).toBeCloseTo(10_000, 6)
    expect(usd.cogs).toBeCloseTo(-2996.59, 2)
  })

  it('leaves margin percentages untouched', () => {
    // A margin is a ratio, so it reads the same in either currency. Dividing
    // 70.03% by 88.1 would have printed 0.8% the moment the toggle moved.
    expect(lineValuesToUsd(inr, 88.1).grossMarginPct).toBe(70.03)
  })

  it('round-trips exactly against the rate the rupee figure was built at', () => {
    const usd = lineValuesToUsd({ netSales: 9_000 * 88.1 }, 88.1)
    expect(usd.netSales).toBeCloseTo(9_000, 6)
  })

  it('refuses a nonsense rate rather than dividing by it', () => {
    expect(lineValuesToUsd(inr, 0)).toBe(inr)
    expect(lineValuesToUsd(inr, Number.NaN)).toBe(inr)
  })

  it('drops nothing and invents nothing', () => {
    expect(Object.keys(lineValuesToUsd(inr, 88.1)).sort()).toEqual(Object.keys(inr).sort())
  })
})
