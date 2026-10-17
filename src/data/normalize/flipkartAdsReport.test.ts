import { describe, expect, it } from 'vitest'
import { detectFlipkartAdsReport, flipkartAdsPeriodDate, normalizeFlipkartAdsReport } from './flipkartAdsReport'
import type { RawSheet } from '@/lib/csvParse'

/**
 * The real file's shape: two lines of period, then the column names, then one
 * row per campaign, ad group and product. Figures are the owner's September
 * report, trimmed to five rows — including the two campaigns that share a
 * name, which the real month has.
 */
const HEADER = [
  'Campaign ID', 'Campaign Name', 'AdGroup ID', 'AdGroup Name', 'Sku Id', 'Product Name',
  'Views', 'Clicks', 'Direct Units Sold', 'Indirect Units Sold', 'Total Revenue (Rs.)',
  'Conversion Rate', 'ROI', 'Ad Spend',
]

const sheet: RawSheet = [
  ['Start Time', ' 2026-09-01 00:00:00'],
  ['End Time', ' 2026-09-30 23:59:59'],
  HEADER,
  ['Y5OH3GFCNPSQ', 'PLA_Auto_Under_Arm_Roll_on', 'HQ1U52O5F5FR', 'Fragrances', 'AO/RollOn/UAR', 'Underarm Roll On', 254247, 7102, 851, 20, 185631, 0.1226, 7.0024, 26509.6],
  ['8DU4HW72OZ6H', 'PLA_CatchAll', 'JX246JI3SVUG', 'Body and Face Skin Care', 'AO/BodyLotion/SPF', 'Sunscreen', 770, 8, 0, 0, 0, 0, 0, 24],
  ['8DU4HW72OZ6H', 'PLA_CatchAll', 'JX246JI3SVUG', 'Body and Face Skin Care', 'AO/RollOn/UAR', 'Underarm Roll On', 1230, 14, 2, 1, 1954, 0.09, 4.7, 606.12],
  // Two campaigns, one name. The id is the identity.
  ['AAAA11112222', 'PLA_KT_Hair_Finishing_Stick_Exact', 'G1', 'Hair', 'AO/Stick/Hair', 'Finishing Stick', 4000, 40, 3, 0, 1200, 0.07, 1.2, 1000],
  ['BBBB33334444', 'PLA_KT_Hair_Finishing_Stick_Exact', 'G2', 'Hair', 'AO/Stick/Hair', 'Finishing Stick', 2000, 10, 0, 0, 0, 0, 0, 500],
]

const SPEND = 26509.6 + 24 + 606.12 + 1000 + 500
const REVENUE = 185631 + 0 + 1954 + 1200 + 0

describe('detectFlipkartAdsReport', () => {
  it('recognizes the real file, period lines and all', () => {
    expect(detectFlipkartAdsReport(sheet)).toBe(true)
  })

  it('recognizes it with the columns on the first row', () => {
    expect(detectFlipkartAdsReport([HEADER])).toBe(true)
  })

  it('rejects an unrelated csv', () => {
    expect(detectFlipkartAdsReport([['Sub Order No', 'SKU ID'], ['x', 'y']])).toBe(false)
  })

  // Myntra's export has a campaign id and an ad spend too; it writes them with
  // underscores and calls an impression an impression.
  it('does not claim Myntra’s ads report', () => {
    expect(detectFlipkartAdsReport([['date', 'campaign_id', 'adgroup_id', 'ad_spend', 'impressions', 'roi_direct']])).toBe(false)
  })
})

describe('flipkartAdsPeriodDate', () => {
  it('reads the date out of a timestamp', () => {
    expect(flipkartAdsPeriodDate(' 2026-09-01 00:00:00')).toBe('2026-09-01')
  })
  it('refuses a form that could be read two ways', () => {
    expect(flipkartAdsPeriodDate('09/01/2026')).toBeNull()
    expect(flipkartAdsPeriodDate('2026-13-01')).toBeNull()
    expect(flipkartAdsPeriodDate('')).toBeNull()
  })
})

