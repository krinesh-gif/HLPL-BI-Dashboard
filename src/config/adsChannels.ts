import type { BusinessChannelId } from './channels'

/**
 * Advertising has its own channel list, deliberately.
 *
 * It is not the sales channel list: Meesho and Purplle sell without an ads
 * report to upload, and the two lists will keep diverging as platforms are
 * added. Reusing the sales list would put permanently empty pages in the
 * navigation and imply data that does not exist.
 *
 * Amazon India is one ads channel, matching the sales side. Its spend is not
 * split into Seller and Vendor unless a report actually arrives that way.
 */
export type AdsChannelId = Extract<
  BusinessChannelId,
  'amazon_in' | 'amazon_us' | 'flipkart' | 'myntra' | 'nykaa' | 'blinkit'
>

export interface AdsChannelDef {
  id: AdsChannelId
  label: string
  /**
   * True where the platform bills through a monthly invoice rather than a
   * downloadable campaign report — Nykaa's marketing-investment figure. Those
   * channels get a manual entry form instead of an upload-only page.
   */
  usesMonthlyInvoice: boolean
  /** What the manual figure is called on that platform's invoice. */
  invoiceLabel?: string
  /**
   * Metrics this platform's own report does not publish.
   *
   * Summing a column that is not in the file gives zero, and zero clicks
   * beside 29 impressions reads as a campaign nobody touched rather than a
   * number the platform never measured. Blinkit's report carries impressions,
   * spend and attributed sales, and neither clicks nor orders.
   */
  reportOmits?: ('clicks' | 'adOrders')[]
}

export const ADS_CHANNELS: AdsChannelDef[] = [
  { id: 'amazon_in', label: 'Amazon India', usesMonthlyInvoice: false },
  { id: 'amazon_us', label: 'Amazon USA', usesMonthlyInvoice: false },
  { id: 'flipkart', label: 'Flipkart', usesMonthlyInvoice: false },
  { id: 'myntra', label: 'Myntra', usesMonthlyInvoice: false },
  { id: 'nykaa', label: 'Nykaa', usesMonthlyInvoice: true, invoiceLabel: 'MI value' },
  { id: 'blinkit', label: 'Blinkit', usesMonthlyInvoice: false, reportOmits: ['clicks', 'adOrders'] },
]

export const ADS_CHANNEL_IDS: AdsChannelId[] = ADS_CHANNELS.map((c) => c.id)

export const ADS_CHANNEL_MAP: Record<AdsChannelId, AdsChannelDef> = Object.fromEntries(
  ADS_CHANNELS.map((c) => [c.id, c]),
) as Record<AdsChannelId, AdsChannelDef>

export function isAdsChannel(id: string): id is AdsChannelId {
  return ADS_CHANNEL_IDS.includes(id as AdsChannelId)
}

export function adsChannelLabel(id: AdsChannelId): string {
  return ADS_CHANNEL_MAP[id]?.label ?? id
}
