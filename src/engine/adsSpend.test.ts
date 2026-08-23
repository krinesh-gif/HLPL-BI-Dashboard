import { describe, expect, it } from 'vitest'
import { ADS_CHANNELS, ADS_CHANNEL_IDS } from '@/config/adsChannels'
import type { AdsRecord, ManualAdSpend } from '@/data/models'
import { adsSpendFor, adsSpendForMonth, tacos, totalAdsSpend } from './adsSpend'
import { marketingFromAds } from './marketing'

function report(over: Partial<AdsRecord> = {}): AdsRecord {
  return {
    date: '2026-08-10', channel: 'amazon_in_seller', campaign: 'C1',
    impressions: 10000, clicks: 200, spend: 5000, adSales: 25000, adOrders: 50,
    importId: 'i', ...over,
  }
}

function manual(over: Partial<ManualAdSpend> = {}): ManualAdSpend {
  return { channel: 'nykaa', month: '2026-08', amount: 125000, enteredAt: '2026-08-31T00:00:00Z', ...over }
}

describe('the ads channel list', () => {
  it('has its own channels, not the sales list', () => {
    // Meesho and Purplle sell without an ads report; listing them would put
    // permanently empty pages in the navigation.
    expect(ADS_CHANNEL_IDS).toEqual(['amazon_in', 'amazon_us', 'flipkart', 'myntra', 'nykaa'])
  })

  it('treats Amazon India as one ads channel', () => {
    const labels = ADS_CHANNELS.map((c) => c.label)
    expect(labels).toContain('Amazon India')
    expect(labels.some((l) => /seller|vendor/i.test(l))).toBe(false)
  })

  it('marks Nykaa as billing by monthly invoice', () => {
    expect(ADS_CHANNELS.find((c) => c.id === 'nykaa')?.usesMonthlyInvoice).toBe(true)
    expect(ADS_CHANNELS.find((c) => c.id === 'amazon_in')?.usesMonthlyInvoice).toBe(false)
  })
})

describe('which source a figure comes from', () => {
  it('prefers an uploaded report', () => {
    const f = adsSpendFor('amazon_in', '2026-08', [report()], [manual({ channel: 'amazon_in', amount: 999999 })])
    expect(f.source).toBe('report')
    expect(f.spend).toBe(5000)
  })

  it('never adds a report and a manual figure together', () => {
    // Both existing for one month must not produce 5000 + 999999.
    const f = adsSpendFor('amazon_in', '2026-08', [report()], [manual({ channel: 'amazon_in', amount: 999999 })])
    expect(f.spend).toBe(5000)
  })

  it('falls back to the manual figure when no report covers the month', () => {
    const f = adsSpendFor('nykaa', '2026-08', [], [manual()])
    expect(f.source).toBe('manual')
    expect(f.spend).toBe(125000)
    expect(f.sourceLabel).toMatch(/manually/i)
  })

  it('labels a manual figure with its invoice reference', () => {
    const f = adsSpendFor('nykaa', '2026-08', [], [manual({ fileName: 'NYK-MI-Aug.pdf' })])
    expect(f.sourceLabel).toContain('NYK-MI-Aug.pdf')
  })

  it('reports no data rather than a zero when neither exists', () => {
    const f = adsSpendFor('flipkart', '2026-08', [], [])
    expect(f.source).toBe('none')
    expect(f.spend).toBe(0)
  })

  it('leaves attributed metrics null on a manual month, not zero', () => {
    // Zero clicks would read as "nobody clicked"; null reads as "not measured".
    const f = adsSpendFor('nykaa', '2026-08', [], [manual()])
    expect(f.adSales).toBeNull()
    expect(f.clicks).toBeNull()
    expect(f.impressions).toBeNull()
  })

  it('rolls both Amazon India reports into the one ads channel', () => {
    const f = adsSpendFor('amazon_in', '2026-08', [
      report({ channel: 'amazon_in_seller', spend: 3000, adSales: 12000 }),
      report({ channel: 'amazon_in_vendor', spend: 2000, adSales: 8000 }),
    ], [])
    expect(f.spend).toBe(5000)
    expect(f.adSales).toBe(20000)
  })
})

describe('the all-channels total', () => {
  const figures = adsSpendForMonth('2026-08', [report({ spend: 5000, adSales: 25000 })], [manual()])

  it('counts manual spend as real money', () => {
    expect(totalAdsSpend(figures).spend).toBe(130000)
    expect(totalAdsSpend(figures).includesManual).toBe(true)
  })

  it('measures ROAS only against spend that came with attributed sales', () => {
    // 25000 of sales against the 5000 that was measured, not against the
    // 130000 that includes Nykaa's unattributed invoice.
    expect(totalAdsSpend(figures).roas).toBeCloseTo(5, 5)
  })

  it('measures ACOS the same way', () => {
    expect(totalAdsSpend(figures).acos).toBeCloseTo(20, 5)
  })

  it('reports ROAS as unknown when nothing was measured', () => {
    const onlyManual = adsSpendForMonth('2026-08', [], [manual()])
    expect(totalAdsSpend(onlyManual).roas).toBeNull()
    expect(totalAdsSpend(onlyManual).adSales).toBeNull()
    expect(totalAdsSpend(onlyManual).spend).toBe(125000)
  })
})

describe('TACOS', () => {
  it('is total ad spend over net sales', () => {
    expect(tacos(130000, 1000000)).toBeCloseTo(13, 5)
  })

  it('is unknown rather than zero when there are no sales', () => {
    expect(tacos(130000, 0)).toBeNull()
  })
})

describe('reaching the P&L', () => {
  it('carries a manual figure into the marketing line', () => {
    // Nykaa's invoice is real advertising spend and has to reach the P&L, or
    // the channel shows a margin it did not earn.
    const marketing = marketingFromAds([], '2026-08', [manual()])
    expect(marketing.nykaa?.ads).toBe(125000)
  })

  it('does not double-count a month that also has a report', () => {
    const marketing = marketingFromAds(
      [report({ channel: 'nykaa', spend: 40000 })], '2026-08', [manual({ amount: 125000 })],
    )
    expect(marketing.nykaa?.ads).toBe(40000)
  })

  it('ignores manual figures from other months', () => {
    expect(marketingFromAds([], '2026-09', [manual()]).nykaa).toBeUndefined()
  })

  it('rolls Amazon India ad spend onto one channel', () => {
    const marketing = marketingFromAds([
      report({ channel: 'amazon_in_seller', spend: 3000 }),
      report({ channel: 'amazon_in_vendor', spend: 2000 }),
    ], '2026-08')
    expect(marketing.amazon_in?.ads).toBe(5000)
  })
})
