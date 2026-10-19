import { describe, expect, it } from 'vitest'
import { adsAmountInr } from './adsAmounts'
import { marketingFromAds } from './marketing'
import type { AdsRecord } from '@/data/models'

const FX = { USD: 88.4, AED: 24.07 }

describe('adsAmountInr', () => {
  it('leaves a rupee figure alone, however it says so', () => {
    expect(adsAmountInr(212876.1, undefined, FX)).toBe(212876.1)
    expect(adsAmountInr(212876.1, 'INR', FX)).toBe(212876.1)
  })

  // AED 5,006.88 is the owner's six months on Amazon UAE. Read as rupees it
  // is ₹5,006.88 and the channel looks as though it never advertised.
  it('brings dirhams and dollars across at the month’s rate', () => {
    expect(adsAmountInr(1547.42, 'AED', FX)).toBeCloseTo(1547.42 * 24.07, 6)
    expect(adsAmountInr(3527.7, 'USD', FX)).toBeCloseTo(3527.7 * 88.4, 6)
  })
})

const record = (over: Partial<AdsRecord>): AdsRecord => ({
  date: '2026-09-01', channel: 'amazon_ae', campaign: 'acct',
  impressions: 0, clicks: 0, spend: 272.11, adSales: 0, adOrders: 0,
  currency: 'AED', importId: 'i', ...over,
})

describe('the P&L’s marketing input', () => {
  it('charges a dirham account in rupees', () => {
    const m = marketingFromAds([record({})], '2026-09', [], FX)
    expect(m.amazon_ae?.ads).toBeCloseTo(272.11 * 24.07, 6)
  })

  it('leaves the rupee channels exactly as they were', () => {
    const m = marketingFromAds(
      [record({ channel: 'amazon_in_seller', currency: 'INR', spend: 212876.1 })], '2026-09', [], FX,
    )
    expect(m.amazon_in?.ads).toBe(212876.1)
  })

  // Every row stored before the currency column existed is rupees: its
  // reader converted at upload. Reading those as foreign would multiply
  // ₹1.77 lakh of Amazon USA spend by eighty-eight.
  it('treats a row with no currency as rupees', () => {
    const m = marketingFromAds(
      [record({ channel: 'amazon_us', currency: undefined, spend: 177141.496 })], '2026-09', [], FX,
    )
    expect(m.amazon_us?.ads).toBe(177141.496)
  })

  it('uses the standing rate when no month rate is given', () => {
    const m = marketingFromAds([record({})], '2026-09', [])
    expect(m.amazon_ae?.ads).toBeGreaterThan(272.11)
  })
})
