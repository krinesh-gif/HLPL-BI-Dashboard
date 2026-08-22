import type { ChannelId } from '@/config/channels'
import { toMonthKey } from '@/lib/format'
import type { AdsRecord } from '@/data/models'
import type { MarketingByChannel } from './pnl'

/** Rolls up ad spend per channel for a month into the P&L engine's marketing input shape. */
export function marketingFromAds(adsRecords: AdsRecord[], month: string): MarketingByChannel {
  const result: MarketingByChannel = {}
  for (const record of adsRecords) {
    if (toMonthKey(record.date) !== month) continue
    const channel = record.channel as ChannelId
    const existing = result[channel] ?? { ads: 0 }
    existing.ads = (existing.ads ?? 0) + record.spend
    result[channel] = existing
  }
  return result
}
