// Central channel registry. Adding a marketplace means adding one entry here —
// no channel-specific logic should be hardcoded elsewhere in the app.

export type ChannelId =
  | 'amazon_in_seller'
  | 'amazon_in_vendor'
  | 'amazon_us'
  | 'flipkart'
  | 'meesho'
  | 'myntra'
  | 'nykaa'
  | 'purplle'

export interface ChannelDef {
  id: ChannelId
  label: string
  group: 'Amazon India' | 'Amazon USA' | 'Flipkart' | 'Meesho' | 'Myntra' | 'Nykaa' | 'Purplle'
  currency: 'INR' | 'USD'
  sellerType: 'seller_central' | 'vendor_central' | 'marketplace'
}

export const CHANNELS: ChannelDef[] = [
  { id: 'amazon_in_seller', label: 'Amazon India — Seller Central', group: 'Amazon India', currency: 'INR', sellerType: 'seller_central' },
  { id: 'amazon_in_vendor', label: 'Amazon India — Vendor Central', group: 'Amazon India', currency: 'INR', sellerType: 'vendor_central' },
  { id: 'amazon_us', label: 'Amazon USA', group: 'Amazon USA', currency: 'USD', sellerType: 'seller_central' },
  { id: 'flipkart', label: 'Flipkart', group: 'Flipkart', currency: 'INR', sellerType: 'marketplace' },
  { id: 'meesho', label: 'Meesho', group: 'Meesho', currency: 'INR', sellerType: 'marketplace' },
  { id: 'myntra', label: 'Myntra', group: 'Myntra', currency: 'INR', sellerType: 'marketplace' },
  { id: 'nykaa', label: 'Nykaa', group: 'Nykaa', currency: 'INR', sellerType: 'marketplace' },
  { id: 'purplle', label: 'Purplle', group: 'Purplle', currency: 'INR', sellerType: 'marketplace' },
]

export const CHANNEL_MAP: Record<ChannelId, ChannelDef> = Object.fromEntries(
  CHANNELS.map((c) => [c.id, c]),
) as Record<ChannelId, ChannelDef>

// Default fixed-expense allocation weights (Sales Contribution Method).
// Recomputed dynamically from actual sales share when real data exists;
// these are only the fallback when no sales data is available yet.
export const DEFAULT_ALLOCATION_WEIGHTS: Record<ChannelId, number> = {
  amazon_in_seller: 0.45,
  amazon_in_vendor: 0.05,
  amazon_us: 0.1,
  flipkart: 0.2,
  meesho: 0.15,
  myntra: 0.03,
  nykaa: 0.01,
  purplle: 0.01,
}
