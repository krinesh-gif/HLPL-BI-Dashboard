import { describe, expect, it } from 'vitest'
import {
  detectAmazonAdsSpendByMonth, monthKeyFor, normalizeAmazonAdsSpendByMonth, reportDownloadDate, unarmour,
} from './amazonAdsSpendByMonth'

const FILE = 'Report_-_10_19_2026T11_32_08.csv'
const HEADERS = [
  'Month', 'Advertiser account ID', 'Campaign ID', 'Advertised product ID',
  'Advertised product marketplace', 'Budget currency', 'Total cost',
]

/** Rows exactly as September's export writes them, armour and all. */
const row = (over: Record<string, string> = {}) => ({
  Month: '9',
  'Advertiser account ID': '="amzn1.ads-account.g.6oc6amdel479kw11ke0o0aucn"',
  'Campaign ID': '="236903289006813"',
  'Advertised product ID': 'B0F7FHMKKW',
  'Advertised product marketplace': 'AMAZON_IN',
  'Budget currency': 'INR',
  'Total cost': '5.54',
  ...over,
})

describe('detectAmazonAdsSpendByMonth', () => {
  it('recognizes the monthly cost report', () => {
    expect(detectAmazonAdsSpendByMonth(HEADERS)).toBe(true)
  })
  it('does not claim the per-product campaign report', () => {
    expect(detectAmazonAdsSpendByMonth(['Start Date', 'Campaign Name', 'Spend', 'Impressions'])).toBe(false)
  })
})

describe('the armour the console puts on its ids', () => {
  it('takes it off', () => {
    expect(unarmour('="236903289006813"')).toBe('236903289006813')
    expect(unarmour('B0F7FHMKKW')).toBe('B0F7FHMKKW')
    expect(unarmour(undefined)).toBe('')
  })
})

/**
 * The month column is a bare number, so the year comes from when the file was
 * downloaded: the console exports the last twelve months.
 */
describe('which year a month number means', () => {
  it('reads the download date out of the console’s file name', () => {
    const d = reportDownloadDate(FILE)
    expect([d?.getFullYear(), d?.getMonth(), d?.getDate()]).toEqual([2026, 9, 19])
    expect(reportDownloadDate('whatever.csv')).toBeNull()
  })

  it('puts a month at or before the download month in that year', () => {
    const oct2026 = new Date(2026, 9, 19)
    expect(monthKeyFor(9, oct2026)).toBe('2026-09')
    expect(monthKeyFor(4, oct2026)).toBe('2026-04')
    expect(monthKeyFor(10, oct2026)).toBe('2026-10')
  })

  it('puts a later month in the year before', () => {
    const oct2026 = new Date(2026, 9, 19)
    expect(monthKeyFor(11, oct2026)).toBe('2025-11')
    expect(monthKeyFor(12, oct2026)).toBe('2025-12')
  })

  // Guessing would file a month twelve months out, which is worse than
  // refusing the file.
  it('refuses the file when the name carries no date', () => {
    const r = normalizeAmazonAdsSpendByMonth([row()], 'i', 'renamed.csv')
    expect(r.adsRecords).toEqual([])
    expect(r.warnings[0]).toContain('no way to tell which year')
  })
})

describe('normalizeAmazonAdsSpendByMonth', () => {
  it('reads a row as a month’s spend on one campaign and ASIN', () => {
    const r = normalizeAmazonAdsSpendByMonth([row()], 'i', FILE)
    expect(r.invalidRows).toEqual([])
    expect(r.adsRecords).toEqual([{
      date: '2026-09-01', channel: 'amazon_in_seller', campaign: '236903289006813',
      sku: 'B0F7FHMKKW', asin: 'B0F7FHMKKW',
      impressions: 0, clicks: 0, spend: 5.54, adSales: 0, adOrders: 0, importId: 'i',
    }])
  })

  // Same campaign, same ASIN, same month is one dedup key: added, because the
  // insert drops a key that arrives twice rather than summing it.
  it('sums rows that share a campaign, an ASIN and a month', () => {
    const r = normalizeAmazonAdsSpendByMonth([row(), row({ 'Total cost': '10.46' })], 'i', FILE)
    expect(r.adsRecords).toHaveLength(1)
    expect(r.adsRecords[0].spend).toBeCloseTo(16, 2)
  })

  it('keeps one campaign’s months apart', () => {
    const r = normalizeAmazonAdsSpendByMonth([row(), row({ Month: '4', 'Total cost': '100' })], 'i', FILE)
    expect(r.adsRecords.map((a) => a.date).sort()).toEqual(['2026-04-01', '2026-09-01'])
  })

  it('says which months it states in full, so the import replaces them', () => {
    const r = normalizeAmazonAdsSpendByMonth(
      [row(), row({ Month: '8' }), row({ Month: '4' })], 'i', FILE,
    )
    expect(r.replaces).toEqual([{ channel: 'amazon_in_seller', months: ['2026-04', '2026-08', '2026-09'] }])
  })

  it('routes a row by the marketplace its product is on', () => {
    const r = normalizeAmazonAdsSpendByMonth([
      row(), row({ 'Advertised product marketplace': 'AMAZON_US', 'Advertised product ID': 'B0USA' }),
    ], 'i', FILE)
    expect(r.adsRecords.map((a) => a.channel)).toEqual(['amazon_in_seller', 'amazon_us'])
  })

  it('refuses a row it cannot place', () => {
    const r = normalizeAmazonAdsSpendByMonth([
      row({ Month: '13' }),
      row({ 'Advertised product marketplace': 'AMAZON_JP' }),
      row({ 'Campaign ID': '' }),
    ], 'i', FILE)
    expect(r.adsRecords).toEqual([])
    expect(r.invalidRows.map((x) => x.reason)).toEqual([
      '"13" is not a month',
      'AMAZON_JP is not an Amazon this app reports on',
      'Missing campaign id',
    ])
  })

  // The P&L wants the cost and that is what this states. Saying so beats a
  // ROAS of zero on a month that simply has no sales figure.
  it('says the month will carry no ROAS', () => {
    const r = normalizeAmazonAdsSpendByMonth([row()], 'i', FILE)
    expect(r.warnings.some((w) => w.includes('ROAS and ACOS cannot be worked out'))).toBe(true)
    expect(r.adsRecords[0].adSales).toBe(0)
  })

  it('counts the campaigns that spent nothing rather than dropping them', () => {
    const r = normalizeAmazonAdsSpendByMonth([row({ 'Total cost': '0.00' })], 'i', FILE)
    expect(r.adsRecords[0].spend).toBe(0)
    expect(r.warnings.some((w) => w.includes('cost nothing'))).toBe(true)
  })
})
