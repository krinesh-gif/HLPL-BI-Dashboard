import { describe, expect, it } from 'vitest'
import { freightRateForMonth, freightRateValue, monthsMissingFreightRate, type FreightRate } from './freightRates'
import { NATIVE_PNL_ASSUMPTIONS } from '@/config/nativePnlAssumptions'

const rates: FreightRate[] = [
  { month: '2026-08', lane: 'nykaa_inbound', perUnitInr: 1.5, note: 'Rate card slab B' },
  { month: '2026-07', lane: 'nykaa_inbound', perUnitInr: 2 },
  { month: '2026-08', lane: 'india_usa', perUnitInr: 120 },
  // Entered before lanes existed, so it is the airway bill.
  { month: '2026-06', perUnitInr: 115 },
]

describe('freight rates by lane', () => {
  it('keeps the two lanes apart on the same month', () => {
    expect(freightRateValue('2026-08', rates, 'nykaa_inbound')).toBe(1.5)
    expect(freightRateValue('2026-08', rates, 'india_usa')).toBe(120)
  })

  it('reads a rate stored before lanes existed as the airway bill', () => {
    expect(freightRateForMonth('2026-06', rates, 'india_usa').entered).toBe(true)
    expect(freightRateValue('2026-06', rates, 'india_usa')).toBe(115)
    // It must not be borrowed by the other lane, which would put an airway
    // bill's rupees-per-unit on a road shipment and dwarf the channel's COGS.
    expect(freightRateForMonth('2026-06', rates, 'nykaa_inbound').entered).toBe(false)
    expect(freightRateValue('2026-06', rates, 'nykaa_inbound')).toBe(0)
  })

  it('defaults to the airway-bill lane, as every earlier caller meant', () => {
    expect(freightRateValue('2026-06', rates)).toBe(115)
  })

  it('charges nothing for an unentered Nykaa month rather than guessing', () => {
    const r = freightRateForMonth('2026-05', rates, 'nykaa_inbound')
    expect(r.entered).toBe(false)
    expect(r.perUnitInr).toBe(0)
  })

  it('still falls back to the standing figure on the lane that has one', () => {
    const r = freightRateForMonth('2026-05', rates, 'india_usa')
    expect(r.entered).toBe(false)
    expect(r.perUnitInr).toBe(NATIVE_PNL_ASSUMPTIONS.indiaUsaFreightPerUnitInr)
  })

  it('names the months missing a rate, per lane', () => {
    const months = ['2026-06', '2026-07', '2026-08']
    expect(monthsMissingFreightRate(months, rates, 'nykaa_inbound')).toEqual(['2026-06'])
    expect(monthsMissingFreightRate(months, rates, 'india_usa')).toEqual(['2026-07'])
  })

  it('ignores a negative rate rather than crediting freight back', () => {
    expect(freightRateValue('2026-08', [{ month: '2026-08', lane: 'nykaa_inbound', perUnitInr: -5 }], 'nykaa_inbound'))
      .toBe(0)
  })
})
