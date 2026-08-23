import type { BusinessChannelId } from '@/config/channels'
import { channelOfSource } from '@/config/channels'
import { toMonthKey } from '@/lib/format'
import type { AdsRecord, ManualAdSpend } from '@/data/models'
import type { MarketingByChannel } from './pnl'

/**
 * Rolls up ad spend per business channel for a month, into the shape the P&L
 * engine takes as its marketing input.
 *
 * Ad records are keyed by the report they came from, so Amazon India's Seller
 * and Vendor spend land on one channel here rather than on two.
 */
export function marketingFromAds(
  adsRecords: AdsRecord[],
  month: string,
  manualAdSpend: ManualAdSpend[] = [],
): MarketingByChannel {
  const result: MarketingByChannel = {}

  for (const record of adsRecords) {
    if (toMonthKey(record.date) !== month) continue
    const channel: BusinessChannelId = channelOfSource(record.channel)
    const existing = result[channel] ?? { ads: 0 }
    existing.ads = (existing.ads ?? 0) + record.spend
    result[channel] = existing
  }

  // A manual figure fills a channel-month that no report covers. It is real
  // money and belongs in the P&L. It is added only where a report is absent,
  // since a month with both would otherwise be counted twice — the same
  // priority the Ads screens apply.
  for (const entry of manualAdSpend) {
    if (entry.month !== month) continue
    const channel = entry.channel as BusinessChannelId
    if (result[channel]) continue
    result[channel] = { ads: entry.amount }
  }

  return result
}
