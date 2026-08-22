import type { ChannelId } from './channels'

// Default fee-rate assumptions per channel, expressed as % of gross sales
// (or % of orders for RTO/return rate). These are placeholders used only
// where an actual marketplace charge report hasn't been uploaded yet —
// once real charge data exists for a channel/month it should override these.
export interface ChannelFeeRates {
  commissionPct: number
  fulfilmentPct: number
  shippingPct: number
  collectionPct: number
  rtoRatePct: number
  returnRatePct: number
}

export const DEFAULT_CHANNEL_FEE_RATES: Record<ChannelId, ChannelFeeRates> = {
  amazon_in_seller: { commissionPct: 15, fulfilmentPct: 8, shippingPct: 2, collectionPct: 1.5, rtoRatePct: 6, returnRatePct: 4 },
  amazon_in_vendor: { commissionPct: 18, fulfilmentPct: 0, shippingPct: 0, collectionPct: 1, rtoRatePct: 2, returnRatePct: 3 },
  amazon_us: { commissionPct: 15, fulfilmentPct: 10, shippingPct: 2, collectionPct: 2, rtoRatePct: 3, returnRatePct: 5 },
  flipkart: { commissionPct: 14, fulfilmentPct: 6, shippingPct: 2.5, collectionPct: 1.5, rtoRatePct: 9, returnRatePct: 5 },
  meesho: { commissionPct: 10, fulfilmentPct: 5, shippingPct: 3, collectionPct: 1, rtoRatePct: 14, returnRatePct: 3 },
  myntra: { commissionPct: 20, fulfilmentPct: 6, shippingPct: 2, collectionPct: 1.5, rtoRatePct: 7, returnRatePct: 6 },
  nykaa: { commissionPct: 22, fulfilmentPct: 5, shippingPct: 2, collectionPct: 1.5, rtoRatePct: 5, returnRatePct: 4 },
  purplle: { commissionPct: 18, fulfilmentPct: 5, shippingPct: 2, collectionPct: 1.5, rtoRatePct: 6, returnRatePct: 4 },
}
