import { useMemo } from 'react'
import { useDataStore } from '@/store/dataStore'
import { usePnlInputs } from '@/engine/usePnlInputs'
import { useFilterStore } from '@/store/filterStore'
import { BUSINESS_CHANNELS, BUSINESS_CHANNEL_IDS, channelLabel } from '@/config/channels'
import { addMonths, ytdMonthKeys } from '@/lib/format'
import { buildAllChannelPnlViews } from '@/engine/channelPnlRouter'
import { buildMasterPnl } from '@/engine/pnl'
import { filterByMonth, groupBySku, growthPct } from '@/engine/sales'
import { asp as aspOf, aov as aovOf, netSalesForMonth, orderBasisNetSales, rtoPct } from '@/engine/netSales'
import { forecastDemand } from '@/engine/forecast'
import { INVENTORY_THRESHOLDS } from '@/config/thresholds'
import {
  inventoryInsight,
  marginDeclineInsight,
  revenueInsight,
  rtoInsight,
  skuGrowthInsights,
  type Insight,
} from '@/engine/insight'

export function useOverviewData() {
  const { salesRecords, adsRecords, skuMaster, inventorySnapshots, flipkartFacts, amazonUsaFacts, meeshoFacts } = useDataStore()
  const { forMonth } = usePnlInputs()
  const { month } = useFilterStore()

  return useMemo(() => {
    const previousMonth = addMonths(month, -1)
    const channelIds = BUSINESS_CHANNEL_IDS
    const facts = { flipkartFacts, amazonUsaFacts, meeshoFacts }

    const currentChannelPnls = buildAllChannelPnlViews(channelIds, month, forMonth(month)).map((v) => v.canonical)
    const previousChannelPnls = buildAllChannelPnlViews(channelIds, previousMonth, forMonth(previousMonth)).map((v) => v.canonical)
    const masterCurrent = buildMasterPnl(currentChannelPnls, month)
    const masterPrevious = buildMasterPnl(previousChannelPnls, previousMonth)

    // The last six months, for the sparklines and the headline trend. Built
    // from the same engine as every other figure on the page, so the shape
    // beside a number and the number itself can never disagree.
    const trendMonths = Array.from({ length: 6 }, (_, i) => addMonths(month, i - 5))
    const trend = trendMonths.map((m) => {
      const f = netSalesForMonth(salesRecords, m, facts, channelIds)
      const master = buildMasterPnl(
        buildAllChannelPnlViews(channelIds, m, forMonth(m)).map((v) => v.canonical), m,
      )
      return {
        month: m,
        netSales: f.netSales,
        orders: f.orders,
        units: f.units,
        grossProfit: master.lines.grossProfit ?? 0,
        ebitda: master.lines.ebitda ?? 0,
      }
    })

    const ytdMonths = ytdMonthKeys(month)
    const ytdNetSales = ytdMonths.reduce(
      (sum, m) => sum + netSalesForMonth(salesRecords, m, facts, channelIds).netSales, 0)
    const previousYtdNetSales = ytdMonths
      .map((m) => addMonths(m, -12))
      .reduce((sum, m) => sum + netSalesForMonth(salesRecords, m, facts, channelIds).netSales, 0)

    // One figure, from the one engine. Previously this summed order rows while
    // masterCurrent read the P&L (settlement for Meesho/Flipkart/Amazon USA),
    // then divided one by the other to get ASP — mixing two datasets inside a
    // single ratio.
    const currentFacts = netSalesForMonth(salesRecords, month, facts, channelIds)
    const previousFacts = netSalesForMonth(salesRecords, previousMonth, facts, channelIds)

    const currentAdsMonth = adsRecords.filter((r) => r.date.slice(0, 7) === month)
    const totalAdSpend = currentAdsMonth.reduce((s, r) => s + r.spend, 0)
    const totalAdSales = currentAdsMonth.reduce((s, r) => s + r.adSales, 0)
    const acos = totalAdSales > 0 ? (totalAdSpend / totalAdSales) * 100 : 0
    const tacos = currentFacts.netSales > 0 ? (totalAdSpend / currentFacts.netSales) * 100 : 0
    const roas = totalAdSpend > 0 ? totalAdSales / totalAdSpend : 0

    // Channel performance
    const channelSummaries = BUSINESS_CHANNELS.map((c) => {
      const cur = currentChannelPnls.find((p) => p.channel === c.id)!
      const prev = previousChannelPnls.find((p) => p.channel === c.id)!
      const g = growthPct(cur.lines.netSales ?? 0, prev.lines.netSales ?? 0)
      return { channel: c.id, label: c.label, netSales: cur.lines.netSales ?? 0, growth: g, contribution: cur.lines.contributionProfit ?? 0 }
    }).filter((c) => c.netSales > 0 || (c.growth !== null && c.growth !== 0))

    const bestChannel = [...channelSummaries].sort((a, b) => b.netSales - a.netSales)[0]
    const fastestGrowing = [...channelSummaries].filter((c) => c.growth !== null).sort((a, b) => (b.growth ?? 0) - (a.growth ?? 0))[0]
    const mostProfitable = [...channelSummaries].sort((a, b) => b.contribution - a.contribution)[0]
    const weakest = [...channelSummaries].filter((c) => c.growth !== null).sort((a, b) => (a.growth ?? 0) - (b.growth ?? 0))[0]

    // SKU performance
    const currentBySku = groupBySku(filterByMonth(salesRecords, month))
    const previousBySku = groupBySku(filterByMonth(salesRecords, previousMonth))
    const skuRows = skuMaster.map((s) => {
      const curUnits = orderBasisNetSales(currentBySku.get(s.sku) ?? []).units
      const prevUnits = orderBasisNetSales(previousBySku.get(s.sku) ?? []).units
      const curNet = orderBasisNetSales(currentBySku.get(s.sku) ?? []).netSales
      return { sku: s.sku, productName: s.productName, curUnits, prevUnits, curNet, growth: growthPct(curUnits, prevUnits) }
    })
    const topSku = [...skuRows].sort((a, b) => b.curNet - a.curNet)[0]
    const fastestGrowingSku = [...skuRows].filter((r) => r.growth !== null && r.prevUnits > 0).sort((a, b) => (b.growth ?? 0) - (a.growth ?? 0))[0]
    const decliningSku = [...skuRows].filter((r) => r.growth !== null && r.prevUnits > 0).sort((a, b) => (a.growth ?? 0) - (b.growth ?? 0))[0]

    // Inventory — only SKUs with a known stock position; no snapshot means
    // unknown coverage, not "excess".
    const inventoryRows = skuMaster.flatMap((s) => {
      const snapshot = inventorySnapshots.find((i) => i.sku === s.sku)
      if (!snapshot) return []
      const trailingDaily = salesRecords
        .filter((r) => r.sku === s.sku && r.orderDate <= snapshot.asOfDate)
        .slice(-90)
      const series = Object.entries(
        trailingDaily.reduce<Record<string, number>>((acc, r) => {
          acc[r.orderDate] = (acc[r.orderDate] ?? 0) + r.quantity
          return acc
        }, {}),
      ).map(([date, units]) => ({ date, units }))
      const forecast = forecastDemand(series)
      const coverageDays = forecast.avgDailyUnits > 0 ? snapshot.currentStock / forecast.avgDailyUnits : Infinity
      return [{ sku: s.sku, productName: s.productName, coverageDays, currentStock: snapshot.currentStock, cogs: s.cogs }]
    })
    const stockOutRiskSkus = inventoryRows.filter((r) => r.coverageDays <= INVENTORY_THRESHOLDS.buyNowCoverageDays)
    const excessInventorySkus = inventoryRows.filter((r) => r.coverageDays >= INVENTORY_THRESHOLDS.excessInventoryCoverageDays)
    const inventoryValue = inventoryRows.reduce((sum, r) => sum + r.currentStock * r.cogs, 0)
    const avgCoverageDays =
      inventoryRows.length > 0 ? inventoryRows.reduce((s, r) => s + (Number.isFinite(r.coverageDays) ? r.coverageDays : 0), 0) / inventoryRows.length : 0

    // Insights (Action Required)
    const insights: Insight[] = []
    const revIns = revenueInsight(currentFacts.netSales, previousFacts.netSales)
    if (revIns) insights.push(revIns)
    const marginIns = marginDeclineInsight(masterCurrent.lines, masterPrevious.lines)
    if (marginIns) insights.push(marginIns)
    insights.push(...skuGrowthInsights(skuRows.map((r) => ({ sku: r.sku, productName: r.productName, currentUnits: r.curUnits, previousUnits: r.prevUnits }))))
    for (const row of inventoryRows) {
      const ins = inventoryInsight(row.sku, row.productName, row.coverageDays)
      if (ins) insights.push(ins)
    }
    for (const c of BUSINESS_CHANNELS) {
      const channelFigure = orderBasisNetSales(filterByMonth(salesRecords, month).filter((r) => r.channel === c.id))
      const ins = rtoInsight(c.id, channelFigure.rtoUnits, channelFigure.shippedUnits)
      if (ins) insights.push(ins)
    }
    if (channelSummaries.length > 0) {
      for (const c of channelSummaries) {
        if (c.growth !== null && c.growth >= 20) {
          insights.push({ severity: 'green', category: 'channel', message: `${channelLabel(c.channel)} revenue increased ${c.growth.toFixed(0)}% MoM.` })
        }
      }
    }

    return {
      month,
      currentFacts,
      previousFacts,
      masterCurrent,
      masterPrevious,
      trend,
      ytdNetSales,
      previousYtdNetSales,
      ytdGrowth: growthPct(ytdNetSales, previousYtdNetSales),
      revenueGrowthMoM: growthPct(currentFacts.netSales, previousFacts.netSales),
      ordersGrowthMoM: growthPct(currentFacts.orders, previousFacts.orders),
      aov: aovOf(currentFacts) ?? 0,
      // ASP = Net Sales / Units, both from the same figure. It used to divide
      // P&L gross sales by order-row units — two datasets in one ratio.
      asp: aspOf(currentFacts) ?? 0,
      previousAsp: aspOf(previousFacts),
      rtoPct: rtoPct(currentFacts),
      netSalesBasis: currentFacts.basis,
      totalAdSpend,
      roas,
      acos,
      tacos,
      bestChannel,
      fastestGrowing,
      mostProfitable,
      weakest,
      topSku,
      fastestGrowingSku,
      decliningSku,
      stockOutRiskSkus,
      excessInventorySkus,
      inventoryValue,
      avgCoverageDays,
      insights,
    }
  }, [salesRecords, adsRecords, skuMaster, inventorySnapshots, flipkartFacts, amazonUsaFacts, meeshoFacts, forMonth, month])
}
