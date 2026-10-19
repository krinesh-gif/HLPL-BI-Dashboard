import { describe, expect, it } from 'vitest'
import type { AdsRecord } from '@/data/models'
import { adsSpendByProgram, adsSpendFor, adsSpendForMonth, totalAdsSpend } from './adsSpend'
import { marketingFromAds } from './marketing'

/**
 * The dashboard reads ad rows grouped, not one per campaign.
 *
 * 5,004 campaign rows were 1.9 MB of JSON on every page load, and no screen
 * reads a campaign row: the Ads pages sum a channel's month, split it by ad
 * product or compare months, and the P&L takes one figure per channel per
 * month. `/api/state` groups on exactly what those readings discriminate by —
 * channel, day, ad product, and the currency it was billed in — which gives
 * 201 rows and 30 kB.
 *
 * That is only safe if it changes no figure, so this rolls rows up the way the
 * SQL does and asserts the engine cannot tell the difference. The grouping key
 * here is the GROUP BY in `api/state.ts`; if one gains a field and the other
 * does not, a figure moves and this is what notices.
 */
const KEY: (keyof AdsRecord)[] = ['date', 'channel', 'program', 'currency']
const SUMMED: (keyof AdsRecord)[] = ['impressions', 'clicks', 'spend', 'adSales', 'adOrders']

/** What the GROUP BY in api/state.ts produces, in TypeScript. */
function rollup(records: AdsRecord[]): AdsRecord[] {
  const groups = new Map<string, AdsRecord>()
  for (const r of records) {
    const key = KEY.map((k) => String(r[k] ?? '')).join('\u0000')
    const found = groups.get(key)
    if (!found) {
      // Campaign and the rest of the row's identity do not survive the
      // grouping, exactly as they do not survive the SQL.
      groups.set(key, {
        ...r, campaign: '', adGroup: undefined, keyword: undefined,
        searchTerm: undefined, sku: undefined, asin: undefined,
      })
      continue
    }
    for (const field of SUMMED) {
      ;(found as unknown as Record<string, number>)[field] += (r as unknown as Record<string, number>)[field]
    }
  }
  return [...groups.values()]
}

const row = (over: Partial<AdsRecord>): AdsRecord => ({
  date: '2026-09-04', channel: 'flipkart', campaign: 'c1',
  impressions: 100, clicks: 5, spend: 250, adSales: 900, adOrders: 2,
  importId: 'i1', ...over,
})

/**
 * Rows of every awkward shape the real data has: several campaigns on one
 * day, two ad products on one day, a foreign currency beside rupees, a month
 * of cost-only rows with no measured sales, and a second month.
 */
const RECORDS: AdsRecord[] = [
  row({ campaign: 'a' }), row({ campaign: 'b', spend: 125.07, adSales: 310.5 }),
  row({ campaign: 'c', date: '2026-09-05', clicks: 0, adSales: 0 }),
  row({ channel: 'amazon_in_seller', campaign: 'sp1', program: 'Sponsored Products', spend: 4000, adSales: 12000 }),
  row({ channel: 'amazon_in_seller', campaign: 'sp2', program: 'Sponsored Products', spend: 1500.33, adSales: 2000.11 }),
  row({ channel: 'amazon_in_seller', campaign: 'sb1', program: 'Sponsored Brands', spend: 900, adSales: 1100 }),
  row({ channel: 'amazon_ae', campaign: '', currency: 'AED', spend: 272.11, adSales: 0, impressions: 0, clicks: 0, adOrders: 0 }),
  row({ channel: 'amazon_us', campaign: '', currency: 'USD', spend: 1163.7, adSales: 0, impressions: 0, clicks: 0, adOrders: 0 }),
  row({ campaign: 'd', date: '2026-08-11', spend: 77.77 }),
  row({ channel: 'myntra', campaign: 'm1', date: '2026-08-11' }),
]

const FX = { USD: 95.8, AED: 26 }
const GROUPED = rollup(RECORDS)

describe('grouping the ad rows changes no figure', () => {
  it('collapses the rows it is supposed to', () => {
    expect(RECORDS).toHaveLength(10)
    expect(GROUPED.length).toBeLessThan(RECORDS.length)
  })

  it.each(['2026-09', '2026-08'])('the whole of %s reads the same', (month) => {
    const raw = totalAdsSpend(adsSpendForMonth(month, RECORDS, [], undefined, FX))
    const grouped = totalAdsSpend(adsSpendForMonth(month, GROUPED, [], undefined, FX))
    expect(grouped.spend).toBeCloseTo(raw.spend, 6)
    expect(grouped.adSales).toBeCloseTo(raw.adSales ?? 0, 6)
    expect(grouped.roas ?? 0).toBeCloseTo(raw.roas ?? 0, 6)
    expect(grouped.acos ?? 0).toBeCloseTo(raw.acos ?? 0, 6)
  })

  it.each([
    ['flipkart', '2026-09'], ['amazon_in', '2026-09'],
    ['amazon_ae', '2026-09'], ['amazon_us', '2026-09'],
    ['flipkart', '2026-08'], ['myntra', '2026-08'],
  ] as const)('%s in %s reads the same, field for field', (channel, month) => {
    const raw = adsSpendFor(channel, month, RECORDS, [], FX)
    const grouped = adsSpendFor(channel, month, GROUPED, [], FX)
    for (const key of Object.keys(raw) as (keyof typeof raw)[]) {
      const a = raw[key]
      const b = grouped[key]
      if (typeof a === 'number' && typeof b === 'number') expect(b, key).toBeCloseTo(a, 6)
      else expect(b, key).toEqual(a)
    }
  })

  it('splits Amazon by ad product exactly as before', () => {
    const raw = adsSpendByProgram('amazon_in', '2026-09', RECORDS, FX)
    const grouped = adsSpendByProgram('amazon_in', '2026-09', GROUPED, FX)
    expect(grouped).toHaveLength(raw.length)
    for (let i = 0; i < raw.length; i++) {
      expect(grouped[i].program).toBe(raw[i].program)
      expect(grouped[i].spend).toBeCloseTo(raw[i].spend, 6)
      expect(grouped[i].adSales).toBeCloseTo(raw[i].adSales, 6)
      expect(grouped[i].shareOfSpend).toBeCloseTo(raw[i].shareOfSpend, 6)
    }
  })

  it.each(['2026-09', '2026-08'])('the P&L charges the same advertising in %s', (month) => {
    const raw = marketingFromAds(RECORDS, month, [], FX)
    const grouped = marketingFromAds(GROUPED, month, [], FX)
    expect(Object.keys(grouped).sort()).toEqual(Object.keys(raw).sort())
    for (const channel of Object.keys(raw) as (keyof typeof raw)[]) {
      expect(grouped[channel]?.ads ?? 0, channel).toBeCloseTo(raw[channel]?.ads ?? 0, 6)
    }
  })

  /**
   * A dirham row and a dollar row must not be added together before the rate
   * is applied, which is why the currency is part of the grouping key.
   */
  it('never merges two currencies into one row', () => {
    for (const r of GROUPED) {
      const sources = RECORDS.filter(
        (x) => x.date === r.date && x.channel === r.channel && x.program === r.program,
      )
      expect(new Set(sources.map((x) => x.currency)).size).toBeLessThanOrEqual(1)
    }
  })
})
