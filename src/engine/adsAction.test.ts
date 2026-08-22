import { describe, expect, it } from 'vitest'
import { recommendAdsAction } from './adsAction'

describe('recommendAdsAction', () => {
  it('recommends NEGATIVE_KEYWORD for high spend with zero conversions', () => {
    const result = recommendAdsAction({ campaign: 'A', spend: 5000, adSales: 0, adOrders: 0 })
    expect(result.action).toBe('NEGATIVE_KEYWORD')
  })

  it('recommends SCALE for high ROAS with strong conversions', () => {
    const result = recommendAdsAction({ campaign: 'B', spend: 1000, adSales: 6000, adOrders: 15 })
    expect(result.action).toBe('SCALE')
  })

  it('recommends PROTECT for very high ROAS with a large sales share, even without hitting scale conversion count', () => {
    const result = recommendAdsAction({ campaign: 'C', spend: 300, adSales: 3000, adOrders: 3, salesShare: 0.2 })
    expect(result.action).toBe('PROTECT')
  })

  it('recommends REDUCE_BID for poor ROAS with meaningful spend', () => {
    const result = recommendAdsAction({ campaign: 'D', spend: 3000, adSales: 2000, adOrders: 8 })
    expect(result.action).toBe('REDUCE_BID')
  })

  it('recommends PAUSE for sustained poor performance', () => {
    const result = recommendAdsAction({ campaign: 'E', spend: 3000, adSales: 1500, adOrders: 5, consecutivePoorDays: 20 })
    expect(result.action).toBe('PAUSE')
  })

  it('recommends INVESTIGATE for a sudden ROAS drop from a healthy trailing average', () => {
    const result = recommendAdsAction({ campaign: 'F', spend: 1000, adSales: 1000, adOrders: 4, trailingRoas: 5 })
    expect(result.action).toBe('INVESTIGATE')
  })
})
