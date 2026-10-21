import { describe, expect, it } from 'vitest'
import {
  detectAmazonAdsSpendByMonth, monthKeyFor, normalizeAmazonAdsSpendByMonth, reportDownloadDate, statedYear,
  unarmour,
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
  it('refuses the file when neither the row nor the name carries a date', () => {
    const r = normalizeAmazonAdsSpendByMonth([row()], 'i', 'renamed.csv')
    expect(r.adsRecords).toEqual([])
    expect(r.warnings[0]).toContain('no way to tell which year')
  })

  it('reads a year the file states, and bounds it', () => {
    expect(statedYear('2026')).toBe(2026)
    expect(statedYear(undefined)).toBeNull()
    expect(statedYear('26')).toBeNull()
    expect(statedYear('not a year')).toBeNull()
  })
})

describe('normalizeAmazonAdsSpendByMonth', () => {
  it('reads a row as a month’s spend on one campaign and ASIN', () => {
    const r = normalizeAmazonAdsSpendByMonth([row()], 'i', FILE)
    expect(r.invalidRows).toEqual([])
    expect(r.adsRecords).toEqual([{
      date: '2026-09-01', channel: 'amazon_in_seller', campaign: '236903289006813',
      sku: 'B0F7FHMKKW', asin: 'B0F7FHMKKW',
      impressions: 0, clicks: 0, spend: 5.54, adSales: 0, adOrders: 0, currency: 'INR', importId: 'i',
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
    ], 'i', FILE)
    expect(r.adsRecords).toEqual([])
    expect(r.invalidRows.map((x) => x.reason)).toEqual([
      '"13" is not a month',
      'AMAZON_JP is not an Amazon this app reports on',
    ])
  })

  // A row whose campaign the console left blank is still money the month
  // cost. Booking it to the account keeps the month's total tying to the
  // file; dropping it as unplaceable would quietly understate the spend.
  it('books a row with no campaign to the account rather than dropping it', () => {
    const r = normalizeAmazonAdsSpendByMonth([row({ 'Campaign ID': '' })], 'i', FILE)
    expect(r.invalidRows).toEqual([])
    expect(r.adsRecords[0].campaign).toBe('amzn1.ads-account.g.6oc6amdel479kw11ke0o0aucn')
    expect(r.adsRecords[0].spend).toBe(5.54)
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

/**
 * The shape the owner settled on: one row per month, the year beside the
 * month, and the account's whole cost. No campaign, no ASIN, no marketplace
 * — so the year comes from the file instead of its name, and the store from
 * what the account is billed in.
 */
describe('the month-per-row shape', () => {
  const ACCOUNT = '="amzn1.ads-account.g.6oc6amdel479kw11ke0o0aucn"'
  const monthRow = (over: Record<string, string> = {}) => ({
    Year: '2026',
    Month: '9',
    'Budget currency': 'INR',
    'Advertiser account ID': ACCOUNT,
    'Total cost': '212876.10',
    ...over,
  })

  it('is recognized without a marketplace column', () => {
    expect(detectAmazonAdsSpendByMonth(['Year', 'Month', 'Budget currency', 'Advertiser account ID', 'Total cost']))
      .toBe(true)
  })

  it('books the month to the account, since there is no campaign to book it to', () => {
    const r = normalizeAmazonAdsSpendByMonth([monthRow()], 'i', 'Amazon_Monthly_Ad_Spend_Report.csv')
    expect(r.invalidRows).toEqual([])
    expect(r.adsRecords).toEqual([{
      date: '2026-09-01',
      channel: 'amazon_in_seller',
      campaign: 'amzn1.ads-account.g.6oc6amdel479kw11ke0o0aucn',
      sku: undefined,
      asin: undefined,
      impressions: 0,
      clicks: 0,
      spend: 212876.1,
      adSales: 0,
      adOrders: 0,
      currency: 'INR',
      importId: 'i',
    }])
  })

  // The whole point of the Year column: the file name is then irrelevant,
  // which is what stops a renamed copy being refused.
  it('takes the year from the row, whatever the file is called', () => {
    const r = normalizeAmazonAdsSpendByMonth(
      [monthRow({ Year: '2025', Month: '11' })], 'i', 'renamed by somebody.csv',
    )
    expect(r.adsRecords[0].date).toBe('2025-11-01')
    expect(r.warnings.some((w) => w.includes('file name'))).toBe(false)
  })

  it('routes by the currency the account is billed in', () => {
    const r = normalizeAmazonAdsSpendByMonth([
      monthRow(),
      monthRow({ 'Budget currency': 'USD', 'Advertiser account ID': '="amzn1.ads-account.g.usa"' }),
      monthRow({ 'Budget currency': 'AED', 'Advertiser account ID': '="amzn1.ads-account.g.uae"' }),
    ], 'i', 'f.csv')
    expect(r.adsRecords.map((a) => a.channel)).toEqual(['amazon_in_seller', 'amazon_us', 'amazon_ae'])
  })

  // The marketplace column is the better evidence and wins where it exists,
  // so a campaign-level export is not re-routed by its currency.
  it('prefers the marketplace column over the currency', () => {
    const r = normalizeAmazonAdsSpendByMonth(
      [{ ...monthRow(), 'Advertised product marketplace': 'AMAZON_US', 'Campaign ID': '="1"' }], 'i', 'f.csv',
    )
    expect(r.adsRecords[0].channel).toBe('amazon_us')
  })

  it('refuses a row that names neither a marketplace nor a currency it knows', () => {
    const r = normalizeAmazonAdsSpendByMonth([
      monthRow({ 'Budget currency': 'GBP' }),
      monthRow({ 'Budget currency': '' }),
    ], 'i', 'f.csv')
    expect(r.adsRecords).toEqual([])
    expect(r.invalidRows.map((x) => x.reason)).toEqual([
      'No marketplace, and GBP does not say which Amazon this is',
      'No marketplace, and (no currency) does not say which Amazon this is',
    ])
  })

  it('refuses a row with no account and no campaign to book the month to', () => {
    const r = normalizeAmazonAdsSpendByMonth([monthRow({ 'Advertiser account ID': '' })], 'i', 'f.csv')
    expect(r.invalidRows.map((x) => x.reason)).toEqual([
      'Neither a campaign id nor an advertiser account to book it to',
    ])
  })

  // The owner's own file: April to September in six rows.
  it('reads the six months of back data as six months to replace', () => {
    const months = [
      ['4', '363426.23'], ['5', '403496.35'], ['6', '333345.32'],
      ['7', '384334.72'], ['8', '300476.04'], ['9', '212876.10'],
    ]
    const r = normalizeAmazonAdsSpendByMonth(
      months.map(([m, cost]) => monthRow({ Month: m, 'Total cost': cost })), 'i', 'Amazon_Monthly_Ad_Spend.csv',
    )
    expect(r.invalidRows).toEqual([])
    expect(r.adsRecords).toHaveLength(6)
    expect(r.adsRecords.reduce((s, a) => s + a.spend, 0)).toBeCloseTo(1997954.76, 2)
    expect(r.replaces).toEqual([{
      channel: 'amazon_in_seller',
      months: ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'],
    }])
    expect(r.warnings[0]).toContain('₹1997954.76')
    expect(r.warnings[0]).toContain('no campaign or ASIN split')
  })

  // One month twice is one row: the insert drops a repeated key rather than
  // adding it, so a file that restates a month has to be summed here.
  it('sums a month stated twice', () => {
    const r = normalizeAmazonAdsSpendByMonth([monthRow(), monthRow({ 'Total cost': '1000' })], 'i', 'f.csv')
    expect(r.adsRecords).toHaveLength(1)
    expect(r.adsRecords[0].spend).toBeCloseTo(213876.1, 2)
  })
})

/**
 * The owner's own UAE and USA files, which share one advertiser account id
 * and differ only in the currency column — so the currency is the only thing
 * that can say which Amazon a row belongs to, and the only thing that says
 * what the figure is worth.
 */
describe('an account billed in something other than rupees', () => {
  const uae = (month: string, cost: string) => ({
    Year: '2026', Month: month, 'Budget currency': 'AED',
    'Advertiser account ID': '="amzn1.ads-account.g.atibnke5ymv6jpm8pvlubi8sg"', 'Total cost': cost,
  })

  it('routes the same account to two channels on its currency', () => {
    const r = normalizeAmazonAdsSpendByMonth([
      uae('9', '272.11'),
      { ...uae('9', '1177.72'), 'Budget currency': 'USD' },
    ], 'i', 'f.csv')
    expect(r.adsRecords.map((a) => [a.channel, a.currency, a.spend])).toEqual([
      ['amazon_ae', 'AED', 272.11],
      ['amazon_us', 'USD', 1177.72],
    ])
  })

  // Stored as the file states them. Converting here would freeze the rate at
  // upload day, and the statement this feeds is itself rendered in dirhams.
  it('stores the dirhams, and says so in its own currency', () => {
    const r = normalizeAmazonAdsSpendByMonth([uae('4', '390.54'), uae('6', '1547.42')], 'i', 'f.csv')
    expect(r.adsRecords.every((a) => a.currency === 'AED')).toBe(true)
    expect(r.warnings[0]).toContain('AED 1937.96')
    expect(r.warnings.some((w) => w.includes('Billed in AED'))).toBe(true)
  })

  it('says nothing about currency for a rupee account', () => {
    const r = normalizeAmazonAdsSpendByMonth(
      [{ ...uae('9', '100'), 'Budget currency': 'INR' }], 'i', 'f.csv',
    )
    expect(r.warnings.some((w) => w.includes('Billed in'))).toBe(false)
    expect(r.warnings[0]).toContain('₹100.00')
  })
})

/**
 * The owner's own September file, header for header and figure for figure.
 *
 * It carries `Sales` and `Units sold` beside the cost, and the importer was
 * reading the cost alone — so Amazon India showed ₹2,12,876 of spend with
 * "not measured" beside it on a report that had measured ₹9,42,039.72.
 */
describe('the Sales column this report carries', () => {
  const OWNERS_HEADERS = ['Year', 'Month', 'Advertiser account ID', 'Budget currency', 'Total cost', 'Sales', 'Units sold']
  const ownersRow = (over: Record<string, string> = {}) => ({
    Year: '2026',
    Month: '9',
    'Advertiser account ID': '="amzn1.ads-account.g.6oc6amdel479kw11ke0o0aucn"',
    'Budget currency': 'INR',
    'Total cost': '212876.10',
    Sales: '942039.72',
    'Units sold': '3566',
    ...over,
  })

  it('is still read as this report', () => {
    expect(detectAmazonAdsSpendByMonth(OWNERS_HEADERS)).toBe(true)
  })

  it('reads the attributed sales beside the cost', () => {
    const r = normalizeAmazonAdsSpendByMonth([ownersRow()], 'i')
    expect(r.adsRecords).toHaveLength(1)
    expect(r.adsRecords[0].spend).toBeCloseTo(212_876.1, 2)
    expect(r.adsRecords[0].adSales).toBeCloseTo(942_039.72, 2)
    expect(r.adsRecords[0].date).toBe('2026-09-01')
    expect(r.adsRecords[0].channel).toBe('amazon_in_seller')
  })

  it('says the month now has a ROAS to work out', () => {
    const r = normalizeAmazonAdsSpendByMonth([ownersRow()], 'i')
    expect(r.warnings.join(' ')).toMatch(/942039\.72 of attributed sales/)
    expect(r.warnings.join(' ')).not.toMatch(/ROAS and ACOS\s+cannot be worked out/)
  })

  it('still says so where the file attributes nothing', () => {
    const r = normalizeAmazonAdsSpendByMonth([ownersRow({ Sales: '0' })], 'i')
    expect(r.adsRecords[0].adSales).toBe(0)
    expect(r.warnings.join(' ')).toMatch(/cannot be worked out/)
  })

  it('adds the sales up where a month arrives on more than one row', () => {
    const r = normalizeAmazonAdsSpendByMonth(
      [ownersRow(), ownersRow({ 'Total cost': '100.00', Sales: '500.00' })], 'i',
    )
    expect(r.adsRecords).toHaveLength(1)
    expect(r.adsRecords[0].spend).toBeCloseTo(212_976.1, 2)
    expect(r.adsRecords[0].adSales).toBeCloseTo(942_539.72, 2)
  })
})
