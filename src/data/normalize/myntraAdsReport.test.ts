import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import Papa from 'papaparse'
import { detectMyntraAdsReport, myntraAdsDate, normalizeMyntraAdsReport } from './myntraAdsReport'
import { adsRecordKey } from './dedupKeys'
import { marketingFromAds } from '@/engine/marketing'

const REPORT = '/root/.claude/uploads/f24a295e-093a-5385-9288-97acefc06862/c8f22908-April_26.csv'

const HEADERS = [
  'date', 'campaign_id', 'campaign_name', 'adgroup_id', 'adgroup_name', 'adgroup_targetting_type',
  'adgroup_status', 'campaign_status', 'impressions', 'clicks', 'ctr', 'cvr', 'avg_cpc', 'ad_spend',
  'units_sold_direct', 'units_sold_indirect', 'units_sold_total', 'direct_revenue', 'indirect_revenue',
  'total_revenue', 'roi_direct', 'roi_indirect', 'roi_total',
  'base_ad_spend', 'base_impressions', 'base_clicks', 'base_units_sold_total', 'base_total_revenue',
  'peak_ad_spend', 'peak_impressions', 'peak_clicks', 'peak_units_sold_total', 'peak_total_revenue',
  'non_peak_ad_spend', 'non_peak_impressions', 'non_peak_clicks', 'non_peak_units_sold_total', 'non_peak_total_revenue',
]

/** One campaign, one ad group, one day. */
const row = (over: Record<string, string | number> = {}): Record<string, unknown> => ({
  date: '20260410', campaign_id: 'CMP1', campaign_name: 'GP1_CPC_5.5',
  adgroup_id: 'ADG1', adgroup_name: 'CPC_5.5', adgroup_targetting_type: 'Auto Targeting',
  adgroup_status: 'ADGROUP_STATUS_LIVE', campaign_status: 'LIVE',
  impressions: 1000, clicks: 20, ctr: 2, cvr: 5, avg_cpc: 5, ad_spend: 100,
  units_sold_direct: 2, units_sold_indirect: 1, units_sold_total: 3,
  direct_revenue: 800, indirect_revenue: 200, total_revenue: 1000,
  base_ad_spend: 60, peak_ad_spend: 30, non_peak_ad_spend: 10,
  base_total_revenue: 600, peak_total_revenue: 300, non_peak_total_revenue: 100,
  ...over,
})

describe('recognising Myntra’s PLA report', () => {
  it('claims the file by its own columns', () => {
    expect(detectMyntraAdsReport(HEADERS)).toBe(true)
  })

  it('refuses another platform’s ads export', () => {
    // An Amazon or Blinkit report has a date and a spend too; neither has
    // Myntra's ROI columns or its dayparts.
    expect(detectMyntraAdsReport(['date', 'campaign_id', 'adgroup_id', 'ad_spend', 'impressions'])).toBe(false)
    expect(detectMyntraAdsReport(['Date', 'Campaign Name', 'Spend', 'Impressions'])).toBe(false)
  })

  it('reads Myntra’s run-together date', () => {
    expect(myntraAdsDate('20260410')).toBe('2026-04-10')
    expect(myntraAdsDate('2026-04-10')).toBe('2026-04-10')
    expect(myntraAdsDate('20261310')).toBeNull()
    expect(myntraAdsDate('sometime')).toBeNull()
  })
})

