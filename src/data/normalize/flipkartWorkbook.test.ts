import { describe, expect, it } from 'vitest'
import { detectFlipkartWorkbook, normalizeFlipkartWorkbook } from './flipkartWorkbook'
import type { RawSheet } from '@/lib/csvParse'
import type { SkuMaster } from '@/data/models'

const skuMaster: SkuMaster[] = [
  { sku: 'AO/HBR/Cleanser/100', productName: 'Barrier Repair Cleanser', category: 'Skin Care', brand: 'Aravi Organic', cogs: 46, mrp: 249, standardSellingPrice: 249, launchDate: '2025-01-01', status: 'active', leadTimeDays: 21, minimumStock: 200, safetyStock: 120 },
]

// A trimmed-down but structurally faithful "Overall Summary" sheet.
const overallSummary: RawSheet = [
  ['Report Specifications'],
  ['Report Type:', 'Profit & Loss Report'],
  ['Orders Recieved During:', '2026-07-01 to 2026-07-31'],
  ['PNL Summary'],
  ['Item', 'Amount (INR)', 'Units'],
  ['Gross Sales', 100000, 500],
  ['Estimated Net Sales', 80000, 400],
  ['Seller-Funded Discount', -1000],
  ['Customer Add-Ons Amount', 500],
  ['Accounted Net Sales (Seller Price)', 79500],
  ['• Commission Fee', -8000],
  ['• Collection Fee', 0],
  ['• Fixed Fee', -4000],
  ['• Pick and Pack Fee', -3000],
  ['• Forward Shipping Fee', 0],
  ['• Offer adjustments', 0],
  ['• Reverse Shipping Fee', -500],
  ['• Storage Fee', -900],
  ['• Recall Fee', 0],
  ['• No Cost Emi Fee Reimbursement', 0],
  ['• Installation Fee', 0],
  ['• Tech Visit Fee', 0],
  ['• Uninstallation & Packaging Fee', 0],
  ['• Customer Add-ons Amount Recovery', 0],
  ['• Franchise Fee', 0],
  ['• Shopsy Marketing Fee', 0],
  ['• Product Cancellation Fee', 10],
  ['• Ads', -6000],
  ['• Google Ads', 0],
  ['• Value Added Services (VAS)', 0],
  ['• Taxes (GST)', -4000],
  ['• Taxes (TCS)', -300],
  ['• Taxes (TDS)', -60],
  ['Rewards & Other Benefits', 100],
]

const ordersP_L: RawSheet = [
  ['Order Date', 'Order ID', 'Order Item ID', 'SKU Name', 'Fulfillment Type', 'Channel of Sale', 'Mode of Payment', 'Order Status', '', 'Gross Units', 'Returned & Cancelled Units', 'Returned & Cancelled Units (Breakup)', '', '', 'Net Units ', '', 'Order Item Value', 'Final Selling Price (FSP)', 'Handling Fee', 'Estimated Net Sales (INR)'],
  ['', '', '', '', '', '', '', '', '', '', '', 'RTO (Logistics Return)', 'RVP (Customer Return)', 'Cancelled Units', '', '', '', '', '', ''],
  ['2026-07-04', 'OD1', 'OI1', 'AO/HBR/Cleanser/100', 'NON_FBF', 'Flipkart', 'postpaid', 'DELIVERED', '', 2, 0, 0, 0, 0, 2, '', '498.00', 249, 5, 460],
  ['2026-07-05', 'OD2', 'OI2', 'UNKNOWN-SKU', 'NON_FBF', 'Flipkart', 'prepaid', 'RTO', '', 1, 1, 1, 0, 0, 0, '', '199.00', 199, 0, 0],
]

const sheets: Record<string, RawSheet> = { 'Overall Summary': overallSummary, 'Orders P&L': ordersP_L }

describe('detectFlipkartWorkbook', () => {
  it('recognizes the real sheet names', () => {
    expect(detectFlipkartWorkbook(['Overall Summary', 'SKU-level P&L', 'Orders P&L', 'Report Help'])).toBe(true)
  })
  it('rejects an unrelated workbook', () => {
    expect(detectFlipkartWorkbook(['Sheet1'])).toBe(false)
  })
})

describe('normalizeFlipkartWorkbook', () => {
  it('extracts the report month from Overall Summary without needing manual entry', () => {
    const result = normalizeFlipkartWorkbook(sheets, skuMaster, 'import-1')
    expect(result.month).toBe('2026-07')
    expect(result.facts.month).toBe('2026-07')
  })

  it('pulls fee totals directly from Overall Summary as positive magnitudes', () => {
    const result = normalizeFlipkartWorkbook(sheets, skuMaster, 'import-1')
    expect(result.facts.commissionFee).toBe(8000)
    expect(result.facts.flipkartAds).toBe(6000)
    expect(result.facts.sellerFundedDiscount).toBe(1000)
    expect(result.facts.outputGst).toBe(4360) // 4000 + 300 + 60
  })

  it('builds daily canonical records from Orders P&L with real per-row dates', () => {
    const result = normalizeFlipkartWorkbook(sheets, skuMaster, 'import-1')
    expect(result.validRecords).toHaveLength(2)
    expect(result.validRecords[0].orderDate).toBe('2026-07-04')
    expect(result.validRecords[1].orderDate).toBe('2026-07-05')
    expect(result.validRecords[1].status).toBe('rto')
  })

  it('splits COGS into priced (via SKU master) and unpriced (25% estimate) buckets', () => {
    const result = normalizeFlipkartWorkbook(sheets, skuMaster, 'import-1')
    expect(result.facts.cogsPriced).toBe(2 * 46) // matched SKU, net units 2
    expect(result.facts.cogsUnpriced).toBeCloseTo(199 * 0.25) // unmatched SKU
    expect(result.warnings.some((w) => w.includes('not found in the Product Master'))).toBe(true)
  })
})
