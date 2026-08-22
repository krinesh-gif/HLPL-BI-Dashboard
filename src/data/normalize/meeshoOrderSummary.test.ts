import { describe, expect, it } from 'vitest'
import { detectMeeshoOrderSummaryReport, normalizeMeeshoOrderSummary } from './meeshoOrderSummary'
import type { SkuMaster } from '@/data/models'

const skuMaster: SkuMaster[] = [
  { sku: 'AO/LBalm/Tinted(BT)', productName: 'Beetroot Tinted Lip Balm', category: 'Lip Care', brand: 'Aravi Organic', cogs: 21, mrp: 279, standardSellingPrice: 279, launchDate: '2025-01-01', status: 'active', leadTimeDays: 18, minimumStock: 200, safetyStock: 120 },
]

const headers = ['Sub orderId', 'Catalog ID', 'Quantity', 'Price', 'Order Date', 'Order Status', 'Payout Value', 'Payout Status', 'Claim Status', 'SKU ID']

describe('detectMeeshoOrderSummaryReport', () => {
  it('recognizes the real header set', () => {
    expect(detectMeeshoOrderSummaryReport(headers)).toBe(true)
  })
})

describe('normalizeMeeshoOrderSummary', () => {
  it('normalizes a completed order row', () => {
    const rows = [
      { 'Sub orderId': '281254221322552000_1', 'Catalog ID': '117841093', Quantity: '1', Price: '328.00', 'Order Date': '2026-04-30', 'Order Status': 'Delivered', 'Payout Value': '250.00', 'Payout Status': 'NA', 'Claim Status': '', 'SKU ID': 'AO/LBalm/Tinted(BT)' },
    ]
    const result = normalizeMeeshoOrderSummary(rows, skuMaster, 'import-1')
    expect(result.validRecords).toHaveLength(1)
    const r = result.validRecords[0]
    expect(r.status).toBe('completed')
    expect(r.grossSales).toBe(328)
    expect(r.netSales).toBe(250)
    expect(r.marketplaceFee).toBe(78)
  })

  it('flags an RTO row with zero payout', () => {
    const rows = [
      { 'Sub orderId': '1', 'Catalog ID': '1', Quantity: '1', Price: '328.00', 'Order Date': '2026-04-30', 'Order Status': 'RTO', 'Payout Value': '0.00', 'Payout Status': 'NA', 'Claim Status': '', 'SKU ID': 'AO/LBalm/Tinted(BT)' },
    ]
    const result = normalizeMeeshoOrderSummary(rows, skuMaster, 'import-1')
    expect(result.validRecords[0].status).toBe('rto')
    expect(result.validRecords[0].rtoUnits).toBe(1)
    expect(result.validRecords[0].netSales).toBe(0)
  })
})
