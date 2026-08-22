import { describe, expect, it } from 'vitest'
import { mergeHeaderRows, rowsToRecords } from './csvParse'

describe('mergeHeaderRows', () => {
  it('prefers the lower row label when present', () => {
    const upper = ['SKU ID', 'Gross Units', 'Total Expenses (Breakup)', undefined]
    const lower = ['', '', 'Commission Fee', 'Fixed Fee']
    expect(mergeHeaderRows(upper, lower)).toEqual(['SKU ID', 'Gross Units', 'Commission Fee', 'Fixed Fee'])
  })

  it('handles rows of different lengths', () => {
    expect(mergeHeaderRows(['A', 'B'], ['', 'C', 'D'])).toEqual(['A', 'C', 'D'])
  })
})

describe('rowsToRecords', () => {
  it('converts raw rows into keyed records starting from the data row', () => {
    const raw = [
      ['header row 1'],
      ['SKU ID', 'Gross Units'],
      ['SKU-A', 10],
      ['SKU-B', 20],
    ]
    const records = rowsToRecords(['SKU ID', 'Gross Units'], raw, 2)
    expect(records).toEqual([
      { 'SKU ID': 'SKU-A', 'Gross Units': '10' },
      { 'SKU ID': 'SKU-B', 'Gross Units': '20' },
    ])
  })

  it('skips columns with an empty header', () => {
    const raw = [['SKU-A', 'ignored', 5]]
    const records = rowsToRecords(['SKU ID', '', 'Qty'], raw, 0)
    expect(records).toEqual([{ 'SKU ID': 'SKU-A', Qty: '5' }])
  })
})
