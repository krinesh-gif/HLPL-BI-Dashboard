import { describe, expect, it } from 'vitest'
import { detectAmazonAdsSponsoredProductsReport, normalizeAmazonAdsSponsoredProductsReport } from './amazonAdsSponsoredProducts'
import { adsRecordKey } from './dedupKeys'

const headers = [
  'Start Date', 'End Date', 'Portfolio name', 'Program Type', 'Campaign Name', 'Retailer', 'Country', 'Status',
  'Currency', 'Budget Amount', 'Targeting Type', 'Bidding strategy', 'Impressions', 'Last Year Impressions',
  'Clicks', 'Last Year Clicks', 'Click-Thru Rate (CTR)', 'Spend', 'Last Year Spend', 'Cost Per Click (CPC)',
  'Last Year Cost Per Click (CPC)', '7 Day Total Orders (#)', 'Total Advertising Cost of Sales (ACOS) ',
  'Total Return on Advertising Spend (ROAS)', '7 Day Total Sales ',
]

// Real row from Sponsored_Products_Campaign_report_4.csv.
function realRow(overrides: Record<string, string> = {}) {
  return {
    'Start Date': 'May 01, 2026', 'End Date': 'May 31, 2026', 'Portfolio name': 'NX/Spray/Sunscreen/100',
    'Program Type': 'Sponsored Products', 'Campaign Name': 'NM_AUTO_TARGETING_CLOSE & LOOSE MATCH',
    Retailer: 'Amazon', Country: 'United States', Status: 'PAUSED', Currency: 'USD', 'Budget Amount': '$80.0',
    'Targeting Type': 'Automatic targeting', 'Bidding strategy': 'Dynamic bids - down only',
    Impressions: '276238', 'Last Year Impressions': '', Clicks: '3110', 'Last Year Clicks': '',
    'Click-Thru Rate (CTR)': '1.126%', Spend: '$1596.1', 'Last Year Spend': '', 'Cost Per Click (CPC)': '$0.5132154',
    'Last Year Cost Per Click (CPC)': '$0.0', '7 Day Total Orders (#)': '333',
    'Total Advertising Cost of Sales (ACOS) ': '35.544%', 'Total Return on Advertising Spend (ROAS)': '2.81',
    '7 Day Total Sales ': '$4490.51',
    ...overrides,
  }
}

describe('detectAmazonAdsSponsoredProductsReport', () => {
  it('recognizes the real header set', () => {
    expect(detectAmazonAdsSponsoredProductsReport(headers)).toBe(true)
  })
  it('rejects an unrelated header set', () => {
    expect(detectAmazonAdsSponsoredProductsReport(['Sub Order No', 'SKU ID'])).toBe(false)
  })
})

/**
 * Which month a row's spend belongs to.
 *
 * "Start Date" means two things in this export: the report's own range in a
 * monthly summary, and each campaign's launch date in the campaign-level
 * download. The second one put ₹2.29 lakh of Amazon USA's July spend on 30
 * June, because two campaigns happened to launch that day.
 */
/**
 * Sponsored Brands and Sponsored Display, which the console exports in the
 * same shape and names in Program Type. A month that ran both is two lines.
 */
describe('every Amazon ad product, not only Sponsored Products', () => {
  const sbHeaders = ['Date', 'Program Type', 'Campaign Name', 'Country', 'Currency', 'Impressions', 'Clicks', 'Spend', '14 Day Total Orders', '14 Day Total Sales']

  it('recognizes a campaign report with no portfolio column', () => {
    expect(detectAmazonAdsSponsoredProductsReport(sbHeaders)).toBe(true)
  })

  it('keeps the ad product the console names', () => {
    const rows = [
      { ...realRow({ Country: 'India', Currency: 'INR' }), 'Program Type': 'Sponsored Products' },
      { ...realRow({ Country: 'India', Currency: 'INR', 'Campaign Name': 'Brand Reach' }), 'Program Type': 'Sponsored Brands' },
    ]
    const r = normalizeAmazonAdsSponsoredProductsReport(rows, 'i')
    expect(r.adsRecords.map((a) => a.program)).toEqual(['Sponsored Products', 'Sponsored Brands'])
    expect(r.warnings.some((w) => w.includes('2 ad products'))).toBe(true)
  })

  // Same campaign, same day, two ad products. Without the program in the key
  // the second row is dropped as a duplicate of the first and the month is
  // short by whatever Sponsored Brands spent.
  it('keeps one campaign’s two ad products apart', () => {
    const rows = [
      { ...realRow({ Country: 'India', Currency: 'INR', Spend: '₹1000' }), Date: 'Sep 03, 2026', 'Program Type': 'Sponsored Products' },
      { ...realRow({ Country: 'India', Currency: 'INR', Spend: '₹4000' }), Date: 'Sep 03, 2026', 'Program Type': 'Sponsored Brands' },
    ]
    const r = normalizeAmazonAdsSponsoredProductsReport(rows, 'i')
    expect(new Set(r.adsRecords.map(adsRecordKey)).size).toBe(2)
    expect(r.adsRecords.reduce((sum, a) => sum + a.spend, 0)).toBe(5000)
  })

  it('leaves the program unset where the report names none', () => {
    // Every platform but Amazon. The row still imports; it simply has no
    // product split to report.
    const { 'Program Type': _omitted, ...noProgram } = realRow()
    const r = normalizeAmazonAdsSponsoredProductsReport([noProgram], 'i')
    expect(r.adsRecords[0].program).toBeUndefined()
  })
})

