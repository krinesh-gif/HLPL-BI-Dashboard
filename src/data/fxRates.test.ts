import { describe, expect, it } from 'vitest'
import { NATIVE_PNL_ASSUMPTIONS } from '@/config/nativePnlAssumptions'
import { fxRateForMonth, lineValuesFromInr, lineValuesToUsd, monthsMissingFxRate, pairOf, type FxRate } from './fxRates'
import { currencyName } from '@/lib/format'

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

describe('a second currency', () => {
  // Amazon UAE settles in dirhams. The rates share one table, so the risk is
  // one currency's month answering for the other's.
  const RATES: FxRate[] = [
    { month: '2026-09', rate: 88.4 },
    { month: '2026-09', pair: 'AEDINR', rate: 24.07 },
    { month: '2026-08', pair: 'USDINR', rate: 87.9 },
  ]

  it('keeps each currency to its own rate', () => {
    expect(fxRateForMonth('2026-09', RATES).rate).toBe(88.4)
    expect(fxRateForMonth('2026-09', RATES, 'AEDINR').rate).toBe(24.07)
  })

  it('reads a row with no pair as the dollar, which is what it was', () => {
    // Every rate stored before the dirham existed here is a dollar rate, and
    // defaulting rather than backfilling keeps those rows meaning what they
    // meant. Read as dirhams they would restate Amazon USA by 3.7 times.
    expect(pairOf({ month: '2026-09', rate: 88.4 })).toBe('USDINR')
    expect(fxRateForMonth('2026-09', [{ month: '2026-09', rate: 88.4 }], 'AEDINR').entered).toBe(false)
  })

  it('does not let one currency borrow the other’s month', () => {
    // August has a dollar rate and no dirham rate. The dirham must fall back
    // and say so, not quietly use 87.9 and overstate the month fourfold.
    const aed = fxRateForMonth('2026-08', RATES, 'AEDINR')
    expect(aed.entered).toBe(false)
    expect(aed.rate).toBeCloseTo(NATIVE_PNL_ASSUMPTIONS.aedToInrRate, 6)
  })

  it('names the months missing a rate for the currency being asked about', () => {
    expect(monthsMissingFxRate(['2026-08', '2026-09'], RATES)).toEqual([])
    expect(monthsMissingFxRate(['2026-08', '2026-09'], RATES, 'AEDINR')).toEqual(['2026-08'])
  })

  it('falls back near the peg, so an unentered month is not wild', () => {
    // 3.6725 dirhams to the dollar. Not a market quote — a standing figure the
    // screen says out loud it is using until a real one is entered.
    expect(NATIVE_PNL_ASSUMPTIONS.aedToInrRate * 3.6725).toBeCloseTo(NATIVE_PNL_ASSUMPTIONS.usdToInrRate, 6)
  })
})

describe('restating a statement out of rupees', () => {
  // The bug this exists for: the P&L converted only when the display currency
  // was exactly 'USD', so Amazon UAE fell through and printed rupees under a
  // dirham symbol. Both views of the toggle showed AED 194,451.41 and
  // ₹1,94,451 — the same figure twice.
  const LINES = { grossSales: 194_451.41, netSales: 174_515, grossMarginPct: 58.3 }

  it('actually divides, for every currency and not just the dollar', () => {
    const aed = lineValuesFromInr(LINES, 25.922)
    expect(aed.grossSales).toBeCloseTo(7501.4, 1)
    expect(aed.grossSales).not.toBeCloseTo(LINES.grossSales, 0)

    const usd = lineValuesFromInr(LINES, 88)
    expect(usd.grossSales).toBeCloseTo(2209.68, 2)
  })

  it('leaves a margin alone, because a ratio is the same in any currency', () => {
    // Dividing it too would turn 58.3% into 2.2% the moment the reader
    // switched currency, which is how a toggle becomes a wrong-decision
    // machine.
    expect(lineValuesFromInr(LINES, 25.922).grossMarginPct).toBe(58.3)
    expect(lineValuesFromInr(LINES, 88).grossMarginPct).toBe(58.3)
  })

  it('refuses a rate that would destroy the figures', () => {
    // A zero or negative rate divides to infinity or flips every sign. The
    // rupees are wrong in the wrong currency, which is better than that.
    expect(lineValuesFromInr(LINES, 0)).toEqual(LINES)
    expect(lineValuesFromInr(LINES, -5)).toEqual(LINES)
  })

  it('names each currency the same way everywhere', () => {
    // Both snapshot pages described dirhams as rupees, each having decided
    // for itself that anything not a dollar was a rupee.
    expect(currencyName('INR')).toBe('Indian rupees')
    expect(currencyName('USD')).toBe('US dollars')
    expect(currencyName('AED')).toBe('UAE dirhams')
  })
})
