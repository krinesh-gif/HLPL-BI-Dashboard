import { describe, expect, it } from 'vitest'
import { fiscalYearLabel, formatCurrencyCompact, formatCurrencyFull, formatPercent, ytdMonthKeys } from './format'

describe('formatCurrencyCompact', () => {
  it('formats crores and lakhs for INR', () => {
    expect(formatCurrencyCompact(12500000)).toBe('₹1.25 Cr')
    expect(formatCurrencyCompact(854000)).toBe('₹8.54 L')
  })

  it('formats small values without a unit suffix', () => {
    expect(formatCurrencyCompact(450)).toBe('₹450')
  })

  it('formats USD in K/M', () => {
    expect(formatCurrencyCompact(2500000, 'USD')).toBe('$2.50M')
    expect(formatCurrencyCompact(4200, 'USD')).toBe('$4.2K')
  })

  it('handles negative values', () => {
    expect(formatCurrencyCompact(-150000)).toBe('-₹1.50 L')
  })
})

describe('formatCurrencyFull', () => {
  it('uses Indian digit grouping', () => {
    expect(formatCurrencyFull(1245000)).toBe('₹12,45,000')
  })
})

describe('formatPercent', () => {
  it('formats with one decimal by default', () => {
    expect(formatPercent(18.4321)).toBe('18.4%')
  })
})

describe('fiscalYearLabel', () => {
  it('assigns April onward to the fiscal year starting that April', () => {
    expect(fiscalYearLabel('2026-04')).toBe('FY27')
    expect(fiscalYearLabel('2026-08')).toBe('FY27')
  })

  it('assigns Jan-Mar to the fiscal year that started the previous April', () => {
    expect(fiscalYearLabel('2026-02')).toBe('FY26')
  })
})

describe('ytdMonthKeys', () => {
  it('returns all months from FY start through the given month', () => {
    expect(ytdMonthKeys('2026-08')).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08'])
  })

  it('handles a month within the Jan-Mar tail of the fiscal year', () => {
    expect(ytdMonthKeys('2026-02')).toEqual([
      '2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09',
      '2025-10', '2025-11', '2025-12', '2026-01', '2026-02',
    ])
  })
})