describe('reading the month', () => {
  it('sums column N into the month’s ad spend', () => {
    const r = normalizeMyntraAdsReport([row({ ad_spend: 100 }), row({ date: '20260411', ad_spend: 57.5 })], 'test')
    expect(r.facts.spend).toBeCloseTo(157.5, 6)
    expect(r.month).toBe('2026-04')
    expect(r.adsRecords).toHaveLength(2)
  })

  it('keeps the direct and indirect attribution apart', () => {
    const r = normalizeMyntraAdsReport([row()], 'test')
    expect(r.facts.revenueDirect).toBe(800)
    expect(r.facts.revenueIndirect).toBe(200)
    expect(r.facts.unitsDirect).toBe(2)
    expect(r.facts.unitsIndirect).toBe(1)
    // The ads record carries the total, which is what every other platform's
    // attributed-sales figure means.
    expect(r.adsRecords[0].adSales).toBe(1000)
    expect(r.adsRecords[0].adOrders).toBe(3)
  })

  it('reads the dayparts as a split of the month, not as extra spend', () => {
    const r = normalizeMyntraAdsReport([row()], 'test')
    expect(r.facts.dayparts.map((d) => d.spend)).toEqual([60, 30, 10])
    expect(r.facts.dayparts.reduce((s, d) => s + d.spend, 0)).toBeCloseTo(r.facts.spend, 6)
  })

  it('says so when the dayparts do not add up to the spend', () => {
    const r = normalizeMyntraAdsReport([row({ base_ad_spend: 10 })], 'test')
    expect(r.warnings.some((w) => w.includes('not reliable this month'))).toBe(true)
  })

  it('keeps two campaigns that share a name apart', () => {
    // A dedup key built on a shared name drops one campaign's rows as
    // duplicates of the other's — which is how Blinkit's April advertising
    // came to read ₹11 against ₹16.80.
    const r = normalizeMyntraAdsReport([
      row({ campaign_id: 'CMP1', ad_spend: 100 }),
      row({ campaign_id: 'CMP2', ad_spend: 250 }),
    ], 'test')
    expect(r.facts.campaigns).toHaveLength(2)
    expect(r.facts.spend).toBe(350)
    const keys = r.adsRecords.map(adsRecordKey)
    expect(new Set(keys).size).toBe(2)
    expect(r.warnings.some((w) => w.includes('used by more than one campaign'))).toBe(true)
  })

  it('rejects a row whose date cannot be read rather than filing it anywhere', () => {
    const r = normalizeMyntraAdsReport([row(), row({ date: 'whenever' })], 'test')
    expect(r.invalidRows).toHaveLength(1)
    expect(r.facts.spend).toBe(100)
  })

  it('counts the campaign-days that stopped on the daily budget', () => {
    const r = normalizeMyntraAdsReport([row({ campaign_status: 'DAILY_BUDGET_MET' }), row({ date: '20260411' })], 'test')
    expect(r.facts.statusCounts).toEqual({ DAILY_BUDGET_MET: 1, LIVE: 1 })
    expect(r.warnings.some((w) => w.includes('stopped on the daily budget'))).toBe(true)
  })
})

/** The owner's own April 2026 report, read end to end. */
describe.skipIf(!existsSync(REPORT))('the owner’s April 2026 Myntra PLA report', () => {
  const run = () => {
    const parsed = Papa.parse<Record<string, string>>(readFileSync(REPORT, 'utf8'), { header: true, skipEmptyLines: true })
    return { headers: parsed.meta.fields ?? [], result: normalizeMyntraAdsReport(parsed.data as Record<string, unknown>[], 'test') }
  }

  it('is recognised, and column N is the ad spend', () => {
    const { headers, result } = run()
    expect(detectMyntraAdsReport(headers)).toBe(true)
    expect(headers[13]).toBe('ad_spend')
    expect(result.totalRows).toBe(143)
    expect(result.invalidRows).toEqual([])
    expect(result.months).toEqual(['2026-04'])
  })

  it('charges ₹36,926.74 of advertising to April', () => {
    const f = run().result.facts
    expect(f.spend).toBeCloseTo(36926.74, 2)
    // And the same figure reaches the P&L's marketing input.
    const marketing = marketingFromAds(run().result.adsRecords, '2026-04', [])
    expect(marketing.myntra?.ads).toBeCloseTo(36926.74, 2)
  })

  it('reads what the spend bought, both ways Myntra attributes it', () => {
    const f = run().result.facts
    expect(f.impressions).toBe(901826)
    expect(f.clicks).toBe(9489)
    expect(f.revenueDirect).toBeCloseTo(135455.59, 2)
    expect(f.revenueIndirect).toBeCloseTo(41945.4, 2)
    expect(f.unitsDirect).toBe(633)
    expect(f.unitsIndirect).toBe(163)
  })

  it('splits the month across the three dayparts to the paisa', () => {
    const f = run().result.facts
    expect(f.dayparts.map((d) => Number(d.spend.toFixed(2)))).toEqual([16366.54, 19368.52, 1191.68])
    expect(f.dayparts.reduce((s, d) => s + d.spend, 0)).toBeCloseTo(f.spend, 2)
  })

  it('finds eight campaigns over 24 days, and the two sharing a name', () => {
    const f = run().result.facts
    expect(f.campaigns).toHaveLength(8)
    expect(f.days).toBe(24)
    expect(f.campaigns[0].campaignName).toBe('GP3_CPC_3.2')
    expect(f.campaigns[0].spend).toBeCloseTo(13026.2, 2)
    expect(f.campaigns.filter((c) => c.campaignName.startsWith('GP5_CPC_3.5'))).toHaveLength(2)
    expect(f.statusCounts).toEqual({ LIVE: 111, ABORTED: 23, CAMPAIGN_EXPIRED: 7, DAILY_BUDGET_MET: 2 })
  })

  it('stores one ads row per campaign, ad group and day, each with its own key', () => {
    const records = run().result.adsRecords
    expect(records).toHaveLength(143)
    expect(new Set(records.map(adsRecordKey)).size).toBe(143)
  })
})
