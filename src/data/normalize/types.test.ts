import { describe, expect, it } from 'vitest'
import { getField, headersPresent, normalizeHeaderKey } from './types'

/**
 * Marketplaces restyle their headers without telling anyone, and because the
 * column names are what identify a file, a restyling can stop an export
 * being recognised at all. Walmart's October 2026 item export underscored
 * every header and the upload refused it; Snapdeal renamed one column and the
 * same thing happened. So the reduction a reader matches on is tested here.
 */
describe('reducing a column name to what it means', () => {
  it('treats an underscore as a space', () => {
    expect(normalizeHeaderKey('Units_Sold')).toBe('units sold')
    expect(normalizeHeaderKey('GMV_Minus_Commission')).toBe('gmv minus commission')
  })

  it('reads the spellings of one column as one column', () => {
    for (const spelling of ['Units Sold', 'Units_Sold', 'UNITS SOLD', 'units.sold', '  Units   Sold  ']) {
      expect(normalizeHeaderKey(spelling)).toBe('units sold')
    }
  })

  it('keeps candidates that are already written with underscores working', () => {
    // Several readers spell their candidates this way — `ad_spend`,
    // `campaign_id` — and both sides are reduced the same way, so they go on
    // matching whichever spelling the file uses.
    expect(headersPresent(['Ad_Spend'], ['ad_spend'])).toBe(true)
    expect(headersPresent(['Ad Spend'], ['ad_spend'])).toBe(true)
    expect(headersPresent(['ad_spend'], ['ad spend'])).toBe(true)
  })

  it('does not run two different columns together', () => {
    expect(normalizeHeaderKey('Cancelled_Sales')).not.toBe(normalizeHeaderKey('Cancelled_Units'))
    expect(normalizeHeaderKey('Auth_Sales')).not.toBe(normalizeHeaderKey('Refund_Sales'))
  })

  it('drops a parenthesised aside, which is how a rate is written', () => {
    expect(normalizeHeaderKey('TCS(0.5%)')).toBe('tcs')
    expect(normalizeHeaderKey('SGST Rate (or UTGST as applicable)')).toBe('sgst rate')
  })

  it('finds a value under whichever spelling the row uses', () => {
    expect(getField({ Units_Sold: '6' }, ['units sold'])).toBe('6')
    expect(getField({ 'Units Sold': '6' }, ['units sold'])).toBe('6')
    expect(getField({ Units_Sold: '6' }, ['something else'])).toBeUndefined()
  })
})