describe('normalizeFlipkartAdsReport', () => {
  it('takes the month from the period above the columns', () => {
    const r = normalizeFlipkartAdsReport(sheet, 'import-1')
    expect(r.month).toBe('2026-09')
    expect(r.facts?.periodStart).toBe('2026-09-01')
    expect(r.facts?.periodEnd).toBe('2026-09-30')
  })

  it('sums the month to the file’s own figures', () => {
    const f = normalizeFlipkartAdsReport(sheet, 'import-1').facts!
    expect(f.spend).toBeCloseTo(SPEND, 2)
    expect(f.revenue).toBeCloseTo(REVENUE, 2)
    expect(f.views).toBe(254247 + 770 + 1230 + 4000 + 2000)
    expect(f.clicks).toBe(7102 + 8 + 14 + 40 + 10)
    expect(f.unitsDirect).toBe(851 + 2 + 3)
    expect(f.unitsIndirect).toBe(20 + 1)
    expect(f.rows).toBe(5)
  })

  it('files one ads record per row, dated in the report’s month', () => {
    const r = normalizeFlipkartAdsReport(sheet, 'import-1')
    expect(r.adsRecords).toHaveLength(5)
    expect(r.adsRecords.every((a) => a.channel === 'flipkart')).toBe(true)
    expect(r.adsRecords.every((a) => a.date === '2026-09-01')).toBe(true)
    expect(r.adsRecords.reduce((s, a) => s + a.spend, 0)).toBeCloseTo(SPEND, 2)
    // Attributed revenue and units ride along; the P&L charges neither.
    expect(r.adsRecords[0].adSales).toBe(185631)
    expect(r.adsRecords[0].adOrders).toBe(871)
    expect(r.adsRecords[0].sku).toBe('AO/RollOn/UAR')
  })

  it('rolls a campaign up across its rows and counts what is under it', () => {
    const f = normalizeFlipkartAdsReport(sheet, 'import-1').facts!
    const catchAll = f.campaigns.find((c) => c.campaignId === '8DU4HW72OZ6H')!
    expect(catchAll.spend).toBeCloseTo(24 + 606.12, 2)
    expect(catchAll.revenue).toBe(1954)
    expect(catchAll.skus).toBe(2)
    expect(catchAll.adGroups).toBe(1)
    expect(f.campaigns[0].campaignId).toBe('Y5OH3GFCNPSQ') // sorted by spend
  })

  it('rolls a product up across the campaigns advertising it', () => {
    const f = normalizeFlipkartAdsReport(sheet, 'import-1').facts!
    const roll = f.skus.find((s) => s.skuId === 'AO/RollOn/UAR')!
    expect(roll.spend).toBeCloseTo(26509.6 + 606.12, 2)
    expect(roll.revenue).toBe(185631 + 1954)
    expect(roll.campaigns).toBe(2)
    expect(f.skus[0].skuId).toBe('AO/RollOn/UAR')
  })

  // Merging two campaigns because they share a name is how Blinkit's April
  // advertising came to read ₹11 against ₹16.80.
  it('keeps two campaigns with one name apart, and says so', () => {
    const r = normalizeFlipkartAdsReport(sheet, 'import-1')
    const shared = r.facts!.campaigns.filter((c) => c.campaignName.startsWith('PLA_KT_Hair_Finishing_Stick_Exact'))
    expect(shared).toHaveLength(2)
    expect(shared.map((c) => c.campaignName).sort()).toEqual([
      'PLA_KT_Hair_Finishing_Stick_Exact (AAAA11112222)',
      'PLA_KT_Hair_Finishing_Stick_Exact (BBBB33334444)',
    ])
    expect(r.warnings.some((w) => w.includes('used by more than one campaign'))).toBe(true)
  })

  it('says the advertising cost is not changed by this file', () => {
    const r = normalizeFlipkartAdsReport(sheet, 'import-1')
    expect(r.warnings[0]).toContain('₹28,639.72')
    expect(r.warnings[0]).toContain('does not change the month')
  })

  // Judged on the campaign, not the row: PLA_CatchAll has a row that earned
  // nothing and a row that earned ₹1,954, and as a campaign it is ahead. Only
  // the one that earned nothing at all on ₹500 is underwater.
  it('names the campaigns that returned less than they cost', () => {
    const r = normalizeFlipkartAdsReport(sheet, 'import-1')
    const warning = r.warnings.find((w) => w.includes('spent more than they returned'))
    expect(warning).toContain('1 campaign(s)')
    expect(warning).toContain('₹500.00 spent against ₹0.00')
    expect(warning).toContain('PLA_KT_Hair_Finishing_Stick_Exact (BBBB33334444)')
  })

  it('counts the rows that bought nothing at all', () => {
    const r = normalizeFlipkartAdsReport(sheet, 'import-1')
    expect(r.warnings.find((w) => w.includes('no attributed sales at all'))).toContain('₹524.00')
  })

  it('imports nothing when the report states no period', () => {
    const r = normalizeFlipkartAdsReport([HEADER, ...sheet.slice(3)], 'import-1')
    expect(r.facts).toBeNull()
    expect(r.adsRecords).toHaveLength(0)
    expect(r.warnings[0]).toContain('Start Time')
  })

  it('warns when the period is only part of a month', () => {
    const partial: RawSheet = [['Start Time', '2026-09-01 00:00:00'], ['End Time', '2026-09-14 23:59:59'], ...sheet.slice(2)]
    const r = normalizeFlipkartAdsReport(partial, 'import-1')
    expect(r.warnings.find((w) => w.includes('part of 2026-09'))).toContain('2026-09-14')
  })

  it('warns when the period crosses a month end', () => {
    const crossing: RawSheet = [['Start Time', '2026-09-15 00:00:00'], ['End Time', '2026-10-14 23:59:59'], ...sheet.slice(2)]
    const r = normalizeFlipkartAdsReport(crossing, 'import-1')
    expect(r.month).toBe('2026-09')
    expect(r.warnings.find((w) => w.includes('crosses a month end'))).toContain('2026-10-14')
  })

  it('rejects a row with no campaign id rather than filing it under a blank one', () => {
    const withBlank: RawSheet = [...sheet, ['', 'Nameless', 'G9', 'Group', 'AO/X', 'X', 10, 1, 0, 0, 0, 0, 0, 5]]
    const r = normalizeFlipkartAdsReport(withBlank, 'import-1')
    expect(r.invalidRows).toHaveLength(1)
    expect(r.invalidRows[0].reason).toBe('Missing Campaign ID')
    expect(r.facts!.spend).toBeCloseTo(SPEND, 2)
  })
})
