import { describe, expect, it } from 'vitest'
import { hasSheets, mergeHeaderRows, rowsToRecords, sheetKey, sheetNamed, type RawSheet } from './csvParse'

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

describe('finding a sheet whose name has drifted', () => {
  // Myntra's P&L arrived as `PnL_Summary`. The same export under any other
  // punctuation is the same sheet, and rejecting a month's whole P&L over a
  // space is how "not recognised" kept happening.
  const sheets = {
    'PnL Summary': [['a']] as RawSheet,
    'sku-detail': [['b']] as RawSheet,
    'Orders P&L ': [['c']] as RawSheet,
  }

  it('matches a name however it is punctuated or cased', () => {
    expect(sheetNamed(sheets, 'PnL_Summary')).toEqual([['a']])
    expect(sheetNamed(sheets, 'SKU_Detail')).toEqual([['b']])
    expect(sheetNamed(sheets, 'Orders P&L')).toEqual([['c']])
  })

  it('takes the first of several candidate names', () => {
    expect(sheetNamed(sheets, 'Nothing Here', 'SKU_Detail')).toEqual([['b']])
  })

  it('returns nothing for a sheet that is genuinely absent', () => {
    // Absent has to stay absent: a loose match that found any sheet would
    // read one report as another.
    expect(sheetNamed(sheets, 'Order Payments')).toBeUndefined()
    expect(sheetNamed({}, 'PnL_Summary')).toBeUndefined()
  })

  it('holds a workbook to carrying every sheet it needs', () => {
    expect(hasSheets(Object.keys(sheets), 'PnL_Summary', 'SKU_Detail')).toBe(true)
    expect(hasSheets(Object.keys(sheets), 'PnL_Summary', 'Ads Cost')).toBe(false)
  })

  it('reduces a name to what it means', () => {
    expect(sheetKey('PnL_Summary')).toBe(sheetKey('pnl summary'))
    expect(sheetKey(' Orders P&L ')).toBe(sheetKey('orders-p-l'))
    expect(sheetKey('SKU_Detail')).not.toBe(sheetKey('SKU_Details'))
  })
})
