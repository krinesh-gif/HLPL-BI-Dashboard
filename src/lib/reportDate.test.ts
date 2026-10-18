import { describe, expect, it } from 'vitest'
import { excelSerialDate, excelSerialToDate, parseInSlashDate, parseReportDate } from './reportDate'

describe('Amazon India settlement dates', () => {
  it('reads the dotted day-first form the settlement report writes', () => {
    const d = parseInSlashDate('02.08.2026')
    expect(d?.getFullYear()).toBe(2026)
    expect(d?.getMonth()).toBe(7)
    expect(d?.getDate()).toBe(2)
  })

  it('takes the date from a UTC timestamp without converting it', () => {
    // 20:42 UTC is 01:12 the next morning in India. Converting would move this
    // row into August 3rd, and every settlement period would lose a day at one
    // end and gain one at the other.
    const d = parseInSlashDate('02.08.2026 20:42:18 UTC')
    expect(d?.getDate()).toBe(2)
    expect(d?.getMonth()).toBe(7)
  })

  it('still reads the slashed two-digit form', () => {
    expect(parseInSlashDate('31/07/26')?.getMonth()).toBe(6)
  })
})

/**
 * A date cell from a workbook, which arrives as the number Excel stores.
 *
 * September's Sponsored Brands export is the case this exists for: 377 rows
 * whose Date column read "46266", "46267", "46268". `new Date('46266')` is
 * not a failure — V8 reads it as the year 46266 — so every row imported under
 * the month "46266-00", a month no screen shows and no P&L charges.
 */
describe('Excel serial dates', () => {
  it('reads the serial a workbook stores a date as', () => {
    // The first and last days of September's Sponsored Brands export.
    expect(excelSerialDate(46266)).toBe('2026-09-01')
    expect(excelSerialDate('46295')).toBe('2026-09-30')
    const d = excelSerialToDate(46266)
    expect([d?.getFullYear(), d?.getMonth(), d?.getDate()]).toEqual([2026, 8, 1])
  })

  it('rejects a number that is not a date', () => {
    expect(excelSerialDate(9)).toBeNull()
    expect(excelSerialDate('')).toBeNull()
    expect(excelSerialDate('B0CPFP8NNB')).toBeNull()
    expect(excelSerialDate(1e9)).toBeNull()
  })

  it('reads one through parseReportDate, whichever convention is asked for', () => {
    for (const convention of ['us', 'in', 'iso'] as const) {
      const d = parseReportDate('46266', convention)
      expect([d?.getFullYear(), d?.getMonth(), d?.getDate()]).toEqual([2026, 8, 1])
    }
  })

  it('refuses a date no marketplace could have written', () => {
    // What the engine made of "46266" before the serial was read.
    expect(parseReportDate('Jan 1, 46266', 'us')).toBeNull()
    expect(parseReportDate('not a date at all', 'us')).toBeNull()
  })

  it('still reads the ordinary forms', () => {
    expect(parseReportDate('May 01, 2026', 'us')?.getMonth()).toBe(4)
    expect(parseReportDate('2026-09-30', 'iso')?.getDate()).toBe(30)
    expect(parseReportDate('6/1/2026', 'us')?.getDate()).toBe(1)
  })
})
