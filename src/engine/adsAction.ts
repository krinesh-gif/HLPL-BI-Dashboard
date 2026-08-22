import { ADS_ACTION_THRESHOLDS } from '@/config/thresholds'

export type AdsActionType = 'SCALE' | 'REDUCE_BID' | 'NEGATIVE_KEYWORD' | 'PAUSE' | 'INVESTIGATE' | 'PROTECT'

export interface AdsActionRecommendation {
  action: AdsActionType
  reason: string
}

export interface CampaignAggregate {
  campaign: string
  spend: number
  adSales: number
  adOrders: number
  /** Trailing average ROAS from before the most recent window, for detecting sudden deterioration. */
  trailingRoas?: number
  /** Number of consecutive days this campaign has shown poor performance (ROAS < 1). */
  consecutivePoorDays?: number
  /** Share of total ad-attributed sales this campaign represents (0-1). */
  salesShare?: number
}

function roas(spend: number, adSales: number): number {
  return spend > 0 ? adSales / spend : 0
}

/**
 * Rule order matters: PAUSE and NEGATIVE_KEYWORD (structural failure) are
 * checked before REDUCE_BID (partial inefficiency), and INVESTIGATE (a sudden
 * change) is checked before steady-state SCALE/PROTECT calls.
 */
export function recommendAdsAction(c: CampaignAggregate): AdsActionRecommendation {
  const t = ADS_ACTION_THRESHOLDS
  const currentRoas = roas(c.spend, c.adSales)

  if (c.adOrders === 0 && c.spend >= t.negativeKeywordMinSpend) {
    return {
      action: 'NEGATIVE_KEYWORD',
      reason: `Spent ₹${c.spend.toFixed(0)} with zero attributed orders — add as negative keyword / exclude placement.`,
    }
  }

  if ((c.consecutivePoorDays ?? 0) >= t.pauseMinDaysPoorPerformance && currentRoas < t.reduceBidMaxRoas) {
    return {
      action: 'PAUSE',
      reason: `ROAS has stayed below ${t.reduceBidMaxRoas}x for ${c.consecutivePoorDays} consecutive days.`,
    }
  }

  if (
    c.trailingRoas !== undefined &&
    c.trailingRoas > 0 &&
    ((currentRoas - c.trailingRoas) / c.trailingRoas) * 100 <= t.investigateDropPct
  ) {
    return {
      action: 'INVESTIGATE',
      reason: `ROAS dropped from ${c.trailingRoas.toFixed(1)}x to ${currentRoas.toFixed(1)}x — sudden deterioration warrants review before acting.`,
    }
  }

  if (currentRoas >= t.protectMinRoas && (c.salesShare ?? 0) >= t.protectMinSalesShare) {
    return {
      action: 'PROTECT',
      reason: `ROAS of ${currentRoas.toFixed(1)}x with ${((c.salesShare ?? 0) * 100).toFixed(0)}% of ad-attributed sales — maintain budget and bids.`,
    }
  }

  if (currentRoas >= t.scaleMinRoas && c.adOrders >= t.scaleMinConversions) {
    return {
      action: 'SCALE',
      reason: `ROAS of ${currentRoas.toFixed(1)}x with ${c.adOrders} orders — increase budget to capture more volume.`,
    }
  }

  if (currentRoas > 0 && currentRoas <= t.reduceBidMaxRoas && c.spend >= t.reduceBidMinSpend) {
    return {
      action: 'REDUCE_BID',
      reason: `ROAS of ${currentRoas.toFixed(1)}x on ₹${c.spend.toFixed(0)} spend — reduce bids to improve efficiency.`,
    }
  }

  return {
    action: 'INVESTIGATE',
    reason: `ROAS of ${currentRoas.toFixed(1)}x does not clearly match a scale, reduce, or pause pattern — review manually.`,
  }
}
