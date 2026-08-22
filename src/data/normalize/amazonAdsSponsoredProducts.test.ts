import { describe, expect, it } from 'vitest'
import { detectAmazonAdsSponsoredProductsReport, normalizeAmazonAdsSponsoredProductsReport } from './amazonAdsSponsoredProducts'

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
