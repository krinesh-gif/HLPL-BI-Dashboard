export interface NavLeaf {
  label: string
  path: string
}

export interface NavSection {
  label: string
  path?: string
  children?: NavLeaf[]
}

export const NAVIGATION: NavSection[] = [
  { label: 'Overview', path: '/' },
  { label: 'Investor MIS', path: '/mis' },
  {
    label: 'P&L',
    children: [
      { label: 'Master P&L', path: '/pnl/master' },
      { label: 'Channel P&L', path: '/pnl/channel' },
      { label: 'Fixed Expenses', path: '/pnl/fixed-expenses' },
    ],
  },
  { label: 'Business Insight', path: '/insight' },
  {
    label: 'Channels',
    children: [
      { label: 'Amazon India — Seller', path: '/channels/amazon_in_seller' },
      { label: 'Amazon India — Vendor', path: '/channels/amazon_in_vendor' },
      { label: 'Amazon USA', path: '/channels/amazon_us' },
      { label: 'Flipkart', path: '/channels/flipkart' },
      { label: 'Meesho', path: '/channels/meesho' },
      { label: 'Myntra', path: '/channels/myntra' },
      { label: 'Nykaa', path: '/channels/nykaa' },
      { label: 'Purplle', path: '/channels/purplle' },
    ],
  },
  {
    label: 'Marketing',
    children: [{ label: 'Amazon Ads', path: '/marketing/amazon-ads' }],
  },
  {
    label: 'Products',
    children: [
      { label: 'SKU Analytics', path: '/products/sku-analytics' },
      { label: 'Product Master', path: '/products/master' },
    ],
  },
  {
    label: 'Sales',
    children: [
      { label: 'Daily Sales', path: '/sales/daily' },
      { label: 'Monthly Sales', path: '/sales/monthly' },
      { label: 'Channel Sales', path: '/sales/channel' },
    ],
  },
  {
    label: 'Supply Chain',
    children: [
      { label: 'Inventory Dashboard', path: '/supply-chain/inventory' },
      { label: 'Demand Forecast', path: '/supply-chain/forecast' },
      { label: 'Procurement Planning', path: '/supply-chain/procurement' },
    ],
  },
  {
    label: 'Data',
    children: [
      { label: 'Upload Reports', path: '/data/upload' },
      { label: 'Import History', path: '/data/import-history' },
    ],
  },
  { label: 'Settings', path: '/settings' },
]