/**
 * September's real Sponsored Brands export, in the shape the uploader hands
 * over: a workbook, so the Date column arrives as the serial Excel stores,
 * and no Program Type column anywhere in its fifty-six headings.
 */
describe('the Sponsored Brands export as it really arrives', () => {
  const SEP_1 = '46266'
  const sbRow = (over: Record<string, string> = {}) => ({
    Date: SEP_1, 'Portfolio name': 'No Portfolio', Currency: 'INR',
    'Campaign Name': 'Rosemary Oil-SBV-GKW-MB-RM', 'Cost type': 'CPC', Country: 'India',
    Impressions: '0', Clicks: '0', Spend: '0', '14 Day Total Sales ': '0', '14 Day Total Orders (#)': '0',
    'Viewable Impressions': '0', 'Video First Quartile Views': '0', '5 Second Views': '0',
    'Brand Store page views': '0', 'Long-Term Sales': '0',
    ...over,
  })

  it('reads the workbook’s serial date as the day it is', () => {
    const r = normalizeAmazonAdsSponsoredProductsReport([sbRow()], 'i')
    expect(r.invalidRows).toEqual([])
    expect(r.adsRecords[0].date).toBe('2026-09-01')
  })

  // The file names no ad product, so the product is taken from the columns
  // only Sponsored Brands has. Without it a month of brand spend reads as
  // "not reported by product" beside the Sponsored Products figure.
  it('names the ad product from the columns only that product has', () => {
    const r = normalizeAmazonAdsSponsoredProductsReport([sbRow()], 'i')
    expect(r.adsRecords[0].program).toBe('Sponsored Brands')
  })

  it('says a month of zeroes is a real zero, not a failed read', () => {
    const r = normalizeAmazonAdsSponsoredProductsReport([sbRow(), sbRow({ Date: '46267' })], 'i')
    expect(r.adsRecords).toHaveLength(2)
    expect(r.warnings.some((w) => w.includes('spent nothing'))).toBe(true)
  })

  it('says nothing of the sort once a row has spend', () => {
    const r = normalizeAmazonAdsSponsoredProductsReport([sbRow({ Spend: '₹2500.75' })], 'i')
    expect(r.adsRecords[0].spend).toBeCloseTo(2500.75, 2)
    expect(r.warnings.some((w) => w.includes('spent nothing'))).toBe(false)
  })
})

describe('which month the spend lands in', () => {
  const daily = (date: string, spend: string) => ({
    ...realRow({ Country: 'India', Currency: 'INR', Spend: spend }), Date: date,
  })

  it('uses the day of spend where the export carries one', () => {
    const r = normalizeAmazonAdsSponsoredProductsReport(
      [daily('Sep 03, 2026', '₹1200.50'), daily('Sep 28, 2026', '₹800.25')], 'i')
    expect(r.adsRecords.map((a) => a.date)).toEqual(['2026-09-03', '2026-09-28'])
    expect(r.warnings).toEqual([])
  })

  it('trusts one shared start date, which is the report’s own range', () => {
    const rows = [realRow(), realRow({ 'Campaign Name': 'Second' })]
    const r = normalizeAmazonAdsSponsoredProductsReport(rows, 'i')
    expect(r.adsRecords.every((a) => a.date === '2026-05-01')).toBe(true)
    expect(r.warnings).toEqual([])
  })

  it('says so when the dates are campaign launch dates rather than a period', () => {
    const rows = [
      realRow({ 'Start Date': 'Jun 30, 2026', 'End Date': 'Jul 31, 2026', 'Campaign Name': 'A' }),
      realRow({ 'Start Date': 'Jul 13, 2026', 'End Date': 'Jul 31, 2026', 'Campaign Name': 'B' }),
    ]
    const r = normalizeAmazonAdsSponsoredProductsReport(rows, 'i')
    // Still imported — the spend is real, and the warning says what is wrong
    // with the month it landed in.
    expect(r.adsRecords).toHaveLength(2)
    expect(r.warnings[0]).toContain('campaign launch dates')
    expect(r.warnings[0]).toContain('Time unit: Daily')
  })

  it('says so when one range crosses a month end', () => {
    const rows = [realRow({ 'Start Date': 'May 15, 2026', 'End Date': 'Jun 14, 2026' })]
    const r = normalizeAmazonAdsSponsoredProductsReport(rows, 'i')
    expect(r.warnings[0]).toContain('2026-05 and 2026-06')
  })
})

