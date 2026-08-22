import { useMemo } from 'react'
import { useDataStore } from '@/store/dataStore'
import { useFilterStore } from '@/store/filterStore'
import { addMonths, monthLabel, toMonthKey } from '@/lib/format'
import { recommendAdsAction, type AdsActionRecommendation } from '@/engine/adsAction'

export interface CampaignRow {
  campaign: string
  spend: number
  adSales: number
  adOrders: number
  impressions: number
  clicks: number
  roas: number
  acos: number
  ctr: number
  cpc: number
  recommendation: AdsActionRecommendation
}

export function useAdsData() {
  const { adsRecords } = useDataStore()
  const { month } = useFilterStore()

  return useMemo(() => {
    const currentMonthRecords = adsRecords.filter((r) => toMonthKey(r.date) === month)
    const previousMonth = addMonths(month, -1)
    const previousMonthRecords = adsRecords.filter((r) => toMonthKey(r.date) === previousMonth)

    const totalAdSales = currentMonthRecords.reduce((s, r) => s + r.adSales, 0)

    const byCampaign = new Map<string, typeof currentMonthRecords>()
    for (const r of currentMonthRecords) {
      const bucket = byCampaign.get(r.campaign)
      if (bucket) bucket.push(r)
      else byCampaign.set(r.campaign, [r])
    }

    const campaignRows: CampaignRow[] = Array.from(byCampaign.entries()).map(([campaign, records]) => {
      const spend = records.reduce((s, r) => s + r.spend, 0)
      const adSales = records.reduce((s, r) => s + r.adSales, 0)
      const adOrders = records.reduce((s, r) => s + r.adOrders, 0)
      const impressions = records.reduce((s, r) => s + r.impressions, 0)
      const clicks = records.reduce((s, r) => s + r.clicks, 0)

      const prevRecords = previousMonthRecords.filter((r) => r.campaign === campaign)
      const trailingSpend = prevRecords.reduce((s, r) => s + r.spend, 0)
      const trailingSales = prevRecords.reduce((s, r) => s + r.adSales, 0)
      const trailingRoas = trailingSpend > 0 ? trailingSales / trailingSpend : undefined

      // Last-14-day consecutive poor-performance check (ROAS < 1 each day).
      const sortedDaily = [...records].sort((a, b) => (a.date < b.date ? -1 : 1))
      let consecutivePoorDays = 0
      for (let i = sortedDaily.length - 1; i >= 0; i--) {
        const r = sortedDaily[i]
        if (r.spend > 0 && r.adSales / r.spend < 1) consecutivePoorDays++
        else break
      }

      const recommendation = recommendAdsAction({
        campaign,
        spend,
        adSales,
        adOrders,
        trailingRoas,
        consecutivePoorDays,
        salesShare: totalAdSales > 0 ? adSales / totalAdSales : 0,
      })

      return {
        campaign,
        spend,
        adSales,
        adOrders,
        impressions,
        clicks,
        roas: spend > 0 ? adSales / spend : 0,
        acos: adSales > 0 ? (spend / adSales) * 100 : 0,
        ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
        cpc: clicks > 0 ? spend / clicks : 0,
        recommendation,
      }
    })

    const trendMonths = Array.from({ length: 6 }).map((_, i) => addMonths(month, i - 5))
    const trend = trendMonths.map((m) => {
      const records = adsRecords.filter((r) => toMonthKey(r.date) === m)
      const spend = records.reduce((s, r) => s + r.spend, 0)
      const sales = records.reduce((s, r) => s + r.adSales, 0)
      return {
        month: monthLabel(m),
        spend,
        sales,
        roas: spend > 0 ? sales / spend : 0,
        acos: sales > 0 ? (spend / sales) * 100 : 0,
      }
    })

    const totalSpend = currentMonthRecords.reduce((s, r) => s + r.spend, 0)

    return {
      campaignRows: campaignRows.sort((a, b) => b.spend - a.spend),
      trend,
      totalSpend,
      totalAdSales,
      roas: totalSpend > 0 ? totalAdSales / totalSpend : 0,
      acos: totalAdSales > 0 ? (totalSpend / totalAdSales) * 100 : 0,
    }
  }, [adsRecords, month])
}
