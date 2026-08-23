export interface NavLeaf {
  label: string
  path: string
}

export interface NavSection {
  label: string
  path?: string
  children?: NavLeaf[]
}

/**
 * The navigation reflects how the business is run, not how the data arrives.
 *
 * Channels are the seven business channels. Amazon India appears once, with
 * Seller Central and Vendor Central available as a drill-down inside it rather
 * than as two entries here.
 *
 * P&L is a single top-level section. It is deliberately NOT repeated inside
 * each channel: one report, one format, one place it can be produced from.
 */
export const NAVIGATION: NavSection[] = [
  { label: 'Overview', path: '/' },
  { label: 'Business Insight', path: '/insight' },
  { label: 'Investor MIS', path: '/mis' },
  { label: 'P&L', path: '/pnl' },
  {
    label: 'Channels',
    children: [
      { label: 'Amazon India', path: '/channels/amazon_in' },
      { label: 'Amazon USA', path: '/channels/amazon_us' },
      { label: 'Flipkart', path: '/channels/flipkart' },
      { label: 'Meesho', path: '/channels/meesho' },
      { label: 'Myntra', path: '/channels/myntra' },
      { label: 'Nykaa', path: '/channels/nykaa' },
      { label: 'Purplle', path: '/channels/purplle' },
    ],
  },
  {
    label: 'Sales',
    children: [
      { label: 'Daily Sales', path: '/sales/daily' },
      { label: 'Monthly Sales', path: '/sales/monthly' },
      { label: 'Channel Sales', path: '/sales/channel' },
      { label: 'SKU Sales', path: '/products/sku-analytics' },
      { label: 'ASP Analysis', path: '/sales/asp' },
      { label: 'RTO Analysis', path: '/sales/rto' },
    ],
  },
  {
    label: 'Marketing',
    children: [
      { label: 'Ads Overview', path: '/marketing/ads' },
      { label: 'Amazon India', path: '/marketing/ads/amazon_in' },
      { label: 'Amazon USA', path: '/marketing/ads/amazon_us' },
      { label: 'Flipkart', path: '/marketing/ads/flipkart' },
      { label: 'Myntra', path: '/marketing/ads/myntra' },
      { label: 'Nykaa', path: '/marketing/ads/nykaa' },
    ],
  },
  {
    label: 'Supply Chain',
    children: [
      { label: 'Inventory', path: '/supply-chain/inventory' },
      { label: 'Forecast', path: '/supply-chain/forecast' },
      { label: 'Procurement', path: '/supply-chain/procurement' },
    ],
  },
  { label: 'Product Master', path: '/products/master' },
  { label: 'Cost Master', path: '/products/cost-sheet' },
  { label: 'SKU Mapping', path: '/products/sku-mapping' },
  { label: 'Fixed Expenses', path: '/pnl/fixed-expenses' },
  { label: 'Net Sales Reconciliation', path: '/pnl/reconciliation' },
  {
    label: 'Data',
    children: [
      { label: 'Data Upload', path: '/data/upload' },
      { label: 'Import History', path: '/data/import-history' },
    ],
  },
  {
    label: 'Settings',
    children: [
      { label: 'General', path: '/settings' },
      { label: 'Team', path: '/settings/team' },
    ],
  },
]
