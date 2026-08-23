// Central channel registry. Adding a marketplace means adding one entry here —
// no channel-specific logic should be hardcoded elsewhere in the app.

/**
 * Two different things get called a "channel", and confusing them is what made
 * Amazon India look like two businesses.
 *
 *   BUSINESS CHANNEL — how management thinks about the business. Amazon India
 *   is one channel worth ₹1 Cr. This is what every dashboard, chart, P&L and
 *   insight reports on.
 *
 *   DATA SOURCE — which report a row was uploaded from. Amazon India has two:
 *   Seller Central and Vendor Central. They are processed separately because
 *   they are genuinely different reports, and they stay separate underneath so
 *   the ₹1 Cr can always be broken back down into ₹80 L + ₹20 L.
 *
 * Sales rows are stored against the SOURCE, because that is what the uploaded
 * file actually tells us and it is the more detailed fact. Management figures
 * roll sources up to their business channel. Nothing in the database changes
 * when the management view is reorganised, and no detail is ever lost.
 */

/** What a stored sales row is keyed by — the report it came from. */
export type SalesSourceId =
  | 'amazon_in_seller'
  | 'amazon_in_vendor'
  | 'amazon_us'
  | 'flipkart'
  | 'meesho'
  | 'myntra'
  | 'nykaa'
  | 'purplle'

/** What management sees. */
export type BusinessChannelId =
  | 'amazon_in'
  | 'amazon_us'
  | 'flipkart'
  | 'meesho'
  | 'myntra'
  | 'nykaa'
  | 'purplle'

/**
 * Retained as the name for a stored row's key, because that is what every
 * persisted record and every normalizer already uses. It is a source id.
 */
export type ChannelId = SalesSourceId

export interface SalesSourceDef {
  id: SalesSourceId
  /** The business channel this source rolls up into. */
  channel: BusinessChannelId
  /** How this source is named when drilling into its channel. */
  label: string
  currency: 'INR' | 'USD'
  sellerType: 'seller_central' | 'vendor_central' | 'marketplace'
}

export interface BusinessChannelDef {
  id: BusinessChannelId
  label: string
  currency: 'INR' | 'USD'
}

/** The management-level channel list. Adding a marketplace starts here. */
export const BUSINESS_CHANNELS: BusinessChannelDef[] = [
  { id: 'amazon_in', label: 'Amazon India', currency: 'INR' },
  { id: 'amazon_us', label: 'Amazon USA', currency: 'USD' },
  { id: 'flipkart', label: 'Flipkart', currency: 'INR' },
  { id: 'meesho', label: 'Meesho', currency: 'INR' },
  { id: 'myntra', label: 'Myntra', currency: 'INR' },
  { id: 'nykaa', label: 'Nykaa', currency: 'INR' },
  { id: 'purplle', label: 'Purplle', currency: 'INR' },
]

/** Every report the system accepts, and which channel it belongs to. */
export const SALES_SOURCES: SalesSourceDef[] = [
  { id: 'amazon_in_seller', channel: 'amazon_in', label: 'Seller Central', currency: 'INR', sellerType: 'seller_central' },
  { id: 'amazon_in_vendor', channel: 'amazon_in', label: 'Vendor Central', currency: 'INR', sellerType: 'vendor_central' },
  { id: 'amazon_us', channel: 'amazon_us', label: 'Amazon USA', currency: 'USD', sellerType: 'seller_central' },
  { id: 'flipkart', channel: 'flipkart', label: 'Flipkart', currency: 'INR', sellerType: 'marketplace' },
  { id: 'meesho', channel: 'meesho', label: 'Meesho', currency: 'INR', sellerType: 'marketplace' },
  { id: 'myntra', channel: 'myntra', label: 'Myntra', currency: 'INR', sellerType: 'marketplace' },
  { id: 'nykaa', channel: 'nykaa', label: 'Nykaa', currency: 'INR', sellerType: 'marketplace' },
  { id: 'purplle', channel: 'purplle', label: 'Purplle', currency: 'INR', sellerType: 'marketplace' },
]

export const BUSINESS_CHANNEL_MAP: Record<BusinessChannelId, BusinessChannelDef> = Object.fromEntries(
  BUSINESS_CHANNELS.map((c) => [c.id, c]),
) as Record<BusinessChannelId, BusinessChannelDef>

export const SOURCE_MAP: Record<SalesSourceId, SalesSourceDef> = Object.fromEntries(
  SALES_SOURCES.map((s) => [s.id, s]),
) as Record<SalesSourceId, SalesSourceDef>

export const BUSINESS_CHANNEL_IDS: BusinessChannelId[] = BUSINESS_CHANNELS.map((c) => c.id)

/** The business channel a stored row belongs to. */
export function channelOfSource(source: SalesSourceId): BusinessChannelId {
  return SOURCE_MAP[source]?.channel ?? (source as unknown as BusinessChannelId)
}

/** Every source that rolls up into a channel. */
export function sourcesOfChannel(channel: BusinessChannelId): SalesSourceDef[] {
  return SALES_SOURCES.filter((s) => s.channel === channel)
}

/** True when a channel is fed by more than one report, and so has a drill-down
 * worth offering. Only Amazon India today; the check is general so a second
 * such channel needs no new UI logic. */
export function hasMultipleSources(channel: BusinessChannelId): boolean {
  return sourcesOfChannel(channel).length > 1
}

export function channelLabel(channel: BusinessChannelId): string {
  return BUSINESS_CHANNEL_MAP[channel]?.label ?? channel
}

export function sourceLabel(source: SalesSourceId): string {
  return SOURCE_MAP[source]?.label ?? source
}

/**
 * `SOURCE_MAP` under its old name.
 *
 * Kept because the SKU-mapping and upload screens legitimately report which
 * *report* a code came from — a source-level question, not a management one.
 */
export const CHANNEL_MAP = SOURCE_MAP

/** Sources, under the old name. Management code should use BUSINESS_CHANNELS. */
export const CHANNELS = SALES_SOURCES

// Default fixed-expense allocation weights (Sales Contribution Method), keyed
// by business channel. Recomputed dynamically from actual sales share when real
// data exists; these are only the fallback when no sales data is available yet.
export const DEFAULT_ALLOCATION_WEIGHTS: Record<BusinessChannelId, number> = {
  amazon_in: 0.5,
  amazon_us: 0.1,
  flipkart: 0.2,
  meesho: 0.15,
  myntra: 0.03,
  nykaa: 0.01,
  purplle: 0.01,
}
