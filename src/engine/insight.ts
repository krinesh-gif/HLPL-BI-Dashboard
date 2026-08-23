import type { BusinessChannelId } from '@/config/channels'
import { channelLabel } from '@/config/channels'
import { INSIGHT_THRESHOLDS } from '@/config/thresholds'
import type { PnlLineValues } from '@/data/models'
import { growthPct } from './sales'

export type InsightSeverity = 'red' | 'orange' | 'green'

export interface Insight {
  severity: InsightSeverity
  category: 'revenue' | 'margin' | 'channel' | 'sku' | 'ads' | 'inventory'
  message: string
}

/**
 * Every function here only asserts what the numbers directly show. Where a
 * plausible cause can't be established from the available data, the message
 * says so explicitly rather than guessing (per the "no fake insights" rule).
 */

export function revenueInsight(currentNetSales: number, previousNetSales: number): Insight | null {
  const g = growthPct(currentNetSales, previousNetSales)
  if (g === null) return null
  if (g >= INSIGHT_THRESHOLDS.revenueGrowthHighPct) {
    return { severity: 'green', category: 'revenue', message: `Revenue grew ${g.toFixed(1)}% MoM.` }
  }
  if (g <= INSIGHT_THRESHOLDS.revenueDeclineHighPct) {
    return { severity: 'red', category: 'revenue', message: `Revenue declined ${Math.abs(g).toFixed(1)}% MoM.` }
  }
  return null
}

/**
 * Decomposes a contribution-margin change into its arithmetic drivers
 * (gross margin %, marketplace-cost %, marketing %) — a direct calculation,
 * not an inference — and only names the driver(s) whose change actually
 * accounts for the movement.
 */
export function marginDeclineInsight(
  current: PnlLineValues,
  previous: PnlLineValues,
): Insight | null {
  const curCm = current.contributionMarginPct ?? 0
  const prevCm = previous.contributionMarginPct ?? 0
  const delta = curCm - prevCm
  if (Math.abs(delta) < INSIGHT_THRESHOLDS.marginDeclinePct) return null

  const marketplacePctOf = (l: PnlLineValues) => {
    const net = l.netSales ?? 0
    if (net === 0) return 0
    const mp =
      (l.marketplaceCommission ?? 0) + (l.fulfilment ?? 0) + (l.shipping ?? 0) +
      (l.collectionFees ?? 0) + (l.rtoCharges ?? 0) + (l.returnCharges ?? 0) + (l.otherMarketplaceCharges ?? 0)
    return (mp / net) * 100
  }
  const marketingPctOf = (l: PnlLineValues) => {
    const net = l.netSales ?? 0
    if (net === 0) return 0
    return (((l.ads ?? 0) + (l.performanceMarketing ?? 0) + (l.otherMarketing ?? 0)) / net) * 100
  }

  const grossMarginDelta = (current.grossMarginPct ?? 0) - (previous.grossMarginPct ?? 0)
  const marketplaceDelta = marketplacePctOf(current) - marketplacePctOf(previous)
  const marketingDelta = marketingPctOf(current) - marketingPctOf(previous)

  const drivers: string[] = []
  if (delta < 0) {
    if (marketingDelta > 0.5) drivers.push(`advertising cost rose ${marketingDelta.toFixed(1)} pts as a share of net sales`)
    if (marketplaceDelta > 0.5) drivers.push(`marketplace/variable costs rose ${marketplaceDelta.toFixed(1)} pts as a share of net sales`)
    if (grossMarginDelta < -0.5) drivers.push(`gross margin fell ${Math.abs(grossMarginDelta).toFixed(1)} pts`)
  } else {
    if (marketingDelta < -0.5) drivers.push(`advertising cost fell ${Math.abs(marketingDelta).toFixed(1)} pts as a share of net sales`)
    if (marketplaceDelta < -0.5) drivers.push(`marketplace/variable costs fell ${Math.abs(marketplaceDelta).toFixed(1)} pts as a share of net sales`)
    if (grossMarginDelta > 0.5) drivers.push(`gross margin rose ${grossMarginDelta.toFixed(1)} pts`)
  }

  const direction = delta < 0 ? 'declined' : 'improved'
  const base = `Contribution margin ${direction} ${Math.abs(delta).toFixed(1)} percentage points MoM (from ${prevCm.toFixed(1)}% to ${curCm.toFixed(1)}%).`
  const explanation =
    drivers.length > 0
      ? ` This is explained by: ${drivers.join('; ')}.`
      : ' The available data does not establish a single primary driver for this change.'

  return {
    severity: delta < 0 ? 'orange' : 'green',
    category: 'margin',
    message: base + explanation,
  }
}

export interface SkuGrowthInput {
  sku: string
  productName: string
  currentUnits: number
  previousUnits: number
}

export function skuGrowthInsights(rows: SkuGrowthInput[]): Insight[] {
  const insights: Insight[] = []
  for (const row of rows) {
    const g = growthPct(row.currentUnits, row.previousUnits)
    if (g === null) continue
    if (g >= INSIGHT_THRESHOLDS.skuGrowthHighPct) {
      insights.push({ severity: 'green', category: 'sku', message: `${row.productName} unit sales grew ${g.toFixed(0)}% MoM.` })
    } else if (g <= INSIGHT_THRESHOLDS.skuDeclinePct) {
      insights.push({ severity: 'red', category: 'sku', message: `${row.productName} unit sales declined ${Math.abs(g).toFixed(0)}% MoM.` })
    }
  }
  return insights
}

export function rtoInsight(channel: BusinessChannelId, rtoUnits: number, quantity: number): Insight | null {
  if (quantity === 0) return null
  const rate = (rtoUnits / quantity) * 100
  if (rate >= INSIGHT_THRESHOLDS.rtoRateHighPct) {
    return {
      severity: 'orange',
      category: 'channel',
      message: `${channelLabel(channel)} RTO rate is ${rate.toFixed(1)}% of units, above the ${INSIGHT_THRESHOLDS.rtoRateHighPct}% threshold.`,
    }
  }
  return null
}

export function acosInsight(campaignOrChannel: string, acosPct: number): Insight | null {
  if (acosPct >= INSIGHT_THRESHOLDS.acosHighPct) {
    return {
      severity: 'orange',
      category: 'ads',
      message: `${campaignOrChannel} ACOS is ${acosPct.toFixed(1)}%, above the ${INSIGHT_THRESHOLDS.acosHighPct}% threshold.`,
    }
  }
  return null
}

export function inventoryInsight(sku: string, productName: string, coverageDays: number): Insight | null {
  if (coverageDays <= INSIGHT_THRESHOLDS.stockCoverageLowDays) {
    return {
      severity: 'red',
      category: 'inventory',
      message: `${productName} (${sku}) may stock out within ${Math.round(coverageDays)} days at current sales velocity.`,
    }
  }
  if (coverageDays >= INSIGHT_THRESHOLDS.excessStockDays) {
    return {
      severity: 'orange',
      category: 'inventory',
      message: `${productName} (${sku}) has ${Math.round(coverageDays)} days of stock coverage — excess inventory.`,
    }
  }
  return null
}
