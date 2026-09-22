import { describe, expect, it } from 'vitest'
import { parseInSlashDate } from './reportDate'

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
