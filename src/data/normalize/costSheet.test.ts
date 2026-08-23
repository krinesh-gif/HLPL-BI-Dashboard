import { describe, expect, it } from 'vitest'
import { detectCostSheet, normalizeCostSheet, parseCost, parseEffectiveMonth } from './costSheet'

const OPTIONS = { defaultEffectiveFrom: '2026-08', fileName: 'costs.xlsx', uploadedAt: '2026-08-23T00:00:00Z' }

describe('recognising a cost sheet', () => {
  it('accepts the layout the owner works from', () => {
    expect(detectCostSheet(['SKU', 'Product', 'Old COGS', 'New COGS', 'Effective From'])).toBe(true)
  })

  it('accepts a minimal sheet with no effective-month column', () => {
    expect(detectCostSheet(['SKU', 'COGS'])).toBe(true)
  })

  it('rejects an unrelated file', () => {
    expect(detectCostSheet(['amazon-order-id', 'purchase-date', 'quantity'])).toBe(false)
  })
})

describe('reading the effective month', () => {
  it('accepts the spellings a spreadsheet actually contains', () => {
    expect(parseEffectiveMonth('Aug 2026')).toBe('2026-08')
    expect(parseEffectiveMonth('August 2026')).toBe('2026-08')
    expect(parseEffectiveMonth('2026-08')).toBe('2026-08')
    expect(parseEffectiveMonth('2026-8')).toBe('2026-08')
    expect(parseEffectiveMonth('08/2026')).toBe('2026-08')
    expect(parseEffectiveMonth('2026-08-15')).toBe('2026-08')
    expect(parseEffectiveMonth('Aug-26')).toBe('2026-08')
  })

  it('reads an Excel serial date', () => {
    // 46235 is 2026-08-15 in Excel's day count.
    expect(parseEffectiveMonth(46235)).toBe('2026-08')
  })

  it('refuses to guess at something unreadable', () => {
    expect(parseEffectiveMonth('next quarter')).toBeNull()
    expect(parseEffectiveMonth('2026-13')).toBeNull()
    expect(parseEffectiveMonth('')).toBeNull()
    expect(parseEffectiveMonth(null)).toBeNull()
  })
})

describe('reading a cost', () => {
  it('strips the currency formatting people type', () => {
    expect(parseCost('₹55')).toBe(55)
    expect(parseCost('1,234.50')).toBe(1234.5)
    expect(parseCost(55)).toBe(55)
    expect(parseCost(' 55 ')).toBe(55)
  })

  it('returns null for text that is not a number', () => {
    expect(parseCost('TBD')).toBeNull()
    expect(parseCost('')).toBeNull()
  })
})

describe('normalizing a cost sheet', () => {
  const headers = ['SKU', 'Product', 'Old COGS', 'New COGS', 'Effective From']

  it('produces one version per row, from the row own month', () => {
    const result = normalizeCostSheet(
      [
        { SKU: 'SKU001', Product: 'Rosemary 15 ml', 'Old COGS': '₹50', 'New COGS': '₹55', 'Effective From': 'Aug 2026' },
        { SKU: 'SKU002', Product: 'Shampoo', 'Old COGS': '₹80', 'New COGS': '₹85', 'Effective From': 'Sep 2026' },
      ],
      headers,
      OPTIONS,
    )

    expect(result.versions).toHaveLength(2)
    expect(result.versions[0]).toMatchObject({ sku: 'SKU001', cogs: 55, effectiveFrom: '2026-08', source: 'cost-sheet' })
    expect(result.versions[1]).toMatchObject({ sku: 'SKU002', cogs: 85, effectiveFrom: '2026-09' })
    expect(result.rejected).toHaveLength(0)
  })

  it('ignores the Old COGS column entirely', () => {
    // Trusting it would let a stale sheet rewrite a cost that has moved on.
    const result = normalizeCostSheet(
      [{ SKU: 'SKU001', 'Old COGS': '₹999', 'New COGS': '₹55', 'Effective From': 'Aug 2026' }],
      headers,
      OPTIONS,
    )
    expect(result.versions).toHaveLength(1)
    expect(result.versions[0].cogs).toBe(55)
  })

  it('falls back to the month chosen on the form when the file has no column', () => {
    const result = normalizeCostSheet([{ SKU: 'SKU001', COGS: '55' }], ['SKU', 'COGS'], OPTIONS)
    expect(result.versions[0].effectiveFrom).toBe('2026-08')
    expect(result.warnings.some((w) => w.includes('No "Effective From" column'))).toBe(true)
  })

  it('rejects a row with an unreadable month rather than silently defaulting it', () => {
    const result = normalizeCostSheet(
      [{ SKU: 'SKU001', 'New COGS': '55', 'Effective From': 'sometime soon' }],
      headers,
      OPTIONS,
    )
    expect(result.versions).toHaveLength(0)
    expect(result.rejected[0].reason).toMatch(/Could not read a month/)
  })

  it('rejects an unreadable or negative cost, naming the row', () => {
    const result = normalizeCostSheet(
      [
        { SKU: 'SKU001', 'New COGS': 'TBD', 'Effective From': 'Aug 2026' },
        { SKU: 'SKU002', 'New COGS': '-5', 'Effective From': 'Aug 2026' },
      ],
      headers,
      OPTIONS,
    )
    expect(result.versions).toHaveLength(0)
    expect(result.rejected).toHaveLength(2)
    expect(result.rejected[0].row).toBe(2)
    expect(result.rejected[1].reason).toMatch(/negative/)
  })

  it('skips blank padding rows without calling them errors', () => {
    const result = normalizeCostSheet(
      [
        { SKU: 'SKU001', 'New COGS': '55', 'Effective From': 'Aug 2026' },
        { SKU: '', 'New COGS': '', 'Effective From': '' },
      ],
      headers,
      OPTIONS,
    )
    expect(result.versions).toHaveLength(1)
    expect(result.rejected).toHaveLength(0)
  })

  it('says so when the file is not a cost sheet at all', () => {
    const result = normalizeCostSheet([{ foo: 'bar' }], ['foo'], OPTIONS)
    expect(result.versions).toHaveLength(0)
    expect(result.warnings[0]).toMatch(/needs a SKU column and a cost column/)
  })
})