describe('normalizeAmazonAdsSponsoredProductsReport', () => {
  it('parses real currency-formatted spend/sales figures and converts USD to INR for amazon_us rows', () => {
    const result = normalizeAmazonAdsSponsoredProductsReport([realRow()], 'import-1')
    expect(result.adsRecords).toHaveLength(1)
    const r = result.adsRecords[0]
    expect(r.spend).toBeCloseTo(1596.1 * 95.2)
    expect(r.adSales).toBeCloseTo(4490.51 * 95.2)
    expect(r.adOrders).toBe(333)
    expect(r.impressions).toBe(276238)
  })

  it('does not convert spend/sales for amazon_in_seller rows', () => {
    const result = normalizeAmazonAdsSponsoredProductsReport([realRow({ Country: 'India' })], 'import-1')
    expect(result.adsRecords[0].spend).toBeCloseTo(1596.1)
    expect(result.adsRecords[0].adSales).toBeCloseTo(4490.51)
  })

  it('maps Retailer=Amazon + Country=United States to the amazon_us channel', () => {
    const result = normalizeAmazonAdsSponsoredProductsReport([realRow()], 'import-1')
    expect(result.adsRecords[0].channel).toBe('amazon_us')
  })

  it('maps Retailer=Amazon + Country=India to amazon_in_seller', () => {
    const result = normalizeAmazonAdsSponsoredProductsReport([realRow({ Country: 'India' })], 'import-1')
    expect(result.adsRecords[0].channel).toBe('amazon_in_seller')
  })

  it('uses Portfolio name as the SKU when it is not the "No Portfolio" placeholder', () => {
    const result = normalizeAmazonAdsSponsoredProductsReport([realRow(), realRow({ 'Portfolio name': 'No Portfolio' })], 'import-1')
    expect(result.adsRecords[0].sku).toBe('NX/Spray/Sunscreen/100')
    expect(result.adsRecords[1].sku).toBeUndefined()
  })

  it('rejects a row with no resolvable Amazon channel', () => {
    const result = normalizeAmazonAdsSponsoredProductsReport([realRow({ Country: 'Germany' })], 'import-1')
    expect(result.adsRecords).toHaveLength(0)
    expect(result.invalidRows).toHaveLength(1)
  })
})

/**
 * The India console's own export of the same report, which differs from the US
 * one in three ways at once — and each of them alone made the month read as
 * zero. Figures are a real row from Sponsored_Products_Campaign_report_5.csv,
 * September 2026.
 */
describe('normalizeAmazonAdsSponsoredProductsReport, on the India export', () => {
  function indiaRow(over: Record<string, string> = {}) {
    return {
      'Start Date': 'Sep 01, 2026', 'End Date': 'Sep 30, 2026', 'Portfolio name': 'No Portfolio',
      'Program Type': 'Sponsored Products', 'Campaign Name': 'All Product Mix-SP-PT-Self',
      // No Retailer column at all.
      Country: 'India', Status: 'ENABLED', Currency: 'INR', 'Budget Amount': '₹3025.0',
      'Targeting Type': 'Manual targeting', 'Bidding strategy': 'Dynamic bids - down only',
      Impressions: '151275', Clicks: '3374', 'Click-Thru Rate (CTR)': '2.23%',
      Spend: '₹44348.29', 'Cost Per Click (CPC)': '₹13.1441286',
      // A 14-day attribution window, not the US file's 7-day.
      '14 Day Total Orders (#)': '617',
      'Total Advertising Cost of Sales (ACOS) ': '26.209%',
      'Total Return on Advertising Spend (ROAS)': '3.82',
      '14 Day Total Sales ': '₹169210.35',
      ...over,
    }
  }

  it('resolves the channel from Country where the export has no Retailer column', () => {
    const r = normalizeAmazonAdsSponsoredProductsReport([indiaRow()], 'import-1')
    expect(r.invalidRows).toHaveLength(0)
    expect(r.adsRecords[0].channel).toBe('amazon_in_seller')
  })

  it('reads a rupee figure rather than making it zero', () => {
    const r = normalizeAmazonAdsSponsoredProductsReport([indiaRow()], 'import-1')
    expect(r.adsRecords[0].spend).toBeCloseTo(44348.29, 2)
  })

  it('reads the 14-day attribution columns as well as the 7-day ones', () => {
    const r = normalizeAmazonAdsSponsoredProductsReport([indiaRow()], 'import-1')
    expect(r.adsRecords[0].adSales).toBeCloseTo(169210.35, 2)
    expect(r.adsRecords[0].adOrders).toBe(617)
  })

  // The expensive direction of the mistake: a rupee figure taken for dollars.
  it('does not convert a rupee figure at the dollar rate', () => {
    const r = normalizeAmazonAdsSponsoredProductsReport([indiaRow()], 'import-1')
    expect(r.adsRecords[0].spend).toBeLessThan(45000)
  })

  it('still converts a US row, and still refuses a retailer that is not Amazon', () => {
    const us = normalizeAmazonAdsSponsoredProductsReport([realRow()], 'import-1')
    expect(us.adsRecords[0].spend).toBeGreaterThan(1596.1)
    const other = normalizeAmazonAdsSponsoredProductsReport([indiaRow({ Retailer: 'Flipkart' })], 'import-1')
    expect(other.adsRecords).toHaveLength(0)
  })
})
