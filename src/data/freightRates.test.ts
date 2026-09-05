import { describe, expect, it } from 'vitest'
import { NATIVE_PNL_ASSUMPTIONS } from '@/config/nativePnlAssumptions'
import { freightRateForMonth, freightRateValue, monthsMissingFreightRate, type FreightRate } from './freightRates'

const rates: FreightRate[] = [
  { month: '2026-06', perUnitInr: 118.4, note: 'Forwarder invoice' },
  { month: '2026-07', perUnitInr: 96.75 },
]

describe('the freight rate that applied in a month', () => {
  it('uses the rate entered for that month', () => {
    expect(freightRateValue('2026-06', rates)).toBe(118.4)
    expect(freightRateValue('2026-07', rates)).toBe(96.75)
  })

  it('falls back to the default and says it did', () => {
    const r = freightRateForMonth('2026-08', rates)
    expect(r.perUnitInr).toBe(NATIVE_PNL_ASSUMPTIONS.indiaUsaFreightPerUnitInr)
    expect(r.entered).toBe(false)
  })

  it('does not borrow a neighbouring month', () => {
    // A rate invented between June and August would look entered but be fiction.
    expect(freightRateForMonth('2026-05', rates).entered).toBe(false)
  })

  it('accepts zero — a month with no inbound shipment cost nothing to freight', () => {
    const withZero: FreightRate[] = [{ month: '2026-09', perUnitInr: 0 }]
    expect(freightRateForMonth('2026-09', withZero)).toMatchObject({ perUnitInr: 0, entered: true })
  })

  it('ignores a negative or nonsense rate rather than using it', () => {
    const broken: FreightRate[] = [{ month: '2026-06', perUnitInr: -5 }, { month: '2026-07', perUnitInr: Number.NaN }]
    expect(freightRateForMonth('2026-06', broken).entered).toBe(false)
    expect(freightRateForMonth('2026-07', broken).entered).toBe(false)
  })

  it('carries the note through, so the basis of the figure is on screen', () => {
    expect(freightRateForMonth('2026-06', rates).note).toBe('Forwarder invoice')
  })

  it('names the months with nothing entered', () => {
    expect(monthsMissingFreightRate(['2026-05', '2026-06', '2026-07', '2026-08'], rates))
      .toEqual(['2026-05', '2026-08'])
  })
})
