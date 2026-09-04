import { describe, expect, it } from 'vitest'
import { NATIVE_PNL_ASSUMPTIONS } from '@/config/nativePnlAssumptions'
import { fxRateForMonth, monthsMissingFxRate, type FxRate } from './fxRates'

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
