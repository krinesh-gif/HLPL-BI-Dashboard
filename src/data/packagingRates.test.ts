import { describe, expect, it } from 'vitest'
import { MEESHO_ASSUMPTIONS } from '@/config/nativePnlAssumptions'
import { monthsMissingPackagingRate, packagingRateForMonth, packagingRateValue } from './packagingRates'
import type { PackagingRate } from './packagingRates'

const rates: PackagingRate[] = [
  { month: '2026-07', perShipmentInr: 6.4 },
  { month: '2026-08', perShipmentInr: 7.1, note: 'Mailer price rose in August' },
]

describe('the packaging rate for a month', () => {
  it('takes the month’s own rate when one is entered', () => {
    expect(packagingRateValue('2026-08', rates)).toBe(7.1)
    expect(packagingRateForMonth('2026-08', rates).note).toBe('Mailer price rose in August')
  })

  it('keeps each month on its own rate, so a closed month is not restated', () => {
    // The whole reason this is dated rather than constant: July was packed at
    // one price and August at another, and a single figure would have quietly
    // repriced July the moment August was entered.
    expect(packagingRateValue('2026-07', rates)).toBe(6.4)
    expect(packagingRateValue('2026-08', rates)).toBe(7.1)
  })

  it('never borrows a neighbouring month’s rate', () => {
    // An exact match or the standing figure. Reading June at July's rate would
    // put a number on the statement that nobody entered for June.
    const june = packagingRateForMonth('2026-06', rates)
    expect(june.entered).toBe(false)
    expect(june.perShipmentInr).toBe(MEESHO_ASSUMPTIONS.packagingPerShipment)
  })

  it('treats an entered zero as entered, not as missing', () => {
    // A month whose parcels cost nothing to pack is a real answer, and it must
    // not fall through to the standing ₹5.
    const free = packagingRateForMonth('2026-09', [{ month: '2026-09', perShipmentInr: 0 }])
    expect(free).toMatchObject({ perShipmentInr: 0, entered: true })
  })

  it('ignores a negative rate rather than charging a credit per parcel', () => {
    expect(packagingRateForMonth('2026-09', [{ month: '2026-09', perShipmentInr: -2 }]).entered).toBe(false)
  })

  it('names the months still on the standing figure', () => {
    expect(monthsMissingPackagingRate(['2026-06', '2026-07', '2026-08'], rates)).toEqual(['2026-06'])
  })
})
